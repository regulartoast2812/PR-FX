import Foundation

// The Ctrl+Space palette's search, laid out like Sage's vault search in Creative Assist (2026-11-23, the user:
// "both UI should be revamp to be formated like sage's ctrl space search and then add a function when i hit tab to
// look for media name. and entering after finding the file and pressing enter would place it in the timeline").
// Tabs you move between with Tab and Shift+Tab, each with its count: Commands (grouped by kind, each group with its
// own colour and count), Media (every placeable item in the Premiere project, by name, with the bins it sits in), and
// Video, SFX and BGM, parts of Media. Pure: no AppKit, so tools/check-palette-search.swift checks it, and native/windows/Core/
// PaletteSearch.cs ports it line for line.

// The media tabs (2026-11-23, the user: "we need to add more categories, like video, sfx for audio under 45s, anything
// over 45s should be ambient or bgm"): Media is everything; Video, SFX (sound under 45 seconds) and BGM (sound 45 seconds
// or longer, ambience or music) are parts of it. Sound whose length Premiere didn't give is only under Media.
// Sequences (2026-11-23, the user: "add sequences to the search tab") are the project's sequences: Enter opens one, so
// they are not in Media, which holds what Enter places.
enum PaletteCategory: String, CaseIterable {
    case commands, media, video, audio, sfx, bgm, sequences
    var label: String {
        switch self {
        case .commands: return "Commands"
        case .media: return "Media"
        case .video: return "Video"
        case .audio: return "Audio"
        case .sfx: return "SFX"
        case .bgm: return "BGM"
        case .sequences: return "Sequences"
        }
    }
    var isMedia: Bool { self != .commands }
    func next() -> PaletteCategory { step(1) }
    func previous() -> PaletteCategory { step(-1) }
    private func step(_ by: Int) -> PaletteCategory {
        let all = PaletteCategory.allCases
        return all[(all.firstIndex(of: self)! + by + all.count) % all.count]
    }
}

/// One item from the host's `prfx.listProjectMedia()`.
struct PaletteMedia: Codable, Equatable {
    let id: String
    let name: String
    let bin: String
    let kind: String   // video, audio, image, sequence or other (graphics, mattes, adjustment layers)
    let ext: String
    /// How long a sound is, in seconds (from its in to its out point); nil for pictures and video.
    var seconds: Double? = nil
}

/// What the engine POSTs to /media.
struct PaletteMediaList: Codable {
    let project: String?
    let total: Int?
    /// How many items are sound, and how many of those came with a length (only those fill SFX and BGM).
    var audio: Int? = nil
    var timed: Int? = nil
    /// What the host saw, for the log: "kind:extension" → count, and its build.
    var kinds: [String: Int]? = nil
    var host: String? = nil
    let items: [PaletteMedia]
    let error: String?
}

/// A command as the search sees it: its name, its kind, and where it sits in the full list.
struct PaletteEntry {
    let type: String
    let name: String
    let index: Int
}

/// The command kinds, in the order their groups are shown, with the name of each group.
enum PaletteKinds {
    static let order: [(type: String, title: String)] = [
        ("ai-function", "AI functions"),
        ("custom", "Functions"),
        ("effect", "Effects"),
        ("audio-effect", "Audio effects"),
        ("transition", "Transitions"),
        ("audio-transition", "Audio transitions"),
        ("preset", "Presets"),
    ]
    static func title(_ type: String) -> String {
        order.first { $0.type == type }?.title ?? (type.prefix(1).uppercased() + type.dropFirst().replacingOccurrences(of: "-", with: " ") + "s")
    }
    static func rank(_ type: String) -> Int { order.firstIndex { $0.type == type } ?? order.count }
}

enum PaletteRow: Equatable {
    /// A group's name, its count and the command kind or category that colours it ("recent" for the recent group).
    case section(title: String, count: Int, colour: String)
    /// A command, by its index in the full list; `at` is the matched range in its name.
    case command(index: Int, at: Range<Int>?)
    /// A media item, by its index in the media list.
    case media(index: Int, at: Range<Int>?)
    /// A line of text in place of results: nothing found, still reading, or an error.
    case note(String)

    var selectable: Bool {
        switch self { case .command, .media: return true; default: return false }
    }
}

enum PaletteSearch {
    /// How well `query` matches `name`, higher is better, nil for no match, and the range to pick out.
    /// The whole query as one piece (start of the name > start of a word > anywhere) beats every word found apart.
    static func match(_ query: String, in name: String) -> (score: Int, at: Range<Int>?)? {
        let q = query.lowercased().trimmingCharacters(in: .whitespaces)
        if q.isEmpty { return (0, nil) }
        let n = name.lowercased()
        if let r = n.range(of: q) {
            let start = n.distance(from: n.startIndex, to: r.lowerBound)
            let range = start..<(start + q.count)
            if start == 0 { return (n.count == q.count ? 1000 : 900 - min(n.count, 200), range) }
            let before = n[n.index(before: r.lowerBound)]
            if !before.isLetter && !before.isNumber { return (700 - min(start, 200), range) }
            return (500 - min(start, 200), range)
        }
        let words = q.split(whereSeparator: { $0 == " " }).map(String.init)
        guard words.count > 1, words.allSatisfy({ n.contains($0) }) else { return nil }
        return (300 - min(n.count, 200), nil)
    }

    /// The Commands rows: with nothing typed, the recent ones first and then every group in full;
    /// with something typed, each group's matches, best first.
    static func commandRows(_ entries: [PaletteEntry], query: String, recent: [Int] = []) -> [PaletteRow] {
        var rows: [PaletteRow] = []
        let typed = !query.trimmingCharacters(in: .whitespaces).isEmpty
        if !typed {
            let shown = recent.filter { entries.indices.contains($0) }
            if !shown.isEmpty {
                rows.append(.section(title: "Recent", count: shown.count, colour: "recent"))
                rows += shown.map { .command(index: entries[$0].index, at: nil) }
            }
        }
        var groups: [String: [(entry: PaletteEntry, score: Int, at: Range<Int>?)]] = [:]
        for e in entries {
            // A command is found by its name, or by its kind's name ("transition" finds every transition).
            if let m = match(query, in: e.name) { groups[e.type, default: []].append((e, m.score, m.at)); continue }
            if typed, let m = match(query, in: PaletteKinds.title(e.type)) { groups[e.type, default: []].append((e, m.score - 600, nil)) }
        }
        for type in groups.keys.sorted(by: { (PaletteKinds.rank($0), $0) < (PaletteKinds.rank($1), $1) }) {
            var hits = groups[type]!
            if typed { hits.sort { $0.score != $1.score ? $0.score > $1.score : $0.entry.index < $1.entry.index } }
            rows.append(.section(title: PaletteKinds.title(type), count: hits.count, colour: type))
            rows += hits.map { .command(index: $0.entry.index, at: $0.at) }
        }
        if rows.isEmpty { rows.append(.note(typed ? "No command is called that. Tab to look in Media." : "No commands yet.")) }
        return rows
    }

    /// How many commands match (recent ones not counted twice).
    static func commandCount(_ entries: [PaletteEntry], query: String) -> Int {
        commandRows(entries, query: query).reduce(0) { n, r in if case .command = r { return n + 1 }; return n }
    }

    /// How many rows in `rows` can be chosen.
    static func count(_ rows: [PaletteRow]) -> Int { rows.filter { $0.selectable }.count }

    /// Sound shorter than this is SFX; this long or longer is ambience or music.
    static let shortSound: Double = 45

    /// The media tab an item belongs to besides Media: .video, .sfx, .bgm, or nil.
    static func category(of m: PaletteMedia) -> PaletteCategory? {
        switch m.kind {
        case "video": return .video
        case "sequence": return .sequences
        case "audio":
            guard let s = m.seconds else { return nil }
            return s < shortSound ? .sfx : .bgm
        default: return nil
        }
    }

    /// Audio holds every sound, with or without a length; SFX and BGM only the sounds whose length Premiere gave.
    static func media(_ m: PaletteMedia, isIn category: PaletteCategory) -> Bool {
        (category == .media && m.kind != "sequence") || (category == .audio && m.kind == "audio") || self.category(of: m) == category
    }

    /// How many items a media tab holds.
    static func mediaCount(_ media: [PaletteMedia], in category: PaletteCategory) -> Int {
        media.filter { self.media($0, isIn: category) }.count
    }

    /// The Media hits in `category`, best first: by name, then by the bins they sit in (lower).
    static func mediaHits(_ media: [PaletteMedia], query: String, in category: PaletteCategory = .media) -> [(index: Int, at: Range<Int>?)] {
        var hits: [(index: Int, score: Int, at: Range<Int>?)] = []
        for (i, m) in media.enumerated() where self.media(m, isIn: category) {
            if let s = match(query, in: m.name) { hits.append((i, s.score, s.at)); continue }
            if !query.trimmingCharacters(in: .whitespaces).isEmpty, let s = match(query, in: m.bin) { hits.append((i, s.score - 600, nil)) }
        }
        hits.sort { $0.score != $1.score ? $0.score > $1.score : media[$0.index].name.localizedStandardCompare(media[$1.index].name) == .orderedAscending }
        return hits.map { ($0.index, $0.at) }
    }

    /// The Media rows. `loading`: the list is being read from Premiere; `error`: it couldn't be.
    static func mediaRows(_ media: [PaletteMedia], query: String, loading: Bool, error: String?, recent: [String] = [], in category: PaletteCategory = .media, limit: Int = 300) -> [PaletteRow] {
        if media.isEmpty {
            if loading { return [.note("Reading the project…")] }
            if let error, !error.isEmpty { return [.note(error)] }
            return [.note("This project has no media to place.")]
        }
        var rows: [PaletteRow] = []
        let typed = !query.trimmingCharacters(in: .whitespaces).isEmpty
        if !typed {
            let shown = recent.compactMap { id in media.firstIndex { $0.id == id } }.filter { self.media(media[$0], isIn: category) }
            if !shown.isEmpty {
                rows.append(.section(title: category == .sequences ? "Recently opened" : "Recently placed", count: shown.count, colour: "recent"))
                rows += shown.map { .media(index: $0, at: nil) }
            }
        }
        let hits = mediaHits(media, query: query, in: category)
        if hits.isEmpty { return [.note(typed ? "Nothing in the project is called that." : emptyNote(category))] }
        rows.append(.section(title: sectionTitle(category, typed: typed), count: hits.count, colour: "media"))
        rows += hits.prefix(limit).map { .media(index: $0.index, at: $0.at) }
        if hits.count > limit { rows.append(.note("\(hits.count - limit) more: type more of the name to narrow it down.")) }
        return rows
    }

    /// The first selectable row at or after `from` going `step` (1 or -1), or nil.
    static func selectable(_ rows: [PaletteRow], from: Int, step: Int) -> Int? {
        var i = from
        while rows.indices.contains(i) {
            if rows[i].selectable { return i }
            i += step
        }
        return nil
    }

    /// Moving the choice by `delta` rows, skipping group names and notes, kept inside the list.
    static func move(_ rows: [PaletteRow], from current: Int, by delta: Int) -> Int? {
        guard let first = selectable(rows, from: 0, step: 1) else { return nil }
        let last = selectable(rows, from: rows.count - 1, step: -1) ?? first
        var target = current
        var left = abs(delta)
        let step = delta < 0 ? -1 : 1
        while left > 0, let next = selectable(rows, from: target + step, step: step) { target = next; left -= 1 }
        return max(first, min(last, rows.indices.contains(target) && rows[target].selectable ? target : first))
    }

    static func sectionTitle(_ category: PaletteCategory, typed: Bool) -> String {
        switch category {
        case .video: return "Video"
        case .audio: return "Audio"
        case .sfx: return "SFX · under 45 s"
        case .bgm: return "Ambient and BGM · 45 s or longer"
        case .sequences: return "Sequences"
        default: return typed ? "In the project" : "All media"
        }
    }

    static func emptyNote(_ category: PaletteCategory) -> String {
        switch category {
        case .video: return "This project has no video."
        case .audio: return "This project has no sound."
        case .sfx: return "This project has no sound shorter than 45 seconds."
        case .bgm: return "This project has no sound 45 seconds or longer."
        case .sequences: return "This project has no sequences."
        default: return "This project has no media to place."
        }
    }

    /// A length: "0.4 s" under 10 seconds, "44 s" under a minute, then m:ss (h:mm:ss from an hour). Rounded down,
    /// so 44.6 s reads 44 s, like the SFX tab it's in.
    static func duration(_ seconds: Double) -> String {
        if seconds < 10 { return String(format: "%.1f s", (max(0, seconds) * 10).rounded(.down) / 10) }
        if seconds < 60 { return "\(Int(seconds.rounded(.down))) s" }
        let t = Int(seconds.rounded(.down))
        let h = t / 3600, m = (t % 3600) / 60, s = t % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }

    /// The line under an item's name: a sound's length, then the bins it sits in.
    static func whereText(_ m: PaletteMedia) -> String {
        let bins = m.bin.isEmpty ? "Top of the project" : m.bin
        guard let s = m.seconds else { return bins }
        return duration(s) + "  ·  " + bins
    }
}
