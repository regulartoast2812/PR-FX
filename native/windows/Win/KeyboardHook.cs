using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

namespace PrFxShortcutListener
{
    // Port of PRFXKeyTap.swift: one low-level keyboard hook that is never
    // unregistered while the listener runs, deciding per keystroke.
    //
    // Runs on its own thread with its own message loop, so a busy palette or
    // toast on the UI thread can never stall the hook. Windows silently removes
    // a low-level hook whose callback exceeds LowLevelHooksTimeout, and while it
    // stalls every keystroke on the machine waits. The callback therefore only
    // reads cached state; everything else is posted to the UI thread.
    //
    // The foreground-window event hook lives on the same thread, so Premiere
    // activation is tracked without polling and the keyboard hook is
    // reinstalled on every activation (cheap insurance against the silent
    // removal above, which has no notification).
    internal sealed class KeyboardHook
    {
        public delegate bool KeyDecision(KeyChord chord);

        private const uint WM_REINSTALL = Native.WM_APP + 1;

        private readonly KeyDecision decide;
        private readonly Native.LowLevelKeyboardProc keyProc;
        private readonly Native.WinEventDelegate foregroundProc;
        private readonly Dictionary<uint, bool> premierePids = new Dictionary<uint, bool>();
        // Consumed keys also swallow their keyUp and auto-repeats; otherwise
        // Premiere sees an orphan keyUp or a run of repeated letters.
        private readonly HashSet<uint> swallowed = new HashSet<uint>();
        private Thread? thread;
        private uint threadId;
        private IntPtr keyHook = IntPtr.Zero;
        private IntPtr foregroundHook = IntPtr.Zero;

        private volatile bool premiereFrontmost;
        private volatile IntPtr premiereWindow = IntPtr.Zero;
        private volatile uint premiereThread;
        private int reinstalls;

        public bool PremiereFrontmost => premiereFrontmost;
        public IntPtr PremiereWindow => premiereWindow;
        public uint PremiereThread => premiereThread;
        public int Reinstalls => Volatile.Read(ref reinstalls);
        public bool Installed => keyHook != IntPtr.Zero;
        public Action<bool>? ForegroundChanged;
        public Action<string>? Log;
        public volatile bool LogKeys;
        public volatile bool AcceptInjected;

        public KeyboardHook(KeyDecision decide)
        {
            this.decide = decide;
            keyProc = HookCallback;
            foregroundProc = ForegroundCallback;
        }

        public void Start()
        {
            var ready = new ManualResetEventSlim(false);
            thread = new Thread(() => Loop(ready)) { IsBackground = true, Name = "PRFX keyboard hook" };
            thread.Start();
            ready.Wait(3000);
        }

        public void Reinstall()
        {
            if (threadId != 0) Native.PostThreadMessage(threadId, WM_REINSTALL, IntPtr.Zero, IntPtr.Zero);
        }

        public void Stop()
        {
            if (threadId != 0) Native.PostThreadMessage(threadId, Native.WM_QUIT, IntPtr.Zero, IntPtr.Zero);
        }

        private void Loop(ManualResetEventSlim ready)
        {
            threadId = Native.GetCurrentThreadId();
            Install();
            foregroundHook = Native.SetWinEventHook(Native.EVENT_SYSTEM_FOREGROUND, Native.EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, foregroundProc, 0, 0, Native.WINEVENT_OUTOFCONTEXT);
            UpdateForeground(Native.GetForegroundWindow());
            ready.Set();
            // Low-level hook and out-of-context WinEvent callbacks are delivered
            // from inside GetMessage; nothing needs dispatching.
            while (Native.GetMessage(out var message, IntPtr.Zero, 0, 0) > 0)
            {
                if (message.message == WM_REINSTALL) Install();
            }
            if (keyHook != IntPtr.Zero) Native.UnhookWindowsHookEx(keyHook);
            if (foregroundHook != IntPtr.Zero) Native.UnhookWinEvent(foregroundHook);
            keyHook = foregroundHook = IntPtr.Zero;
        }

        private void Install()
        {
            var previous = keyHook;
            var module = Native.GetModuleHandle(null);
            var installed = Native.SetWindowsHookEx(Native.WH_KEYBOARD_LL, keyProc, module, 0);
            if (installed == IntPtr.Zero)
            {
                Log?.Invoke("Keyboard hook install failed: Win32 error " + Marshal.GetLastWin32Error());
                return;
            }
            keyHook = installed;
            if (previous != IntPtr.Zero)
            {
                Native.UnhookWindowsHookEx(previous);
                Interlocked.Increment(ref reinstalls);
            }
            swallowed.Clear();
        }

        private void ForegroundCallback(IntPtr hook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint eventThread, uint eventTime)
        {
            UpdateForeground(hwnd);
        }

        private void UpdateForeground(IntPtr hwnd)
        {
            var wasPremiere = premiereFrontmost;
            uint pid = 0;
            var tid = hwnd == IntPtr.Zero ? 0u : Native.GetWindowThreadProcessId(hwnd, out pid);
            var isPremiere = tid != 0 && IsPremiereProcess(pid);
            premiereFrontmost = isPremiere;
            if (isPremiere)
            {
                premiereWindow = hwnd;
                premiereThread = tid;
                if (!wasPremiere) Install();
            }
            swallowed.Clear();
            if (isPremiere != wasPremiere)
            {
                // Which window took the front, so a wrong "Premiere is not frontmost" can be traced.
                var image = pid == 0 ? "" : System.IO.Path.GetFileName(Native.ProcessImagePath(pid));
                var cls = new System.Text.StringBuilder(128);
                if (hwnd != IntPtr.Zero) Native.GetClassName(hwnd, cls, cls.Capacity);
                var line = "Foreground: " + (isPremiere ? "Premiere" : "not Premiere") + " (" + image + ", class " + cls + ")";
                ThreadPool.QueueUserWorkItem(_ => Log?.Invoke(line));
                ForegroundChanged?.Invoke(isPremiere);
            }
        }

        // "Adobe Premiere Pro.exe" on every release so far, and "Adobe Premiere
        // Pro (Beta).exe" for the beta. Cached per process: the image-path query
        // opens a process handle, which does not belong on the hot path.
        private bool IsPremiereProcess(uint pid)
        {
            if (pid == 0) return false;
            if (premierePids.TryGetValue(pid, out var known)) return known;
            var image = System.IO.Path.GetFileName(Native.ProcessImagePath(pid));
            var result = image.StartsWith("Adobe Premiere Pro", StringComparison.OrdinalIgnoreCase);
            if (premierePids.Count > 512) premierePids.Clear();
            premierePids[pid] = result;
            return result;
        }

        private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode < 0) return Native.CallNextHookEx(keyHook, nCode, wParam, lParam);
            var info = Marshal.PtrToStructure<Native.KBDLLHOOKSTRUCT>(lParam);
            var message = wParam.ToInt32();
            var vk = info.vkCode;
            // Diagnostics (files in the support folder, read at start): "log-keys" logs keys pressed in Premiere (never in other apps),
            // "accept-injected" lets synthesised keys through for testing.
            if (LogKeys && premiereFrontmost && (message == Native.WM_KEYDOWN || message == Native.WM_SYSKEYDOWN))
            {
                var line = "Key seen: vk=0x" + vk.ToString("X2") + " flags=0x" + info.flags.ToString("X") + " ctrl=" + Native.IsDown(Native.VK_CONTROL) + " premiereFrontmost=" + premiereFrontmost;
                ThreadPool.QueueUserWorkItem(_ => Log?.Invoke(line));
            }
            // Our own menu-mask taps, and anything another tool synthesises.
            if ((info.flags & Native.LLKHF_INJECTED) != 0 && !(AcceptInjected && vk != Native.VK_MENU_MASK))
                return Native.CallNextHookEx(keyHook, nCode, wParam, lParam);
            if (message == Native.WM_KEYUP || message == Native.WM_SYSKEYUP)
            {
                if (swallowed.Remove(vk)) return new IntPtr(1);
                return Native.CallNextHookEx(keyHook, nCode, wParam, lParam);
            }
            if (message != Native.WM_KEYDOWN && message != Native.WM_SYSKEYDOWN) return Native.CallNextHookEx(keyHook, nCode, wParam, lParam);
            if (swallowed.Contains(vk)) return new IntPtr(1);
            if (!premiereFrontmost || IsModifier(vk)) return Native.CallNextHookEx(keyHook, nCode, wParam, lParam);

            var chord = new KeyChord((int)vk,
                Native.IsDown(Native.VK_CONTROL),
                Native.IsDown(Native.VK_MENU),
                Native.IsDown(Native.VK_SHIFT),
                Native.IsDown(Native.VK_LWIN) || Native.IsDown(Native.VK_RWIN));
            bool consume;
            try { consume = decide(chord); }
            catch (Exception) { consume = false; }
            if (!consume) return Native.CallNextHookEx(keyHook, nCode, wParam, lParam);

            swallowed.Add(vk);
            // Releasing Alt (or Win) with nothing typed in between opens
            // Premiere's menu bar (or Start). A tap of an unassigned key while
            // the modifier is still held cancels that, exactly as AutoHotkey does.
            if (chord.Alt || chord.Win) Native.TapMenuMaskKey();
            return new IntPtr(1);
        }

        private static bool IsModifier(uint vk)
        {
            switch ((int)vk)
            {
                case Native.VK_SHIFT: case Native.VK_CONTROL: case Native.VK_MENU:
                case Native.VK_LSHIFT: case Native.VK_RSHIFT: case Native.VK_LCONTROL: case Native.VK_RCONTROL:
                case Native.VK_LMENU: case Native.VK_RMENU: case Native.VK_LWIN: case Native.VK_RWIN:
                    return true;
                default:
                    return false;
            }
        }
    }
}
