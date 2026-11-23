import Foundation

// Drives PaletteSearch (native/PRFXPaletteSearch.swift) through the cases it must get right. Run:
// swiftc -module-cache-path /tmp/prfx-swift-module-cache native/PRFXPaletteSearch.swift tools/check-palette-search.swift -o /tmp/prfx-check-palette-search && /tmp/prfx-check-palette-search

nonisolated(unsafe) var failures = 0

func check(_ ok: Bool, _ what: String) {
    print((ok ? "ok    " : "FAIL  ") + what)
    if !ok { failures += 1 }
}

@main
enum PaletteSearchChecks {
static func main() {
    let entries = [
        PaletteEntry(type: "effect", name: "Gaussian Blur", index: 0),
        PaletteEntry(type: "transition", name: "Cross Dissolve", index: 1),
        PaletteEntry(type: "custom", name: "Ripple Delete Gaps", index: 2),
        PaletteEntry(type: "effect", name: "Directional Blur", index: 3),
        PaletteEntry(type: "audio-transition", name: "Constant Power", index: 4),
        PaletteEntry(type: "ai-function", name: "Cut silences", index: 5),
    ]

    // Matching
    check(PaletteSearch.match("blur", in: "Blur")!.score == 1000, "exact name scores highest")
    check(PaletteSearch.match("gau", in: "Gaussian Blur")!.score > PaletteSearch.match("blu", in: "Gaussian Blur")!.score, "start of name beats start of a word")
    check(PaletteSearch.match("blu", in: "Gaussian Blur")!.score > PaletteSearch.match("ssi", in: "Gaussian Blur")!.score, "start of a word beats the middle")
    check(PaletteSearch.match("blur gau", in: "Gaussian Blur") != nil, "every word found apart still matches")
    check(PaletteSearch.match("blur gau", in: "Gaussian Blur")!.at == nil, "words found apart pick nothing out")
    check(PaletteSearch.match("zzz", in: "Gaussian Blur") == nil, "no match is nil")
    check(PaletteSearch.match("BLUR", in: "Gaussian Blur")!.at == 9..<13, "case doesn't matter and the range is right")

    // Commands with nothing typed: groups in order, recent first
    let all = PaletteSearch.commandRows(entries, query: "", recent: [2])
    check(all.first == .section(title: "Recent", count: 1, colour: "recent"), "recent group comes first")
    let titles = all.compactMap { r -> String? in if case let .section(t, _, _) = r { return t }; return nil }
    check(titles == ["Recent", "AI functions", "Functions", "Effects", "Transitions", "Audio transitions"], "groups in their order: \(titles)")
    check(PaletteSearch.commandCount(entries, query: "") == 6, "count is every command, recent not counted twice")

    // Commands with a query
    let blur = PaletteSearch.commandRows(entries, query: "blur")
    check(blur == [.section(title: "Effects", count: 2, colour: "effect"), .command(index: 0, at: 9..<13), .command(index: 3, at: 12..<16)], "blur finds both blurs under Effects")
    let trans = PaletteSearch.commandRows(entries, query: "transition")
    check(PaletteSearch.count(trans) == 2, "a kind's name finds every command of it")
    check(PaletteSearch.commandRows(entries, query: "qqq") == [.note("No command is called that. Tab to look in Media.")], "nothing found says so and points at Tab")
    check(!PaletteSearch.commandRows(entries, query: "blur", recent: [2]).contains(.section(title: "Recent", count: 1, colour: "recent")), "no recent group while typing")

    // Media
    let media = [
        PaletteMedia(id: "1", name: "Interview_B.mov", bin: "Footage / Day 1", kind: "video", ext: "mov"),
        PaletteMedia(id: "2", name: "interview_A.mov", bin: "Footage / Day 1", kind: "video", ext: "mov"),
        PaletteMedia(id: "3", name: "Music bed.wav", bin: "", kind: "audio", ext: "wav"),
        PaletteMedia(id: "4", name: "Logo.png", bin: "Graphics", kind: "image", ext: "png"),
    ]
    let inter = PaletteSearch.mediaRows(media, query: "interview", loading: false, error: nil)
    check(inter == [.section(title: "In the project", count: 2, colour: "media"), .media(index: 1, at: 0..<9), .media(index: 0, at: 0..<9)], "equal matches sort by name, A before B")
    let byBin = PaletteSearch.mediaRows(media, query: "graphics", loading: false, error: nil)
    check(byBin == [.section(title: "In the project", count: 1, colour: "media"), .media(index: 3, at: nil)], "found by its bin")
    let name = PaletteSearch.mediaRows(media, query: "day", loading: false, error: nil)
    check(PaletteSearch.count(name) == 2, "bin matches count")
    let recentMedia = PaletteSearch.mediaRows(media, query: "", loading: false, error: nil, recent: ["3", "gone"])
    check(recentMedia.prefix(2) == [.section(title: "Recently placed", count: 1, colour: "recent"), .media(index: 2, at: nil)], "recently placed first, gone ones dropped")
    check(PaletteSearch.mediaRows([], query: "", loading: true, error: nil) == [.note("Reading the project…")], "loading says so")
    check(PaletteSearch.mediaRows([], query: "", loading: false, error: "Premiere isn't answering.") == [.note("Premiere isn't answering.")], "an error is shown")
    check(PaletteSearch.mediaRows([], query: "", loading: false, error: nil) == [.note("This project has no media to place.")], "empty project says so")
    check(PaletteSearch.mediaRows(media, query: "qqq", loading: false, error: nil) == [.note("Nothing in the project is called that.")], "nothing found says so")
    let many = (0..<350).map { PaletteMedia(id: "\($0)", name: "Clip \($0)", bin: "", kind: "video", ext: "mp4") }
    let capped = PaletteSearch.mediaRows(many, query: "clip", loading: false, error: nil)
    check(PaletteSearch.count(capped) == 300 && capped.last == .note("50 more: type more of the name to narrow it down."), "long lists stop at 300 and say how many more")
    check(PaletteSearch.whereText(media[2]) == "Top of the project", "no bin reads as the top of the project")

    // Video, SFX (sound under 45 s) and BGM (45 s or longer); Media is all of them
    let sounds = [
        PaletteMedia(id: "v", name: "Shot.mov", bin: "", kind: "video", ext: "mov"),
        PaletteMedia(id: "s", name: "Whoosh.wav", bin: "SFX", kind: "audio", ext: "wav", seconds: 44.6),
        PaletteMedia(id: "b", name: "Bed.mp3", bin: "", kind: "audio", ext: "mp3", seconds: 45),
        PaletteMedia(id: "u", name: "Unknown.wav", bin: "", kind: "audio", ext: "wav"),
        PaletteMedia(id: "i", name: "Logo.png", bin: "", kind: "image", ext: "png"),
    ]
    check(PaletteSearch.mediaCount(sounds, in: .media) == 5, "Media holds everything")
    check(PaletteSearch.mediaCount(sounds, in: .video) == 1, "Video holds video only")
    check(PaletteSearch.mediaCount(sounds, in: .sfx) == 1 && PaletteSearch.category(of: sounds[1]) == .sfx, "44.6 s is SFX")
    check(PaletteSearch.mediaCount(sounds, in: .bgm) == 1 && PaletteSearch.category(of: sounds[2]) == .bgm, "45 s is ambient or BGM")
    check(PaletteSearch.category(of: sounds[3]) == nil, "sound of unknown length is only under Media")
    check(PaletteSearch.mediaRows(sounds, query: "", loading: false, error: nil, in: .sfx) == [.section(title: "SFX · under 45 s", count: 1, colour: "media"), .media(index: 1, at: nil)], "the SFX tab lists its sound")
    check(PaletteSearch.mediaRows(sounds, query: "", loading: false, error: nil, recent: ["b", "s"], in: .sfx).prefix(2) == [.section(title: "Recently placed", count: 1, colour: "recent"), .media(index: 1, at: nil)], "recents are kept to the tab")
    check(PaletteSearch.mediaRows(sounds, query: "shot", loading: false, error: nil, in: .bgm) == [.note("Nothing in the project is called that.")], "a search stays in its tab")
    check(PaletteSearch.mediaRows([sounds[0]], query: "", loading: false, error: nil, in: .bgm) == [.note("This project has no sound 45 seconds or longer.")], "an empty tab says so")
    check(PaletteSearch.whereText(sounds[1]) == "44 s  ·  SFX" && PaletteSearch.duration(0.46) == "0.4 s" && PaletteSearch.duration(152.3) == "2:32" && PaletteSearch.duration(3725) == "1:02:05", "a sound shows its length")
    check(PaletteCategory.commands.next() == .media && PaletteCategory.bgm.next() == .commands && PaletteCategory.commands.previous() == .bgm, "Tab goes round the tabs, Shift+Tab back")
    let decoded = try! JSONDecoder().decode(PaletteMediaList.self, from: Data(#"{"items":[{"id":"1","name":"a","bin":"","kind":"audio","ext":"wav","seconds":3.5},{"id":"2","name":"b","bin":"","kind":"video","ext":"mov"}]}"#.utf8))
    check(decoded.items[0].seconds == 3.5 && decoded.items[1].seconds == nil, "seconds is read when sent and optional")

    // Moving skips group names and notes and stays inside
    let rows: [PaletteRow] = [.section(title: "A", count: 2, colour: "x"), .command(index: 0, at: nil), .command(index: 1, at: nil),
                              .section(title: "B", count: 1, colour: "y"), .command(index: 2, at: nil), .note("n")]
    check(PaletteSearch.selectable(rows, from: 0, step: 1) == 1, "first choosable row skips the group name")
    check(PaletteSearch.move(rows, from: 2, by: 1) == 4, "down skips a group name")
    check(PaletteSearch.move(rows, from: 4, by: -1) == 2, "up skips a group name")
    check(PaletteSearch.move(rows, from: 4, by: 1) == 4, "down stops at the last")
    check(PaletteSearch.move(rows, from: 1, by: -1) == 1, "up stops at the first")
    check(PaletteSearch.move(rows, from: 1, by: 10) == 4, "page down lands on the last")
    check(PaletteSearch.move([.note("x")], from: 0, by: 1) == nil, "nothing to choose is nil")

    // The engine's payload decodes
    let json = #"{"project":"Edit","total":1,"items":[{"id":"000f4","name":"A.mov","bin":"","kind":"video","ext":"mov"}]}"#
    let list = try? JSONDecoder().decode(PaletteMediaList.self, from: Data(json.utf8))
    check(list?.items.first?.id == "000f4" && list?.error == nil, "media list decodes")

    print(failures == 0 ? "\nAll palette search checks pass." : "\n\(failures) failed.")
    exit(failures == 0 ? 0 : 1)
}
}
