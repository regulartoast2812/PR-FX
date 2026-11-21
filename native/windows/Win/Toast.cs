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
            var oneLine = TextRenderer.MeasureText(text, label.Font, Size.Empty, TextFormatFlags.NoPadding | TextFormatFlags.SingleLine).Width;
            var width = Math.Min(640, Math.Max(280, oneLine + 60));
            var textWidth = width - 56;
            var measured = TextRenderer.MeasureText(text, label.Font, new Size(textWidth, 120), TextFormatFlags.NoPadding | TextFormatFlags.WordBreak);
            var height = Math.Max(42, measured.Height + 20);
            Bounds = new Rectangle(area.Left + (area.Width - width) / 2, area.Bottom - height - 90, width, height);
            icon.Bounds = new Rectangle(13, (height - 22) / 2, 20, 22);
            label.Bounds = new Rectangle(41, 10, width - 55, height - 20);
            using (var path = new System.Drawing.Drawing2D.GraphicsPath())
            {
                var radius = Math.Min(32, height);
                path.AddArc(0, 0, radius, radius, 90, 180);
                path.AddArc(width - radius - 1, 0, radius, radius, 270, 180);
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
