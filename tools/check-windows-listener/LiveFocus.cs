using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using PrFxShortcutListener;

// The real Ctrl+Space palette and banner against a stand-in Premiere in another process that grabs the front back
// (2026-11-22). The palette closing as it opened broke every palette command three times (the banner taking the front,
// Alt+Tab's switcher, Windows reporting Premiere in front while the palette took it), and each time the checks passed:
// they never opened a window. The user: "have a safeguard so that won't happen again". Each past cause is a scenario,
// across two processes as with Premiere (inside one process taking the front always works, so it would prove nothing).
// build-windows.cmd runs these and refuses to build a listener that fails them. The windows show for about 15 s.
internal static class LiveFocus
{
    private static void Pump(int ms)
    {
        var until = DateTime.UtcNow.AddMilliseconds(ms);
        while (DateTime.UtcNow < until) { Application.DoEvents(); Thread.Sleep(5); }
    }

    private static bool PumpUntil(Func<bool> done, int ms)
    {
        var until = DateTime.UtcNow.AddMilliseconds(ms);
        while (DateTime.UtcNow < until) { if (done()) return true; Application.DoEvents(); Thread.Sleep(5); }
        return done();
    }

    private sealed class StandIn : IDisposable
    {
        public readonly Process Process;
        public readonly IntPtr Window;
        public StandIn(string mode)
        {
            var self = Process.GetCurrentProcess().MainModule!.FileName;
            Process = Process.Start(new ProcessStartInfo(self, "--stand-in-premiere " + Process.GetCurrentProcess().Id + " " + mode)
            { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardInput = true, CreateNoWindow = true })!;
            var line = Process.StandardOutput.ReadLine() ?? "0";
            Window = new IntPtr(long.Parse(line));
        }
        public void Dispose()
        {
            try { Process.StandardInput.WriteLine("quit"); Process.StandardInput.Flush(); } catch (Exception) { }
            if (!Process.WaitForExit(2000)) try { Process.Kill(); } catch (Exception) { }
        }
    }

    // The stand-in Premiere: a window that takes the front, prints its handle, and (mode grab:<after ms>:<times>) takes the
    // front back that long after the palette ("Edie", in the checking process) gets it, as Premiere did.
    public static int StandInMain(string[] args)
    {
        var parent = uint.Parse(args[1]);
        var mode = args.Length > 2 ? args[2] : "none";
        int after = 0, times = 0;
        if (mode.StartsWith("grab:")) { var p = mode.Split(':'); after = int.Parse(p[1]); times = int.Parse(p[2]); }
        var form = new Form { Text = "PR FX check: stand-in Premiere", StartPosition = FormStartPosition.Manual, Location = new System.Drawing.Point(40, 40), Size = new System.Drawing.Size(360, 200), ShowInTaskbar = false };
        form.Show();
        Native.ForceForeground(form.Handle);
        Console.WriteLine(form.Handle.ToInt64());
        Console.Out.Flush();
        var quit = false;
        new Thread(() => { try { Console.In.ReadLine(); } catch (Exception) { } quit = true; }) { IsBackground = true }.Start();
        var until = DateTime.UtcNow.AddSeconds(20);
        DateTime? sawPalette = null;
        while (!quit && DateTime.UtcNow < until)
        {
            Application.DoEvents();
            Thread.Sleep(5);
            if (times <= 0) continue;
            var front = Native.GetForegroundWindow();
            Native.GetWindowThreadProcessId(front, out var pid);
            var title = new StringBuilder(32);
            Native.InternalGetWindowText(front, title, title.Capacity);
            if (pid == parent && title.ToString() == "Edie")
            {
                sawPalette ??= DateTime.UtcNow;
                if ((DateTime.UtcNow - sawPalette.Value).TotalMilliseconds >= after) { Native.ForceForeground(form.Handle); times--; sawPalette = null; }
            }
            else sawPalette = null;
        }
        return 0;
    }

    public static void Run(Action<bool, string> expect)
    {
        if (Environment.GetEnvironmentVariable("PRFX_SKIP_LIVE_FOCUS") == "1")
        {
            Console.WriteLine("SKIP the live palette focus checks (PRFX_SKIP_LIVE_FOCUS=1): the palette closing as it opens is NOT checked");
            return;
        }
        // Scratch support folder: the palette saves its frame there, never in the user's.
        var support = Path.Combine(Path.GetTempPath(), "prfx-live-focus-" + Guid.NewGuid().ToString("N"));
        Environment.SetEnvironmentVariable("PRFX_SUPPORT_DIR", support);
        PaletteForm? palette = null;
        var toast = new Toast();
        toast.PaletteWindow = () => palette != null && palette.Visible ? palette.Handle : IntPtr.Zero;
        _ = toast.Handle;
        try
        {
            using (var premiere = new StandIn("none"))
            {
                if (!PumpUntil(() => Native.GetForegroundWindow() == premiere.Window, 2000))
                {
                    expect(false, "palette live: the stand-in Premiere couldn't take the front (screen locked? set PRFX_SKIP_LIVE_FOCUS=1 to build anyway, unchecked)");
                    return;
                }
            }

            PaletteForm NewPalette()
            {
                var p = new PaletteForm();
                p.IsOurs = h => h == toast.Handle; p.Log = m => Console.WriteLine("     " + DateTime.UtcNow.ToString("ss.fff") + " " + m);
                _ = p.Handle;
                return p;
            }

            // One scenario: a stand-in in front, the palette opened over it, then where things stand ms later.
            void Scenario(string mode, int wait, bool stayOpen, string label, Action<PaletteForm, StandIn>? during = null)
            {
                using (var premiere = new StandIn(mode))
                {
                    PumpUntil(() => Native.GetForegroundWindow() == premiere.Window, 2000);
                    palette = NewPalette();
                    during?.Invoke(palette, premiere);
                    palette.Open(premiere.Window);
                    Pump(wait);
                    var front = Native.GetForegroundWindow() == palette.Handle;
                    expect(stayOpen ? palette.Visible && front : !palette.Visible,
                        "palette live: " + label + (stayOpen ? (palette.Visible ? front ? "" : " (open but not in front)" : " (it closed)") : palette.Visible ? " (still open)" : ""));
                    if (palette.Visible) palette.ClosePalette(false);
                    palette.Dispose();
                    palette = null;
                }
            }

            // Cause 3 (2026-11-22): Windows reports Premiere in front while the palette is still opening.
            Scenario("none", 900, true, "Premiere in front again while the palette opens: it stays open, in front",
                (p, premiere) =>
                {
                    var once = true;
                    p.VisibleChanged += (_, __) => { if (once && p.Visible) { once = false; Native.ForceForeground(premiere.Window); } };
                });
            Scenario("grab:0:1", 900, true, "Premiere grabbing the front back at once: it stays open, in front");
            Scenario("grab:60:1", 900, true, "Premiere grabbing the front back 60 ms later: it stays open, in front");
            Scenario("grab:60:2", 1200, true, "Premiere grabbing it back twice: it stays open, in front");
            Scenario("grab:2000:1", 2600, false, "clicking Premiere two seconds later still closes it");

            // Cause 1 (2026-11-21): the banner took the front from Premiere, so shortcuts and Ctrl+Space stopped.
            using (var premiere = new StandIn("none"))
            {
                PumpUntil(() => Native.GetForegroundWindow() == premiere.Window, 2000);
                toast.ShowMessage("Timeline armed · check", ToastKind.Ok, 1.0, premiere.Window);
                Pump(500);
                expect(Native.GetForegroundWindow() == premiere.Window, "banner live: showing the banner leaves Premiere in front");
                toast.Hide();
            }
            // Cause 2 (2026-11-21): the banner, shown while the palette opened, handed the front to Premiere.
            Scenario("none", 900, true, "the banner showing while it's open: it stays open, in front",
                (p, premiere) =>
                {
                    var once = true;
                    p.VisibleChanged += (_, __) => { if (once && p.Visible) { once = false; toast.ShowMessage("Timeline armed · check", ToastKind.Ok, 1.0, premiere.Window); } };
                });
        }
        finally
        {
            toast.Hide();
            toast.Dispose();
            try { Directory.Delete(support, true); } catch (Exception) { }
            Environment.SetEnvironmentVariable("PRFX_SUPPORT_DIR", null);
        }
    }
}
