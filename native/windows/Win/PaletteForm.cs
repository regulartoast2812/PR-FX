using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Windows.Forms;

namespace PrFxShortcutListener
{
    // The standalone palette. Mirrors the macOS palette in
    // PRFXShortcutListener.swift (filterCommands / applyCurrentSelection and the
    // three apply sub-menus), so both platforms behave the same.
    internal sealed class PaletteForm : Form
    {
        private static readonly Color Background = Color.FromArgb(30, 30, 32);
        private static readonly Color Field = Color.FromArgb(44, 44, 47);
        private static readonly Color Selected = Color.FromArgb(48, 82, 140);
        private static readonly Color Muted = Color.FromArgb(150, 150, 155);
        private static readonly Color TransitionTint = Color.FromArgb(99, 176, 219);
        private static readonly Color AudioTint = Color.FromArgb(107, 194, 156);
        private static readonly Color FunctionTint = Color.FromArgb(84, 184, 173);
        private static readonly Color AIFunctionTint = Color.FromArgb(176, 132, 230);
        private static readonly Color EffectTint = Color.FromArgb(214, 115, 46);

        private readonly Label title = new Label();
        private readonly Label hotkey = new Label();
        private readonly TextBox search = new TextBox();
        private readonly ListBox list = new ListBox();
        private readonly Label footer = new Label();
        private readonly Panel header = new Panel();
        private readonly PictureBox character = new PictureBox();

        private List<Dictionary<string, object?>> visible = new List<Dictionary<string, object?>>();
        private Dictionary<string, object?>? pendingTransition, pendingMove, pendingStagger;
        private string catalogQuery = "";
        private bool submitting;
        private IntPtr returnWindow = IntPtr.Zero;

        public Func<List<Dictionary<string, object?>>> Catalog = () => new List<Dictionary<string, object?>>();
        public Func<ListenerSettings> CurrentSettings = () => new ListenerSettings();
        public Action<Dictionary<string, object?>, bool>? Submit;

        public PaletteForm()
        {
            Text = "Edie";
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            KeyPreview = true;
            BackColor = Background;
            Size = new Size(640, 430);
            MinimumSize = new Size(420, 260);
            Padding = new Padding(1);

            header.Dock = DockStyle.Top;
            header.Height = 34;
            header.BackColor = Background;
            title.Text = "EDIE";
            title.ForeColor = Muted;
            title.Font = new Font("Segoe UI Semibold", 8.5f);
            title.AutoSize = false;
            title.Dock = DockStyle.Fill;
            title.TextAlign = ContentAlignment.MiddleLeft;
            title.Padding = new Padding(52, 0, 0, 0);
            character.Image = CreateEdieBitmap();
            character.SizeMode = PictureBoxSizeMode.Normal;
            character.Location = new Point(12, 1);
            character.Size = new Size(32, 32);
            character.BackColor = Background;
            hotkey.ForeColor = Muted;
            hotkey.Font = new Font("Segoe UI", 8.5f);
            hotkey.Dock = DockStyle.Right;
            hotkey.Width = 220;
            hotkey.TextAlign = ContentAlignment.MiddleRight;
            hotkey.Padding = new Padding(0, 0, 12, 0);
            header.Controls.Add(title);
            header.Controls.Add(hotkey);
            header.Controls.Add(character);
            character.BringToFront();
            foreach (Control dragHandle in new Control[] { header, title, hotkey, character }) dragHandle.MouseDown += DragWindow;

            var searchHost = new Panel { Dock = DockStyle.Top, Height = 40, Padding = new Padding(12, 6, 12, 6), BackColor = Background };
            search.Dock = DockStyle.Fill;
            search.BorderStyle = BorderStyle.FixedSingle;
            search.BackColor = Field;
            search.ForeColor = Color.White;
            search.Font = new Font("Segoe UI", 12f);
            search.TextChanged += (_, __) => FilterCommands(false);
            search.KeyDown += SearchKeyDown;
            searchHost.Controls.Add(search);

            list.Dock = DockStyle.Fill;
            list.BorderStyle = BorderStyle.None;
            list.BackColor = Background;
            list.ForeColor = Color.White;
            list.DrawMode = DrawMode.OwnerDrawFixed;
            list.ItemHeight = 32;
            list.IntegralHeight = false;
            list.Font = new Font("Segoe UI", 10.5f);
            list.DrawItem += DrawRow;
            list.DoubleClick += (_, __) => ApplyCurrentSelection(false);
            list.KeyDown += SearchKeyDown;

            footer.Dock = DockStyle.Bottom;
            footer.Height = 28;
            footer.ForeColor = Muted;
            footer.Font = new Font("Segoe UI", 8.5f);
            footer.TextAlign = ContentAlignment.MiddleLeft;
            footer.Padding = new Padding(12, 0, 0, 0);

            Controls.Add(list);
            Controls.Add(footer);
            Controls.Add(searchHost);
            Controls.Add(header);

            Deactivate += (_, __) => { if (Visible) ClosePalette(false); };
            ResetApplyMenu();
        }

        private static Bitmap CreateEdieBitmap()
        {
            // Facing right, toward the commands: EdieSprite (the port of the macOS sprite), one bitmap pixel
            // per fine-grid cell, so the palette can never drift from his look on the Timeline highlight.
            var image = new Bitmap(32, 32);
            using (var graphics = Graphics.FromImage(image))
            {
                graphics.Clear(Color.Transparent);
                EdieSprite.Draw(graphics, EdieSprite.Face(EdieSprite.Mood.Rest, right: true), 0, 0, 2);
            }
            return image;
        }

        protected override CreateParams CreateParams
        {
            get
            {
                var parameters = base.CreateParams;
                parameters.ExStyle |= Native.WS_EX_TOOLWINDOW;
                return parameters;
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            using (var pen = new Pen(Color.FromArgb(70, 70, 75))) e.Graphics.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
        }

        public void Open(IntPtr premiereWindow)
        {
            returnWindow = premiereWindow;
            if (pendingTransition != null || pendingMove != null || pendingStagger != null) ResetApplyMenu();
            catalogQuery = "";
            search.Text = "";
            hotkey.Text = CurrentSettings().Palette.Display().ToUpperInvariant();
            FilterCommands(true);
            RestoreFrame();
            Show();
            Native.ForceForeground(Handle);
            Activate();
            search.Focus();
        }

        public void ClosePalette(bool returnToPremiere)
        {
            SaveFrame();
            Hide();
            if (returnToPremiere && returnWindow != IntPtr.Zero && Native.IsWindow(returnWindow)) Native.ForceForeground(returnWindow);
        }

        // ---- list ---------------------------------------------------------

        private static string Identity(IDictionary<string, object?> command) =>
            string.Join("|", Json.Str(command, "type") ?? "", Json.Str(command, "id") ?? "", Json.Str(command, "moveMode") ?? "", Json.Str(command, "name") ?? "");

        private void FilterCommands(bool resetSelection)
        {
            var previousRow = list.SelectedIndex;
            var previousKey = previousRow >= 0 && previousRow < visible.Count ? Identity(visible[previousRow]) : null;
            var settings = CurrentSettings();
            if (pendingTransition != null) visible = TransitionPlacementCommands();
            else if (pendingMove != null) visible = MoveModeCommands();
            else if (pendingStagger != null) visible = StaggerFrameCommands(settings);
            else
            {
                var query = search.Text.Trim().ToLowerInvariant();
                visible = Catalog()
                    .Where(c => query.Length == 0 || ((Json.Str(c, "name") ?? "") + " " + (Json.Str(c, "type") ?? "")).ToLowerInvariant().Contains(query))
                    .ToList();
            }
            list.BeginUpdate();
            list.Items.Clear();
            foreach (var command in visible) list.Items.Add(Json.Str(command, "name") ?? "");
            list.EndUpdate();
            if (visible.Count == 0) return;
            var row = 0;
            if (!resetSelection)
            {
                var matched = previousKey == null ? -1 : visible.FindIndex(c => Identity(c) == previousKey);
                if (matched >= 0) row = matched;
                else if (previousRow >= 0) row = Math.Max(0, Math.Min(visible.Count - 1, previousRow));
            }
            list.SelectedIndex = row;
        }

        private void DrawRow(object? sender, DrawItemEventArgs e)
        {
            if (e.Index < 0 || e.Index >= visible.Count) return;
            var command = visible[e.Index];
            var selected = (e.State & DrawItemState.Selected) != 0;
            using (var fill = new SolidBrush(selected ? Selected : Background)) e.Graphics.FillRectangle(fill, e.Bounds);
            var type = Json.Str(command, "type") ?? "";
            var label = TypeLabel(type);
            var labelFont = new Font("Segoe UI Semibold", 7.5f);
            var labelSize = TextRenderer.MeasureText(label, labelFont);
            var nameBounds = new Rectangle(e.Bounds.Left + 14, e.Bounds.Top, e.Bounds.Width - labelSize.Width - 40, e.Bounds.Height);
            TextRenderer.DrawText(e.Graphics, Json.Str(command, "name") ?? "", list.Font, nameBounds, Color.White, TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
            var labelBounds = new Rectangle(e.Bounds.Right - labelSize.Width - 16, e.Bounds.Top, labelSize.Width + 4, e.Bounds.Height);
            TextRenderer.DrawText(e.Graphics, label, labelFont, labelBounds, selected ? Color.White : TypeTint(type), TextFormatFlags.VerticalCenter | TextFormatFlags.Right | TextFormatFlags.NoPrefix);
            labelFont.Dispose();
        }

        private static bool IsFunctionType(string type) => type == "custom" || type == "move-mode" || type == "stagger-frames";

        private static string TypeLabel(string type) =>
            IsFunctionType(type) ? "FUNCTION" : type == "transition-placement" ? "TRANSITION" : type.Replace("-", " ").ToUpperInvariant();

        private static Color TypeTint(string type)
        {
            if (type == "transition" || type == "transition-placement") return TransitionTint;
            if (type == "audio-transition") return AudioTint;
            if (type == "ai-function") return AIFunctionTint;
            if (IsFunctionType(type)) return FunctionTint;
            return EffectTint;
        }

        // ---- keyboard -----------------------------------------------------

        private void SearchKeyDown(object? sender, KeyEventArgs e)
        {
            switch (e.KeyCode)
            {
                case Keys.Down: MoveSelection(1); break;
                case Keys.Up: MoveSelection(-1); break;
                case Keys.PageDown: MoveSelection(8); break;
                case Keys.PageUp: MoveSelection(-8); break;
                case Keys.Enter: ApplyCurrentSelection(e.Shift); break;
                case Keys.Escape:
                    if (pendingTransition != null || pendingMove != null || pendingStagger != null) ResetApplyMenu();
                    else ClosePalette(true);
                    break;
                default: return;
            }
            e.Handled = true;
            e.SuppressKeyPress = true;
            if (sender == list) search.Focus();
        }

        private void MoveSelection(int delta)
        {
            if (visible.Count == 0) return;
            var current = list.SelectedIndex < 0 ? 0 : list.SelectedIndex;
            list.SelectedIndex = Math.Max(0, Math.Min(visible.Count - 1, current + delta));
        }

        // ---- apply --------------------------------------------------------

        private void ApplyCurrentSelection(bool keepOpen)
        {
            if (submitting) return;
            var row = list.SelectedIndex;
            if (row < 0 || row >= visible.Count) return;
            var command = visible[row];
            var settings = CurrentSettings();
            var id = Json.Str(command, "id");
            var type = Json.Str(command, "type") ?? "";

            if (pendingTransition != null)
            {
                var placed = Json.Clone(pendingTransition);
                placed["transitionFrames"] = TransitionFramesFromField(settings);
                placed["transitionPlacement"] = id ?? "both";
                ResetApplyMenu();
                SubmitCommand(placed, keepOpen);
                return;
            }
            if (pendingStagger != null)
            {
                var staggered = Json.Clone(pendingStagger);
                staggered["staggerFrames"] = int.TryParse(id, NumberStyles.Integer, CultureInfo.InvariantCulture, out var frames) ? frames : settings.StaggerFrames;
                ResetApplyMenu();
                SubmitCommand(staggered, keepOpen);
                return;
            }
            if (pendingMove != null)
            {
                var moved = Json.Clone(pendingMove);
                moved["moveMode"] = id ?? "group";
                ResetApplyMenu();
                SubmitCommand(moved, keepOpen);
                return;
            }
            if (type == "transition" || type == "audio-transition")
            {
                ShowSubMenu(ref pendingTransition, command, "TRANSITION", "Length in frames • CEP default " + settings.TransitionFrames,
                    "↑ ↓  choose placement     ↵  apply + close     Shift+↵  apply + keep open     Esc  back");
                return;
            }
            if (type == "custom" && (id == "move-selected-clips-up" || id == "move-selected-clips-down") && string.IsNullOrEmpty(Json.Str(command, "moveMode")))
            {
                ShowSubMenu(ref pendingMove, command, "FUNCTION", "Choose move behavior",
                    "↑ ↓  choose behavior     ↵  move + close     Shift+↵  move + keep open     Esc  back");
                return;
            }
            if (type == "custom" && (id == "stagger-ascending" || id == "stagger-descending"))
            {
                ShowSubMenu(ref pendingStagger, command, "FUNCTION", "Frames per step • default " + settings.StaggerFrames,
                    "↑ ↓  choose step     ↵  stagger + close     Shift+↵  stagger + keep open     Esc  back");
                return;
            }
            SubmitCommand(Json.Clone(command), keepOpen);
        }

        private void ShowSubMenu(ref Dictionary<string, object?>? slot, Dictionary<string, object?> command, string kind, string placeholder, string footerText)
        {
            slot = command;
            catalogQuery = search.Text;
            title.Text = (Json.Str(command, "name") ?? "").ToUpperInvariant();
            hotkey.Text = kind;
            search.Text = "";
            SetPlaceholder(placeholder);
            footer.Text = footerText;
            FilterCommands(true);
            search.Focus();
        }

        private void SubmitCommand(Dictionary<string, object?> command, bool keepOpen)
        {
            submitting = true;
            Submit?.Invoke(command, keepOpen);
            if (keepOpen) { Native.ForceForeground(Handle); search.Focus(); }
            else ClosePalette(true);
            var release = new Timer { Interval = 350 };
            release.Tick += (_, __) => { submitting = false; release.Stop(); release.Dispose(); };
            release.Start();
        }

        private void ResetApplyMenu()
        {
            pendingTransition = pendingMove = pendingStagger = null;
            title.Text = "EDIE";
            hotkey.Text = CurrentSettings().Palette.Display().ToUpperInvariant();
            search.Text = catalogQuery;
            SetPlaceholder("Search effects, transitions, presets…");
            footer.Text = "↑ ↓  navigate     ↵  apply + close     Shift+↵  apply + keep open     Esc  close";
            FilterCommands(true);
        }

        private int TransitionFramesFromField(ListenerSettings settings)
        {
            var value = int.TryParse(search.Text.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var typed) ? typed : settings.TransitionFrames;
            return Math.Max(1, Math.Min(300, value));
        }

        private static Dictionary<string, object?> Option(string type, string name, string id) =>
            new Dictionary<string, object?>(StringComparer.Ordinal) { ["type"] = type, ["name"] = name, ["id"] = id };

        private static List<Dictionary<string, object?>> TransitionPlacementCommands() => new List<Dictionary<string, object?>>
        {
            Option("transition-placement", "Both In + Out on each selected clip", "both"),
            Option("transition-placement", "In points only", "in"),
            Option("transition-placement", "Out points only", "out"),
            Option("transition-placement", "Cuts between adjacent selected clips", "selected-cuts"),
            Option("transition-placement", "Start + end of each selected group", "group-ends"),
            Option("transition-placement", "Centered at every selected boundary", "centered")
        };

        private static List<Dictionary<string, object?>> MoveModeCommands() => new List<Dictionary<string, object?>>
        {
            Option("move-mode", "Move selection as a group", "group"),
            Option("move-mode", "Move clips individually", "individual")
        };

        // Typed frame count first, then common steps, so the prompt works
        // whether the editor types an exact number or just picks one.
        private List<Dictionary<string, object?>> StaggerFrameCommands(ListenerSettings settings)
        {
            var frames = new List<int>();
            if (int.TryParse(search.Text.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var typed) && typed >= 0 && typed <= 9999) frames.Add(typed);
            frames.Add(Math.Max(0, settings.StaggerFrames));
            frames.AddRange(new[] { 2, 3, 5, 10, 15, 20, 30 });
            return frames.Distinct().Select(value => Option("stagger-frames", value + " frame" + (value == 1 ? "" : "s") + " per step", value.ToString(CultureInfo.InvariantCulture))).ToList();
        }

        private void SetPlaceholder(string text)
        {
            if (search.IsHandleCreated) Native.SendMessage(search.Handle, Native.EM_SETCUEBANNER, new IntPtr(1), text);
            else search.HandleCreated += (_, __) => Native.SendMessage(search.Handle, Native.EM_SETCUEBANNER, new IntPtr(1), text);
        }

        // ---- frame --------------------------------------------------------

        private void DragWindow(object? sender, MouseEventArgs e)
        {
            if (e.Button != MouseButtons.Left) return;
            Native.ReleaseCapture();
            Native.SendMessage(Handle, Native.WM_NCLBUTTONDOWN, new IntPtr(Native.HTCAPTION), IntPtr.Zero);
            SaveFrame();
        }

        private void RestoreFrame()
        {
            try
            {
                var parts = File.ReadAllText(Paths.PaletteFrame).Trim().Split(',').Select(p => int.Parse(p, CultureInfo.InvariantCulture)).ToArray();
                var frame = new Rectangle(parts[0], parts[1], parts[2], parts[3]);
                if (frame.Width >= MinimumSize.Width && frame.Height >= MinimumSize.Height &&
                    Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(new Rectangle(frame.X, frame.Y, frame.Width, 40))))
                {
                    Bounds = frame;
                    return;
                }
            }
            catch (Exception) { }
            var screen = returnWindow != IntPtr.Zero ? Screen.FromHandle(returnWindow) : Screen.PrimaryScreen;
            var area = screen.WorkingArea;
            Location = new Point(area.Left + (area.Width - Width) / 2, area.Top + area.Height / 5);
        }

        private void SaveFrame()
        {
            if (!Visible || WindowState != FormWindowState.Normal) return;
            try
            {
                Paths.Ensure(Paths.SupportDir);
                File.WriteAllText(Paths.PaletteFrame, string.Join(",", new[] { Left, Top, Width, Height }.Select(v => v.ToString(CultureInfo.InvariantCulture))));
            }
            catch (Exception) { }
        }
    }
}
