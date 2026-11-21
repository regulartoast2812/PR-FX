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
            // The focused panel only while Premiere is in front (premiereThread 0 otherwise); where the Timeline
            // is, always, so the highlight follows it with Premiere behind another app too.
            var info = new Native.GUITHREADINFO { cbSize = Marshal.SizeOf(typeof(Native.GUITHREADINFO)) };
            if (premiereThread == 0 || !Native.GetGUIThreadInfo(premiereThread, ref info)) info.hwndFocus = IntPtr.Zero;
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
            // The whole panel, tab row included: its frame window, which Premiere's own border runs inside.
            if (visible != IntPtr.Zero && Native.GetWindowRect(FrameOf(visible), out var rect))
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

        // The panel's frame ("DroverLord - Frame Window"): the panel with its tab row. Premiere draws its border,
        // blue when the panel has focus, 2 px inside it (measured on 26.0.1). The tab panel itself if none.
        private const string FrameTitle = "DroverLord - Frame Window";
        private static IntPtr FrameOf(IntPtr panel)
        {
            var window = panel;
            for (var depth = 0; depth < 4 && window != IntPtr.Zero; depth++)
            {
                if (Title(window) == FrameTitle) return window;
                window = Native.GetParent(window);
            }
            return panel;
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
            var isTimeline = LooksLikeTimeline(panel, out var measured);
            lock (gate)
            {
                var t = new HashSet<IntPtr>(timelines);
                var o = new HashSet<IntPtr>(others);
                if (isTimeline) { t.Add(panel); o.Remove(panel); } else { o.Add(panel); }
                timelines = t; others = o;
                checkedAt[panel] = DateTime.UtcNow;
            }
            Details = "panel=" + panel + " " + measured + (isTimeline ? " timeline" : " other");
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

        // A panel is the Timeline when its playhead runs down most of it, or when it looks like one (time, ruler,
        // work-area bar, V1/A1 buttons): the playhead can be scrolled out of view, and the look needs the panel tall
        // and wide enough to show its headers. One capture serves both.
        public static bool LooksLikeTimeline(IntPtr panel, out string details)
        {
            details = "";
            if (!Native.GetWindowRect(panel, out var r)) return false;
            int w = r.Right - r.Left, h = r.Bottom - r.Top;
            details = w + "x" + h;
            var pixels = Capture(panel, w, h, out var stride);
            if (pixels == null) return false;
            var dpi = Native.GetDpiForWindow(panel);
            var scale = dpi > 0 ? dpi / 96.0 : 1.0;
            var playhead = LongestBlueRun(pixels, stride, w, h) / (double)h;
            var look = TimelineLook(pixels, stride, w, h, scale);
            details += " playhead=" + playhead.ToString("0.00") + " look=" + look;
            return playhead >= 0.4 || look >= TimelineLookNeeded;
        }

        // The panel's own pixels as BGRA rows (PrintWindow: works while Premiere is covered), or null.
        public static byte[]? Capture(IntPtr panel, int w, int h, out int stride)
        {
            stride = 0;
            if (w < 120 || h < 80) return null;
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
                    stride = data.Stride;
                    bitmap.UnlockBits(data);
                    return pixels;
                }
            }
            catch (Exception) { return null; }
        }

        // How much a panel looks like a Timeline in its own pixels: the port of PanelPixels.timelineLook in
        // PRFXPanelPixels.swift (2026-11-21, the user: "a clear way of knowing the panel is the timeline are these
        // V# A# and icons, time number and ruler"). Signs, each looked for where the Timeline draws it:
        //   - the current time in Premiere's blue (67,160,255) in the panel's top-left corner (the Program monitor
        //     draws its blue time at the bottom, so it doesn't count there);
        //   - the time ruler: a row near the top with many thin light ticks between dark;
        //   - the work-area bar under the ruler, yellow (233,233,1);
        //   - the track headers' targeted buttons (V1, A1…), solid blue (0,92,200) blocks in the left part,
        //     stacked in one column (2 signs for two or more).
        // Two or more signs: it's a Timeline, whether or not its playhead is in view. The macOS sizes are points;
        // here they're physical pixels, so every size is multiplied by the display scale (`scale`, 1 at 96 dpi).
        public const int TimelineLookNeeded = 2;

        public static int TimelineLook(byte[] bgra, int stride, int w, int h, double scale)
        {
            int S(double v) => (int)Math.Round(v * scale);
            if (w < S(200) || h < S(120)) return 0;
            int R(int x, int y) => bgra[y * stride + x * 4 + 2];
            int G(int x, int y) => bgra[y * stride + x * 4 + 1];
            int B(int x, int y) => bgra[y * stride + x * 4];
            int Luma(int x, int y) => (R(x, y) * 30 + G(x, y) * 59 + B(x, y) * 11) / 100;
            var signs = 0;
            // Time: top 80, left 260.
            var blue = 0;
            for (var y = 0; y < Math.Min(h, S(80)); y++)
                for (var x = 0; x < Math.Min(w, S(260)); x++)
                {
                    int r = R(x, y), g = G(x, y), b = B(x, y);
                    if (b >= 215 && g >= 125 && g <= 195 && r >= 35 && r <= 120) blue++;
                }
            if (blue >= 20 * scale * scale) signs++;
            // Ruler and work-area bar: top 110, right of the track headers. A tick is a light, grey run at most one
            // point wide (one or two pixels when scaled) with dark on both sides.
            var rx0 = w / 4;
            var widest = Math.Max(1, (int)Math.Ceiling(scale));
            bool ruler = false, yellowBar = false;
            for (var y = 0; y < Math.Min(h, S(110)) && !(ruler && yellowBar); y++)
            {
                int ticks = 0, yellow = 0, run = 0;
                var darkBefore = false;
                for (var x = rx0; x < w; x++)
                {
                    int r = R(x, y), g = G(x, y), b = B(x, y), l = Luma(x, y);
                    if (r >= 200 && g >= 200 && b <= 70) yellow++;
                    if (l >= 100 && Math.Abs(r - b) <= 20) { run++; continue; }
                    if (run > 0 && run <= widest && darkBefore && l <= 60) ticks++;
                    darkBefore = l <= 60;
                    run = 0;
                }
                if (ticks >= 12) ruler = true;
                if (yellow * 5 >= (w - rx0) * 2) yellowBar = true;
            }
            if (ruler) signs++;
            if (yellowBar) signs++;
            // Targeted track buttons: rows holding a 12 pt+ run of their blue in the left 300 (its left end), grouped
            // into blocks 10 pt+ tall that share one column.
            var rows = new int?[h + 1];
            for (var y = 0; y < h; y++)
            {
                int start = 0, current = 0;
                for (var x = 0; x < Math.Min(w, S(300)); x++)
                {
                    int r = R(x, y), g = G(x, y), b = B(x, y);
                    if (r <= 35 && g >= 70 && g <= 115 && b >= 170 && b <= 235)
                    {
                        if (current == 0) start = x;
                        if (++current >= S(12)) { rows[y] = start; break; }
                    }
                    else current = 0;
                }
            }
            var blocks = new List<int>();
            int count = 0, column = 0, near = S(6);
            foreach (var row in rows)
            {
                if (row.HasValue && (count == 0 || Math.Abs(row.Value - column) <= near))
                {
                    if (count == 0) column = row.Value;
                    count++;
                    continue;
                }
                if (count >= S(10)) blocks.Add(column);
                count = row.HasValue ? 1 : 0;
                column = row ?? 0;
            }
            var stacked = 0;
            foreach (var c in blocks)
            {
                var n = 0;
                foreach (var other in blocks) if (Math.Abs(other - c) <= near) n++;
                if (n > stacked) stacked = n;
            }
            return signs + Math.Min(2, stacked);
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
