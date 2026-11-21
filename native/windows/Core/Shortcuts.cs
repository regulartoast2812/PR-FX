using System;
using System.Collections.Generic;
using System.IO;

namespace PrFxShortcutListener
{
    // A shortcut as the CEP panel saves it: a KeyboardEvent.code plus the four
    // modifiers. On Windows `meta` is the Windows key.
    internal sealed class Shortcut
    {
        public string Code = "Space";
        public bool Ctrl, Alt, Shift, Meta;

        public bool HasCommandModifier => Ctrl || Alt || Meta;

        public static Shortcut? From(IDictionary<string, object?>? obj)
        {
            if (obj == null) return null;
            var code = Json.Str(obj, "code");
            if (string.IsNullOrEmpty(code)) return null;
            return new Shortcut
            {
                Code = code!,
                Ctrl = Json.Bool(obj, "ctrl"),
                Alt = Json.Bool(obj, "alt"),
                Shift = Json.Bool(obj, "shift"),
                Meta = Json.Bool(obj, "meta")
            };
        }

        public string Display()
        {
            var parts = new List<string>();
            if (Ctrl) parts.Add("Ctrl");
            if (Alt) parts.Add("Alt");
            if (Shift) parts.Add("Shift");
            if (Meta) parts.Add("Win");
            parts.Add(Code == "Space" ? "Space" : Code.Replace("Key", "").Replace("Digit", ""));
            return string.Join("+", parts);
        }

        // Windows virtual-key code, or null for anything the CEP capture cannot
        // produce. Mapping an unknown code to Space would bind the wrong key.
        public static int? VirtualKey(string code)
        {
            if (code == "Space") return 0x20;
            if (code.Length == 4 && code.StartsWith("Key", StringComparison.Ordinal) && code[3] >= 'A' && code[3] <= 'Z') return code[3];
            if (code.Length == 6 && code.StartsWith("Digit", StringComparison.Ordinal) && code[5] >= '0' && code[5] <= '9') return code[5];
            return null;
        }
    }

    internal struct KeyChord : IEquatable<KeyChord>
    {
        public readonly int VirtualKey;
        public readonly bool Ctrl, Alt, Shift, Win;

        public KeyChord(int virtualKey, bool ctrl, bool alt, bool shift, bool win)
        {
            VirtualKey = virtualKey; Ctrl = ctrl; Alt = alt; Shift = shift; Win = win;
        }

        public bool Equals(KeyChord other) => VirtualKey == other.VirtualKey && Ctrl == other.Ctrl && Alt == other.Alt && Shift == other.Shift && Win == other.Win;
        public override bool Equals(object? obj) => obj is KeyChord other && Equals(other);
        public override int GetHashCode() => (VirtualKey << 4) | (Ctrl ? 1 : 0) | (Alt ? 2 : 0) | (Shift ? 4 : 0) | (Win ? 8 : 0);
    }

    // The lookup the keyboard hook consults on every keystroke. The first
    // binding of a chord wins and later duplicates are reported.
    internal sealed class ChordTable
    {
        private readonly Dictionary<KeyChord, int> ids = new Dictionary<KeyChord, int>();
        public readonly List<string> Duplicates = new List<string>();
        public readonly List<string> Unmappable = new List<string>();

        public void Add(Shortcut shortcut, int id, string label)
        {
            var vk = Shortcut.VirtualKey(shortcut.Code);
            if (vk == null) { Unmappable.Add(label); return; }
            var chord = new KeyChord(vk.Value, shortcut.Ctrl, shortcut.Alt, shortcut.Shift, shortcut.Meta);
            if (ids.ContainsKey(chord)) { Duplicates.Add(label); return; }
            ids[chord] = id;
        }

        public bool TryGet(KeyChord chord, out int id) => ids.TryGetValue(chord, out id);
        public int Count => ids.Count;
    }

    internal sealed class Binding
    {
        public Shortcut Shortcut = new Shortcut();
        public Dictionary<string, object?> Command = new Dictionary<string, object?>();
    }

    // settings.json, written by the CEP panel (client/app.js). Read-only here.
    internal sealed class ListenerSettings
    {
        public Shortcut Palette = new Shortcut { Code = "Space", Ctrl = true };
        public int TransitionFrames = 30;
        public int StaggerFrames = 5;
        public int StaggerGroup = 1;
        public string ShortcutFeedback = "problems";
        public string AnnounceScope = "on";
        // The Timeline highlight with Edie on it, and his nudges: same keys and defaults as the macOS listener.
        public string TimelineHighlight = "off";
        public string EdieNudges = "on";
        public double EdieNudgeMinutes = 2;
        public List<Binding> Bindings = new List<Binding>();

        public static ListenerSettings Load(out string error)
        {
            error = "";
            var settings = new ListenerSettings();
            string text;
            try { text = File.ReadAllText(Paths.Settings); }
            catch (Exception readError) { error = readError is FileNotFoundException || readError is DirectoryNotFoundException ? "" : readError.Message; return settings; }
            if (!Json.TryParse(text, out var parsed) || !(parsed is Dictionary<string, object?> root))
            {
                error = "settings.json is not valid JSON";
                return settings;
            }
            settings.Palette = Shortcut.From(Json.Obj(root, "shortcut")) ?? settings.Palette;
            settings.TransitionFrames = Json.Int(root, "transitionFrames") ?? 30;
            settings.StaggerFrames = Json.Int(root, "staggerFrames") ?? 5;
            settings.StaggerGroup = Json.Int(root, "staggerGroup") ?? 1;
            settings.ShortcutFeedback = Json.Str(root, "shortcutFeedback") ?? "problems";
            settings.AnnounceScope = Json.Str(root, "announceScope") ?? "on";
            settings.TimelineHighlight = Json.Str(root, "timelineHighlight") ?? "off";
            settings.EdieNudges = Json.Str(root, "edieNudges") ?? "on";
            if (root.TryGetValue("edieNudgeMinutes", out var minutes) && minutes != null &&
                double.TryParse(Convert.ToString(minutes, System.Globalization.CultureInfo.InvariantCulture), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var parsedMinutes) &&
                !double.IsNaN(parsedMinutes) && !double.IsInfinity(parsedMinutes))
                settings.EdieNudgeMinutes = parsedMinutes;
            foreach (var item in Json.List(root, "bindings") ?? new List<object?>())
            {
                var entry = item as IDictionary<string, object?>;
                var shortcut = Shortcut.From(Json.Obj(entry, "shortcut"));
                var command = Json.Obj(entry, "command");
                if (shortcut == null || command == null) continue;
                settings.Bindings.Add(new Binding { Shortcut = shortcut, Command = Json.Clone(command) });
            }
            return settings;
        }
    }
}
