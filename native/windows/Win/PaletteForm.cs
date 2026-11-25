using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace PrFxShortcutListener
{
    // The palette's colours: the settings panel's warm dark neutrals and its orange accent. Three copies, change all
    // of them together: client/styles.css :root, native/PRFXShortcutListener.swift PaletteStyle, and this class.
    internal static class PaletteStyle
    {
        public static Color Hex(int v) => Color.FromArgb((v >> 16) & 255, (v >> 8) & 255, v & 255);
        public static readonly Color Canvas = Hex(0x262624);
        public static readonly Color Card = Hex(0x2f2f2d);
        public static readonly Color Line = Hex(0x3e3e38);
        public static readonly Color Text = Hex(0xeceae3);
        public static readonly Color Muted = Hex(0xa3a096);
        public static readonly Color Faint = Hex(0x6f6c64);
        public static readonly Color Accent = Hex(0xff9a3d);
        public static readonly Color Orange = Hex(0xd4a26a), Blue = Hex(0x86a6d0), Cyan = Hex(0x7db5ae), Purple = Hex(0xa99cd4);
        // Media wears Premiere's default label colours (Preferences ▸ Labels): Violet video, Caribbean audio,
        // Lavender stills, Forest sequences, Iris the rest. Each tab takes its type's colour, each item its own kind's.
        public static readonly Color LabelVideo = Hex(0xa690e0), LabelAudio = Hex(0x29d698), LabelStill = Hex(0xe385e3), LabelOther = Hex(0x729acc), LabelSequence = Hex(0x51b858);
        public static Color Label(PaletteCategory category) => category switch
        {
            PaletteCategory.Commands => Accent,
            PaletteCategory.Video => LabelVideo,
            PaletteCategory.Audio or PaletteCategory.Sfx or PaletteCategory.Bgm => LabelAudio,
            PaletteCategory.Sequences => LabelSequence,
            _ => LabelOther,
        };
        public static Color Label(PaletteMedia m) => m.Kind switch
        {
            "video" => LabelVideo,
            "audio" => LabelAudio,
            "image" => LabelStill,
            "sequence" => LabelSequence,
            _ => LabelOther,
        };

        // `colour` at `alpha` over the canvas, as one solid colour (the Mac fills with alpha over the same canvas).
        public static Color Over(Color colour, double alpha, Color? under = null)
        {
            var b = under ?? Canvas;
            return Color.FromArgb(
                (int)Math.Round(colour.R * alpha + b.R * (1 - alpha)),
                (int)Math.Round(colour.G * alpha + b.G * (1 - alpha)),
                (int)Math.Round(colour.B * alpha + b.B * (1 - alpha)));
        }

        public static Color Colour(string type)
        {
            switch (type)
            {
                case "transition": case "transition-placement": return Blue;
                case "audio-transition": return Cyan;
                case "custom": case "move-mode": case "stagger-frames": return Accent;
                case "preset": case "ai-function": return Purple;
                default: return Orange;
            }
        }

        // The Mac draws SF Symbols; these are the nearest Segoe UI Symbol characters.
        public static string Symbol(string type)
        {
            switch (type)
            {
                case "ai-function": return "✦";        // sparkles
                case "custom": return "⚡";             // bolt
                case "effect": return "✶";             // wand and stars
                case "audio-effect": return "♪";       // speaker
                case "transition": return "◨";         // rectangle, right half filled
                case "audio-transition": return "≈";   // waveform
                case "preset": return "★";             // star
                case "transition-placement": return "↔";
                case "move-mode": return "↕";
                case "stagger-frames": return "↗";     // stairs
                default: return "●";
            }
        }

        // Sound in BGM gets the music note; other sound keeps the waveform.
        public static string MediaSymbol(PaletteMedia m) =>
            m.Kind == "audio" && PaletteSearch.CategoryOf(m) == PaletteCategory.Bgm ? "♫" : MediaSymbol(m.Kind);

        public static string MediaSymbol(string kind)
        {
            switch (kind)
            {
                case "video": return "▶";   // film
                case "audio": return "∿";   // waveform
                case "image": return "▣";   // photo
                case "sequence": return "≡"; // tracks
                default: return "❏";        // stack
            }
        }
    }

    // The standalone palette, laid out like Sage's Ctrl+Space search in Creative Assist and the same as the macOS
    // palette (PRFXShortcutListener.swift: the search row, PaletteTabsView, PaletteRowView, filterCommands /
    // applyCurrentSelection and the three apply menus): a search row with Edie and an esc key cap, Commands · Media ·
    // Video · Audio · SFX · BGM · Sequences tabs with counts (Tab goes to the next, Shift+Tab back), grouped rows, and a footer naming the keys. The search and rows
    // are Core/PaletteSearch.cs, the port of PRFXPaletteSearch.swift.
    internal sealed class PaletteForm : Form
    {
        // Double-buffered panels drawn by hand.
        private sealed class Canvas : Panel
        {
            public Canvas()
            {
                SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
                BackColor = PaletteStyle.Canvas;
            }
        }

        private const TextFormatFlags Line1 = TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine | TextFormatFlags.VerticalCenter;

        private readonly Canvas searchRow = new Canvas();
        private readonly TextBox search = new TextBox();
        private readonly Canvas tabs = new Canvas();
        private readonly Panel listHost = new Panel();
        private readonly ListBox list = new ListBox();
        private readonly Canvas footer = new Canvas();
        private readonly Bitmap edie = CreateEdieBitmap();
        // The In/Out picker (Win/RangePicker.cs): Enter on a video or sound opens it in place of the search row, tabs and
        // list; the footer stays. Esc or Backspace comes back to the list as it was.
        private readonly RangePicker picker = new RangePicker();
        // The open sequence's frame rate from the last media list (0 with none open), the picker's rate.
        private double? mediaFps;

        // The rows shown, and what their indexes point into: the commands (the catalog, or an apply menu's options)
        // and the project's media.
        private List<PaletteRow> rows = new List<PaletteRow>();
        private List<Dictionary<string, object?>> visible = new List<Dictionary<string, object?>>();
        private List<PaletteMedia> media = new List<PaletteMedia>();
        private Dictionary<string, string> shortcutLabels = new Dictionary<string, string>(StringComparer.Ordinal);
        private PaletteCategory category = PaletteCategory.Commands;
        // One per tab, in PaletteCategories.All's order; -1 while the first list is still being read.
        private readonly int[] counts = new int[PaletteCategories.All.Length];
        private readonly Rectangle[] tabRects = new Rectangle[PaletteCategories.All.Length];
        private string? titleName, titleKind;
        private Color titleColour;
        private string footerText = "";

        private Dictionary<string, object?>? pendingTransition, pendingMove, pendingStagger;
        private string catalogQuery = "";
        private bool submitting;
        private IntPtr returnWindow = IntPtr.Zero;

        // Media from Premiere: asked for when the Media tab is opened, read by CEP (prfx.listProjectMedia()).
        private string? mediaError;
        private DateTime? mediaAskedAt, mediaLoadedAt;
        private readonly System.Windows.Forms.Timer mediaTimeout = new System.Windows.Forms.Timer { Interval = 6000 };

        // The last 5 commands run and media placed, kept in palette-recent.json like the Mac's.
        private List<string> recentCommandKeys = new List<string>();
        private List<string> recentMediaIds = new List<string>();

        // Selection: only commands and media can be chosen; hovering chooses, but not just after a key moved it.
        private bool selecting;
        private int lastSelectable = -1;
        private DateTime keyMovedAt = DateTime.MinValue;
        // The row whose hairline below it is hidden (the last chosen one), so a new choice repaints both rows under them.
        private int hairlineHiddenUnder = -1;
        private Point lastMouse = new Point(-1, -1);

        // Sizes are the Mac's points times the screen's scale (the listener is per-monitor DPI aware).
        private float scale = 1f;
        private Font searchFont = null!, tabFont = null!, tabActiveFont = null!, countFont = null!, hintFont = null!, kindFont = null!, titleFont = null!,
            sectionFont = null!, nameFont = null!, nameBoldFont = null!, whereFont = null!, tagFont = null!, keyFont = null!, noteFont = null!,
            footerFont = null!, escFont = null!, iconFont = null!, iconLargeFont = null!, tabIconFont = null!;

        public Func<List<Dictionary<string, object?>>> Catalog = () => new List<Dictionary<string, object?>>();
        public Func<ListenerSettings> CurrentSettings = () => new ListenerSettings();
        public Action<Dictionary<string, object?>, bool>? Submit;
        // Asks CEP for the project's media (CommandBridge.RequestMedia); the answer comes back through ReceiveMedia.
        public Action? RequestMedia;

        public PaletteForm()
        {
            Text = "Edie";
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            KeyPreview = true;
            BackColor = PaletteStyle.Canvas;
            Padding = new Padding(1);

            searchRow.Dock = DockStyle.Top;
            searchRow.Paint += PaintSearchRow;
            search.BorderStyle = BorderStyle.None;
            search.BackColor = PaletteStyle.Canvas;
            search.ForeColor = PaletteStyle.Text;
            search.TextChanged += (_, __) => FilterCommands(!InApplyMenu);
            searchRow.Controls.Add(search);

            tabs.Dock = DockStyle.Top;
            tabs.Paint += PaintTabs;
            tabs.MouseDown += (_, e) =>
            {
                if (titleName != null || e.Button != MouseButtons.Left) return;
                for (var i = 0; i < tabRects.Length; i++)
                {
                    if (!tabRects[i].Contains(e.Location)) continue;
                    SwitchCategory(PaletteCategories.All[i]);
                    return;
                }
                DragWindow(tabs, e);
            };

            listHost.Dock = DockStyle.Fill;
            listHost.BackColor = PaletteStyle.Canvas;
            list.Dock = DockStyle.Fill;
            list.BorderStyle = BorderStyle.None;
            list.BackColor = PaletteStyle.Canvas;
            list.ForeColor = PaletteStyle.Text;
            list.DrawMode = DrawMode.OwnerDrawVariable;
            list.IntegralHeight = false;
            list.MeasureItem += MeasureRow;
            list.DrawItem += DrawRow;
            list.SelectedIndexChanged += (_, __) => KeepSelectionOnChoosable();
            list.SelectedIndexChanged += (_, __) => RepaintBelowChoice();
            list.DoubleClick += (_, __) => ApplyCurrentSelection(false);
            list.MouseMove += HoverRow;
            // The search field keeps the keys: a click in the list chooses, then hands the focus straight back.
            list.MouseUp += (_, __) => search.Focus();
            list.Resize += (_, __) => list.Invalidate();
            list.HandleCreated += (_, __) => DarkScrollbar(list.Handle);
            listHost.Controls.Add(list);

            footer.Dock = DockStyle.Bottom;
            footer.Paint += PaintFooter;

            picker.Dock = DockStyle.Fill;
            picker.Place = (item, range, keepOpen) => { ClosePicker(); PlaceMedia(item, keepOpen, range); };
            picker.Back = ClosePicker;
            picker.DragRequested = e => DragWindow(picker, e);
            picker.FooterChanged = () => { if (picker.Active) SetFooter(picker.FooterText); };
            picker.Log = message => Log?.Invoke(message);
            // Both fill the same space; only one is ever shown.
            Controls.Add(picker);
            Controls.Add(listHost);
            Controls.Add(footer);
            Controls.Add(tabs);
            Controls.Add(searchRow);
            foreach (Control dragHandle in new Control[] { searchRow, footer }) dragHandle.MouseDown += DragWindow;

            ApplyScale(1f);
            mediaTimeout.Tick += (_, __) => MediaTimedOut();
            LoadRecent();

            // Closing when the palette loses the front, but not on a blip (2026-11-22, the user: "when i ctrl space it
            // appear for 1 frame and closes"): the decisions are PaletteFocus's (Core/PaletteFocus.cs), checked, and the
            // build refuses a listener whose palette closes as it opens. Never close it here directly.
            deactivateCheck.Interval = PaletteFocus.RecheckMs;
            deactivateCheck.Tick += (_, __) => { deactivateCheck.Stop(); CheckLostFront(); };
            Deactivate += (_, __) =>
            {
                if (focus.OnDeactivate(Visible) != PaletteFocusAction.CheckAgain) return;
                deactivateCheck.Stop();
                deactivateCheck.Start();
            };
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
            using (var pen = new Pen(PaletteStyle.Line)) e.Graphics.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
        }

        public Action<string>? Log;

        private static string WindowName(IntPtr window)
        {
            if (window == IntPtr.Zero) return "no window";
            Native.GetWindowThreadProcessId(window, out var pid);
            var title = new System.Text.StringBuilder(60);
            Native.InternalGetWindowText(window, title, title.Capacity);
            return System.IO.Path.GetFileName(Native.ProcessImagePath(pid)) + " '" + title + "'";
        }

        private readonly System.Windows.Forms.Timer deactivateCheck = new System.Windows.Forms.Timer();
        // The listener's other windows (the banner, the Timeline highlight): one of them in front is not the user leaving.
        public Func<IntPtr, bool>? IsOurs;
        private readonly PaletteFocus focus = new PaletteFocus();
        // How often the palette closed as it opened, for the health page (paletteQuickCloses); 0 is right.
        public int QuickCloses => focus.QuickCloses;

        private bool OursInFront()
        {
            var front = Native.GetForegroundWindow();
            return front == Handle || (front != IntPtr.Zero && (IsOurs?.Invoke(front) ?? false));
        }

        private void CheckLostFront()
        {
            var front = Native.GetForegroundWindow();
            var premiereTookIt = front != IntPtr.Zero && (front == returnWindow || (returnWindow != IntPtr.Zero && Native.GetAncestor(front, Native.GA_ROOTOWNER) == Native.GetAncestor(returnWindow, Native.GA_ROOTOWNER)));
            switch (focus.OnRecheck(Visible, OursInFront(), premiereTookIt, DateTime.UtcNow))
            {
                case PaletteFocusAction.TakeBack:
                    Log?.Invoke("Palette took the front back from " + WindowName(front) + " (just opened)");
                    Native.ForceForeground(Handle);
                    Activate();
                    if (picker.Active) picker.Focus(); else search.Focus();
                    deactivateCheck.Start();   // and looks once more
                    return;
                case PaletteFocusAction.Close:
                    Log?.Invoke("Palette closed: " + WindowName(front) + " took the front" + (focus.QuickClosesInARow > 0 ? " — it had just opened (" + focus.QuickClosesInARow + " in a row" + (focus.Wide ? "; waiting longer from now on" : "") + ")" : ""));
                    CloseCore(false);
                    return;
            }
        }

        public void Open(IntPtr premiereWindow)
        {
            deactivateCheck.Stop();
            focus.BeginOpen();
            returnWindow = premiereWindow;
            // Sized for the screen Premiere is on, as the banner is.
            var dpi = premiereWindow != IntPtr.Zero ? Native.GetDpiForWindow(premiereWindow) : 0;
            ApplyScale(dpi > 0 ? dpi / 96f : DeviceDpi / 96f);
            if (picker.Active) ClosePicker();
            if (pendingTransition != null || pendingMove != null || pendingStagger != null) ResetApplyMenu();
            // It opens on Commands, as the Mac's does.
            category = PaletteCategory.Commands;
            catalogQuery = "";
            search.Text = "";
            FilterCommands(true);
            RestoreFrame();
            Show();
            Native.ForceForeground(Handle);
            Activate();
            search.Focus();
            focus.EndOpen(DateTime.UtcNow);
            Log?.Invoke("Palette opened" + (Native.GetForegroundWindow() == Handle ? "" : "; Windows kept " + WindowName(Native.GetForegroundWindow()) + " in front"));
            // If Windows kept another window in front, the same check decides: take it back (Premiere) or close.
            if (!OursInFront()) deactivateCheck.Start();
        }

        public void ClosePalette(bool returnToPremiere)
        {
            focus.OnClosedByUser();
            CloseCore(returnToPremiere);
        }

        private void CloseCore(bool returnToPremiere)
        {
            deactivateCheck.Stop();
            SaveFrame();
            // Playback stops when the palette hides; the marks are kept for this item.
            if (picker.Active) ClosePicker();
            Hide();
            if (returnToPremiere && returnWindow != IntPtr.Zero && Native.IsWindow(returnWindow)) Native.ForceForeground(returnWindow);
        }

        // ---- scale and fonts ----------------------------------------------

        private int P(float points) => (int)Math.Round(points * scale);

        private Font Px(string family, float points) => new Font(family, points * scale, FontStyle.Regular, GraphicsUnit.Pixel);

        private void ApplyScale(float next)
        {
            if (next <= 0) next = 1f;
            if (searchFont != null && Math.Abs(next - scale) < 0.01f) return;
            scale = next;
            var old = new[] { searchFont, tabFont, tabActiveFont, countFont, hintFont, kindFont, titleFont, sectionFont, nameFont, nameBoldFont, whereFont, tagFont, keyFont, noteFont, footerFont, escFont, iconFont, iconLargeFont, tabIconFont };
            // The Mac's sizes in points are pixels at 100%; "medium" has no Segoe UI face here, so it is regular.
            const string ui = "Segoe UI", semibold = "Segoe UI Semibold", symbol = "Segoe UI Symbol";
            searchFont = Px(ui, 15);
            tabFont = Px(ui, 12.5f);
            tabActiveFont = Px(semibold, 12.5f);
            countFont = Px(semibold, 10);
            hintFont = Px(ui, 11);
            kindFont = Px(semibold, 11.5f);
            titleFont = Px(ui, 12.5f);
            sectionFont = Px(semibold, 11.5f);
            nameFont = Px(ui, 13.5f);
            nameBoldFont = Px(semibold, 13.5f);
            whereFont = Px(ui, 11);
            tagFont = Px(semibold, 10.5f);
            keyFont = Px("Consolas", 10.5f);
            noteFont = Px(ui, 12.5f);
            footerFont = Px(ui, 11);
            escFont = Px(ui, 10.5f);
            iconFont = Px(symbol, 12);
            iconLargeFont = Px(symbol, 14);
            tabIconFont = Px(symbol, 11.5f);
            foreach (var font in old) font?.Dispose();

            search.Font = searchFont;
            picker.SetScale(scale);
            searchRow.Height = P(52);
            tabs.Height = P(38);
            footer.Height = P(30);
            listHost.Padding = new Padding(0, P(4), 0, P(4));
            // 640 wide (was 520) so the five tabs fit on one line; "Tab to switch" shows only when there's room.
            Size = new Size(P(640), P(440));
            LayoutSearchRow();
            if (IsHandleCreated) FilterCommands(false);
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            LayoutSearchRow();
        }

        private void LayoutSearchRow()
        {
            if (searchFont == null) return;
            // Where the Mac puts its field: 52 in, 16 down, 22 tall, leaving room for esc on the right.
            search.Location = new Point(P(52), P(16) + Math.Max(0, (P(22) - search.Height) / 2));
            search.Width = Math.Max(P(60), searchRow.ClientSize.Width - P(52) - P(56));
        }

        // Dragged to a screen with another scale: take the size Windows suggests and redraw at that scale.
        protected override void WndProc(ref Message m)
        {
            const int WM_DPICHANGED = 0x02E0;
            if (m.Msg == WM_DPICHANGED)
            {
                var dpi = (int)((long)m.WParam & 0xFFFF);
                ApplyScale(dpi / 96f);
                var suggested = (Rect)Marshal.PtrToStructure(m.LParam, typeof(Rect))!;
                Location = new Point(suggested.Left, suggested.Top);
            }
            base.WndProc(ref m);
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct Rect { public int Left, Top, Right, Bottom; }

        [DllImport("uxtheme.dll", CharSet = CharSet.Unicode)]
        private static extern int SetWindowTheme(IntPtr hWnd, string subAppName, string? subIdList);

        // A dark scroll bar on Windows 10 1809 and later; older Windows keep the light one.
        private static void DarkScrollbar(IntPtr handle)
        {
            try { SetWindowTheme(handle, "DarkMode_Explorer", null); } catch (Exception) { }
        }

        // ---- list ---------------------------------------------------------

        private bool InApplyMenu => pendingTransition != null || pendingMove != null || pendingStagger != null;

        private static string Identity(IDictionary<string, object?> command) =>
            string.Join("|", Json.Str(command, "type") ?? "", Json.Str(command, "id") ?? "", Json.Str(command, "moveMode") ?? "", Json.Str(command, "name") ?? "");

        private static string ShortcutKey(IDictionary<string, object?> command) =>
            string.Join("|", Json.Str(command, "type") ?? "", Json.Str(command, "id") ?? "", Json.Str(command, "name") ?? "");

        private string? RowKey(int row)
        {
            if (row < 0 || row >= rows.Count) return null;
            var r = rows[row];
            if (r.Kind == PaletteRowKind.Command) return r.Index >= 0 && r.Index < visible.Count ? "c:" + Identity(visible[r.Index]) : null;
            if (r.Kind == PaletteRowKind.Media) return r.Index >= 0 && r.Index < media.Count ? "m:" + media[r.Index].Id : null;
            return null;
        }

        private string RowText(PaletteRow r)
        {
            switch (r.Kind)
            {
                case PaletteRowKind.Section: return r.Title + " " + r.Count;
                case PaletteRowKind.Command: return r.Index < visible.Count ? Json.Str(visible[r.Index], "name") ?? "" : "";
                case PaletteRowKind.Media: return r.Index < media.Count ? media[r.Index].Name : "";
                default: return r.Text;
            }
        }

        private void FilterCommands(bool resetSelection)
        {
            var previousRow = list.SelectedIndex;
            var previousKey = RowKey(previousRow);
            var query = search.Text;
            var settings = CurrentSettings();
            if (InApplyMenu)
            {
                if (pendingTransition != null) visible = TransitionPlacementCommands();
                else if (pendingMove != null) visible = MoveModeCommands();
                else visible = StaggerFrameCommands(settings);
                rows = Enumerable.Range(0, visible.Count).Select(i => PaletteRow.Command(i, null)).ToList();
            }
            else
            {
                visible = Catalog();
                shortcutLabels = new Dictionary<string, string>(StringComparer.Ordinal);
                foreach (var binding in settings.Bindings)
                {
                    var key = ShortcutKey(binding.Command);
                    if (!shortcutLabels.ContainsKey(key)) shortcutLabels[key] = binding.Shortcut.Display();
                }
                var entries = visible.Select((c, i) => new PaletteEntry(Json.Str(c, "type") ?? "", Json.Str(c, "name") ?? "", i)).ToList();
                var recent = new List<int>();
                foreach (var key in recentCommandKeys)
                {
                    var found = visible.FindIndex(c => Identity(c) == key);
                    if (found >= 0) recent.Add(found);
                }
                var typed = query.Trim(' ', '\t').Length > 0;
                var commandRows = PaletteSearch.CommandRows(entries, query, recent);
                rows = commandRows;
                for (var i = 0; i < PaletteCategories.All.Length; i++)
                {
                    var tab = PaletteCategories.All[i];
                    if (tab == PaletteCategory.Commands) { counts[i] = typed ? PaletteSearch.Count(commandRows) : entries.Count; continue; }
                    // Every media tab counts its own items; rows are built only for a typed count or the tab shown.
                    var tabRows = typed || tab == category ? PaletteSearch.MediaRows(media, query, MediaLoading, mediaError, recentMediaIds, tab) : null;
                    if (tab == category) rows = tabRows!;
                    counts[i] = media.Count == 0 && MediaLoading ? -1 : typed ? PaletteSearch.Count(tabRows!) : PaletteSearch.MediaCount(media, tab);
                }
            }

            selecting = true;
            list.BeginUpdate();
            list.Items.Clear();
            list.Items.AddRange(rows.Select(r => (object)RowText(r)).ToArray());
            int? row = null;
            if (!resetSelection && previousKey != null)
            {
                for (var i = 0; i < rows.Count; i++) if (RowKey(i) == previousKey) { row = i; break; }
            }
            if (row == null && !resetSelection && previousRow >= 0 && rows.Count > 0)
            {
                var from = Math.Min(previousRow, rows.Count - 1);
                row = PaletteSearch.Selectable(rows, from, 1) ?? PaletteSearch.Selectable(rows, from, -1);
            }
            var first = PaletteSearch.Selectable(rows, 0, 1);
            if (row == null) row = first;
            list.SelectedIndex = row ?? -1;
            lastSelectable = row ?? -1;
            // The first choice shows its group's name above it.
            if (row != null && row == first) list.TopIndex = 0;
            list.EndUpdate();
            selecting = false;
            UpdateChrome();
            tabs.Invalidate();
        }

        // The placeholder and footer for the category; an apply menu sets its own.
        private void UpdateChrome()
        {
            if (InApplyMenu) return;
            if (picker.Active) { SetFooter(picker.FooterText); return; }
            titleName = null;
            var commands = category == PaletteCategory.Commands;
            SetPlaceholder(Placeholder(category));
            SetFooter(commands
                ? "↑↓ choose  ·  ↵ apply  ·  ⇧↵ apply, keep open  ·  Tab media  ·  esc close"
                : category == PaletteCategory.Sequences
                ? "↑↓ choose  ·  ↵ open  ·  ⇧↵ open, keep open  ·  Tab next  ·  esc close"
                : "↑↓ choose  ·  ↵ set In/Out, then place  ·  Ctrl+↵ place whole clip  ·  Tab next  ·  esc close");
        }

        private static string Placeholder(PaletteCategory tab)
        {
            switch (tab)
            {
                case PaletteCategory.Commands: return "Search effects, transitions, presets and functions…";
                case PaletteCategory.Video: return "Search the project’s video…";
                case PaletteCategory.Audio: return "Search every sound in the project…";
                case PaletteCategory.Sfx: return "Search sound effects, under 45 seconds…";
                case PaletteCategory.Bgm: return "Search ambience and music, 45 seconds or longer…";
                case PaletteCategory.Sequences: return "Search the project’s sequences…";
                default: return "Search the project’s media by name…";
            }
        }

        private void SetFooter(string text)
        {
            if (footerText == text) return;
            footerText = text;
            footer.Invalidate();
        }

        // The row under the chosen one hides its hairline; ListBox repaints only the old and new choice, so repaint the
        // rows under them too.
        private void RepaintBelowChoice()
        {
            var now = list.SelectedIndex;
            if (now == hairlineHiddenUnder) return;
            foreach (var row in new[] { hairlineHiddenUnder + 1, now + 1 })
                if (row > 0 && row < list.Items.Count) list.Invalidate(list.GetItemRectangle(row));
            hairlineHiddenUnder = now;
        }

        private void KeepSelectionOnChoosable()
        {
            if (selecting) return;
            var row = list.SelectedIndex;
            if (row >= 0 && row < rows.Count && rows[row].Selectable) { lastSelectable = row; return; }
            // A click on a group's name or a note: the choice stays where it was.
            selecting = true;
            list.SelectedIndex = lastSelectable >= 0 && lastSelectable < rows.Count ? lastSelectable : -1;
            selecting = false;
        }

        private void HoverRow(object? sender, MouseEventArgs e)
        {
            if (e.Location == lastMouse) return;
            lastMouse = e.Location;
            if ((DateTime.UtcNow - keyMovedAt).TotalMilliseconds < 350) return;
            var row = list.IndexFromPoint(e.Location);
            if (row < 0 || row >= rows.Count || !rows[row].Selectable || row == list.SelectedIndex) return;
            list.SelectedIndex = row;
        }

        private void MoveSelection(int delta)
        {
            var current = list.SelectedIndex;
            var next = PaletteSearch.Move(rows, current < 0 ? 0 : current, delta);
            if (next == null) return;
            keyMovedAt = DateTime.UtcNow;
            selecting = true;
            list.SelectedIndex = next.Value;
            lastSelectable = next.Value;
            if (next.Value == PaletteSearch.Selectable(rows, 0, 1)) list.TopIndex = 0;
            selecting = false;
        }

        private void SwitchCategory(PaletteCategory to)
        {
            if (InApplyMenu || to == category) return;
            category = to;
            if (PaletteCategories.IsMedia(category)) RefreshMediaIfStale();
            FilterCommands(true);
        }

        // ---- drawing ------------------------------------------------------

        private static GraphicsPath Rounded(RectangleF r, float radius)
        {
            var path = new GraphicsPath();
            var d = Math.Min(radius * 2, Math.Min(r.Width, r.Height));
            if (d <= 0) { path.AddRectangle(r); return path; }
            path.AddArc(r.X, r.Y, d, d, 180, 90);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        private static void FillRounded(Graphics g, RectangleF r, float radius, Color colour)
        {
            var smoothing = g.SmoothingMode;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var path = Rounded(r, radius))
            using (var brush = new SolidBrush(colour)) g.FillPath(brush, path);
            g.SmoothingMode = smoothing;
        }

        private static Size Measure(string text, Font font) =>
            text.Length == 0 ? Size.Empty : TextRenderer.MeasureText(text, font, new Size(int.MaxValue, int.MaxValue), Line1);

        private static void Draw(Graphics g, string text, Font font, Rectangle bounds, Color colour, TextFormatFlags extra = TextFormatFlags.Default) =>
            TextRenderer.DrawText(g, text, font, bounds, colour, Line1 | extra);

        // The search row, 52 tall: Edie where Sage has the magnifier, the query, and esc.
        private void PaintSearchRow(object? sender, PaintEventArgs e)
        {
            var g = e.Graphics;
            g.InterpolationMode = InterpolationMode.NearestNeighbor;
            g.PixelOffsetMode = PixelOffsetMode.Half;
            g.DrawImage(edie, new Rectangle(P(12), P(12), P(32), P(32)));
            g.PixelOffsetMode = PixelOffsetMode.Default;
            var cap = new Rectangle(searchRow.ClientSize.Width - P(48), P(18), P(34), P(18));
            var smoothing = g.SmoothingMode;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var path = Rounded(new RectangleF(cap.X + 0.5f, cap.Y + 0.5f, cap.Width - 1, cap.Height - 1), P(5)))
            {
                using (var brush = new SolidBrush(PaletteStyle.Card)) g.FillPath(brush, path);
                using (var pen = new Pen(PaletteStyle.Line)) g.DrawPath(pen, path);
            }
            g.SmoothingMode = smoothing;
            Draw(g, "esc", escFont, cap, PaletteStyle.Muted, TextFormatFlags.HorizontalCenter);
        }

        // Commands · Media, each with an icon, its name and its count; the active one sits on a soft pill in its colour
        // with its count filled in that colour, an empty one fades. In an apply menu the row names the command instead.
        private void PaintTabs(object? sender, PaintEventArgs e)
        {
            var g = e.Graphics;
            var w = tabs.ClientSize.Width;
            var h = tabs.ClientSize.Height;
            using (var brush = new SolidBrush(PaletteStyle.Line)) g.FillRectangle(brush, 0, h - 1, w, 1);
            var midY = (h - 1) / 2;
            tabRects[0] = tabRects[1] = Rectangle.Empty;
            if (titleName != null)
            {
                var kind = titleKind ?? "";
                var kindSize = Measure(kind, kindFont);
                Draw(g, kind, kindFont, new Rectangle(P(18), midY - kindSize.Height / 2, kindSize.Width + P(2), kindSize.Height), titleColour);
                var nameHeight = Measure("Ag", titleFont).Height;
                Draw(g, titleName, titleFont, new Rectangle(P(18) + kindSize.Width + P(8), midY - nameHeight / 2, Math.Max(0, w - kindSize.Width - P(44)), nameHeight), PaletteStyle.Text, TextFormatFlags.EndEllipsis);
                return;
            }
            // Seven tabs: when their natural size doesn't fit the palette's width they draw tighter (less padding,
            // narrower count capsules), and if that still doesn't fit, without their icons, rather than run off the edge.
            // Same as the Mac palette.
            var roomy = TabsWidth(counts, false) <= w - P(10);
            var iconless = !roomy && TabsWidth(counts, true) > w - P(10);
            int icon = iconless ? 0 : P(14);
            int pad = P(roomy ? 10 : iconless ? 6 : 7), iconGap = P(roomy ? 6 : iconless ? 0 : 5), capGap = P(roomy ? 7 : 5), capMin = P(roomy ? 30 : 22), between = P(roomy ? 4 : 2);
            var x = P(roomy ? 10 : 6);
            for (var i = 0; i < PaletteCategories.All.Length; i++)
            {
                var cat = PaletteCategories.All[i];
                var active = cat == category;
                var tint = PaletteStyle.Label(cat);
                var count = counts[i];
                var label = PaletteCategories.Label(cat);
                var labelFont = active ? tabActiveFont : tabFont;
                var labelSize = Measure(label, labelFont);
                var countString = count < 0 ? "…" : count.ToString(CultureInfo.InvariantCulture);
                var countSize = Measure(countString, countFont);
                // At least three digits wide, so the tabs don't shift as counts change while typing.
                var capsuleWidth = Math.Max(countSize.Width + P(10), capMin);
                var width = pad + icon + iconGap + labelSize.Width + capGap + capsuleWidth + pad;
                var rect = new Rectangle(x, midY - P(13), width, P(26));
                tabRects[i] = rect;
                var faded = count == 0 && !active;
                if (active) FillRounded(g, rect, P(8), PaletteStyle.Over(tint, 0.15));
                var cx = rect.X + pad;
                if (!iconless) Draw(g, TabSymbol(cat), tabIconFont, new Rectangle(cx, rect.Y, P(14), rect.Height), active ? tint : PaletteStyle.Muted, TextFormatFlags.HorizontalCenter);
                cx += icon + iconGap;
                Draw(g, label, labelFont, new Rectangle(cx, midY - labelSize.Height / 2, labelSize.Width + P(2), labelSize.Height), active ? PaletteStyle.Text : PaletteStyle.Muted);
                cx += labelSize.Width + capGap;
                var box = new Rectangle(cx, midY - P(8), capsuleWidth, P(16));
                FillRounded(g, box, P(8), active ? tint : PaletteStyle.Line);
                Draw(g, countString, countFont, box, active ? PaletteStyle.Canvas : PaletteStyle.Muted, TextFormatFlags.HorizontalCenter);
                if (faded)
                {
                    using (var veil = new SolidBrush(Color.FromArgb(140, PaletteStyle.Canvas))) g.FillRectangle(veil, rect);
                }
                x = rect.Right + between;
            }
            const string hint = "Tab to switch";
            var hintSize = Measure(hint, hintFont);
            if (x + hintSize.Width + P(16) < w) Draw(g, hint, hintFont, new Rectangle(w - hintSize.Width - P(16), midY - hintSize.Height / 2, hintSize.Width + P(2), hintSize.Height), PaletteStyle.Faint);
        }

        // command, photo, film, waveform, music note: the Mac's SF Symbols, as Segoe UI Symbol characters.
        /// How wide the row of tabs is, measured the way the tabs are drawn (the active tab's label is bold).
        private int TabsWidth(int[] counts, bool compact)
        {
            int pad = P(compact ? 7 : 10), iconGap = P(compact ? 5 : 6), capGap = P(compact ? 5 : 7), capMin = P(compact ? 22 : 30), between = P(compact ? 2 : 4);
            var total = P(compact ? 6 : 10);
            for (var i = 0; i < PaletteCategories.All.Length; i++)
            {
                var cat = PaletteCategories.All[i];
                var labelSize = Measure(PaletteCategories.Label(cat), cat == category ? tabActiveFont : tabFont);
                var countString = counts[i] < 0 ? "…" : counts[i].ToString(CultureInfo.InvariantCulture);
                total += pad + P(14) + iconGap + labelSize.Width + capGap + Math.Max(Measure(countString, countFont).Width + P(10), capMin) + pad + between;
            }
            return total;
        }

        private static string TabSymbol(PaletteCategory tab)
        {
            switch (tab)
            {
                case PaletteCategory.Commands: return "⌘";
                case PaletteCategory.Media: return "▣";
                case PaletteCategory.Video: return "▶";
                case PaletteCategory.Audio: return "♪";
                case PaletteCategory.Sfx: return "∿";
                case PaletteCategory.Sequences: return "≡";
                default: return "♫";
            }
        }

        private void PaintFooter(object? sender, PaintEventArgs e)
        {
            var g = e.Graphics;
            using (var brush = new SolidBrush(PaletteStyle.Line)) g.FillRectangle(brush, 0, 0, footer.ClientSize.Width, 1);
            Draw(g, footerText, footerFont, new Rectangle(P(16), 1, Math.Max(0, footer.ClientSize.Width - P(32)), footer.ClientSize.Height - 1), PaletteStyle.Faint, TextFormatFlags.EndEllipsis);
        }

        private void MeasureRow(object? sender, MeasureItemEventArgs e)
        {
            if (e.Index < 0 || e.Index >= rows.Count) { e.ItemHeight = P(30); return; }
            switch (rows[e.Index].Kind)
            {
                case PaletteRowKind.Section: e.ItemHeight = e.Index == 0 ? P(26) : P(32); break;
                case PaletteRowKind.Command: e.ItemHeight = P(30); break;
                case PaletteRowKind.Media: e.ItemHeight = P(42); break;
                default: e.ItemHeight = P(64); break;
            }
            e.ItemHeight = Math.Min(255, e.ItemHeight);
        }

        // One row: a section name in its colour with a count capsule, an item (icon, name with the typed part picked
        // out, a muted "where" line for media, a shortcut or file type on the right), or a note in place of results.
        private void DrawRow(object? sender, DrawItemEventArgs e)
        {
            var g = e.Graphics;
            var b = e.Bounds;
            using (var fill = new SolidBrush(PaletteStyle.Canvas)) g.FillRectangle(fill, b);
            if (e.Index < 0 || e.Index >= rows.Count) return;
            var row = rows[e.Index];
            switch (row.Kind)
            {
                case PaletteRowKind.Section:
                {
                    var colour = row.Colour == "recent" ? PaletteStyle.Muted : row.Colour == "media" ? PaletteStyle.Label(category) : PaletteStyle.Colour(row.Colour);
                    var midY = b.Bottom - P(11);
                    var size = Measure(row.Title, sectionFont);
                    Draw(g, row.Title, sectionFont, new Rectangle(b.X + P(18), midY - size.Height / 2, size.Width + P(2), size.Height), colour);
                    var countText = row.Count.ToString(CultureInfo.InvariantCulture);
                    var countSize = Measure(countText, countFont);
                    var box = new Rectangle(b.X + P(18) + size.Width + P(7), midY - P(8), countSize.Width + P(10), P(16));
                    FillRounded(g, box, P(8), PaletteStyle.Over(colour, 0.16));
                    Draw(g, countText, countFont, box, colour, TextFormatFlags.HorizontalCenter);
                    return;
                }
                case PaletteRowKind.Note:
                {
                    var width = Math.Max(0, b.Width - P(64));
                    const TextFormatFlags wrap = TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix | TextFormatFlags.WordBreak | TextFormatFlags.HorizontalCenter;
                    var height = TextRenderer.MeasureText(row.Text, noteFont, new Size(width, int.MaxValue), wrap).Height;
                    TextRenderer.DrawText(g, row.Text, noteFont, new Rectangle(b.X + P(32), b.Y + (b.Height - height) / 2, width, height + P(2)), PaletteStyle.Muted, wrap);
                    return;
                }
            }

            string name, symbol;
            Color colour2;
            string? detail = null, tag = null;
            var tagIsKey = true;
            if (row.Kind == PaletteRowKind.Media)
            {
                if (row.Index >= media.Count) return;
                var m = media[row.Index];
                name = m.Name;
                symbol = PaletteStyle.MediaSymbol(m);
                colour2 = PaletteStyle.Label(m);
                detail = PaletteSearch.WhereText(m);
                tag = m.Ext.Length == 0 ? null : m.Ext.ToLowerInvariant();
                tagIsKey = false;
            }
            else
            {
                if (row.Index >= visible.Count) return;
                var command = visible[row.Index];
                var type = Json.Str(command, "type") ?? "";
                name = Json.Str(command, "name") ?? "";
                symbol = PaletteStyle.Symbol(type);
                colour2 = PaletteStyle.Colour(type);
                if (!InApplyMenu && shortcutLabels.TryGetValue(ShortcutKey(command), out var label)) tag = label;
            }

            // The chosen row: a soft rounded fill in the category's colour, like Sage's.
            var selected = (e.State & DrawItemState.Selected) != 0;
            var back = PaletteStyle.Canvas;
            if (selected)
            {
                back = PaletteStyle.Over(row.Kind == PaletteRowKind.Media ? colour2 : PaletteStyle.Accent, 0.16);
                FillRounded(g, new RectangleF(b.X + P(8), b.Y + P(1), b.Width - P(16), b.Height - P(2)), P(7), back);
            }
            // Hairlines between results (2026-11-24, the user: "a line dividing the items cuz currently it's pretty
            // difficult to see"): 1pt of Line over the first pixels of a result that follows another result, so no row
            // changes height; none under a group's name or under the last; hidden by the chosen row and the one under it.
            // The panel (client/styles.css) and the Mac palette draw the same.
            else if (e.Index > 0 && rows[e.Index - 1].Selectable && list.SelectedIndex != e.Index - 1)
            {
                using (var line = new SolidBrush(PaletteStyle.Line)) g.FillRectangle(line, b.X + P(16), b.Y, Math.Max(0, b.Width - P(32)), Math.Max(1, P(1)));
            }

            var mid = b.Y + b.Height / 2;
            var iconFontNow = detail == null ? iconFont : iconLargeFont;
            Draw(g, symbol, iconFontNow, new Rectangle(b.X + P(18), b.Y, P(18), b.Height), colour2, TextFormatFlags.HorizontalCenter);
            var right = b.Right - P(16);
            if (!string.IsNullOrEmpty(tag))
            {
                var font = tagIsKey ? keyFont : tagFont;
                var tagSize = Measure(tag!, font);
                var box = new Rectangle(right - tagSize.Width - P(12), mid - P(9), tagSize.Width + P(12), P(18));
                FillRounded(g, box, tagIsKey ? P(5) : P(9), tagIsKey ? PaletteStyle.Over(PaletteStyle.Line, 0.7, back) : PaletteStyle.Over(colour2, 0.14, back));
                Draw(g, tag!, font, box, tagIsKey ? PaletteStyle.Muted : colour2, TextFormatFlags.HorizontalCenter);
                right = box.X - P(10);
            }
            var left = b.X + P(46);
            var nameHeight = Measure("Ag", nameFont).Height;
            if (detail != null)
            {
                DrawPicked(g, name, row.At, colour2, new Rectangle(left, mid - nameHeight, Math.Max(0, right - left), nameHeight));
                var whereHeight = Measure("Ag", whereFont).Height;
                Draw(g, detail, whereFont, new Rectangle(left, mid + P(2), Math.Max(0, right - left), whereHeight), PaletteStyle.Muted, TextFormatFlags.EndEllipsis);
            }
            else DrawPicked(g, name, row.At, colour2, new Rectangle(left, mid - nameHeight / 2, Math.Max(0, right - left), nameHeight));
        }

        // The name with the typed part in semibold, in the row's colour.
        private void DrawPicked(Graphics g, string name, PaletteRange? at, Color colour, Rectangle bounds)
        {
            if (!at.HasValue || at.Value.Start < 0 || at.Value.End > name.Length || at.Value.Length <= 0)
            {
                Draw(g, name, nameFont, bounds, PaletteStyle.Text, TextFormatFlags.EndEllipsis);
                return;
            }
            var before = name.Substring(0, at.Value.Start);
            var hit = name.Substring(at.Value.Start, at.Value.Length);
            var after = name.Substring(at.Value.End);
            var beforeWidth = Measure(before, nameFont).Width;
            var hitWidth = Measure(hit, nameBoldFont).Width;
            if (beforeWidth + hitWidth > bounds.Width)
            {
                Draw(g, name, nameFont, bounds, PaletteStyle.Text, TextFormatFlags.EndEllipsis);
                return;
            }
            var x = bounds.X;
            if (before.Length > 0) { Draw(g, before, nameFont, new Rectangle(x, bounds.Y, beforeWidth + 1, bounds.Height), PaletteStyle.Text); x += beforeWidth; }
            Draw(g, hit, nameBoldFont, new Rectangle(x, bounds.Y, hitWidth + 1, bounds.Height), colour);
            x += hitWidth;
            if (after.Length > 0) Draw(g, after, nameFont, new Rectangle(x, bounds.Y, Math.Max(0, bounds.Right - x), bounds.Height), PaletteStyle.Text, TextFormatFlags.EndEllipsis);
        }

        // ---- keyboard -----------------------------------------------------

        // Every palette key is taken here, before the field or Windows sees it, so the focus never leaves the search
        // field: Tab would otherwise move it, and Enter would beep.
        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            // The picker takes every key while it's up (I/O, J K L, arrows, Enter, Esc, Backspace…).
            if (picker.Active) return picker.HandleKey(keyData) || base.ProcessCmdKey(ref msg, keyData);
            var key = keyData & Keys.KeyCode;
            var modifiers = keyData & Keys.Modifiers;
            var plain = modifiers == Keys.None;
            switch (key)
            {
                case Keys.Tab when modifiers == Keys.None || modifiers == Keys.Shift:
                    SwitchCategory(modifiers == Keys.Shift ? PaletteCategories.Previous(category) : PaletteCategories.Next(category));
                    return true;
                case Keys.Down when plain: MoveSelection(1); return true;
                case Keys.Up when plain: MoveSelection(-1); return true;
                case Keys.PageDown when plain: MoveSelection(8); return true;
                case Keys.PageUp when plain: MoveSelection(-8); return true;
                case Keys.Enter when modifiers == Keys.None || modifiers == Keys.Shift:
                    ApplyCurrentSelection(modifiers == Keys.Shift);
                    return true;
                // Ctrl+Enter: a video or sound goes in whole, straight away, as Enter did before the picker.
                case Keys.Enter when modifiers == Keys.Control || modifiers == (Keys.Control | Keys.Shift):
                    ApplyCurrentSelection((modifiers & Keys.Shift) != 0, whole: true);
                    return true;
                case Keys.Escape when plain:
                    if (InApplyMenu) ResetApplyMenu();
                    else ClosePalette(true);
                    return true;
            }
            return base.ProcessCmdKey(ref msg, keyData);
        }

        // ---- media --------------------------------------------------------

        private bool MediaLoading => mediaAskedAt.HasValue && (!mediaLoadedAt.HasValue || mediaLoadedAt.Value < mediaAskedAt.Value);

        // Asks Premiere for the project's media (the next CEP poll runs prfx.listProjectMedia() and POSTs /media),
        // unless a list came in the last 10 seconds. The old list stays shown while a new one is read.
        private void RefreshMediaIfStale()
        {
            var now = DateTime.UtcNow;
            if (MediaLoading && mediaAskedAt.HasValue && (now - mediaAskedAt.Value).TotalSeconds < 6) return;
            if (!MediaLoading && mediaLoadedAt.HasValue && (now - mediaLoadedAt.Value).TotalSeconds < 10) return;
            mediaAskedAt = now;
            RequestMedia?.Invoke();
            mediaTimeout.Stop();
            mediaTimeout.Start();
        }

        private void MediaTimedOut()
        {
            mediaTimeout.Stop();
            if (!MediaLoading) return;
            mediaAskedAt = null;
            // No list is better than an old one shown as the project's (the user saw a stale count of 7 from test data).
            media = new List<PaletteMedia>();
            mediaLoadedAt = null;
            mediaError = "Premiere hasn’t answered. Open Window ▸ Extensions ▸ Edie, then Tab here again.";
            Log?.Invoke("Palette media: no answer from Premiere after 6s");
            FilterCommands(false);
        }

        // What CEP POSTed to /media. Call on the UI thread.
        public void ReceiveMedia(byte[] body)
        {
            mediaTimeout.Stop();
            mediaLoadedAt = DateTime.UtcNow;
            if (!mediaAskedAt.HasValue) mediaAskedAt = DateTime.MinValue;
            PaletteMediaList? list = null;
            try { list = PaletteMediaList.Parse(System.Text.Encoding.UTF8.GetString(body)); } catch (Exception) { }
            if (list != null && string.IsNullOrEmpty(list.Error))
            {
                media = list.Items;
                mediaError = null;
                mediaFps = list.Fps;
                Log?.Invoke("Palette media: " + list.Items.Count + " item(s) from " + (list.Project ?? "the project"));
            }
            else
            {
                var error = list?.Error ?? "Premiere sent a media list Edie couldn’t read.";
                if (error.StartsWith("ERROR: ", StringComparison.Ordinal)) error = error.Substring(7);
                media = new List<PaletteMedia>();
                mediaError = error;
                Log?.Invoke("Palette media failed: " + error);
            }
            FilterCommands(false);
        }

        // `range`: the picker's In and Out (seconds from the file's start, Out exclusive), sent as inSeconds/outSeconds
        // for the host's place-project-item; null places the whole clip as before. Named as the Mac names it.
        private void PlaceMedia(PaletteMedia item, bool keepOpen, (double InSeconds, double OutSeconds)? range = null)
        {
            Remember(null, item.Id);
            var sequence = item.Kind == "sequence";
            var place = new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["type"] = "custom",
                ["name"] = (sequence ? "Open “" : "Place “") + item.Name + "”" + (!sequence && range != null ? " In to Out" : ""),
                ["id"] = sequence ? "open-project-sequence" : "place-project-item",
                ["mediaId"] = item.Id
            };
            if (!sequence && range is (double, double) marked)
            {
                place["inSeconds"] = marked.InSeconds;
                place["outSeconds"] = marked.OutSeconds;
            }
            Log?.Invoke("Palette media: " + (sequence ? "open " : "place ") + item.Name + (range is (double, double) r ? " " + r.InSeconds.ToString("0.######", CultureInfo.InvariantCulture) + "–" + r.OutSeconds.ToString("0.######", CultureInfo.InvariantCulture) + " s" : sequence ? "" : " whole"));
            SubmitCommand(place, keepOpen);
        }

        private static bool Pickable(PaletteMedia item) => item.Kind == "video" || item.Kind == "audio";

        // Enter on a video or sound: the picker, unless Premiere gave no file or it isn't on this disk (then it goes in
        // whole, as before; the log says why). As the Mac's placeMedia.
        private void OpenPicker(PaletteMedia item, bool keepOpen)
        {
            if (string.IsNullOrEmpty(item.Path) || !File.Exists(item.Path))
            {
                Log?.Invoke("Palette picker: no file on disk for " + item.Name + " (" + (item.Path ?? "no path") + "); placing the whole clip");
                PlaceMedia(item, keepOpen);
                return;
            }
            SuspendLayout();
            searchRow.Visible = false;
            tabs.Visible = false;
            listHost.Visible = false;
            picker.Open(item, mediaFps);
            ResumeLayout(true);
            SetFooter(picker.FooterText);
            picker.Focus();
        }

        // Back to the list exactly as it was: same tab, search text and choice.
        private void ClosePicker()
        {
            if (!picker.Active && !picker.Visible) return;
            SuspendLayout();
            picker.Close();
            searchRow.Visible = true;
            tabs.Visible = true;
            listHost.Visible = true;
            ResumeLayout(true);
            UpdateChrome();
            if (Visible) search.Focus();
        }

        // ---- recent -------------------------------------------------------

        private static string RecentPath => Path.Combine(Paths.SupportDir, "palette-recent.json");

        private void LoadRecent()
        {
            try
            {
                if (!File.Exists(RecentPath)) return;
                if (!Json.TryParse(File.ReadAllText(RecentPath), out var parsed) || !(parsed is Dictionary<string, object?> recent)) return;
                recentCommandKeys = (Json.List(recent, "commands") ?? new List<object?>()).OfType<string>().ToList();
                recentMediaIds = (Json.List(recent, "media") ?? new List<object?>()).OfType<string>().ToList();
            }
            catch (Exception) { }
        }

        private void Remember(string? commandKey, string? mediaId)
        {
            List<string> Bump(List<string> current, string? key) =>
                key == null ? current : new[] { key }.Concat(current.Where(k => k != key)).Take(5).ToList();
            recentCommandKeys = Bump(recentCommandKeys, commandKey);
            recentMediaIds = Bump(recentMediaIds, mediaId);
            try
            {
                Paths.Ensure(Paths.SupportDir);
                File.WriteAllText(RecentPath, Json.Serialize(new Dictionary<string, object?>
                {
                    ["commands"] = recentCommandKeys.Cast<object?>().ToList(),
                    ["media"] = recentMediaIds.Cast<object?>().ToList()
                }));
            }
            catch (Exception) { }
        }

        // ---- apply --------------------------------------------------------

        private void ApplyCurrentSelection(bool keepOpen, bool whole = false)
        {
            if (submitting) return;
            var row = list.SelectedIndex;
            if (row < 0 || row >= rows.Count) return;
            var chosen = rows[row];
            if (chosen.Kind == PaletteRowKind.Media && chosen.Index < media.Count)
            {
                var item = media[chosen.Index];
                // Enter (or Shift+Enter) on a video or sound picks In and Out first; Ctrl+Enter places it whole.
                if (!whole && Pickable(item)) OpenPicker(item, keepOpen);
                else PlaceMedia(item, keepOpen);
                return;
            }
            if (chosen.Kind != PaletteRowKind.Command || chosen.Index >= visible.Count) return;
            var command = visible[chosen.Index];
            var settings = CurrentSettings();
            var id = Json.Str(command, "id");
            var type = Json.Str(command, "type") ?? "";
            if (!InApplyMenu) Remember(Identity(command), null);

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
                ShowSubMenu(ref pendingTransition, command, type == "audio-transition" ? "Audio transition" : "Transition", PaletteStyle.Colour(type),
                    "Length in frames · default " + settings.TransitionFrames,
                    "↑↓ choose where it goes  ·  ↵ apply  ·  ⇧↵ apply, keep open  ·  esc back");
                return;
            }
            if (type == "custom" && (id == "move-selected-clips-up" || id == "move-selected-clips-down") && string.IsNullOrEmpty(Json.Str(command, "moveMode")))
            {
                ShowSubMenu(ref pendingMove, command, "Function", PaletteStyle.Accent, "Choose how they move",
                    "↑↓ choose  ·  ↵ move  ·  ⇧↵ move, keep open  ·  esc back");
                return;
            }
            if (type == "custom" && (id == "stagger-ascending" || id == "stagger-descending"))
            {
                ShowSubMenu(ref pendingStagger, command, "Function", PaletteStyle.Accent, "Frames per step · default " + settings.StaggerFrames,
                    "↑↓ choose a step  ·  ↵ stagger  ·  ⇧↵ stagger, keep open  ·  esc back");
                return;
            }
            SubmitCommand(Json.Clone(command), keepOpen);
        }

        private void ShowSubMenu(ref Dictionary<string, object?>? slot, Dictionary<string, object?> command, string kind, Color colour, string placeholder, string footerLine)
        {
            slot = command;
            catalogQuery = search.Text;
            titleName = Json.Str(command, "name") ?? "";
            titleKind = kind;
            titleColour = colour;
            search.Text = "";
            SetPlaceholder(placeholder);
            SetFooter(footerLine);
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
            titleName = null;
            search.Text = catalogQuery;
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

        // The field's grey hint (Windows draws it in GrayText, within a shade of the Mac's faint).
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

        // Only where it was is restored: its size is always the Mac's 640 × 440 at the screen's scale.
        private void RestoreFrame()
        {
            try
            {
                var parts = File.ReadAllText(Paths.PaletteFrame).Trim().Split(',').Select(p => int.Parse(p, CultureInfo.InvariantCulture)).ToArray();
                var at = new Point(parts[0], parts[1]);
                if (Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(new Rectangle(at.X, at.Y, Width, 40))))
                {
                    Location = at;
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
