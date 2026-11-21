using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Windows.Forms;

namespace PrFxShortcutListener
{
    // The Timeline highlight with Edie sitting on it, a port of PRFXTimelineHighlight.swift (2026-11-21).
    // It shows the exact panel the listener judges every keystroke against:
    //   armed       full orange, Edie awake (blinks now and then, swings a leg)
    //   not armed   faded orange, Edie dozing, and a short note saying why
    //   key fired   the stroke pulses brighter, Edie grins
    //   key passed  the stroke pulses red, Edie startles
    // and it carries his nudges (EdieNudges) in a speech bubble beside him.
    //
    // A per-pixel-alpha layered window that ignores the mouse and never activates. It is owned by Premiere's
    // window, so Windows keeps it just above Premiere and behind any other app in front of Premiere: the macOS
    // version has to cut out the windows covering Premiere by hand. Physical pixels throughout (PerMonitorV2).
    internal sealed class TimelineHighlight : Form
    {
        public struct State
        {
            public IntPtr Owner;
            public Native.RECT Region;
            public bool Armed;
            public string Reason;
        }

        private sealed class Speech
        {
            public string Title = "", Detail = "";
            public DateTime Started;
            public double Duration;
            public const double FadeIn = 0.2, FadeOut = 0.4, Talking = 1.6;
        }

        private static readonly Color Orange = Color.FromArgb(255, 153, 61);
        private static readonly Color BubbleFill = Color.FromArgb(248, 0x26, 0x26, 0x24);
        private static readonly Color BubbleText = Color.FromArgb(0xec, 0xea, 0xe3);
        private const double FlashDuration = 0.5;
        private const int Headroom = 44;

        private State? state;
        private IntPtr owner;
        private Rectangle placed;
        private float scale = 1;
        private bool flashFired = true;
        private DateTime flashStarted = DateTime.MinValue;
        private string? workingName;
        private DateTime workingStarted;
        private Speech? speech;
        private string drawnKey = "";
        private readonly Timer animation = new Timer { Interval = 33 };

        public TimelineHighlight()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            animation.Tick += (_, __) => Render(force: false);
        }

        public bool IsShowing => Visible && state != null;
        public bool IsSpeaking => speech != null;

        protected override bool ShowWithoutActivation => true;

        protected override CreateParams CreateParams
        {
            get
            {
                var parameters = base.CreateParams;
                parameters.ExStyle |= Native.WS_EX_LAYERED | Native.WS_EX_TRANSPARENT | Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE;
                return parameters;
            }
        }

        public void Update(State next)
        {
            if (next.Owner == IntPtr.Zero || next.Region.Right - next.Region.Left < 40 || next.Region.Bottom - next.Region.Top < 40) { HideHighlight(); return; }
            state = next;
            var dpi = Native.GetDpiForWindow(next.Owner);
            scale = dpi > 0 ? dpi / 96f : 1;
            var headroom = (int)Math.Ceiling(Headroom * scale);
            var region = next.Region;
            placed = new Rectangle(region.Left, region.Top - headroom, region.Right - region.Left, region.Bottom - region.Top + headroom);
            owner = next.Owner;
            if (!Visible)
            {
                Show();
                Log.Write("Timeline highlight shown over " + placed);
            }
            KeepJustAbove(owner);
            Render(force: false);
        }

        // Keeps this window directly above Premiere's in the z-order: on Premiere, under any other app in front of
        // it. NOT by making Premiere its owner: an owner in another process joins the two programs' input queues,
        // and clicks in the Timeline then fell through to the app behind Premiere (2026-11-21, seen: VS Code and
        // Opera took the front, Premiere lost it, and with it every shortcut).
        private void KeepJustAbove(IntPtr premiere)
        {
            var above = Native.GetWindow(premiere, Native.GW_HWNDPREV);
            if (above == Handle) return;
            // Placed after the window just above Premiere, it lands right on top of Premiere. A topmost window
            // there would make this one topmost too, so then it goes to the top of the ordinary windows instead.
            var after = above == IntPtr.Zero || (Native.GetWindowLong(above, Native.GWL_EXSTYLE) & Native.WS_EX_TOPMOST) != 0 ? Native.HWND_TOP : above;
            Native.SetWindowPos(Handle, after, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE | Native.SWP_NOOWNERZORDER);
        }

        public void HideHighlight()
        {
            speech = null;
            if (state == null && !Visible) return;
            state = null;
            drawnKey = "";
            animation.Stop();
            if (Visible) { Hide(); Log.Write("Timeline highlight hidden"); }
        }

        public void Flash(bool fired)
        {
            if (!IsShowing) return;
            flashFired = fired;
            flashStarted = DateTime.UtcNow;
            animation.Start();
            Render(force: true);
        }

        public void StartWorking(string name) { workingName = name; workingStarted = DateTime.UtcNow; animation.Start(); Render(force: true); }
        public void StopWorking() { workingName = null; Render(force: true); }

        public void Say(string title, string detail, double seconds)
        {
            if (!IsShowing) return;
            speech = new Speech { Title = title, Detail = detail, Started = DateTime.UtcNow, Duration = seconds };
            animation.Start();
            Render(force: true);
            Log.Write("Edie says: " + title + " / " + detail);
        }

        // Fades the bubble out now (input arrived).
        public void Hush()
        {
            if (speech == null) return;
            var elapsed = (DateTime.UtcNow - speech.Started).TotalSeconds;
            if (speech.Duration - elapsed > Speech.FadeOut) speech.Duration = elapsed + Speech.FadeOut;
        }

        // Only what changed is drawn again: the frame's look is summed up in a key.
        private void Render(bool force)
        {
            if (state is not State s || !Visible) { animation.Stop(); return; }
            var now = DateTime.UtcNow;
            var since = (now - flashStarted).TotalSeconds;
            var pulse = since < FlashDuration ? 1 - since / FlashDuration : 0;
            if (speech != null && (now - speech.Started).TotalSeconds >= speech.Duration) speech = null;
            var animating = pulse > 0 || speech != null || workingName != null;
            if (!animating) animation.Stop();
            // A blink for one refresh (0.2 s) in every twenty; two leg swings every eleven seconds.
            var tick = (long)((now - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds / 200);
            var blink = tick % 20 == 0;
            var step = (int)(tick % 55);
            var swing = step < 12 ? new[] { 1, 1, 0, -1, -1, 0 }[step % 6] : 0;
            var key = placed + "|" + s.Armed + "|" + s.Reason + "|" + blink + "|" + swing + "|" + workingName + "|" +
                      (workingName != null ? (int)(now - workingStarted).TotalSeconds : 0);
            if (!force && !animating && key == drawnKey) return;
            drawnKey = key;
            using (var bitmap = new Bitmap(Math.Max(1, placed.Width), Math.Max(1, placed.Height), PixelFormat.Format32bppArgb))
            {
                using (var g = Graphics.FromImage(bitmap))
                {
                    g.Clear(Color.Transparent);
                    Draw(g, s, pulse, blink, swing, now);
                }
                Present(bitmap);
            }
        }

        private void Draw(Graphics g, State s, double pulse, bool blink, int swing, DateTime now)
        {
            var px = 2 * scale;
            var headroom = (float)Math.Ceiling(Headroom * scale);
            // Premiere's own border is a 1 px line on the panel's edge; this covers it.
            var rect = new RectangleF(1, headroom + 1, placed.Width - 2, placed.Height - headroom - 2);
            var color = Color.FromArgb(s.Armed ? 255 : 115, Orange);
            if (pulse > 0)
            {
                var target = flashFired ? Color.FromArgb(255, 209, 115) : Color.FromArgb(255, 69, 58);
                color = Blend(color, target, pulse);
            }
            var width = (float)((2 + 2 * pulse) * scale);
            using (var pen = new Pen(color, width) { Alignment = PenAlignment.Inset })
                g.DrawRectangle(pen, rect.X, rect.Y, rect.Width, rect.Height);

            // Edie sits on the top edge near the right corner, legs over the line, clapperboard in hand.
            var spoken = speech != null ? (now - speech.Started).TotalSeconds : (double?)null;
            EdieSprite.Mood mood;
            if (pulse > 0) mood = flashFired ? EdieSprite.Mood.Grin : EdieSprite.Mood.Shocked;
            else if (spoken is double t) mood = t >= Speech.Talking ? EdieSprite.Mood.Rest : ((int)(t / 0.25) % 2 == 0 ? EdieSprite.Mood.Talk : EdieSprite.Mood.TalkPause);
            else if (!s.Armed) mood = EdieSprite.Mood.Sleepy;
            else mood = blink ? EdieSprite.Mood.Blink : EdieSprite.Mood.Rest;
            var edieX = (float)Math.Round(rect.Right - EdieSprite.Columns * px - 10 * scale);
            var edieY = (float)Math.Round(rect.Top - (EdieSprite.SeatRow + EdieSprite.Crown / 2f) * px);
            g.SmoothingMode = SmoothingMode.None;
            g.PixelOffsetMode = PixelOffsetMode.Half;
            EdieSprite.Draw(g, EdieSprite.Sitting(mood, mood == EdieSprite.Mood.Rest || mood == EdieSprite.Mood.Blink ? swing : 0), edieX, edieY, px);
            g.PixelOffsetMode = PixelOffsetMode.Default;

            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            if (speech != null && spoken is double e) DrawSpeech(g, speech, e, edieX - 3 * scale, rect.Top - 12 * scale);
            else if (workingName != null)
                DrawNote(g, "Working on " + workingName + " · " + Math.Max(0, (int)(now - workingStarted).TotalSeconds) + "s", edieX - 6 * scale, rect.Top - 9 * scale);
            else if (!s.Armed && ShortReason(s.Reason).Length > 0) DrawNote(g, ShortReason(s.Reason), edieX - 6 * scale, rect.Top - 9 * scale);
        }

        public static string ShortReason(string reason)
        {
            var lower = reason.ToLowerInvariant();
            if (lower.Contains("outside the timeline") || lower.Contains("could not be located")) return "Click the Timeline to arm";
            if (lower.Contains("text input")) return "Typing in a field";
            if (lower.Contains("menu")) return "Menu open";
            if (lower.Contains("bridge")) return "Edie bridge offline";
            // Working in another app: he dozes, with nothing to say about it.
            if (lower.Contains("not frontmost")) return "";
            return reason;
        }

        private void DrawNote(Graphics g, string text, float rightEdge, float midY)
        {
            using (var font = new Font("Segoe UI Semibold", 8.25f * scale, FontStyle.Regular, GraphicsUnit.Point))
            {
                var size = g.MeasureString(text, font);
                var width = Math.Min(size.Width + 14 * scale, Math.Max(40 * scale, rightEdge - 4));
                var height = size.Height + 4 * scale;
                var box = new RectangleF(rightEdge - width, midY - height / 2, width, height);
                using (var path = Pill(box, box.Height / 2))
                using (var fill = new SolidBrush(Orange))
                    g.FillPath(fill, path);
                using (var ink = new SolidBrush(Color.FromArgb(26, 18, 8)))
                using (var format = new StringFormat { Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap, LineAlignment = StringAlignment.Center })
                    g.DrawString(text, font, ink, new RectangleF(box.X + 7 * scale, box.Y, box.Width - 12 * scale, box.Height), format);
            }
        }

        // A speech bubble ending in a tail at `rightEdge` (Edie's side): the heading, then the detail lighter under it.
        private void DrawSpeech(Graphics g, Speech said, double elapsed, float rightEdge, float midY)
        {
            var alpha = Math.Min(1, Math.Min(elapsed / Speech.FadeIn, Math.Max(0, (said.Duration - elapsed) / Speech.FadeOut)));
            if (alpha <= 0) return;
            using (var titleFont = new Font("Segoe UI Semibold", 8.25f * scale, FontStyle.Regular, GraphicsUnit.Point))
            using (var detailFont = new Font("Segoe UI", 8.25f * scale, FontStyle.Regular, GraphicsUnit.Point))
            {
                var titleSize = g.MeasureString(said.Title, titleFont);
                var detailSize = g.MeasureString(said.Detail, detailFont);
                var tail = 6 * scale;
                var right = rightEdge - tail;
                var width = Math.Min(Math.Min(Math.Max(titleSize.Width, detailSize.Width) + 18 * scale, 380 * scale), Math.Max(40 * scale, right - 4));
                var height = titleSize.Height + detailSize.Height + 8 * scale;
                var box = new RectangleF((float)Math.Round(right - width), (float)Math.Round(midY + 12 * scale - height), (float)Math.Round(width), (float)Math.Round(height));
                int A(int a) => (int)(a * alpha);
                using (var path = Pill(box, 7 * scale))
                {
                    var tip = new PointF(rightEdge, box.Y + box.Height / 2 + 7 * scale);
                    var top = new PointF(box.Right - 0.5f, box.Y + box.Height / 2 - 1 * scale);
                    var bottom = new PointF(box.Right - 0.5f, box.Y + box.Height / 2 + 6 * scale);
                    using (var fill = new SolidBrush(Color.FromArgb(A(BubbleFill.A), BubbleFill)))
                    using (var edge = new Pen(Color.FromArgb(A(255), Orange), Math.Max(1, scale)))
                    {
                        g.FillPath(fill, path);
                        g.DrawPath(edge, path);
                        g.FillPolygon(fill, new[] { top, tip, bottom });
                        g.DrawLines(edge, new[] { top, tip, bottom });
                    }
                }
                using (var titleInk = new SolidBrush(Color.FromArgb(A(255), BubbleText)))
                using (var detailInk = new SolidBrush(Color.FromArgb(A(158), BubbleText)))
                using (var format = new StringFormat { Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap })
                {
                    var inner = RectangleF.Inflate(box, -9 * scale, -4 * scale);
                    g.DrawString(said.Title, titleFont, titleInk, new RectangleF(inner.X, inner.Y, inner.Width, titleSize.Height), format);
                    g.DrawString(said.Detail, detailFont, detailInk, new RectangleF(inner.X, inner.Y + titleSize.Height, inner.Width, detailSize.Height), format);
                }
            }
        }

        private static GraphicsPath Pill(RectangleF box, float radius)
        {
            var d = Math.Min(radius * 2, Math.Min(box.Width, box.Height));
            var path = new GraphicsPath();
            path.AddArc(box.X, box.Y, d, d, 180, 90);
            path.AddArc(box.Right - d, box.Y, d, d, 270, 90);
            path.AddArc(box.Right - d, box.Bottom - d, d, d, 0, 90);
            path.AddArc(box.X, box.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        private static Color Blend(Color from, Color to, double t) => Color.FromArgb(
            (int)(from.A + (to.A - from.A) * t), (int)(from.R + (to.R - from.R) * t), (int)(from.G + (to.G - from.G) * t), (int)(from.B + (to.B - from.B) * t));

        // Puts the drawing on screen with its own alpha (UpdateLayeredWindow).
        private void Present(Bitmap bitmap)
        {
            var screen = Native.GetDC(IntPtr.Zero);
            var memory = Native.CreateCompatibleDC(screen);
            var hBitmap = bitmap.GetHbitmap(Color.FromArgb(0));
            var old = Native.SelectObject(memory, hBitmap);
            try
            {
                var size = new Native.SIZE { Cx = bitmap.Width, Cy = bitmap.Height };
                var source = new Native.POINT();
                var at = new Native.POINT { X = placed.X, Y = placed.Y };
                var blend = new Native.BLENDFUNCTION { BlendOp = 0, BlendFlags = 0, SourceConstantAlpha = 255, AlphaFormat = 1 };
                Native.UpdateLayeredWindow(Handle, screen, ref at, ref size, memory, ref source, 0, ref blend, Native.ULW_ALPHA);
            }
            finally
            {
                Native.SelectObject(memory, old);
                Native.DeleteObject(hBitmap);
                Native.DeleteDC(memory);
                Native.ReleaseDC(IntPtr.Zero, screen);
            }
        }
    }
}
