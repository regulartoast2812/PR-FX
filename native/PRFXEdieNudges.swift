import Foundation

// Edie's nudges (2026-11-20): when the editor has gone quiet in Premiere for a
// while (thinking, or away from the desk), Edie says one short line in a speech
// bubble beside him on the Timeline highlight, to pull attention back.
//
//   still there   no input at all for `nudgeAfter` (default 2 min) while
//                 Premiere is in front with a live region drawn. Once per
//                 quiet stretch; gone at the next input or after 9 s.
//   welcome back  input resumes after `awayAfter` or more of nothing
//                 (5 min, or 2.5× nudgeAfter if longer). Shown within 4 s of
//                 the return, as soon as Premiere is in front again; 6 s.
//
// Pure logic, no AppKit: tools/check-edie-nudges.swift drives it.

struct EdieNudges {
    enum Kind: Equatable { case stillThere, welcomeBack }
    // Two lines in the bubble (2026-11-20, the user): a short heading, then
    // the detail under it, lighter. No dashes joining them.
    struct Line: Equatable {
        var kind: Kind
        var title: String
        var detail: String
        var text: String { "\(title)\n\(detail)" }
    }

    var nudgeAfter: TimeInterval = 120
    var awayAfter: TimeInterval { max(300, nudgeAfter * 2.5) }
    static let welcomeWindow: TimeInterval = 4

    private var lastIdle: TimeInterval = 0
    private var nudged = false
    private var pendingWelcome: (away: TimeInterval, until: TimeInterval)?
    private var said = 0

    // Called five times a second. `idle` is the seconds since any input (a
    // cheap CGEventSource read); `eligible` is: setting on, Premiere in front,
    // a live region drawn, palette closed. `last` is the last command run.
    // Returns whether input arrived since the previous call and, at most once
    // per quiet stretch, a line to say.
    mutating func tick(idle: TimeInterval, eligible: Bool, now: TimeInterval,
                       last: (name: String, at: TimeInterval)?) -> (resumed: Bool, line: Line?) {
        let resumed = idle < lastIdle
        if resumed {
            if lastIdle >= awayAfter { pendingWelcome = (lastIdle, now + Self.welcomeWindow) }
            nudged = false
        }
        lastIdle = idle
        if let pending = pendingWelcome {
            if now > pending.until {
                pendingWelcome = nil
            } else if eligible {
                pendingWelcome = nil
                // A command run while away (from the chat, say) is still "where we were".
                return (resumed, line(.welcomeBack, welcomeLine(away: pending.away, last: last, now: now)))
            }
        }
        // Not into an empty room: past `awayAfter` the welcome does the job.
        if !nudged, eligible, idle >= nudgeAfter, idle < awayAfter {
            nudged = true
            return (resumed, line(.stillThere, stillThereLine(idle: idle, last: last, now: now)))
        }
        return (resumed, nil)
    }

    private func line(_ kind: Kind, _ said: (String, String)) -> Line {
        Line(kind: kind, title: said.0, detail: said.1)
    }

    private mutating func pick(_ lines: [(String, String)]) -> (String, String) {
        defer { said += 1 }
        return lines[said % lines.count]
    }

    // With a command to go on he names it (that's what gets you back in);
    // without one, a plain line. Each set rotates so he doesn't repeat himself.
    private mutating func stillThereLine(idle: TimeInterval, last: (name: String, at: TimeInterval)?, now: TimeInterval) -> (String, String) {
        if let last, now - last.at < 4 * 3600 {
            let name = Self.short(last.name)
            return pick([
                ("Still with me?", "We left off at \(name)."),
                ("Lost in thought?", "Last thing was \(name)."),
                ("Take your time.", "\(name) was \(Self.span(now - last.at)) ago."),
            ])
        }
        return pick([
            ("Still with me?", "Take your time."),
            ("Lost in thought?", "I’m right here."),
            ("Quiet a while.", "Ready to pick it back up?"),
        ])
    }

    private mutating func welcomeLine(away: TimeInterval, last: (name: String, at: TimeInterval)?, now: TimeInterval) -> (String, String) {
        if let last, now - last.at < 12 * 3600 {
            let name = Self.short(last.name)
            return pick([
                ("Welcome back!", "You were on \(name)."),
                ("You’re back!", "Last thing was \(name), \(Self.span(now - last.at)) ago."),
            ])
        }
        return pick([
            ("Welcome back!", "You were away \(Self.span(away))."),
            ("Hey, you’re back.", "Ready when you are."),
        ])
    }

    static func span(_ seconds: TimeInterval) -> String {
        let minutes = max(1, Int((seconds / 60).rounded()))
        if minutes < 60 { return "\(minutes) min" }
        let hours = minutes / 60, rest = minutes % 60
        return rest == 0 ? "\(hours) hr" : "\(hours) hr \(rest) min"
    }

    static func short(_ name: String) -> String {
        name.count <= 30 ? name : String(name.prefix(29)).trimmingCharacters(in: .whitespaces) + "…"
    }
}
