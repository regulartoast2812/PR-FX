using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace PrFxShortcutListener
{
    // Windows counterpart of ShortcutListener in PRFXShortcutListener.swift.
    //
    // CEP owns the command catalog and pushes it over /catalog; this process
    // only caches it. Commands pass through as JSON dictionaries, so a new
    // command field or a new command never needs a listener rebuild.
    internal sealed class ShortcutListener : ApplicationContext
    {
        private const int PaletteBindingId = -1;
        private static readonly HashSet<string> RetiredCommandIds = new HashSet<string>(StringComparer.Ordinal) { "stretch-speed-to-playhead" };

        // Everything the hook needs on one keystroke, swapped atomically.
        private sealed class Armed
        {
            public ListenerSettings Settings = new ListenerSettings();
            public ChordTable Table = new ChordTable();
        }

        private enum ScopeLevel { None, ModifierOnly, Full }

        private struct Scope
        {
            public ScopeLevel Level;
            public string Reason;
            public Scope(ScopeLevel level, string reason) { Level = level; Reason = reason; }
            public bool Arms(Shortcut shortcut) => Level == ScopeLevel.Full || (Level == ScopeLevel.ModifierOnly && shortcut.HasCommandModifier);
        }

        private readonly PaletteForm palette = new PaletteForm();
        private readonly Toast toast = new Toast();
        private readonly KeyboardHook hook;
        private readonly TimelinePanel timeline = new TimelinePanel();
        private readonly TimelineHighlight highlight = new TimelineHighlight();
        private readonly EdieNudges nudges = new EdieNudges();
        private EdieNudges.Kind? nudgeKind;
        private string? lastCommandName;
        private DateTime lastCommandAt;
        private readonly CommandBridge? bridge;
        private readonly System.Windows.Forms.Timer housekeeping = new System.Windows.Forms.Timer { Interval = 250 };
        private readonly object statsGate = new object();
        private readonly KeyStats stats = new KeyStats();
        private readonly Dictionary<int, Tuple<string, string, DateTime>> inFlight = new Dictionary<int, Tuple<string, string, DateTime>>();
        private int? workingAISeq;
        private readonly string build;

        private volatile Armed armed = new Armed();
        private List<Dictionary<string, object?>> commands = new List<Dictionary<string, object?>>();
        private readonly object catalogGate = new object();
        private string catalogFingerprint = "";
        private int catalogRevision;
        private DateTime? settingsModifiedAt;
        private int seq;
        private volatile bool caretCalibrated;
        private readonly bool plainKeysOverride;
        private int housekeepingTicks;
        private string announcedScope = "";

        public ShortcutListener()
        {
            build = Assembly.GetExecutingAssembly().GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "source-dev";
            Paths.Ensure(Paths.SupportDir);
            Paths.Ensure(Paths.LogsDir);
            caretCalibrated = File.Exists(Paths.CaretCalibration);
            // Escape hatch for a Premiere build whose text fields never show a
            // Windows caret: plain-key shortcuts would otherwise stay withheld.
            plainKeysOverride = File.Exists(Path.Combine(Paths.SupportDir, "allow-plain-keys"));
            Log.Write("PR FX Shortcut Listener " + build + " starting (Windows)");

            // Handles must exist before any background thread marshals onto them.
            palette.CreateControl();
            _ = palette.Handle;
            _ = toast.Handle;
            _ = highlight.Handle;
            palette.Catalog = CatalogSnapshot;
            palette.CurrentSettings = () => armed.Settings;
            palette.Submit = SubmitFromPalette;

            commands = FallbackCommands();
            LoadCatalog();
            LoadSettings();

            timeline.Log = Log.Write;
            palette.Log = Log.Write;
            palette.IsOurs = h => h == toast.Handle || h == highlight.Handle;
            toast.Log = Log.Write;
            toast.PaletteWindow = () => palette.Visible ? palette.Handle : IntPtr.Zero;
            hook = new KeyboardHook(Decide)
            {
                Log = Log.Write,
                LogKeys = File.Exists(Path.Combine(Paths.SupportDir, "log-keys")),
                AcceptInjected = File.Exists(Path.Combine(Paths.SupportDir, "accept-injected")),
            };
            if (hook.LogKeys || hook.AcceptInjected) Log.Write("Key diagnostics on: log-keys=" + hook.LogKeys + " accept-injected=" + hook.AcceptInjected);
            hook.ForegroundChanged = isPremiere => OnUi(() => { if (isPremiere) ReloadSettingsIfNeeded(); });

            try
            {
                bridge = new CommandBridge
                {
                    CatalogReceived = CatalogReceived,
                    Health = HealthPayload,
                    ReloadSettings = () => OnUi(() => LoadSettings()),
                    Delivered = (command, client) => OnUi(() => RecordDelivered(command, client)),
                    Discarded = command => OnUi(() => RecordDiscarded(command)),
                    ResultReceived = (resultSeq, ok, message, ms) => OnUi(() => RecordResult(resultSeq, ok, message)),
                    Log = Log.Write,
                    ControlToken = WriteBridgeToken(),
                    Control = (route, body) => OnUi(() => HandleControl(route, body)),
                    Undo = body => PressPremiereUndo(body),
                    CatalogPayload = () => Json.Serialize(CatalogSnapshot()),
                    SettingsPayload = () => { try { return File.Exists(Paths.Settings) ? File.ReadAllText(Paths.Settings) : "{}"; } catch (Exception) { return "{}"; } },
                    SettingsWrite = WriteSettingsPatch
                };
                Log.Write("Command bridge listening on 127.0.0.1:" + CommandBridge.Port);
            }
            catch (Exception error)
            {
                bridge = null;
                Log.Write("Command bridge failed to start: " + error.Message);
            }

            hook.Start();
            Log.Write(hook.Installed ? "Keyboard hook installed" : "Keyboard hook NOT installed");

            housekeeping.Tick += (_, __) => Housekeeping();
            housekeeping.Start();
        }

        // ---- threads ------------------------------------------------------

        private void OnUi(Action action)
        {
            try { palette.BeginInvoke(action); }
            catch (Exception error) { Log.Write("UI dispatch failed: " + error.Message); }
        }

        private string WriteSettingsPatch(byte[] body)
        {
            if (!Json.TryParse(Encoding.UTF8.GetString(body), out var parsed) || parsed is not Dictionary<string, object?> patch)
                return "{\"error\":\"invalid settings patch\"}";
            Dictionary<string, object?> current = new Dictionary<string, object?>();
            try
            {
                if (File.Exists(Paths.Settings) && Json.TryParse(File.ReadAllText(Paths.Settings), out var stored) && stored is Dictionary<string, object?> values)
                    current = values;
                foreach (var item in patch) current[item.Key] = item.Value;
                var text = Json.Serialize(current);
                var temp = Paths.Settings + ".uxp." + Process.GetCurrentProcess().Id + ".tmp";
                File.WriteAllText(temp, text, new UTF8Encoding(false));
                if (File.Exists(Paths.Settings)) File.Replace(temp, Paths.Settings, null);
                else File.Move(temp, Paths.Settings);
                OnUi(() => LoadSettings());
                return text;
            }
            catch (Exception)
            {
                return "{\"error\":\"settings were not saved\"}";
            }
        }

        private void Housekeeping()
        {
            housekeepingTicks++;
            bridge?.Sweep();
            hook.Recheck();
            // Which panel is in use is worked out here, off the hook thread: the
            // hook only reads the verdict this leaves behind.
            var premiereOpen = PremiereOnScreen();
            if (hook.PremiereFrontmost)
            {
                timeline.Refresh(hook.PremiereThread, hook.PremiereWindow);
                AnnounceScopeIfChanged(CurrentScope());
            }
            else
            {
                announcedScope = "";
                // Behind another app the Timeline is still followed, so Edie stays on it.
                if (premiereOpen) timeline.Refresh(0, PremiereMainWindow());
            }
            RefreshHighlight(premiereOpen);
            RefreshNudge();
            if (housekeepingTicks % 4 == 0) ReloadSettingsIfNeeded();
        }

        // Premiere's main window is there and not minimised.
        private bool PremiereOnScreen()
        {
            var window = PremiereMainWindow();
            if (window == IntPtr.Zero || !Native.IsWindow(window)) return false;
            var root = Native.GetAncestor(window, Native.GA_ROOT);
            return Native.IsWindowVisible(root) && !Native.IsIconic(root);
        }

        // The Premiere window last in front, or, before Premiere has been in
        // front since the listener started, its main window (looked up at most
        // every 2 s).
        private IntPtr foundPremiere;
        private DateTime foundPremiereAt;
        private IntPtr PremiereMainWindow()
        {
            var window = hook.PremiereWindow;
            if (window != IntPtr.Zero && Native.IsWindow(window)) return window;
            if (foundPremiere != IntPtr.Zero && Native.IsWindow(foundPremiere)) return foundPremiere;
            if (DateTime.UtcNow - foundPremiereAt < TimeSpan.FromSeconds(2)) return IntPtr.Zero;
            foundPremiereAt = DateTime.UtcNow;
            foundPremiere = IntPtr.Zero;
            foreach (var process in Process.GetProcesses())
            {
                try
                {
                    if (process.ProcessName.StartsWith("Adobe Premiere Pro", StringComparison.OrdinalIgnoreCase) && process.MainWindowHandle != IntPtr.Zero)
                    { foundPremiere = process.MainWindowHandle; break; }
                }
                catch (Exception) { }
                finally { process.Dispose(); }
            }
            return foundPremiere;
        }

        // ---- Timeline highlight and Edie's nudges ---------------------------

        // Drawn with the setting on whenever Premiere's window is open and the
        // Timeline is on screen, whether Premiere is in front or not (the user,
        // 2026-11-21: "I want him to always exist in PR even if PR isn't active").
        // Its window sits just above Premiere's, so other apps in front cover
        // it. Hidden when Premiere is minimised, when the Timeline isn't showing,
        // and while a Premiere dialog is in front (Export settings, say). While
        // the palette is open it stays as it was.
        private void RefreshHighlight(bool premiereOpen)
        {
            if (palette.Visible && highlight.IsShowing) return;
            var settings = armed.Settings;
            var live = timeline.LiveRect;
            var root = timeline.LiveRoot;
            var dialogInFront = hook.PremiereFrontmost && Native.GetAncestor(hook.PremiereWindow, Native.GA_ROOT) != root;
            if (settings.TimelineHighlight != "on" || !premiereOpen || live == null || root == IntPtr.Zero ||
                !Native.IsWindowVisible(root) || Native.IsIconic(root) || dialogInFront)
            {
                highlight.HideHighlight();
                return;
            }
            var scope = CurrentScope();
            highlight.Update(new TimelineHighlight.State { Owner = root, Region = live.Value, Armed = scope.Level == ScopeLevel.Full, Reason = scope.Reason });
        }

        // Same tick: one idle-time read, the rest comparisons. He speaks only
        // beside the highlight, Premiere in front and the palette closed.
        private void RefreshNudge()
        {
            if (!highlight.IsSpeaking) nudgeKind = null;
            var settings = armed.Settings;
            if (settings.EdieNudges == "off") { highlight.Hush(); return; }
            var eligible = !palette.Visible && highlight.IsShowing && hook.PremiereFrontmost;
            nudges.NudgeAfter = Math.Max(0.1, Math.Min(60, settings.EdieNudgeMinutes)) * 60;
            var now = (DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds;
            var lastAt = (lastCommandAt - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds;
            var line = nudges.Tick(Native.IdleSeconds(), eligible, now, lastCommandName, lastAt, out var resumed);
            // Gone at the next input; at once if the palette opens or Premiere goes behind.
            if (!eligible || (resumed && nudgeKind == EdieNudges.Kind.StillThere)) highlight.Hush();
            if (line != null)
            {
                highlight.Say(line.Title, line.Detail, line.Kind == EdieNudges.Kind.WelcomeBack ? 6 : 9);
                nudgeKind = line.Kind;
            }
        }

        // ---- scope --------------------------------------------------------

        // Same rules as the macOS listener: plain keys only in the Timeline,
        // keys with Ctrl or Alt (and the palette) in any panel, nothing while a
        // menu is open, and no plain keys while typing in a text field.
        //
        // Premiere gives keyboard focus to the panel you click, and each panel
        // is its own window, so the focused window says which panel is in use
        // (TimelinePanel). A panel not yet looked at is Unknown for the moment
        // it takes housekeeping to look; plain keys wait for it.
        private Scope CurrentScope()
        {
            if (!hook.PremiereFrontmost) return new Scope(ScopeLevel.None, "Premiere is not frontmost");
            var info = new Native.GUITHREADINFO { cbSize = System.Runtime.InteropServices.Marshal.SizeOf(typeof(Native.GUITHREADINFO)) };
            if (!Native.GetGUIThreadInfo(hook.PremiereThread, ref info))
                return new Scope(ScopeLevel.ModifierOnly, "Timeline panel could not be located");
            if ((info.flags & (Native.GUI_INMENUMODE | Native.GUI_POPUPMENUMODE | Native.GUI_SYSTEMMENUMODE)) != 0)
                return new Scope(ScopeLevel.None, "Premiere menu is open");
            if (info.hwndCaret != IntPtr.Zero || (info.flags & Native.GUI_CARETBLINKING) != 0)
            {
                MarkCaretCalibrated();
                return new Scope(ScopeLevel.ModifierOnly, "Text input is focused");
            }
            if (plainKeysOverride) return new Scope(ScopeLevel.Full, "Premiere is frontmost (allow-plain-keys)");
            switch (timeline.Classify(info.hwndFocus))
            {
                case TimelinePanel.Verdict.Timeline: return new Scope(ScopeLevel.Full, "Timeline panel active");
                case TimelinePanel.Verdict.OtherPanel: return new Scope(ScopeLevel.ModifierOnly, "Last click was outside the Timeline panel");
                default: return new Scope(ScopeLevel.ModifierOnly, "Timeline panel could not be located");
            }
        }

        private void MarkCaretCalibrated()
        {
            if (caretCalibrated) return;
            caretCalibrated = true;
            ThreadPool.QueueUserWorkItem(_ =>
            {
                try { File.WriteAllText(Paths.CaretCalibration, DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture)); } catch (Exception) { }
                Log.Write("Text caret seen in Premiere; plain-key shortcuts can now arm");
            });
        }

        // Called on the hook thread for every non-modifier keydown while
        // Premiere is frontmost. Must stay instant: table lookup, one
        // GetGUIThreadInfo, then everything else is posted to the UI thread.
        private bool Decide(KeyChord chord)
        {
            var snapshot = armed;
            if (!snapshot.Table.TryGet(chord, out var id)) return false;
            var isPalette = id == PaletteBindingId;
            var shortcut = isPalette ? snapshot.Settings.Palette : snapshot.Settings.Bindings[id].Shortcut;
            var name = isPalette ? "Open Edie Palette" : Json.Str(snapshot.Settings.Bindings[id].Command, "name") ?? "";
            var key = shortcut.Display();
            var scope = CurrentScope();
            if (!scope.Arms(shortcut))
            {
                OnUi(() => RecordPassed(key, name, scope.Reason));
                return false;
            }
            if (!isPalette && bridge == null)
            {
                OnUi(() => RecordPassed(key, name, "Command bridge is offline"));
                return false;
            }
            // The banner goes first: it can't then be shown (or made active) while the palette takes the front.
            if (isPalette) OnUi(() => { toast.Hide(); palette.Open(hook.PremiereWindow); });
            else
            {
                var command = snapshot.Settings.Bindings[id].Command;
                var reason = scope.Reason;
                OnUi(() => FireBinding(command, key, reason, snapshot.Settings));
            }
            return true;
        }

        // ---- commands -----------------------------------------------------

        private void FireBinding(Dictionary<string, object?> binding, string key, string reason, ListenerSettings settings)
        {
            var command = Json.Clone(binding);
            var name = Json.Str(command, "name") ?? "";
            var commandSeq = NextTrackedSeq(key, name);
            StartAIWorking(command, commandSeq, name);
            lock (statsGate) stats.Fired++;
            KeyJournal.Record("fired", commandSeq, key, name, reason);
            highlight.Flash(true);
            command["transitionFrames"] = settings.TransitionFrames;
            command["staggerFrames"] = settings.StaggerFrames;
            command["staggerGroup"] = settings.StaggerGroup;
            command["seq"] = commandSeq;
            command["key"] = key;
            bridge?.Enqueue(command);
        }

        private void SubmitFromPalette(Dictionary<string, object?> command, bool keepOpen)
        {
            if (bridge == null)
            {
                MessageBox.Show("The local command bridge could not start. Quit any other Edie listener (Task Manager → PRFXShortcutListener.exe), then start it again.", "PR FX", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            var settings = armed.Settings;
            var name = Json.Str(command, "name") ?? "";
            var commandSeq = NextTrackedSeq("palette", name);
            StartAIWorking(command, commandSeq, name);
            lock (statsGate) stats.Fired++;
            KeyJournal.Record("fired", commandSeq, "palette", name, "native palette");
            highlight.Flash(true);
            if (Json.Int(command, "transitionFrames") == null) command["transitionFrames"] = settings.TransitionFrames;
            if (Json.Int(command, "staggerFrames") == null) command["staggerFrames"] = settings.StaggerFrames;
            if (Json.Int(command, "staggerGroup") == null) command["staggerGroup"] = settings.StaggerGroup;
            command["seq"] = commandSeq;
            command["key"] = "palette";
            bridge.Enqueue(command);
            if (keepOpen) Log.Write("Keeping palette open after queued command: " + name);
        }

        // Banner when shortcuts go live, mirroring the macOS listener: "armed"
        // means the Timeline is the panel in use and plain keys are live.
        private void AnnounceScopeIfChanged(Scope scope)
        {
            var kind = scope.Level == ScopeLevel.Full ? "armed" : scope.Level == ScopeLevel.ModifierOnly ? "other" : "";
            if (kind == announcedScope) return;
            announcedScope = kind;
            if (armed.Settings.AnnounceScope == "off" || palette.Visible) return;
            if (kind == "armed")
            {
                var live = armed.Settings.Bindings.Count(b => scope.Arms(b.Shortcut));
                toast.ShowMessage("Timeline armed · " + live + " shortcut" + (live == 1 ? "" : "s") + " live", ToastKind.Ok, 1.1, hook.PremiereWindow);
            }
        }

        // Premiere's own Undo or Redo for the UXP panel, which has no undo call.
        // Only when Premiere's window is known, so the keys never land elsewhere.
        private string PressPremiereUndo(byte[] body)
        {
            var redo = false; var count = 1;
            if (Json.TryParse(System.Text.Encoding.UTF8.GetString(body), out var parsed) && parsed is Dictionary<string, object?> request)
            {
                redo = Json.Bool(request, "redo");
                count = Math.Max(1, Math.Min(Json.Int(request, "count") ?? 1, 25));
            }
            var window = hook.PremiereWindow;
            if (window == IntPtr.Zero || !Native.IsWindow(window)) return "{\"error\":\"Premiere is not open.\"}";
            OnUi(() =>
            {
                Native.ForceForeground(window);
                for (var i = 0; i < count; i++)
                {
                    Native.keybd_event((byte)Native.VK_CONTROL, 0, 0, UIntPtr.Zero);
                    if (redo) Native.keybd_event((byte)Native.VK_SHIFT, 0, 0, UIntPtr.Zero);
                    Native.keybd_event(0x5A, 0, 0, UIntPtr.Zero);
                    Native.keybd_event(0x5A, 0, Native.KEYEVENTF_KEYUP, UIntPtr.Zero);
                    if (redo) Native.keybd_event((byte)Native.VK_SHIFT, 0, Native.KEYEVENTF_KEYUP, UIntPtr.Zero);
                    Native.keybd_event((byte)Native.VK_CONTROL, 0, Native.KEYEVENTF_KEYUP, UIntPtr.Zero);
                    System.Threading.Thread.Sleep(60);
                }
            });
            return "{\"ok\":true,\"count\":" + count + "}";
        }

        private void HandleControl(string route, byte[] body)
        {
            if (route == "/open-palette") { Log.Write("PR FX app asked for the palette"); palette.Open(hook.PremiereWindow); return; }
            if (route != "/run" || bridge == null) return;
            if (!Json.TryParse(System.Text.Encoding.UTF8.GetString(body), out var parsed) || !(parsed is Dictionary<string, object?> command))
            {
                Log.Write("PR FX app sent an unreadable command");
                return;
            }
            var settings = armed.Settings;
            var name = Json.Str(command, "name") ?? "";
            var commandSeq = NextTrackedSeq("app", name);
            StartAIWorking(command, commandSeq, name);
            lock (statsGate) stats.Fired++;
            KeyJournal.Record("fired", commandSeq, "app", name, "PR FX app");
            if (Json.Int(command, "transitionFrames") == null) command["transitionFrames"] = settings.TransitionFrames;
            if (Json.Int(command, "staggerFrames") == null) command["staggerFrames"] = settings.StaggerFrames;
            if (Json.Int(command, "staggerGroup") == null) command["staggerGroup"] = settings.StaggerGroup;
            command["seq"] = commandSeq;
            command["key"] = "app";
            bridge.Enqueue(command);
        }

        private static string WriteBridgeToken()
        {
            var bytes = new byte[24];
            using (var random = System.Security.Cryptography.RandomNumberGenerator.Create()) random.GetBytes(bytes);
            var token = string.Concat(bytes.Select(b => b.ToString("x2")));
            try { File.WriteAllText(Paths.BridgeToken, token); } catch (Exception error) { Log.Write("Could not write bridge token: " + error.Message); }
            return token;
        }

        private int NextTrackedSeq(string key, string name)
        {
            seq++;
            inFlight[seq] = Tuple.Create(key, name, DateTime.UtcNow);
            lastCommandName = name;
            lastCommandAt = DateTime.UtcNow;
            // A result that never arrives (Premiere quit mid-command) must not
            // grow this forever.
            if (inFlight.Count > 256) inFlight.Remove(inFlight.Keys.Min());
            return seq;
        }

        private void StartAIWorking(IDictionary<string, object?> command, int commandSeq, string name)
        {
            if ((Json.Str(command, "type") ?? "") != "ai-function") return;
            workingAISeq = commandSeq;
            toast.StartWorking(name, hook.PremiereWindow);
            highlight.StartWorking(name);
        }

        // ---- outcomes -----------------------------------------------------

        private string FeedbackMode => armed.Settings.ShortcutFeedback;

        private void RecordPassed(string key, string name, string reason)
        {
            string bucket;
            lock (statsGate) { stats.RecordPassed(reason); }
            bucket = KeyStats.ReasonBucket(reason);
            KeyJournal.Record("passed", null, key, name, reason);
            highlight.Flash(false);
            Log.Write("Shortcut passed to Premiere: " + key + " → " + name + " — " + reason);
            // Typing into a field and keys pressed in an open menu are the
            // scoping working, not failures; a banner there would be noise.
            if (FeedbackMode == "off" || bucket == "text-field" || bucket == "menu-open") return;
            string hint;
            switch (bucket)
            {
                case "outside-timeline": hint = "click the Timeline first"; break;
                case "timeline-not-found": hint = "Edie can't find the Timeline panel — click it once"; break;
                case "bridge-down": hint = "the Edie bridge is offline"; break;
                default: hint = reason; break;
            }
            toast.ShowMessage(key + " · " + name + " not run — " + hint, ToastKind.Skipped, 2.6, hook.PremiereWindow);
        }

        private void RecordDelivered(Dictionary<string, object?> command, string client)
        {
            if (!(Json.Int(command, "seq") is int commandSeq)) return;
            lock (statsGate) stats.Delivered++;
            KeyJournal.Record("delivered", commandSeq, Json.Str(command, "key") ?? "", Json.Str(command, "name") ?? "", client);
        }

        private void RecordDiscarded(Dictionary<string, object?> command)
        {
            if (!(Json.Int(command, "seq") is int commandSeq)) return;
            lock (statsGate) stats.Expired++;
            inFlight.Remove(commandSeq);
            if (workingAISeq == commandSeq) { workingAISeq = null; toast.StopWorking(); highlight.StopWorking(); }
            var key = Json.Str(command, "key") ?? "";
            var name = Json.Str(command, "name") ?? "";
            KeyJournal.Record("expired", commandSeq, key, name, "not collected within 5s");
            Log.Write("Command expired before CEP collected it: " + name + " [" + key + "]");
            if (FeedbackMode != "off")
                toast.ShowMessage(name + " didn't run — Premiere was busy or the Edie engine isn't running", ToastKind.Failed, 4, hook.PremiereWindow);
        }

        private void RecordResult(int resultSeq, bool ok, string message)
        {
            inFlight.TryGetValue(resultSeq, out var info);
            inFlight.Remove(resultSeq);
            if (workingAISeq == resultSeq) { workingAISeq = null; toast.StopWorking(); highlight.StopWorking(); }
            var key = info?.Item1 ?? "";
            var name = info?.Item2 ?? "command #" + resultSeq;
            var elapsed = info == null ? "" : (int)(DateTime.UtcNow - info.Item3).TotalMilliseconds + "ms";
            message = message.Trim();
            if (message.StartsWith("ERROR:", StringComparison.Ordinal)) message = message.Substring(6).Trim();
            var detail = (elapsed + " " + message).Trim();
            if (ok)
            {
                lock (statsGate) stats.Ok++;
                KeyJournal.Record("ok", resultSeq, key, name, detail);
                if (FeedbackMode == "all")
                {
                    var quiet = message.Length == 0 || message.StartsWith("Applied ", StringComparison.Ordinal);
                    var shown = message.Length > 140 ? message.Substring(0, 137) + "…" : message;
                    toast.ShowMessage(name + (quiet ? "" : " — " + shown), ToastKind.Ok, quiet ? 1.3 : 2.4, hook.PremiereWindow);
                }
            }
            else
            {
                lock (statsGate) stats.Failed++;
                KeyJournal.Record("failed", resultSeq, key, name, detail);
                Log.Write("Command failed: " + name + " [" + key + "] — " + message);
                if (FeedbackMode != "off")
                {
                    var shown = message.Length > 180 ? message.Substring(0, 177) + "…" : message;
                    toast.ShowMessage(name + (shown.Length == 0 ? "" : " — " + shown), ToastKind.Failed, 4.5, hook.PremiereWindow);
                }
            }
        }

        // ---- settings -----------------------------------------------------

        private DateTime? SettingsModificationDate()
        {
            try { return File.Exists(Paths.Settings) ? File.GetLastWriteTimeUtc(Paths.Settings) : (DateTime?)null; }
            catch (Exception) { return null; }
        }

        private void ReloadSettingsIfNeeded()
        {
            var current = SettingsModificationDate();
            if (current == settingsModifiedAt) return;
            Log.Write("Detected settings.json change; reloading shortcut bindings");
            LoadSettings();
        }

        private void LoadSettings()
        {
            settingsModifiedAt = SettingsModificationDate();
            var loaded = ListenerSettings.Load(out var error);
            if (error.Length > 0)
            {
                // Keep the last good bindings: a half-written settings.json must
                // not disarm every shortcut.
                Log.Write("Settings load failed: " + error);
                return;
            }
            loaded.Bindings = loaded.Bindings
                .Where(b => !RetiredCommandIds.Contains(Json.Str(b.Command, "id") ?? ""))
                .ToList();
            foreach (var binding in loaded.Bindings)
            {
                var id = Json.Str(binding.Command, "id");
                if (id == "undo-last-palette-action") binding.Command["name"] = "Undo Last Edie Effect Apply";
                if (id == "undo-last-prfx-action") binding.Command["name"] = "Undo Last Edie Action (Any)";
                if (id == "undo-last-arrange") binding.Command["name"] = "Undo Last Edie Arrange Action";
                if (id == "redo-last-arrange") binding.Command["name"] = "Redo Last Edie Arrange Action";
                if (id == "remove-transitions") binding.Command["name"] = "Remove Transitions on Selected Clips";
            }
            var table = new ChordTable();
            table.Add(loaded.Palette, PaletteBindingId, "Palette");
            for (var i = 0; i < loaded.Bindings.Count; i++)
                table.Add(loaded.Bindings[i].Shortcut, i, loaded.Bindings[i].Shortcut.Display() + " → " + Json.Str(loaded.Bindings[i].Command, "name"));
            foreach (var duplicate in table.Duplicates) Log.Write("Duplicate shortcut ignored: " + duplicate);
            foreach (var unmappable in table.Unmappable) Log.Write("Unsupported key, binding ignored: " + unmappable);
            armed = new Armed { Settings = loaded, Table = table };
            Log.Write("Loaded " + loaded.Bindings.Count + " command shortcut(s); palette " + loaded.Palette.Display());
        }

        // ---- catalog ------------------------------------------------------

        private List<Dictionary<string, object?>> CatalogSnapshot()
        {
            lock (catalogGate) return commands.Select(Json.Clone).ToList();
        }

        private static List<Dictionary<string, object?>> Sanitized(IEnumerable<object?> catalog) =>
            catalog.OfType<IDictionary<string, object?>>()
                .Where(c => !string.IsNullOrEmpty(Json.Str(c, "name")) && !string.IsNullOrEmpty(Json.Str(c, "type")))
                .Where(c => !RetiredCommandIds.Contains(Json.Str(c, "id") ?? ""))
                .Select(Json.Clone)
                .ToList();

        // A catalog under 25 entries is a CEP bug or a half-loaded panel, never
        // a real catalog; accepting it would empty the palette.
        private void CatalogReceived(List<object?> catalog, string fingerprint)
        {
            if (catalog.Count < 25)
            {
                Log.Write("Ignored suspiciously small catalog: " + catalog.Count + " command(s)");
                return;
            }
            var sanitized = Sanitized(catalog);
            bool changed;
            lock (catalogGate)
            {
                changed = fingerprint != catalogFingerprint;
                commands = sanitized;
                catalogFingerprint = fingerprint;
                if (changed) catalogRevision++;
            }
            if (!changed) return;
            Log.Write("Received catalog: " + sanitized.Count + " command(s) [" + fingerprint + "]");
            ThreadPool.QueueUserWorkItem(_ =>
            {
                try { File.WriteAllText(Paths.Catalog, Json.Serialize(sanitized), new System.Text.UTF8Encoding(false)); }
                catch (Exception error) { Log.Write("Catalog cache write failed: " + error.Message); }
            });
        }

        private void LoadCatalog()
        {
            try
            {
                if (!File.Exists(Paths.Catalog)) return;
                if (!(Json.Parse(File.ReadAllText(Paths.Catalog)) is List<object?> cached) || cached.Count < 25) return;
                commands = Sanitized(cached);
                Log.Write("Restored cached catalog: " + commands.Count + " command(s)");
            }
            catch (Exception error) { Log.Write("Cached catalog unreadable: " + error.Message); }
        }

        // Startup-only list, used until CEP pushes the real catalog. Same
        // entries as prfxFallbackCommands in the macOS listener.
        private static List<Dictionary<string, object?>> FallbackCommands()
        {
            var entries = new[]
            {
                "dump-qe-api|[System] Dump QE + DOM API", "inspect-selected-clip|[System] Inspect Selected Clip",
                "failure-report|[System] Failure Report", "preset-report|[System] Preset Report",
                "probe-preset-routes|[System] Probe Lumetri Preset Apply", "clear-failure-ledger|[System] Clear Failure Ledger",
                "undo-last-palette-action|Undo Last Edie Effect Apply", "remove-transitions|Remove Transitions on Selected Clips",
                "move-selected-clips-up|Move Selected Clips Up as Group|group", "move-selected-clips-up|Move Selected Clips Up Individually|individual",
                "move-selected-clips-down|Move Selected Clips Down as Group|group", "move-selected-clips-down|Move Selected Clips Down Individually|individual",
                "pull-group-in|Pull Group In to Playhead", "pull-group-out|Pull Group Out to Playhead",
                "retract-speed-in-to-playhead|Retract Speed In to Playhead", "retract-speed-out-to-playhead|Retract Speed Out to Playhead",
                "undo-last-prfx-action|Undo Last Edie Action (Any)", "undo-last-arrange|Undo Last Edie Arrange Action",
                "redo-last-arrange|Redo Last Edie Arrange Action", "select-before-playhead|Select Everything Starting Before Playhead",
                "adjustment-layer-over-selection|Adjustment Layer Over Selection", "perfect-pitch|Perfect Pitch (Correct Speed Transposition)",
                "place-source-clip|Place Source Monitor Clip at Playhead", "place-bin-clips|Place Bin Clips at Playhead in Row",
                "place-bin-clips-column|Place Bin Clips at Playhead in Column", "replace-from-bin|Replace Selected Clips from Bin",
                "replace-fit-from-bin|Replace & Fit to Slot from Bin", "bulk-replace-preview|Bulk Replace — Dry Run (no changes)",
                "bulk-replace-by-name|Bulk Replace from Bin by Name", "queue-cuts-to-ame|Queue Cuts to Media Encoder",
                "trim-in-to-playhead|Trim In to Playhead", "trim-out-to-playhead|Trim Out to Playhead",
                "close-selected-gaps|Close Gaps Between Selected Clips", "clean-up-track-rows|Clean Up by Selected",
                "fill-track-rows-down|Clean Up by Timeline", "snap-tracks-in|Snap Track Blocks In to Playhead",
                "snap-tracks-out|Snap Track Blocks Out to Playhead", "stagger-ascending|Stagger Ascending",
                "stagger-descending|Stagger Descending"
            };
            return entries.Select(entry =>
            {
                var parts = entry.Split('|');
                var command = new Dictionary<string, object?>(StringComparer.Ordinal) { ["type"] = "custom", ["name"] = parts[1], ["transitionFrames"] = 30, ["id"] = parts[0] };
                if (parts.Length > 2) command["moveMode"] = parts[2];
                return command;
            }).ToList();
        }

        // ---- health -------------------------------------------------------

        // Same keys as the macOS healthPayload, plus "platform". Called on a
        // bridge thread; reads only snapshots and locked counters.
        private string HealthPayload()
        {
            var snapshot = armed;
            var scope = CurrentScope();
            var premiere = hook.PremiereFrontmost;
            var mode = !premiere || bridge == null || !hook.Installed ? "paused"
                : scope.Level == ScopeLevel.Full ? "active"
                : scope.Level == ScopeLevel.ModifierOnly ? "modifier-only" : "paused";
            var saved = snapshot.Settings.Bindings.Count;
            var armedCount = snapshot.Settings.Bindings.Count(b => scope.Arms(b.Shortcut));
            int catalogCount, revision;
            string fingerprint;
            lock (catalogGate) { catalogCount = commands.Count; revision = catalogRevision; fingerprint = catalogFingerprint; }
            string keyStats;
            lock (statsGate) keyStats = stats.ToJson();
            var pending = bridge?.PendingName() ?? "";
            var transport = (bridge?.QueueHealth() ?? "") +
                            ",\"failedRegistrations\":0,\"deliveryMode\":\"" + (hook.Installed ? "keyboard-hook" : "none") + "\"" +
                            ",\"tapReenables\":0,\"hookReinstalls\":" + hook.Reinstalls +
                            ",\"keyStats\":" + keyStats;
            return "{\"platform\":\"windows\",\"mode\":\"" + mode + "\",\"listenerBuild\":" + Json.Quote(build) +
                   ",\"bindings\":" + saved + ",\"armedBindings\":" + armedCount + ",\"withheldBindings\":" + Math.Max(0, saved - armedCount) +
                   ",\"accessibilityTrusted\":true,\"accessibilityBypassed\":false" +
                   ",\"catalogCount\":" + catalogCount + ",\"catalogRevision\":" + revision + ",\"catalogFingerprint\":" + Json.Quote(fingerprint) +
                   ",\"pendingCommand\":" + Json.Quote(pending) + ",\"focus\":" + Json.Quote(scope.Reason) +
                   ",\"paletteFrameSaved\":" + (File.Exists(Paths.PaletteFrame) ? "true" : "false") +
                   ",\"paletteQuickCloses\":" + palette.QuickCloses +
                   ",\"caretCalibrated\":" + (caretCalibrated || plainKeysOverride ? "true" : "false") +
                   ",\"timelineDetection\":" + Json.Quote(timeline.Details) +
                   ",\"geometry\":{\"live\":" + RectJson(timeline.LiveRect) + ",\"saved\":" + RectJson(timeline.LastTimelineRect) + ",\"click\":null,\"panelsHidden\":false,\"premiereFrontmost\":" + (premiere ? "true" : "false") +
                   ",\"window\":" + WindowJson(hook.PremiereWindow) + ",\"units\":\"physical-pixels\"}" +
                   ",\"scopeKind\":\"" + (scope.Level == ScopeLevel.Full ? "full" : scope.Level == ScopeLevel.ModifierOnly ? "modifier-only" : "none") + "\"" +
                   ",\"keyScope\":" + Json.Quote(scope.Reason) + ",\"feedback\":" + Json.Quote(snapshot.Settings.ShortcutFeedback) + ",\"announceScope\":" + Json.Quote(snapshot.Settings.AnnounceScope) +
                   transport + "}";
        }

        private static string RectJson(Native.RECT? rect) => rect is Native.RECT r
            ? "[" + r.Left + "," + r.Top + "," + (r.Right - r.Left) + "," + (r.Bottom - r.Top) + "]" : "null";

        private static string WindowJson(IntPtr window)
        {
            if (window == IntPtr.Zero || !Native.IsWindow(window) || !Native.GetWindowRect(window, out var rect)) return "null";
            return "[" + rect.Left + "," + rect.Top + "," + (rect.Right - rect.Left) + "," + (rect.Bottom - rect.Top) + "]";
        }

        protected override void ExitThreadCore()
        {
            housekeeping.Stop();
            hook.Stop();
            bridge?.Dispose();
            base.ExitThreadCore();
        }
    }
}
