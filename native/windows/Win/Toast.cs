using System;
using System.Drawing;
using System.Windows.Forms;

namespace PrFxShortcutListener
{
    internal enum ToastKind { Ok, Failed, Skipped }

    // Port of the banner in PRFXKeyFeedback.swift. Never takes focus: a banner
    // that stole keyboard focus from Premiere would itself break the next
    // shortcut.
    internal sealed class Toast : Form
    {
        private readonly Label icon = new Label();
        private readonly Label label = new Label();
        private readonly Timer timer = new Timer();
        private readonly Timer workingTimer = new Timer { Interval = 1000 };
        private string workingName = "";
        private DateTime workingStarted;
        private IntPtr workingWindow;
        private float fontScale = -1;

        public Toast()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            BackColor = Color.FromArgb(19, 19, 22);
            label.ForeColor = Color.White;
            label.Font = new Font("Segoe UI", 10f, FontStyle.Regular);
            label.TextAlign = ContentAlignment.MiddleLeft;
            label.AutoEllipsis = false;
            icon.Font = new Font("Segoe UI Symbol", 11f, FontStyle.Bold);
            icon.TextAlign = ContentAlignment.MiddleCenter;
            icon.BackColor = Color.Transparent;
            Controls.Add(icon);
            Controls.Add(label);
            timer.Tick += (_, __) => { timer.Stop(); Hide(); };
            workingTimer.Tick += (_, __) => ShowWorkingTick();
        }

        protected override bool ShowWithoutActivation => true;

        protected override CreateParams CreateParams
        {
            get
            {
                var parameters = base.CreateParams;
                parameters.ExStyle |= Native.WS_EX_TOOLWINDOW | Native.WS_EX_TOPMOST | Native.WS_EX_NOACTIVATE;
                return parameters;
            }
        }

        public void ShowMessage(string text, ToastKind kind, double seconds, IntPtr nearWindow)
        {
            // The pill never changes colour. Only its icon carries state, which
            // keeps the message white and readable over every Premiere panel.
            BackColor = Color.FromArgb(19, 19, 22);
            icon.Text = kind == ToastKind.Ok ? "✓" : kind == ToastKind.Failed ? "×" : "!";
            icon.ForeColor = kind == ToastKind.Ok ? Color.FromArgb(79, 219, 140) : kind == ToastKind.Failed ? Color.FromArgb(255, 97, 87) : Color.FromArgb(255, 161, 71);
            label.Text = text;
            var screen = nearWindow != IntPtr.Zero ? Screen.FromHandle(nearWindow) : Screen.PrimaryScreen;
            var area = screen.WorkingArea;
            // Physical pixels (the listener is per-monitor DPI aware): everything scales with the screen.
            var dpi = nearWindow != IntPtr.Zero ? Native.GetDpiForWindow(nearWindow) : 0;
            var s = dpi > 0 ? dpi / 96f : DeviceDpi / 96f;
            int S(float v) => (int)Math.Round(v * s);
            if (s != fontScale)
            {
                fontScale = s;
                // Only when the display scale changes; the old fonts are left to the collector (the controls
                // may still be drawing with them).
                label.Font = new Font("Segoe UI", 10f * s, FontStyle.Regular, GraphicsUnit.Point);
                icon.Font = new Font("Segoe UI Symbol", 11f * s, FontStyle.Bold, GraphicsUnit.Point);
            }
            // The icon and the text are one group, centred in the bubble, with the same space either side
            // (2026-11-21, the user: it sat far left of centre). Long messages wrap at 640 px.
            const TextFormatFlags flags = TextFormatFlags.NoPadding;
            var pad = S(18); var iconWidth = S(18); var gap = S(9);
            var oneLine = TextRenderer.MeasureText(text, label.Font, Size.Empty, flags | TextFormatFlags.SingleLine);
            var maxText = S(640) - 2 * pad - iconWidth - gap;
            var textSize = oneLine.Width <= maxText ? oneLine : TextRenderer.MeasureText(text, label.Font, new Size(maxText, S(200)), flags | TextFormatFlags.WordBreak);
            var group = iconWidth + gap + textSize.Width;
            var width = Math.Max(S(160), group + 2 * pad);
            var height = Math.Max(S(40), textSize.Height + S(20));
            Bounds = new Rectangle(area.Left + (area.Width - width) / 2, area.Bottom - height - S(90), width, height);
            var left = (width - group) / 2;
            icon.Bounds = new Rectangle(left, (height - S(22)) / 2, iconWidth, S(22));
            label.Bounds = new Rectangle(left + iconWidth + gap, (height - textSize.Height) / 2, textSize.Width + S(2), textSize.Height);
            label.TextAlign = ContentAlignment.TopLeft;
            using (var path = new System.Drawing.Drawing2D.GraphicsPath())
            {
                // A rounded rectangle, ends fully round on one line (corner diameter = height, at most 32 px).
                var d = Math.Min(height, S(32));
                path.AddArc(0, 0, d, d, 180, 90);
                path.AddArc(width - d, 0, d, d, 270, 90);
                path.AddArc(width - d, height - d, d, d, 0, 90);
                path.AddArc(0, height - d, d, d, 90, 90);
                path.CloseFigure();
                Region?.Dispose();
                Region = new Region(path);
            }
            if (!Visible) Show();
            Native.SetWindowPos(Handle, Native.HWND_TOPMOST, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW);
            timer.Stop();
            timer.Interval = Math.Max(500, (int)(seconds * 1000));
            timer.Start();
        }

        public void StartWorking(string name, IntPtr nearWindow)
        {
            workingName = name;
            workingWindow = nearWindow;
            workingStarted = DateTime.UtcNow;
            workingTimer.Start();
            ShowWorkingTick();
        }

        public void StopWorking()
        {
            workingTimer.Stop();
            workingName = "";
            timer.Stop();
            Hide();
        }

        private void ShowWorkingTick()
        {
            if (workingName.Length == 0) return;
            var seconds = Math.Max(0, (int)(DateTime.UtcNow - workingStarted).TotalSeconds);
            ShowMessage("Edie · Working on " + workingName + " · " + seconds + "s", ToastKind.Skipped, 2, workingWindow);
        }
    }
}
