using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Windows.Forms;
using System.Windows.Forms.Integration;
using Wpf = System.Windows;
using WpfControls = System.Windows.Controls;
using WpfMedia = System.Windows.Media;

namespace PrFxShortcutListener
{
    // The palette's In/Out picker (2026-11-25), the Windows side of the Mac palette's picker: Enter on a video or a sound
    // in the palette's list opens it in place of the search row, tabs and list (the palette keeps its 640 × 440). The
    // editor scrubs, marks In and Out, and Enter places only that part at the playhead. The marks, stepping, shuttle and
    // timecode are Core/RangePick.cs (the port of PRFXRangePick.swift, checked by tools/check-windows-bridge); this file
    // only draws them and drives the player.
    //
    // Playback is WPF's MediaPlayer (Windows Media Foundation: H.264, HEVC with the HEVC extension, MP3, WAV, AAC, as far
    // as the machine has codecs). Video shows through a VideoDrawing in an ElementHost, letterboxed on the canvas. Sound
    // shows a plain bar, not a waveform (decoding a waveform needs a decoder MediaPlayer doesn't expose). MediaPlayer
    // gives no frame rate, so the picker steps at the open sequence's rate (RangePick.PickFps(null, sequence)).
    // A file that won't open keeps the picker up with a note: Enter then places the whole clip, as before the picker.
    internal sealed class RangePicker : Control
    {
        private enum State { Closed, Loading, Ready, Failed }

        private const TextFormatFlags Line1 = TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine | TextFormatFlags.VerticalCenter;
        private const string Dash = "–";

        // The player: one for the palette's life, opened per item.
        private WpfMedia.MediaPlayer? player;
        private ElementHost? host;
        private WpfMedia.VideoDrawing? video;
        private readonly System.Windows.Forms.Timer clock = new System.Windows.Forms.Timer { Interval = 30 };
        private readonly System.Windows.Forms.Timer openTimeout = new System.Windows.Forms.Timer { Interval = 8000 };
        private readonly Stopwatch tickWatch = new Stopwatch();
        // Where reverse shuttle is, unsnapped, so steps smaller than a frame add up instead of being floored away.
        private double shuttleClock;
        private int openToken;
        // The file being opened: MediaOpened from an earlier file (opened, closed, another opened fast) is ignored.
        private Uri? opening;

        private State state = State.Closed;
        private string failure = "";
        private PaletteMedia? item;
        private double listFps;
        private RangePick pick;
        private bool showsVideo;
        // Marks per media id, for the session: reopening the same item brings back its In, Out and playhead.
        private readonly Dictionary<string, RangePick> remembered = new Dictionary<string, RangePick>(StringComparer.Ordinal);

        private bool scrubbing;
        private float scale = 1f;
        private Font titleFont = null!, binFont = null!, readFont = null!, labelFont = null!, noteFont = null!, escFont = null!, barIconFont = null!;

        /// Place this item: the range, or null for the whole clip; keep the palette open or not.
        public Action<PaletteMedia, (double InSeconds, double OutSeconds)?, bool>? Place;
        /// Esc or Backspace: back to the list.
        public Action? Back;
        /// A press on the header moves the palette, as the search row does.
        public Action<MouseEventArgs>? DragRequested;
        /// The footer line changes with the state (a file that won't play has its own).
        public Action? FooterChanged;
        public Action<string>? Log;

        public RangePicker()
        {
            SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.ResizeRedraw | ControlStyles.Selectable, true);
            BackColor = PaletteStyle.Canvas;
            TabStop = true;
            Visible = false;
            clock.Tick += (_, __) => Tick();
            openTimeout.Tick += (_, __) =>
            {
                openTimeout.Stop();
                if (state == State.Loading) Fail("It didn’t open within 8 seconds.");
            };
            SetScale(1f);
        }

        public bool Active => state != State.Closed;

        // The Mac's lines, with Ctrl for ⌘.
        public string FooterText => state == State.Failed
            ? "↵ place the whole clip  ·  ⇧↵ place, keep open  ·  esc back"
            : "I / O mark  ·  J K L play  ·  ←→ frame  ·  ↵ place In to Out  ·  ⇧↵ place, keep open  ·  Ctrl+↵ whole clip  ·  esc back";

        // ---- scale ----------------------------------------------------------

        private int P(float points) => (int)Math.Round(points * scale);
        private Font Px(string family, float points) => new Font(family, points * scale, FontStyle.Regular, GraphicsUnit.Pixel);

        public void SetScale(float next)
        {
            if (next <= 0) next = 1f;
            if (titleFont != null && Math.Abs(next - scale) < 0.01f) return;
            scale = next;
            var old = new[] { titleFont, binFont, readFont, labelFont, noteFont, escFont, barIconFont };
            titleFont = Px("Segoe UI Semibold", 15);
            binFont = Px("Segoe UI", 11);
            // Segoe UI's figures are tabular, so the timecode doesn't jitter as it runs.
            readFont = Px("Segoe UI", 12.5f);
            labelFont = Px("Segoe UI", 11);
            noteFont = Px("Segoe UI", 12.5f);
            escFont = Px("Segoe UI", 10.5f);
            barIconFont = Px("Segoe UI Symbol", 22);
            foreach (var font in old) font?.Dispose();
            LayoutHost();
            Invalidate();
        }

        // ---- layout (all in the Mac's points times the scale) ----------------

        private Rectangle HeaderRect => new Rectangle(0, 0, ClientSize.Width, P(52));
        private Rectangle ReadoutRect => new Rectangle(P(16), ClientSize.Height - P(34), Math.Max(0, ClientSize.Width - P(32)), P(28));
        private Rectangle ScrubRect => new Rectangle(P(16), ReadoutRect.Y - P(30), Math.Max(0, ClientSize.Width - P(32)), P(26));
        private Rectangle MediaRect
        {
            get
            {
                var top = HeaderRect.Bottom + P(12);
                return new Rectangle(P(16), top, Math.Max(0, ClientSize.Width - P(32)), Math.Max(0, ScrubRect.Y - P(10) - top));
            }
        }
        // Sound's plain bar, across the middle of the media area.
        private Rectangle SoundBarRect
        {
            get
            {
                var m = MediaRect;
                var h = Math.Min(P(72), m.Height);
                return new Rectangle(m.X, m.Y + (m.Height - h) / 2, m.Width, h);
            }
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            LayoutHost();
        }

        private void LayoutHost()
        {
            if (host == null) return;
            host.Bounds = MediaRect;
        }

        // ---- opening and closing --------------------------------------------

        /// Opens the picker for a video or sound with a file on disk. The caller has checked the path is there.
        public void Open(PaletteMedia media, double? sequenceFps)
        {
            Close();
            item = media;
            listFps = sequenceFps ?? 0;
            state = State.Loading;
            failure = "";
            showsVideo = false;
            // Until the file says how long it is: what the list said (sound), else nothing to scrub yet.
            pick = new RangePick(media.Seconds ?? 0, RangePick.PickFps(null, listFps));
            Visible = true;
            Focus();
            FooterChanged?.Invoke();
            Invalidate();
            var path = media.Path ?? "";
            if (!File.Exists(path)) { Fail("The file isn’t where Premiere says it is."); return; }
            try
            {
                EnsurePlayer();
                var token = ++openToken;
                opening = new Uri(path);
                player!.IsMuted = true;
                player.Open(opening);
                openTimeout.Stop();
                openTimeout.Start();
                Log?.Invoke("Range picker: opening " + Path.GetFileName(path) + " (#" + token + ")");
            }
            catch (Exception ex)
            {
                Fail("Windows couldn’t open it (" + ex.Message + ").");
            }
        }

        /// Leaves the picker: playback stops, the file is let go, the marks are remembered.
        public void Close()
        {
            if (state == State.Closed && !Visible) return;
            openTimeout.Stop();
            clock.Stop();
            scrubbing = false;
            if (Capture) Capture = false;
            if (state == State.Ready && item != null) { pick.Stop(); remembered[item.Id] = pick; }
            openToken++;
            try { player?.Pause(); player?.Close(); } catch (Exception) { }
            if (host != null) host.Visible = false;
            state = State.Closed;
            item = null;
            Visible = false;
        }

        private void EnsurePlayer()
        {
            if (player != null) return;
            player = new WpfMedia.MediaPlayer { ScrubbingEnabled = true, Volume = 0.8 };
            player.MediaOpened += (_, __) => Opened();
            player.MediaFailed += (_, e) => { if (state == State.Loading || state == State.Ready) Fail("Windows can’t play this file here (" + (e.ErrorException?.Message ?? "no codec") + ")."); };
            player.MediaEnded += (_, __) => { if (state == State.Ready && pick.Rate > 0) { pick.GoToEnd(); ApplyRate(); Moved(); } };
            video = new WpfMedia.VideoDrawing { Player = player, Rect = new Wpf.Rect(0, 0, 16, 9) };
            var canvas = WpfMedia.Color.FromRgb(PaletteStyle.Canvas.R, PaletteStyle.Canvas.G, PaletteStyle.Canvas.B);
            var image = new WpfControls.Image
            {
                Source = new WpfMedia.DrawingImage(video),
                Stretch = WpfMedia.Stretch.Uniform,
                IsHitTestVisible = false,
                Focusable = false,
            };
            var root = new WpfControls.Grid { Background = new WpfMedia.SolidColorBrush(canvas), Focusable = false, IsHitTestVisible = false };
            root.Children.Add(image);
            host = new ElementHost { Child = root, BackColor = PaletteStyle.Canvas, TabStop = false, Visible = false };
            // The keys stay with the picker: a click on the picture hands the focus straight back.
            host.Enter += (_, __) => BeginInvoke((Action)(() => Focus()));
            host.MouseDown += (_, __) => Focus();
            Controls.Add(host);
            LayoutHost();
        }

        private void Opened()
        {
            if (state != State.Loading || player == null || item == null || opening == null || player.Source != opening) return;
            openTimeout.Stop();
            var duration = player.NaturalDuration.HasTimeSpan ? player.NaturalDuration.TimeSpan.TotalSeconds : item.Seconds ?? 0;
            if (!(duration > 0)) { Fail("Windows couldn’t tell how long it is."); return; }
            if (!player.HasVideo && !player.HasAudio) { Fail("Windows found no picture or sound in it."); return; }
            pick = new RangePick(duration, RangePick.PickFps(null, listFps));
            if (remembered.TryGetValue(item.Id, out var saved)) pick.Restore(saved.MarkIn, saved.MarkOut, saved.Playhead);
            showsVideo = player.HasVideo && player.NaturalVideoWidth > 0 && player.NaturalVideoHeight > 0;
            if (showsVideo && video != null) video.Rect = new Wpf.Rect(0, 0, player.NaturalVideoWidth, player.NaturalVideoHeight);
            // Play then pause at once: MediaPlayer shows no frame until it has started; muted so nothing is heard.
            player.Play();
            player.Pause();
            player.Position = TimeSpan.FromSeconds(pick.Playhead);
            player.IsMuted = false;
            state = State.Ready;
            if (host != null) host.Visible = showsVideo;
            Log?.Invoke("Range picker: opened " + item.Name + " · " + RangePick.Length(duration) + " at " + pick.Fps.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture) + " fps" + (showsVideo ? "" : " (sound)"));
            Invalidate();
        }

        private void Fail(string why)
        {
            openTimeout.Stop();
            clock.Stop();
            openToken++;
            try { player?.Close(); } catch (Exception) { }
            if (host != null) host.Visible = false;
            state = State.Failed;
            failure = why;
            Log?.Invoke("Range picker: can’t play " + (item?.Name ?? "?") + ": " + why);
            FooterChanged?.Invoke();
            Invalidate();
        }

        // ---- playback -------------------------------------------------------

        // The model's rate onto the player: forward plays at that speed; back is stepped by the clock (MediaPlayer
        // can't play backward); still pauses on the playhead's frame.
        private void ApplyRate()
        {
            if (player == null || state != State.Ready) return;
            if (pick.Rate > 0)
            {
                player.SpeedRatio = pick.Rate;
                player.Play();
            }
            else
            {
                player.Pause();
                player.Position = TimeSpan.FromSeconds(pick.Playhead);
                shuttleClock = pick.Playhead;
            }
            if (pick.Rate != 0) { tickWatch.Restart(); clock.Start(); }
            else clock.Stop();
        }

        private void Tick()
        {
            if (player == null || state != State.Ready || pick.Rate == 0) { clock.Stop(); return; }
            var dt = tickWatch.Elapsed.TotalSeconds;
            tickWatch.Restart();
            if (pick.Rate > 0) pick.Seek(player.Position.TotalSeconds);
            else
            {
                shuttleClock += pick.Rate * dt;
                pick.Seek(shuttleClock);
                player.Position = TimeSpan.FromSeconds(pick.Playhead);
                if (shuttleClock <= 0) pick.Seek(0);
            }
            if (pick.AtBoundary || (pick.Rate < 0 && shuttleClock <= 0))
            {
                pick.Stop();
                ApplyRate();
            }
            Moved();
        }

        // Only the playhead's places repaint: the scrub bar, the readout, and sound's bar.
        private void Moved()
        {
            Invalidate(Rectangle.Inflate(ScrubRect, 0, P(4)));
            Invalidate(ReadoutRect);
            if (!showsVideo) Invalidate(SoundBarRect);
        }

        private void SeekPlayer()
        {
            if (player == null || state != State.Ready) return;
            shuttleClock = pick.Playhead;
            player.Position = TimeSpan.FromSeconds(pick.Playhead);
        }

        // ---- keys -----------------------------------------------------------

        /// Every picker key; true when it was the picker's. Enter, Esc and Backspace included.
        public bool HandleKey(Keys keyData)
        {
            if (!Active) return false;
            var key = keyData & Keys.KeyCode;
            var modifiers = keyData & Keys.Modifiers;
            var plain = modifiers == Keys.None;
            var shift = modifiers == Keys.Shift;
            var alt = modifiers == Keys.Alt;

            switch (key)
            {
                case Keys.Escape when plain:
                case Keys.Back when plain:
                    Back?.Invoke();
                    return true;
                case Keys.Enter when (modifiers & ~(Keys.Shift | Keys.Control)) == Keys.None:
                    PlaceNow(whole: (modifiers & Keys.Control) != 0, keepOpen: (modifiers & Keys.Shift) != 0);
                    return true;
            }
            // While it opens or after it failed, only Enter, Esc and Backspace do anything; the rest are swallowed so
            // they never reach Premiere or beep.
            if (state != State.Ready) return true;

            var moved = true;
            switch (key)
            {
                case Keys.I when plain: pick.MarkInHere(); break;
                case Keys.O when plain: pick.MarkOutHere(); break;
                case Keys.I when alt: pick.ClearIn(); break;
                case Keys.O when alt: pick.ClearOut(); break;
                case Keys.I when shift: pick.GoToIn(); ApplyRate(); break;
                case Keys.O when shift: pick.GoToOut(); ApplyRate(); break;
                case Keys.J when plain: pick.ShuttleBackward(); ApplyRate(); break;
                case Keys.K when plain: pick.Stop(); ApplyRate(); break;
                case Keys.L when plain: pick.ShuttleForward(); ApplyRate(); break;
                case Keys.Space when plain: pick.TogglePlay(); ApplyRate(); break;
                case Keys.Left when plain || shift: pick.Step(shift ? -10 : -1); ApplyRate(); break;
                case Keys.Right when plain || shift: pick.Step(shift ? 10 : 1); ApplyRate(); break;
                case Keys.Home when plain: pick.GoToStart(); ApplyRate(); break;
                case Keys.End when plain: pick.GoToEnd(); ApplyRate(); break;
                default: moved = false; break;
            }
            if (moved) { if (item != null) remembered[item.Id] = pick; Invalidate(); }
            // Anything else is the picker's too (no typing goes anywhere while it's up), except Tab, which the palette
            // ignores here.
            return true;
        }

        private void PlaceNow(bool whole, bool keepOpen)
        {
            var media = item;
            if (media == null) return;
            (double InSeconds, double OutSeconds)? range = null;
            if (!whole)
            {
                if (state == State.Ready) range = pick.PlaceRange;
                // Still opening: what was marked last time, if anything (same file, same length).
                else if (state == State.Loading && remembered.TryGetValue(media.Id, out var saved)) range = saved.PlaceRange;
            }
            Place?.Invoke(media, range, keepOpen);
        }

        // ---- mouse: the scrub bar (and sound's bar) seek; the header moves the palette ----

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            Focus();
            if (e.Button != MouseButtons.Left) return;
            if (HeaderRect.Contains(e.Location)) { DragRequested?.Invoke(e); return; }
            if (state != State.Ready) return;
            if (Rectangle.Inflate(ScrubRect, 0, P(4)).Contains(e.Location) || (!showsVideo && SoundBarRect.Contains(e.Location)))
            {
                scrubbing = true;
                Capture = true;
                ScrubTo(e.X);
            }
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            if (scrubbing && (e.Button & MouseButtons.Left) != 0) ScrubTo(e.X);
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (!scrubbing) return;
            scrubbing = false;
            Capture = false;
            if (item != null) remembered[item.Id] = pick;
            Focus();
        }

        private void ScrubTo(int x)
        {
            var bar = ScrubRect;
            if (bar.Width <= 0) return;
            pick.Seek(pick.Seconds((x - bar.X) / (double)bar.Width));
            SeekPlayer();
            Moved();
        }

        // ---- drawing --------------------------------------------------------

        private static Size Measure(string text, Font font) =>
            text.Length == 0 ? Size.Empty : TextRenderer.MeasureText(text, font, new Size(int.MaxValue, int.MaxValue), Line1);

        private static void Draw(Graphics g, string text, Font font, Rectangle bounds, Color colour, TextFormatFlags extra = TextFormatFlags.Default) =>
            TextRenderer.DrawText(g, text, font, bounds, colour, Line1 | extra);

        private static void FillRounded(Graphics g, RectangleF r, float radius, Color colour)
        {
            var d = Math.Min(radius * 2, Math.Min(r.Width, r.Height));
            var smoothing = g.SmoothingMode;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var brush = new SolidBrush(colour))
            {
                if (d <= 0) g.FillRectangle(brush, r);
                else
                {
                    using (var path = new GraphicsPath())
                    {
                        path.AddArc(r.X, r.Y, d, d, 180, 90);
                        path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
                        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
                        path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
                        path.CloseFigure();
                        g.FillPath(brush, path);
                    }
                }
            }
            g.SmoothingMode = smoothing;
        }

        private Color Kind => item == null ? PaletteStyle.LabelOther : PaletteStyle.Label(item);

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            using (var fill = new SolidBrush(PaletteStyle.Canvas)) g.FillRectangle(fill, ClientRectangle);
            if (item == null) return;
            PaintHeader(g);
            PaintMedia(g);
            PaintScrub(g);
            PaintReadout(g);
        }

        // One title: the kind's dot, the media name, its bin muted after it; esc on the right, as in the search row.
        private void PaintHeader(Graphics g)
        {
            var h = HeaderRect;
            using (var line = new SolidBrush(PaletteStyle.Line)) g.FillRectangle(line, 0, h.Bottom - 1, h.Width, 1);
            var midY = h.Y + (h.Height - 1) / 2;
            var smoothing = g.SmoothingMode;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var dot = new SolidBrush(Kind)) g.FillEllipse(dot, P(20), midY - P(4), P(8), P(8));
            g.SmoothingMode = smoothing;

            var cap = new Rectangle(h.Width - P(48), P(18), P(34), P(18));
            var capPath = new RectangleF(cap.X + 0.5f, cap.Y + 0.5f, cap.Width - 1, cap.Height - 1);
            FillRounded(g, capPath, P(5), PaletteStyle.Line);
            FillRounded(g, RectangleF.Inflate(capPath, -1, -1), P(4), PaletteStyle.Card);
            Draw(g, "esc", escFont, cap, PaletteStyle.Muted, TextFormatFlags.HorizontalCenter);

            var left = P(40);
            var room = Math.Max(0, cap.X - P(16) - left);
            var bin = item!.Bin;
            var binSize = Measure(bin, binFont);
            var nameSize = Measure(item.Name, titleFont);
            // The name wins the room; the bin takes what's left (at most a third), or goes.
            var binRoom = bin.Length == 0 ? 0 : Math.Min(binSize.Width + P(2), Math.Max(0, Math.Min(room / 3, room - nameSize.Width - P(10))));
            var nameWidth = Math.Min(nameSize.Width + P(2), room - (binRoom > P(24) ? binRoom + P(10) : 0));
            Draw(g, item.Name, titleFont, new Rectangle(left, midY - nameSize.Height / 2, Math.Max(0, nameWidth), nameSize.Height), PaletteStyle.Text, TextFormatFlags.EndEllipsis);
            if (binRoom > P(24))
                Draw(g, bin, binFont, new Rectangle(left + nameWidth + P(10), midY - binSize.Height / 2 + P(1), binRoom, binSize.Height), PaletteStyle.Muted, TextFormatFlags.EndEllipsis);
        }

        private void PaintMedia(Graphics g)
        {
            var m = MediaRect;
            if (state == State.Ready && showsVideo) return;   // the ElementHost draws the picture
            if (state == State.Loading)
            {
                Note(g, m, "Opening…");
                return;
            }
            if (state == State.Failed)
            {
                Note(g, m, "Can’t play this file here. ↵ places the whole clip.\n" + failure);
                return;
            }
            // Sound: a plain bar in the sound colour (no waveform on Windows), filled up to the playhead.
            var bar = SoundBarRect;
            FillRounded(g, bar, P(10), PaletteStyle.Over(Kind, 0.10));
            var played = (int)Math.Round(bar.Width * pick.Fraction(pick.Playhead));
            if (played > 0)
            {
                var clip = g.Clip;
                g.SetClip(new Rectangle(bar.X, bar.Y, played, bar.Height));
                FillRounded(g, bar, P(10), PaletteStyle.Over(Kind, 0.22));
                g.Clip = clip;
            }
            Draw(g, "∿", barIconFont, bar, PaletteStyle.Over(Kind, 0.8), TextFormatFlags.HorizontalCenter);
        }

        private void Note(Graphics g, Rectangle area, string text)
        {
            const TextFormatFlags wrap = TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix | TextFormatFlags.WordBreak | TextFormatFlags.HorizontalCenter;
            var width = Math.Max(0, area.Width - P(48));
            var height = TextRenderer.MeasureText(text, noteFont, new Size(width, int.MaxValue), wrap).Height;
            TextRenderer.DrawText(g, text, noteFont, new Rectangle(area.X + (area.Width - width) / 2, area.Y + (area.Height - height) / 2, width, height + P(2)), PaletteStyle.Muted, wrap);
        }

        // The whole length: the marked part in the kind's colour at low alpha with In/Out ticks, the playhead an
        // orange line.
        private void PaintScrub(Graphics g)
        {
            var r = ScrubRect;
            var midY = r.Y + r.Height / 2;
            var track = new RectangleF(r.X, midY - P(3), r.Width, P(6));
            FillRounded(g, track, P(3), PaletteStyle.Line);
            if (state != State.Ready) return;
            float X(double seconds) => r.X + (float)(r.Width * pick.Fraction(seconds));
            if (pick.HasMarks)
            {
                var range = pick.PlaceRange!.Value;
                var x0 = X(range.InSeconds);
                var x1 = Math.Max(x0 + 2, X(range.OutSeconds));
                FillRounded(g, new RectangleF(x0, midY - P(7), x1 - x0, P(14)), P(3), PaletteStyle.Over(Kind, 0.30));
                using (var tick = new SolidBrush(Kind))
                {
                    if (pick.MarkIn != null) g.FillRectangle(tick, x0, midY - P(8), Math.Max(2, P(2)), P(16));
                    if (pick.MarkOut != null) g.FillRectangle(tick, x1 - Math.Max(2, P(2)), midY - P(8), Math.Max(2, P(2)), P(16));
                }
            }
            using (var head = new SolidBrush(PaletteStyle.Accent))
            {
                var x = X(pick.Playhead);
                g.FillRectangle(head, x - Math.Max(1, P(1)), r.Y, Math.Max(2, P(2)), r.Height);
            }
        }

        // The playhead's time, then In, Out and the marked length: muted labels, values in the text colour.
        private void PaintReadout(Graphics g)
        {
            var r = ReadoutRect;
            var ready = state == State.Ready;
            string Time(double seconds) => item?.Kind == "audio" || (ready && !showsVideo) ? RangePick.Clock(seconds) : RangePick.Timecode(seconds, pick.Fps);
            var x = r.X;
            void Value(string text, Color colour)
            {
                var size = Measure(text, readFont);
                Draw(g, text, readFont, new Rectangle(x, r.Y, size.Width + P(2), r.Height), colour);
                x += size.Width + P(18);
            }
            void Label(string text)
            {
                var size = Measure(text, labelFont);
                Draw(g, text, labelFont, new Rectangle(x, r.Y, size.Width + P(2), r.Height), PaletteStyle.Muted);
                x += size.Width + P(6);
            }
            Value(ready ? Time(pick.Playhead) : Dash, PaletteStyle.Text);
            Label("In");
            Value(ready && pick.MarkIn is double markIn ? Time(markIn) : Dash, pick.MarkIn != null ? PaletteStyle.Text : PaletteStyle.Faint);
            Label("Out");
            Value(ready && pick.MarkOut is double markOut ? Time(markOut) : Dash, pick.MarkOut != null ? PaletteStyle.Text : PaletteStyle.Faint);
            // The length sits on the right: of the marked part, or of the whole clip with no marks.
            var lengthText = ready ? RangePick.Length(pick.MarkedSeconds) : Dash;
            var lengthLabel = ready && pick.HasMarks ? "Marked" : "Length";
            var valueSize = Measure(lengthText, readFont);
            var labelSize = Measure(lengthLabel, labelFont);
            var right = r.Right;
            if (x + labelSize.Width + P(6) + valueSize.Width > right) return;
            Draw(g, lengthText, readFont, new Rectangle(right - valueSize.Width - P(2), r.Y, valueSize.Width + P(2), r.Height), PaletteStyle.Text);
            Draw(g, lengthLabel, labelFont, new Rectangle(right - valueSize.Width - P(8) - labelSize.Width, r.Y, labelSize.Width + P(2), r.Height), PaletteStyle.Muted);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                clock.Dispose();
                openTimeout.Dispose();
                try { player?.Close(); } catch (Exception) { }
                foreach (var font in new[] { titleFont, binFont, readFont, labelFont, noteFont, escFont, barIconFont }) font?.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
