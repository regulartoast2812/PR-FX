using System.Diagnostics;
using System.Net;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace PrFxShortcutListener;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new ShortcutContext());
    }
}

internal sealed class ShortcutContext : ApplicationContext
{
    private const int WmHotKey = 0x0312;
    private const int PaletteHotKeyId = 1;
    private const uint ModAlt = 0x0001, ModControl = 0x0002, ModShift = 0x0004, ModWin = 0x0008;
    private readonly ListenerWindow window = new();
    private Settings settings;
    private readonly ListenerBridge bridge;
    private readonly PaletteForm palette;
    private readonly Dictionary<int, Command> mappedCommands = [];
    private readonly HashSet<int> registeredHotKeyIds = [];
    private readonly SynchronizationContext uiContext;
    private IntPtr premiereWindow;

    public ShortcutContext()
    {
        window.CreateHandle(new CreateParams());
        uiContext = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
        settings = Settings.Load();
        bridge = new ListenerBridge(ReloadSettings);
        palette = new PaletteForm(settings, bridge.Enqueue, ReturnToPremiere);
        RegisterShortcuts();
        window.WndProcOverride = WndProc;
    }

    private void RegisterShortcuts()
    {
        foreach (var id in registeredHotKeyIds) Native.UnregisterHotKey(window.Handle, id);
        registeredHotKeyIds.Clear();
        mappedCommands.Clear();

        RegisterShortcut(PaletteHotKeyId, settings.Shortcut, null);
        var nextId = PaletteHotKeyId + 1;
        foreach (var binding in settings.Bindings ?? [])
        {
            RegisterShortcut(nextId++, binding.Shortcut, binding.Command);
        }
    }

    private void RegisterShortcut(int id, Shortcut shortcut, Command? command)
    {
        if (Native.RegisterHotKey(window.Handle, id, ModifierKeys(shortcut), VirtualKey(shortcut.Code)))
        {
            registeredHotKeyIds.Add(id);
            if (command is not null) mappedCommands[id] = command;
        }
        else if (id == PaletteHotKeyId)
        {
            MessageBox.Show($"{shortcut.Display()} is unavailable. Choose another shortcut in PR FX Palette Settings.", "PR FX Shortcut Listener", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private void WndProc(ref Message message)
    {
        if (message.Msg != WmHotKey || !IsPremiereForeground(out premiereWindow)) return;
        var id = message.WParam.ToInt32();
        if (id == PaletteHotKeyId) palette.Open();
        else if (mappedCommands.TryGetValue(id, out var command)) bridge.Enqueue(command with { TransitionFrames = settings.TransitionFrames });
    }

    private void ReloadSettings()
    {
        uiContext.Post(_ =>
        {
            settings = Settings.Load();
            RegisterShortcuts();
        }, null);
    }

    private void ReturnToPremiere()
    {
        if (premiereWindow != IntPtr.Zero) Native.SetForegroundWindow(premiereWindow);
    }

    protected override void ExitThreadCore()
    {
        foreach (var id in registeredHotKeyIds) Native.UnregisterHotKey(window.Handle, id);
        bridge.Dispose();
        window.DestroyHandle();
        base.ExitThreadCore();
    }

    private static bool IsPremiereForeground(out IntPtr handle)
    {
        handle = Native.GetForegroundWindow();
        Native.GetWindowThreadProcessId(handle, out var processId);
        try
        {
            using var process = Process.GetProcessById((int)processId);
            return process.ProcessName.StartsWith("Adobe Premiere Pro", StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    private static uint ModifierKeys(Shortcut key)
    {
        uint result = 0;
        if (key.Ctrl) result |= ModControl;
        if (key.Alt) result |= ModAlt;
        if (key.Shift) result |= ModShift;
        if (key.Meta) result |= ModWin;
        return result;
    }

    private static uint VirtualKey(string code) => code switch
    {
        "Space" => 0x20,
        [ 'K', 'e', 'y', var letter ] when letter is >= 'A' and <= 'Z' => (uint)letter,
        [ 'D', 'i', 'g', 'i', 't', var digit ] when digit is >= '0' and <= '9' => (uint)digit,
        _ => 0x20
    };
}

internal sealed class PaletteForm : Form
{
    private readonly Settings settings;
    private readonly Action<Command> enqueue;
    private readonly Action returnToPremiere;
    private readonly TextBox search = new() { Dock = DockStyle.Top, PlaceholderText = "Search effects and transitions…", Font = new Font("Segoe UI", 12), Margin = new Padding(14) };
    private readonly ListBox list = new() { Dock = DockStyle.Fill, Font = new Font("Segoe UI", 11), IntegralHeight = false };
    private List<Command> matches = [];

    private static readonly Command[] Commands =
    [
        new("effect", "Gaussian Blur"), new("effect", "Lumetri Color"), new("effect", "Crop"), new("effect", "Transform"), new("effect", "Warp Stabilizer"), new("effect", "Sharpen"), new("effect", "Tint"),
        new("transition", "Cross Dissolve"), new("transition", "Dip To Black"), new("transition", "Dip To White"), new("transition", "Film Dissolve"),
        new("audio-transition", "Constant Power"), new("audio-transition", "Exponential Fade")
    ];

    public PaletteForm(Settings settings, Action<Command> enqueue, Action returnToPremiere)
    {
        this.settings = settings;
        this.enqueue = enqueue;
        this.returnToPremiere = returnToPremiere;
        Text = "PR FX Palette";
        ClientSize = new Size(560, 460);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.CenterScreen;
        var header = new Label { Text = "FX PALETTE", Dock = DockStyle.Top, Height = 34, Padding = new Padding(12, 10, 0, 0), Font = new Font("Segoe UI", 10, FontStyle.Bold) };
        Controls.Add(list);
        Controls.Add(search);
        Controls.Add(header);
        search.TextChanged += (_, _) => Filter();
        search.KeyDown += SearchKeyDown;
        list.KeyDown += SearchKeyDown;
        list.DoubleClick += async (_, _) => await ApplySelected();
        Deactivate += (_, _) => Hide();
        Filter();
    }

    public void Open()
    {
        search.Clear();
        Filter();
        Show();
        Activate();
        search.Focus();
    }

    private void Filter()
    {
        var query = search.Text.Trim();
        matches = Commands.Where(command => string.IsNullOrWhiteSpace(query) || ($"{command.Name} {command.Type}").Contains(query, StringComparison.OrdinalIgnoreCase))
            .Select(command => command with { TransitionFrames = settings.TransitionFrames }).ToList();
        list.DataSource = matches.Select(command => $"{command.Name,-40} {command.Type}").ToList();
        if (matches.Count > 0) list.SelectedIndex = 0;
    }

    private async void SearchKeyDown(object? sender, KeyEventArgs eventArgs)
    {
        if (eventArgs.KeyCode == Keys.Down) { list.Focus(); eventArgs.Handled = true; }
        if (eventArgs.KeyCode == Keys.Escape) { Hide(); returnToPremiere(); }
        if (eventArgs.KeyCode == Keys.Enter) { eventArgs.SuppressKeyPress = true; await ApplySelected(); }
    }

    private async Task ApplySelected()
    {
        if (list.SelectedIndex < 0 || list.SelectedIndex >= matches.Count) return;
        enqueue(matches[list.SelectedIndex]);
        Hide();
        returnToPremiere();
    }
}

internal sealed class ListenerBridge : IDisposable
{
    private readonly HttpListener listener = new();
    private readonly object gate = new();
    private Command? pending;
    private readonly Action reloadSettings;

    public ListenerBridge(Action reloadSettings)
    {
        this.reloadSettings = reloadSettings;
        listener.Prefixes.Add("http://127.0.0.1:27389/");
        listener.Start();
        _ = Task.Run(ListenAsync);
    }

    public void Enqueue(Command command)
    {
        lock (gate) pending = command;
    }

    private async Task ListenAsync()
    {
        while (listener.IsListening)
        {
            try
            {
                var context = await listener.GetContextAsync();
                if (context.Request.HttpMethod == "GET" && context.Request.Url?.AbsolutePath == "/next")
                {
                    Command? command;
                    lock (gate) { command = pending; pending = null; }
                    var body = JsonSerializer.Serialize(command);
                    var bytes = System.Text.Encoding.UTF8.GetBytes(body);
                    context.Response.StatusCode = 200;
                    context.Response.ContentType = "application/json";
                    context.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                    context.Response.ContentLength64 = bytes.Length;
                    await context.Response.OutputStream.WriteAsync(bytes);
                    context.Response.Close();
                }
                else if (context.Request.HttpMethod == "POST" && context.Request.Url?.AbsolutePath == "/reload-settings")
                {
                    reloadSettings();
                    context.Response.StatusCode = 200;
                    context.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                    context.Response.Close();
                }
                else { context.Response.StatusCode = 404; context.Response.Close(); }
            }
            catch (HttpListenerException) { break; }
            catch (ObjectDisposedException) { break; }
        }
    }

    public void Dispose()
    {
        listener.Stop();
        listener.Close();
    }
}

internal delegate void WindowMessageHandler(ref Message message);

internal sealed class ListenerWindow : NativeWindow
{
    public WindowMessageHandler? WndProcOverride { get; set; }
    protected override void WndProc(ref Message message)
    {
        WndProcOverride?.Invoke(ref message);
        base.WndProc(ref message);
    }
}

internal record Shortcut(string Code, bool Ctrl, bool Alt, bool Shift, bool Meta)
{
    public string Display() => string.Join(" + ", new[] { Ctrl ? "Ctrl" : null, Alt ? "Alt" : null, Shift ? "Shift" : null, Meta ? "Win" : null, Code == "Space" ? "Space" : Code.Replace("Key", "").Replace("Digit", "") }.Where(value => value is not null));
}
internal record Binding(Shortcut Shortcut, Command Command);
internal record Settings(Shortcut Shortcut, int TransitionFrames, IReadOnlyList<Binding>? Bindings = null)
{
    private static readonly Settings Defaults = new(new Shortcut("Space", true, false, false, false), 30, []);
    public static Settings Load()
    {
        try
        {
            var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "PR FX Palette", "settings.json");
            return JsonSerializer.Deserialize<Settings>(File.ReadAllText(path), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? Defaults;
        }
        catch { return Defaults; }
    }
}
internal record Command(string Type, string Name, int TransitionFrames = 30, string? Id = null);

internal static partial class Native
{
    [LibraryImport("user32.dll")] internal static partial bool RegisterHotKey(IntPtr handle, int id, uint modifiers, uint virtualKey);
    [LibraryImport("user32.dll")] internal static partial bool UnregisterHotKey(IntPtr handle, int id);
    [LibraryImport("user32.dll")] internal static partial IntPtr GetForegroundWindow();
    [LibraryImport("user32.dll")] internal static partial uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
    [LibraryImport("user32.dll")] internal static partial bool SetForegroundWindow(IntPtr handle);
}
