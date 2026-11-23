using System;
using System.Collections.Generic;
using System.Linq;

namespace PrFxShortcutListener
{
    // The Ctrl+Space palette's search, laid out like Sage's vault search in Creative Assist (2026-11-23, the user:
    // "both UI should be revamp to be formated like sage's ctrl space search and then add a function when i hit tab to
    // look for media name. and entering after finding the file and pressing enter would place it in the timeline").
    // Tabs you move between with Tab and Shift+Tab, each with its count: Commands (grouped by kind, each group with its
    // own colour and count), Media (every placeable item in the Premiere project, by name, with the bins it sits in), and
    // Video, SFX and BGM, parts of Media. A line-for-line port of native/PRFXPaletteSearch.swift: change both together. Pure (no
    // WinForms), so tools/check-windows-bridge can run it on macOS.

    // The media tabs (2026-11-23, the user: "we need to add more categories, like video, sfx for audio under 45s, anything
    // over 45s should be ambient or bgm"): Media is everything; Video, SFX (sound under 45 seconds) and BGM (sound 45 seconds
    // or longer, ambience or music) are parts of it. Sound whose length Premiere didn't give is only under Media.
    internal enum PaletteCategory { Commands, Media, Video, Audio, Sfx, Bgm, Sequences }

    internal static class PaletteCategories
    {
        public static readonly PaletteCategory[] All = { PaletteCategory.Commands, PaletteCategory.Media, PaletteCategory.Video, PaletteCategory.Audio, PaletteCategory.Sfx, PaletteCategory.Bgm, PaletteCategory.Sequences };

        public static string Label(PaletteCategory category)
        {
            switch (category)
            {
                case PaletteCategory.Commands: return "Commands";
                case PaletteCategory.Media: return "Media";
                case PaletteCategory.Video: return "Video";
                case PaletteCategory.Audio: return "Audio";
                case PaletteCategory.Sfx: return "SFX";
                case PaletteCategory.Sequences: return "Sequences";
                default: return "BGM";
            }
        }
        public static bool IsMedia(PaletteCategory category) => category != PaletteCategory.Commands;
        public static PaletteCategory Next(PaletteCategory category) => Step(category, 1);
        public static PaletteCategory Previous(PaletteCategory category) => Step(category, -1);
        private static PaletteCategory Step(PaletteCategory category, int by) =>
            All[(Array.IndexOf(All, category) + by + All.Length) % All.Length];
    }

    /// One item from the host's prfx.listProjectMedia().
    internal sealed class PaletteMedia
    {
        public string Id = "", Name = "", Bin = "", Kind = "", Ext = "";   // Kind: video, audio, image, sequence or other
        /// How long a sound is, in seconds (from its in to its out point); null for pictures and video.
        public double? Seconds;
    }

    /// What the engine POSTs to /media.
    internal sealed class PaletteMediaList
    {
        public string? Project;
        public int? Total;
        public List<PaletteMedia> Items = new List<PaletteMedia>();
        public string? Error;

        // Null when the body can't be read, as Swift's JSONDecoder fails: items is required, and every item needs all
        // five strings.
        public static PaletteMediaList? Parse(string text)
        {
            if (!Json.TryParse(text, out var parsed) || !(parsed is Dictionary<string, object?> body)) return null;
            if (!(Json.List(body, "items") is IList<object?> items)) return null;
            var list = new PaletteMediaList { Project = Json.Str(body, "project"), Total = Json.Int(body, "total"), Error = Json.Str(body, "error") };
            foreach (var value in items)
            {
                if (!(value is Dictionary<string, object?> item)) return null;
                var id = Json.Str(item, "id");
                var name = Json.Str(item, "name");
                var bin = Json.Str(item, "bin");
                var kind = Json.Str(item, "kind");
                var ext = Json.Str(item, "ext");
                if (id == null || name == null || bin == null || kind == null || ext == null) return null;
                double? seconds = null;
                if (item.TryGetValue("seconds", out var length) && length != null)
                {
                    if (length is long whole) seconds = whole;
                    else if (length is double fraction) seconds = fraction;
                    else return null;   // present but not a number: Swift's decoder fails too
                }
                list.Items.Add(new PaletteMedia { Id = id, Name = name, Bin = bin, Kind = kind, Ext = ext, Seconds = seconds });
            }
            return list;
        }
    }

    /// A command as the search sees it: its name, its kind, and where it sits in the full list.
    internal struct PaletteEntry
    {
        public readonly string Type;
        public readonly string Name;
        public readonly int Index;
        public PaletteEntry(string type, string name, int index) { Type = type; Name = name; Index = index; }
    }

    /// A matched range in a name: Start up to (not including) End, in characters.
    internal struct PaletteRange : IEquatable<PaletteRange>
    {
        public readonly int Start, End;
        public PaletteRange(int start, int end) { Start = start; End = end; }
        public int Length => End - Start;
        public bool Equals(PaletteRange other) => Start == other.Start && End == other.End;
        public override bool Equals(object? obj) => obj is PaletteRange other && Equals(other);
        public override int GetHashCode() => (Start * 397) ^ End;
    }

    /// The command kinds, in the order their groups are shown, with the name of each group.
    internal static class PaletteKinds
    {
        public static readonly KeyValuePair<string, string>[] Order =
        {
            new KeyValuePair<string, string>("ai-function", "AI functions"),
            new KeyValuePair<string, string>("custom", "Functions"),
            new KeyValuePair<string, string>("effect", "Effects"),
            new KeyValuePair<string, string>("audio-effect", "Audio effects"),
            new KeyValuePair<string, string>("transition", "Transitions"),
            new KeyValuePair<string, string>("audio-transition", "Audio transitions"),
            new KeyValuePair<string, string>("preset", "Presets"),
        };

        public static string Title(string type)
        {
            foreach (var kind in Order) if (kind.Key == type) return kind.Value;
            if (type.Length == 0) return "s";
            return type.Substring(0, 1).ToUpperInvariant() + type.Substring(1).Replace("-", " ") + "s";
        }

        public static int Rank(string type)
        {
            for (var i = 0; i < Order.Length; i++) if (Order[i].Key == type) return i;
            return Order.Length;
        }
    }

    internal enum PaletteRowKind { Section, Command, Media, Note }

    internal sealed class PaletteRow : IEquatable<PaletteRow>
    {
        public PaletteRowKind Kind;
        /// Section: a group's name, its count and the command kind or category that colours it ("recent" for the recent group).
        public string Title = "";
        public int Count;
        public string Colour = "";
        /// Command: its index in the full list. Media: its index in the media list. At: the matched range in its name.
        public int Index;
        public PaletteRange? At;
        /// Note: a line of text in place of results: nothing found, still reading, or an error.
        public string Text = "";

        public static PaletteRow Section(string title, int count, string colour) => new PaletteRow { Kind = PaletteRowKind.Section, Title = title, Count = count, Colour = colour };
        public static PaletteRow Command(int index, PaletteRange? at) => new PaletteRow { Kind = PaletteRowKind.Command, Index = index, At = at };
        public static PaletteRow Media(int index, PaletteRange? at) => new PaletteRow { Kind = PaletteRowKind.Media, Index = index, At = at };
        public static PaletteRow Note(string text) => new PaletteRow { Kind = PaletteRowKind.Note, Text = text };

        public bool Selectable => Kind == PaletteRowKind.Command || Kind == PaletteRowKind.Media;

        public bool Equals(PaletteRow? other) =>
            other != null && Kind == other.Kind && Title == other.Title && Count == other.Count && Colour == other.Colour &&
            Index == other.Index && Nullable.Equals(At, other.At) && Text == other.Text;
        public override bool Equals(object? obj) => Equals(obj as PaletteRow);
        public override int GetHashCode() => ((int)Kind * 397) ^ Index ^ Title.GetHashCode() ^ Text.GetHashCode();
    }

    internal struct PaletteMatch
    {
        public readonly int Score;
        public readonly PaletteRange? At;
        public PaletteMatch(int score, PaletteRange? at) { Score = score; At = at; }
    }

    internal static class PaletteSearch
    {
        private static string Trim(string text) => text.Trim(' ', '\t');

        /// How well `query` matches `name`, higher is better, null for no match, and the range to pick out.
        /// The whole query as one piece (start of the name > start of a word > anywhere) beats every word found apart.
        public static PaletteMatch? Match(string query, string name)
        {
            var q = Trim(query.ToLowerInvariant());
            if (q.Length == 0) return new PaletteMatch(0, null);
            var n = name.ToLowerInvariant();
            var start = n.IndexOf(q, StringComparison.Ordinal);
            if (start >= 0)
            {
                var range = new PaletteRange(start, start + q.Length);
                if (start == 0) return new PaletteMatch(n.Length == q.Length ? 1000 : 900 - Math.Min(n.Length, 200), range);
                var before = n[start - 1];
                if (!char.IsLetterOrDigit(before)) return new PaletteMatch(700 - Math.Min(start, 200), range);
                return new PaletteMatch(500 - Math.Min(start, 200), range);
            }
            var words = q.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            if (words.Length <= 1 || !words.All(w => n.IndexOf(w, StringComparison.Ordinal) >= 0)) return null;
            return new PaletteMatch(300 - Math.Min(n.Length, 200), null);
        }

        private struct Hit
        {
            public int Index, Score;
            public PaletteRange? At;
            public Hit(int index, int score, PaletteRange? at) { Index = index; Score = score; At = at; }
        }

        /// The Commands rows: with nothing typed, the recent ones first and then every group in full;
        /// with something typed, each group's matches, best first.
        public static List<PaletteRow> CommandRows(IList<PaletteEntry> entries, string query, IList<int>? recent = null)
        {
            var rows = new List<PaletteRow>();
            var typed = Trim(query).Length > 0;
            if (!typed && recent != null)
            {
                var shown = recent.Where(i => i >= 0 && i < entries.Count).ToList();
                if (shown.Count > 0)
                {
                    rows.Add(PaletteRow.Section("Recent", shown.Count, "recent"));
                    foreach (var i in shown) rows.Add(PaletteRow.Command(entries[i].Index, null));
                }
            }
            // Hit.Index here is the entry's own Index (its place in the full list), kept with the entry's order.
            var groups = new Dictionary<string, List<Hit>>(StringComparer.Ordinal);
            foreach (var e in entries)
            {
                // A command is found by its name, or by its kind's name ("transition" finds every transition).
                var m = Match(query, e.Name);
                if (m.HasValue) { Add(groups, e.Type, new Hit(e.Index, m.Value.Score, m.Value.At)); continue; }
                if (typed)
                {
                    var k = Match(query, PaletteKinds.Title(e.Type));
                    if (k.HasValue) Add(groups, e.Type, new Hit(e.Index, k.Value.Score - 600, null));
                }
            }
            var types = groups.Keys.ToList();
            types.Sort((a, b) =>
            {
                var byRank = PaletteKinds.Rank(a).CompareTo(PaletteKinds.Rank(b));
                return byRank != 0 ? byRank : string.CompareOrdinal(a, b);
            });
            foreach (var type in types)
            {
                var hits = groups[type];
                // Stable: OrderBy keeps the list order for ties, and the index breaks them anyway.
                if (typed) hits = hits.OrderByDescending(h => h.Score).ThenBy(h => h.Index).ToList();
                rows.Add(PaletteRow.Section(PaletteKinds.Title(type), hits.Count, type));
                foreach (var h in hits) rows.Add(PaletteRow.Command(h.Index, h.At));
            }
            if (rows.Count == 0) rows.Add(PaletteRow.Note(typed ? "No command is called that. Tab to look in Media." : "No commands yet."));
            return rows;
        }

        private static void Add(Dictionary<string, List<Hit>> groups, string type, Hit hit)
        {
            if (!groups.TryGetValue(type, out var list)) { list = new List<Hit>(); groups[type] = list; }
            list.Add(hit);
        }

        /// How many commands match (recent ones not counted twice).
        public static int CommandCount(IList<PaletteEntry> entries, string query) =>
            CommandRows(entries, query).Count(r => r.Kind == PaletteRowKind.Command);

        /// How many rows in `rows` can be chosen.
        public static int Count(IList<PaletteRow> rows) => rows.Count(r => r.Selectable);

        /// Sound shorter than this is SFX; this long or longer is ambience or music.
        public const double ShortSound = 45;

        /// The media tab an item belongs to besides Media: Video, Sfx, Bgm, or null.
        public static PaletteCategory? CategoryOf(PaletteMedia m)
        {
            switch (m.Kind)
            {
                case "video": return PaletteCategory.Video;
                case "sequence": return PaletteCategory.Sequences;
                case "audio":
                    if (!m.Seconds.HasValue) return null;
                    return m.Seconds.Value < ShortSound ? PaletteCategory.Sfx : PaletteCategory.Bgm;
                default: return null;
            }
        }

        /// Audio holds every sound, with or without a length; SFX and BGM only the sounds whose length Premiere gave.
        public static bool MediaIsIn(PaletteMedia m, PaletteCategory category) =>
            (category == PaletteCategory.Media && m.Kind != "sequence") || (category == PaletteCategory.Audio && m.Kind == "audio") || CategoryOf(m) == category;

        /// How many items a media tab holds.
        public static int MediaCount(IList<PaletteMedia> media, PaletteCategory category) => media.Count(m => MediaIsIn(m, category));

        /// The Media hits in `category`, best first: by name, then by the bins they sit in (lower).
        public static List<KeyValuePair<int, PaletteRange?>> MediaHits(IList<PaletteMedia> media, string query, PaletteCategory category = PaletteCategory.Media)
        {
            var hits = new List<Hit>();
            var typed = Trim(query).Length > 0;
            for (var i = 0; i < media.Count; i++)
            {
                if (!MediaIsIn(media[i], category)) continue;
                var s = Match(query, media[i].Name);
                if (s.HasValue) { hits.Add(new Hit(i, s.Value.Score, s.Value.At)); continue; }
                if (typed)
                {
                    var b = Match(query, media[i].Bin);
                    if (b.HasValue) hits.Add(new Hit(i, b.Value.Score - 600, null));
                }
            }
            hits.Sort((a, b) => a.Score != b.Score ? b.Score.CompareTo(a.Score) : NaturalCompare(media[a.Index].Name, media[b.Index].Name));
            return hits.Select(h => new KeyValuePair<int, PaletteRange?>(h.Index, h.At)).ToList();
        }

        /// The Media rows. `loading`: the list is being read from Premiere; `error`: it couldn't be.
        public static List<PaletteRow> MediaRows(IList<PaletteMedia> media, string query, bool loading, string? error, IList<string>? recent = null, PaletteCategory category = PaletteCategory.Media, int limit = 300)
        {
            if (media.Count == 0)
            {
                if (loading) return new List<PaletteRow> { PaletteRow.Note("Reading the project…") };
                if (!string.IsNullOrEmpty(error)) return new List<PaletteRow> { PaletteRow.Note(error!) };
                return new List<PaletteRow> { PaletteRow.Note("This project has no media to place.") };
            }
            var rows = new List<PaletteRow>();
            var typed = Trim(query).Length > 0;
            if (!typed && recent != null)
            {
                var shown = new List<int>();
                foreach (var id in recent)
                {
                    for (var i = 0; i < media.Count; i++) if (media[i].Id == id) { if (MediaIsIn(media[i], category)) shown.Add(i); break; }
                }
                if (shown.Count > 0)
                {
                    rows.Add(PaletteRow.Section(category == PaletteCategory.Sequences ? "Recently opened" : "Recently placed", shown.Count, "recent"));
                    foreach (var i in shown) rows.Add(PaletteRow.Media(i, null));
                }
            }
            var hits = MediaHits(media, query, category);
            if (hits.Count == 0) return new List<PaletteRow> { PaletteRow.Note(typed ? "Nothing in the project is called that." : EmptyNote(category)) };
            rows.Add(PaletteRow.Section(SectionTitle(category, typed), hits.Count, "media"));
            foreach (var h in hits.Take(limit)) rows.Add(PaletteRow.Media(h.Key, h.Value));
            if (hits.Count > limit) rows.Add(PaletteRow.Note((hits.Count - limit) + " more: type more of the name to narrow it down."));
            return rows;
        }

        /// The first selectable row at or after `from` going `step` (1 or -1), or null.
        public static int? Selectable(IList<PaletteRow> rows, int from, int step)
        {
            var i = from;
            while (i >= 0 && i < rows.Count)
            {
                if (rows[i].Selectable) return i;
                i += step;
            }
            return null;
        }

        /// Moving the choice by `delta` rows, skipping group names and notes, kept inside the list.
        public static int? Move(IList<PaletteRow> rows, int current, int delta)
        {
            var firstFound = Selectable(rows, 0, 1);
            if (!firstFound.HasValue) return null;
            var first = firstFound.Value;
            var last = Selectable(rows, rows.Count - 1, -1) ?? first;
            var target = current;
            var left = Math.Abs(delta);
            var step = delta < 0 ? -1 : 1;
            while (left > 0)
            {
                var next = Selectable(rows, target + step, step);
                if (!next.HasValue) break;
                target = next.Value;
                left -= 1;
            }
            var landed = target >= 0 && target < rows.Count && rows[target].Selectable ? target : first;
            return Math.Max(first, Math.Min(last, landed));
        }

        public static string SectionTitle(PaletteCategory category, bool typed)
        {
            switch (category)
            {
                case PaletteCategory.Video: return "Video";
                case PaletteCategory.Audio: return "Audio";
                case PaletteCategory.Sfx: return "SFX · under 45 s";
                case PaletteCategory.Bgm: return "Ambient and BGM · 45 s or longer";
                case PaletteCategory.Sequences: return "Sequences";
                default: return typed ? "In the project" : "All media";
            }
        }

        public static string EmptyNote(PaletteCategory category)
        {
            switch (category)
            {
                case PaletteCategory.Video: return "This project has no video.";
                case PaletteCategory.Audio: return "This project has no sound.";
                case PaletteCategory.Sfx: return "This project has no sound shorter than 45 seconds.";
                case PaletteCategory.Bgm: return "This project has no sound 45 seconds or longer.";
                case PaletteCategory.Sequences: return "This project has no sequences.";
                default: return "This project has no media to place.";
            }
        }

        /// A length: "0.4 s" under 10 seconds, "44 s" under a minute, then m:ss (h:mm:ss from an hour). Rounded down,
        /// so 44.6 s reads 44 s, like the SFX tab it's in.
        public static string Duration(double seconds)
        {
            var inv = System.Globalization.CultureInfo.InvariantCulture;
            if (seconds < 10) return (Math.Floor(Math.Max(0, seconds) * 10) / 10).ToString("0.0", inv) + " s";
            if (seconds < 60) return ((int)Math.Floor(seconds)).ToString(inv) + " s";
            var t = (int)Math.Floor(seconds);
            int h = t / 3600, m = (t % 3600) / 60, s = t % 60;
            return h > 0 ? string.Format(inv, "{0}:{1:00}:{2:00}", h, m, s) : string.Format(inv, "{0}:{1:00}", m, s);
        }

        /// The line under an item's name: a sound's length, then the bins it sits in.
        public static string WhereText(PaletteMedia m)
        {
            var bins = m.Bin.Length == 0 ? "Top of the project" : m.Bin;
            if (!m.Seconds.HasValue) return bins;
            return Duration(m.Seconds.Value) + "  ·  " + bins;
        }

        // Finder-like order, as Swift's localizedStandardCompare: case-insensitive, runs of digits by their value
        // ("Clip 2" before "Clip 10").
        public static int NaturalCompare(string a, string b)
        {
            int i = 0, j = 0;
            while (i < a.Length && j < b.Length)
            {
                if (char.IsDigit(a[i]) && char.IsDigit(b[j]))
                {
                    int si = i, sj = j;
                    while (i < a.Length && char.IsDigit(a[i])) i++;
                    while (j < b.Length && char.IsDigit(b[j])) j++;
                    var da = a.Substring(si, i - si).TrimStart('0');
                    var db = b.Substring(sj, j - sj).TrimStart('0');
                    if (da.Length != db.Length) return da.Length.CompareTo(db.Length);
                    var c = string.CompareOrdinal(da, db);
                    if (c != 0) return c;
                    continue;
                }
                var x = string.Compare(a[i].ToString(), b[j].ToString(), StringComparison.CurrentCultureIgnoreCase);
                if (x != 0) return x;
                i++; j++;
            }
            var rest = (a.Length - i).CompareTo(b.Length - j);
            return rest != 0 ? rest : string.Compare(a, b, StringComparison.Ordinal);
        }
    }
}
