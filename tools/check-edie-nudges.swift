import Foundation

// Drives EdieNudges (native/PRFXEdieNudges.swift) through the cases it must
// get right. Run:
// swiftc -module-cache-path /tmp/prfx-swift-module-cache native/PRFXEdieNudges.swift tools/check-edie-nudges.swift -o /tmp/prfx-check-edie-nudges && /tmp/prfx-check-edie-nudges

nonisolated(unsafe) var failures = 0

func check(_ ok: Bool, _ what: String) {
    print((ok ? "ok    " : "FAIL  ") + what)
    if !ok { failures += 1 }
}

// Simulates the 5×/s tick: idle grows from `from` for `seconds`.
func run(_ n: inout EdieNudges, from: TimeInterval, seconds: TimeInterval, start: TimeInterval,
         eligible: Bool = true, last: (name: String, at: TimeInterval)? = nil) -> [EdieNudges.Line] {
    var said: [EdieNudges.Line] = []
    var t: TimeInterval = 0
    while t <= seconds {
        if let line = n.tick(idle: from + t, eligible: eligible, now: start + t, last: last).line { said.append(line) }
        t += 0.2
    }
    return said
}

@main
enum EdieNudgeChecks {
static func main() {
do {
    var n = EdieNudges()
    let said = run(&n, from: 0, seconds: 119, start: 0)
    check(said.isEmpty, "quiet under 2 min: nothing")
}
do {
    var n = EdieNudges()
    let said = run(&n, from: 0, seconds: 250, start: 0)
    check(said.count == 1 && said[0].kind == .stillThere, "2 min quiet: one still-there line, once per stretch")
}
do {
    var n = EdieNudges()
    _ = run(&n, from: 0, seconds: 130, start: 0)
    // Input, then quiet again: a new stretch may nudge again.
    let again = run(&n, from: 0, seconds: 130, start: 131)
    check(again.count == 1, "a new quiet stretch after input nudges again")
}
do {
    var n = EdieNudges()
    let said = run(&n, from: 0, seconds: 250, start: 0, eligible: false)
    check(said.isEmpty, "Premiere behind / no live region / palette open: nothing")
}
do {
    var n = EdieNudges()
    _ = run(&n, from: 0, seconds: 600, start: 0, last: ("Ripple Delete", -30))
    // Back: input at 600 s.
    let back = n.tick(idle: 0.1, eligible: true, now: 600.2, last: ("Ripple Delete", -30))
    check(back.resumed && back.line?.kind == .welcomeBack, "back after 10 min: welcome line at once")
    check(back.line?.text.contains("Ripple Delete") == true, "welcome names the last command: \(back.line?.text ?? "-")")
    let next = run(&n, from: 0.1, seconds: 10, start: 600.4)
    check(next.isEmpty, "welcome said once")
}
do {
    var n = EdieNudges()
    _ = run(&n, from: 0, seconds: 600, start: 0)
    // Back, but in another app; Premiere comes in front 2 s later.
    let away = n.tick(idle: 0.1, eligible: false, now: 600.2, last: nil)
    check(away.line == nil, "back in another app: no bubble")
    let later = n.tick(idle: 0.1, eligible: true, now: 602.2, last: nil)
    check(later.line?.kind == .welcomeBack, "Premiere in front within 4 s: welcome")
    var m = EdieNudges()
    _ = run(&m, from: 0, seconds: 600, start: 0)
    _ = m.tick(idle: 0.1, eligible: false, now: 600.2, last: nil)
    let tooLate = m.tick(idle: 5, eligible: true, now: 605.2, last: nil)
    check(tooLate.line == nil, "Premiere in front after 4 s: no stale welcome")
}
do {
    var n = EdieNudges()
    _ = run(&n, from: 0, seconds: 200, start: 0)
    let back = n.tick(idle: 0.1, eligible: true, now: 200.2, last: nil)
    check(back.resumed && back.line == nil, "back after 3 min (under 5): no welcome")
}
do {
    var n = EdieNudges()
    n.nudgeAfter = 600
    check(n.awayAfter == 1500, "away threshold follows a long nudge time (2.5×)")
    let said = run(&n, from: 0, seconds: 599, start: 0)
    check(said.isEmpty, "custom 10 min: nothing at 9:59")
}
do {
    // Every line is a heading and a detail, no dashes joining them (the user, 2026-11-20).
    var lines: [EdieNudges.Line] = []
    for withName in [true, false] {
        for i in 0..<6 {
            var n = EdieNudges()
            let last: (name: String, at: TimeInterval)? = withName ? ("Ripple Delete", -30) : nil
            for _ in 0..<i { _ = run(&n, from: 0, seconds: 130, start: 0, last: last) }
            lines += run(&n, from: 0, seconds: 130, start: 0, last: last)
            _ = run(&n, from: 0, seconds: 600, start: 0, last: last)
            if let back = n.tick(idle: 0.1, eligible: true, now: 600.2, last: last).line { lines.append(back) }
        }
    }
    check(!lines.isEmpty && lines.allSatisfy { !$0.title.isEmpty && !$0.detail.isEmpty }, "every line has a heading and a detail")
    let dashes = lines.filter { ($0.title + $0.detail).contains { "-–—".contains($0) } }
    check(dashes.isEmpty, "no dashes in what he says: \(dashes.first.map { $0.text } ?? "none")")
}
check(EdieNudges.span(59) == "1 min" && EdieNudges.span(14 * 60) == "14 min" && EdieNudges.span(3900) == "1 hr 5 min", "spans read plainly")
check(EdieNudges.short(String(repeating: "x", count: 50)).count == 30, "long names are cut to 30")

print(failures == 0 ? "All Edie nudge checks passed" : "\(failures) failed")
exit(failures == 0 ? 0 : 1)
}
}
