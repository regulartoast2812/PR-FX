using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

namespace PrFxShortcutListener
{
    // Which Premiere panel you're in, and whether it's the Timeline (Windows, 2026-11-21).
    //
    // Premiere on Windows names no panel to UI Automation, but every panel is its own child window
    // ("DroverLord - TabPanel Window", one per tab) and Premiere gives keyboard focus to the panel you
    // click. So the focused window's TabPanel ancestor is the panel in use, exactly what the macOS
    // listener infers from the last click.
    //
    // Telling the Timeline apart: its playhead is a 1-2 px blue line (64,150,243 in the default theme)
    // running down most of the panel. Measured on Premiere 26.0.1: 80% of the Timeline's height, at most
    // 6% in any other panel (Program monitor, Project, tools, meters, a CEP panel). The panel's own window
    // is captured with PrintWindow, which works while Premiere is covered, in about 50 ms.
    //
    // All capture work runs on the UI thread (Refresh, from housekeeping). The keyboard hook only calls
    // Classify, which reads cached verdicts and walks parents with GetParent: no window messages, no
    // capture, so it stays instant.
    internal sealed class TimelinePanel
    {
        public enum Verdict { Unknown, Timeline, OtherPanel }

        private const string TabPanelTitle = "DroverLord - TabPanel Window";
        // A non-Timeline verdict can be wrong while the playhead is scrolled out of view, so it's checked
        // again after this long. A Timeline verdict stays until the window is gone.
        private static readonly TimeSpan RecheckOther = TimeSpan.FromSeconds(3);

        private readonly object gate = new object();
        private HashSet<IntPtr> timelines = new HashSet<IntPtr>();
        private HashSet<IntPtr> others = new HashSet<IntPtr>();
        private readonly Dictionary<IntPtr, DateTime> checkedAt = new Dictionary<IntPtr, DateTime>();

        public Native.RECT? LiveRect { get; private set; }
        public Native.RECT? LastTimelineRect { get; private set; }
        public string Details { get; private set; } = "";
        public Action<string>? Log;

        // Hook thread: the verdict for the focused window, from cache only.
        public Verdict Classify(IntPtr focus)
        {
            if (focus == IntPtr.Zero) return Verdict.Unknown;
            HashSet<IntPtr> t, o;
            lock (gate) { t = timelines; o = others; }
            var window = focus;
            for (var depth = 0; depth < 12 && window != IntPtr.Zero; depth++)
            {
                if (t.Contains(window)) return Verdict.Timeline;
                if (o.Contains(window)) return Verdict.OtherPanel;
                window = Native.GetParent(window);
            }
            return Verdict.Unknown;
        }

        // The main window the Timeline sits in (Premiere's, unless the panel floats).
        public IntPtr LiveRoot { get; private set; }
        private DateTime lastScan = DateTime.MinValue;

        // UI thread: classify the focused panel when it's new or due a recheck, then find where the Timeline is
        // on screen now, even while another panel is in use (the highlight shows it dimmed then). When no Timeline
        // is known and visible, every visible panel is looked at, at most every 3 s.
        public void Refresh(uint premiereThread, IntPtr premiereWindow)
        {
            var info = new Native.GUITHREADINFO { cbSize = Marshal.SizeOf(typeof(Native.GUITHREADINFO)) };
            if (premiereThread == 0 || !Native.GetGUIThreadInfo(premiereThread, ref info)) return;
            Prune();
            var panel = TabPanelOf(info.hwndFocus);
            if (panel != IntPtr.Zero)
            {
                bool known, isTimeline;
                DateTime last;
                lock (gate)
                {
                    isTimeline = timelines.Contains(panel);
                    known = isTimeline || others.Contains(panel);
                    checkedAt.TryGetValue(panel, out last);
                }
                if (!known || (!isTimeline && DateTime.UtcNow - last > RecheckOther)) Measure(panel);
            }
            var visible = VisibleTimeline();
            if (visible == IntPtr.Zero && premiereWindow != IntPtr.Zero && DateTime.UtcNow - lastScan > RecheckOther)
            {
                lastScan = DateTime.UtcNow;
                var root = Native.GetAncestor(premiereWindow, Native.GA_ROOT);
                foreach (var candidate in TabPanels(root))
                {
                    bool seen;
                    lock (gate) seen = timelines.Contains(candidate) || (others.Contains(candidate) && checkedAt.TryGetValue(candidate, out var at) && DateTime.UtcNow - at <= RecheckOther);
                    if (!seen && Measure(candidate)) break;
                }
                visible = VisibleTimeline();
            }
            if (visible != IntPtr.Zero && Native.GetWindowRect(visible, out var rect))
            {
                LiveRect = rect; LastTimelineRect = rect;
                LiveRoot = Native.GetAncestor(visible, Native.GA_ROOT);
            }
            else { LiveRect = null; LiveRoot = IntPtr.Zero; }
        }

        private IntPtr VisibleTimeline()
        {
            HashSet<IntPtr> t;
            lock (gate) t = timelines;
            foreach (var window in t)
                if (Native.IsWindow(window) && Native.IsWindowVisible(window) && Native.GetWindowRect(window, out var r) && r.Right - r.Left > 80 && r.Bottom - r.Top > 60)
                    return window;
            return IntPtr.Zero;
        }

        private static List<IntPtr> TabPanels(IntPtr root)
        {
            var found = new List<IntPtr>();
            if (root == IntPtr.Zero) return found;
            Native.EnumChildWindows(root, (child, _) =>
            {
                if (Native.IsWindowVisible(child) && Title(child) == TabPanelTitle) found.Add(child);
                return true;
            }, IntPtr.Zero);
            return found;
        }

        private static IntPtr TabPanelOf(IntPtr window)
        {
            for (var depth = 0; depth < 12 && window != IntPtr.Zero; depth++)
            {
                if (Title(window) == TabPanelTitle) return window;
                window = Native.GetParent(window);
            }
            return IntPtr.Zero;
        }

        // InternalGetWindowText reads the title without sending WM_GETTEXT, so a busy Premiere can't stall us.
        private static string Title(IntPtr window)
        {
            var text = new StringBuilder(64);
            Native.InternalGetWindowText(window, text, text.Capacity);
            return text.ToString();
        }

        private bool Measure(IntPtr panel)
        {
            var fraction = PlayheadFraction(panel, out var size);
            var isTimeline = fraction >= 0.4;
            lock (gate)
            {
                var t = new HashSet<IntPtr>(timelines);
                var o = new HashSet<IntPtr>(others);
                if (isTimeline) { t.Add(panel); o.Remove(panel); } else { o.Add(panel); }
                timelines = t; others = o;
                checkedAt[panel] = DateTime.UtcNow;
            }
            Details = "panel=" + panel + " " + size + " playhead=" + fraction.ToString("0.00") + (isTimeline ? " timeline" : " other");
            Log?.Invoke((isTimeline ? "Timeline panel found: " : "Panel in use is not the Timeline: ") + Details);
            return isTimeline;
        }

        private void Prune()
        {
            lock (gate)
            {
                if (timelines.Count + others.Count < 64) return;
                var t = new HashSet<IntPtr>(); var o = new HashSet<IntPtr>();
                foreach (var w in timelines) if (Native.IsWindow(w)) t.Add(w);
                foreach (var w in others) if (Native.IsWindow(w)) o.Add(w);
                timelines = t; others = o;
            }
        }

        // The longest unbroken run of playhead-blue pixels in any one column, as a fraction of the panel's height.
        public static double PlayheadFraction(IntPtr panel, out string size)
        {
            size = "";
            if (!Native.GetWindowRect(panel, out var r)) return 0;
            int w = r.Right - r.Left, h = r.Bottom - r.Top;
            size = w + "x" + h;
            if (w < 120 || h < 80) return 0;
            try
            {
                using (var bitmap = new Bitmap(w, h, PixelFormat.Format32bppArgb))
                {
                    using (var g = Graphics.FromImage(bitmap))
                    {
                        var dc = g.GetHdc();
                        try { Native.PrintWindow(panel, dc, Native.PW_RENDERFULLCONTENT); }
                        finally { g.ReleaseHdc(dc); }
                    }
                    var data = bitmap.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                    var pixels = new byte[data.Stride * h];
                    Marshal.Copy(data.Scan0, pixels, 0, pixels.Length);
                    var stride = data.Stride;
                    bitmap.UnlockBits(data);
                    return LongestBlueRun(pixels, stride, w, h) / (double)h;
                }
            }
            catch (Exception) { return 0; }
        }

        // BGRA rows. Playhead blue: strongly blue, little red. Clip blue (≈120,160,210) and selection
        // blue fail the red/difference test, and they're never one column wide all the way down anyway.
        public static int LongestBlueRun(byte[] bgra, int stride, int width, int height)
        {
            var best = 0;
            for (var x = 0; x < width; x++)
            {
                int run = 0, max = 0;
                for (var y = 0; y < height; y++)
                {
                    var i = y * stride + x * 4;
                    int b = bgra[i], g = bgra[i + 1], red = bgra[i + 2];
                    if (b >= 180 && red <= 90 && b - red >= 120 && g >= 90 && g <= 190) { if (++run > max) max = run; }
                    else run = 0;
                }
                if (max > best) best = max;
            }
            return best;
        }
    }
}
