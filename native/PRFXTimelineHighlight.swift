import AppKit

// The Timeline highlight (2026-11-19): shows, over Premiere, the exact region
// the listener judges every keystroke against, so the editor can see at a
// glance whether a shortcut is going to fire. Same technique as Edit Assist's
// inspection panel: a borderless, non-activating, click-through NSPanel at
// screen-saver level, laid over the Premiere window.
//
// No fill: a thin orange stroke laid over Premiere's own blue panel border, and
// Edie sitting on its top-right corner.
//   armed       full orange, Edie awake (blinks now and then)
//   not armed   faded orange, Edie dozing, and a short note saying why
//   key fired   the stroke pulses brighter, Edie grins
//   key passed  the stroke pulses red, Edie startles
//
// Everything here is in Accessibility coordinates (top-left origin of the
// primary screen), the same space the listener stores regions in.

struct TimelineHighlightState: Equatable {
    var window: CGRect
    var live: CGRect?
    var saved: CGRect?
    var click: CGPoint?
    var armed: Bool
    var reason: String
    // Other apps' windows in front of Premiere: nothing is drawn over them.
    var covers: [CGRect] = []
}

final class TimelineHighlight {
    private var panel: NSPanel?
    private var view: TimelineHighlightView?
    // Room above the window for Edie when the Timeline is docked at its top.
    static let headroom: CGFloat = 44
    private var workingTimer: Timer?

    func update(_ state: TimelineHighlightState?) {
        guard let state, state.window.width > 40, state.window.height > 40 else {
            hide()
            return
        }
        // `open -gj` (start-listener-macos.sh) launches the listener hidden, and a
        // hidden app shows no windows at all. Unhide without taking focus.
        if NSApp.isHidden { NSApp.unhideWithoutActivation() }
        let panel = self.panel ?? makePanel()
        let area = CGRect(x: state.window.minX, y: state.window.minY - Self.headroom,
                          width: state.window.width, height: state.window.height + Self.headroom)
        let primaryHeight = NSScreen.screens.first?.frame.height ?? area.maxY
        let placed = NSRect(x: area.minX, y: primaryHeight - area.maxY, width: area.width, height: area.height)
        if panel.frame != placed { panel.setFrame(placed, display: false) }
        guard let view else { return }
        // A blink for one refresh (0.2 s) in every twenty.
        let blink = Int(Date().timeIntervalSince1970 / 0.2) % 20 == 0
        // Now and then (two swings every eleven seconds) he swings a leg: out, out, still, back, back, still.
        let tick = Int(Date().timeIntervalSince1970 / 0.2) % 55
        let swing = tick < 12 ? [1, 1, 0, -1, -1, 0][tick % 6] : 0
        if view.state != state || view.area != area || view.blink != blink || view.swing != swing {
            view.state = state
            view.area = area
            view.blink = blink
            view.swing = swing
            view.needsDisplay = true
        }
        if !panel.isVisible {
            panel.orderFrontRegardless()
            listenerLog("Timeline highlight shown over \(NSStringFromRect(placed)) visible=\(panel.isVisible)")
        }
    }

    func flash(fired: Bool) {
        guard panel?.isVisible == true else { return }
        view?.flash(fired: fired)
    }

    func startWorking(_ name: String) {
        view?.workingName = name
        view?.workingStarted = Date()
        view?.needsDisplay = true
        workingTimer?.invalidate()
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in self?.view?.needsDisplay = true }
        workingTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    func stopWorking() {
        workingTimer?.invalidate()
        workingTimer = nil
        view?.workingName = nil
        view?.needsDisplay = true
    }

    // Drawn and on screen (it only ever draws a live region).
    var isShowing: Bool { panel?.isVisible == true }
    var isSpeaking: Bool { view?.speech != nil }
    private var speechTimer: Timer?

    // Edie's nudges (PRFXEdieNudges.swift): one line in a bubble beside him.
    // Never takes focus or clicks: it's drawn in this click-through panel.
    func say(_ title: String, _ detail: String, for duration: TimeInterval) {
        guard let view, isShowing else { return }
        view.speech = TimelineHighlightView.Speech(title: title, detail: detail, started: Date(), duration: duration)
        view.needsDisplay = true
        speechTimer?.invalidate()
        // Ten frames a second for the fade and his wave, only while he speaks.
        let timer = Timer(timeInterval: 0.1, repeats: true) { [weak self] timer in
            guard let self, let view = self.view, let speech = view.speech else { timer.invalidate(); return }
            if Date().timeIntervalSince(speech.started) >= speech.duration {
                view.speech = nil
                timer.invalidate()
                self.speechTimer = nil
            }
            view.needsDisplay = true
        }
        speechTimer = timer
        RunLoop.main.add(timer, forMode: .common)
        listenerLog("Edie says: \(title) / \(detail)")
    }

    // Fades the bubble out now (input arrived), over a third of a second.
    func hush() {
        guard let view, let speech = view.speech else { return }
        let elapsed = Date().timeIntervalSince(speech.started)
        guard speech.duration - elapsed > TimelineHighlightView.Speech.fadeOut else { return }
        view.speech?.duration = elapsed + TimelineHighlightView.Speech.fadeOut
    }

    func hide() {
        if view?.speech != nil {
            speechTimer?.invalidate()
            speechTimer = nil
            view?.speech = nil
        }
        guard panel?.isVisible == true else { return }
        panel?.orderOut(nil)
        listenerLog("Timeline highlight hidden")
    }

    private func makePanel() -> NSPanel {
        let created = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        created.isOpaque = false
        created.backgroundColor = .clear
        created.hasShadow = false
        created.level = .screenSaver
        created.ignoresMouseEvents = true
        created.hidesOnDeactivate = false
        created.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle, .stationary]
        created.isReleasedWhenClosed = false
        created.animationBehavior = .none
        let content = TimelineHighlightView(frame: .zero)
        created.contentView = content
        panel = created
        view = content
        return created
    }
}

final class TimelineHighlightView: NSView {
    var state: TimelineHighlightState?
    var area: CGRect = .zero
    var blink = false
    var swing = 0
    var workingName: String?
    var workingStarted = Date()
    // What Edie is saying, if anything (TimelineHighlight.say).
    struct Speech {
        var title: String
        var detail: String
        var started: Date
        var duration: TimeInterval
        static let fadeIn: TimeInterval = 0.2
        static let fadeOut: TimeInterval = 0.4
        // He talks (mouth and wave) this long, then listens, awake.
        static let talking: TimeInterval = 1.6
    }
    var speech: Speech?
    private var flashFired = true
    private var flashStarted = Date.distantPast
    private var flashTimer: Timer?
    private static let flashDuration: TimeInterval = 0.5
    private static let orange = NSColor(srgbRed: 1.0, green: 0.60, blue: 0.24, alpha: 1)
    private static let pixel: CGFloat = 2

    override var isFlipped: Bool { true }

    func flash(fired: Bool) {
        flashFired = fired
        flashStarted = Date()
        flashTimer?.invalidate()
        let timer = Timer(timeInterval: 1.0 / 30.0, repeats: true) { [weak self] timer in
            guard let self else { timer.invalidate(); return }
            if Date().timeIntervalSince(self.flashStarted) > Self.flashDuration { timer.invalidate() }
            self.needsDisplay = true
        }
        flashTimer = timer
        RunLoop.main.add(timer, forMode: .common)
        needsDisplay = true
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let state else { return }
        func local(_ r: CGRect) -> NSRect { NSRect(x: r.minX - area.minX, y: r.minY - area.minY, width: r.width, height: r.height) }
        drawHighlight(state, local: local)
        // Then clear wherever another app's window is in front of Premiere, so the
        // stroke, Edie and the note stay on Premiere (rounded like a window's corners).
        guard !state.covers.isEmpty, let context = NSGraphicsContext.current else { return }
        context.saveGraphicsState()
        context.compositingOperation = .clear
        for cover in state.covers {
            NSBezierPath(roundedRect: local(cover), xRadius: 12, yRadius: 12).fill()
        }
        context.restoreGraphicsState()
    }

    private func drawHighlight(_ state: TimelineHighlightState, local: (CGRect) -> NSRect) {
        let since = Date().timeIntervalSince(flashStarted)
        let pulse = since < Self.flashDuration ? CGFloat(1 - since / Self.flashDuration) : 0

        guard let region = state.live ?? state.saved else {
            drawNote("Edie can’t find the Timeline", rightEdge: bounds.maxX - 12, midY: TimelineHighlight.headroom + 24)
            return
        }
        // Premiere's own border is a 1pt line on the panel's edge; this covers it.
        let rect = local(region).insetBy(dx: 1, dy: 1)
        var color = Self.orange.withAlphaComponent(state.armed ? 1 : 0.45)
        if pulse > 0 {
            let target: NSColor = flashFired ? NSColor(srgbRed: 1, green: 0.82, blue: 0.45, alpha: 1) : .systemRed
            color = color.blended(withFraction: pulse, of: target) ?? color
        }
        let border = NSBezierPath(rect: rect)
        border.lineWidth = 2 + 2 * pulse
        if state.live == nil { border.setLineDash([8, 5], count: 2, phase: 0) }
        color.setStroke()
        border.stroke()

        // Edie sits on the top edge, near the right corner, legs over the line, clapperboard in hand.
        let mood: EdieSprite.Mood
        let spoken = speech.map { Date().timeIntervalSince($0.started) }
        if pulse > 0 { mood = flashFired ? .grin : .shocked }
        else if let spoken {
            // Speaking wakes him: he talks and waves, then listens.
            mood = spoken >= Speech.talking ? .rest : (Int(spoken / 0.25) % 2 == 0 ? .talk : .talkPause)
        }
        else if !state.armed { mood = .sleepy }
        else { mood = blink ? .blink : .rest }
        let px = Self.pixel
        let edieOrigin = NSPoint(x: rect.maxX - CGFloat(EdieSprite.columns) * px - 10,
                                 y: rect.minY - (CGFloat(EdieSprite.seatRow) + CGFloat(EdieSprite.crown) / 2) * px)
        EdieSprite.draw(EdieSprite.sitting(mood, swing: mood == .rest || mood == .blink ? swing : 0), at: edieOrigin, pixel: px)

        if let speech, let spoken {
            // In place of the note while he speaks; the note comes back after.
            drawSpeech(speech, elapsed: spoken, rightEdge: edieOrigin.x - 3, midY: rect.minY - 12)
        } else if let workingName {
            let seconds = max(0, Int(Date().timeIntervalSince(workingStarted)))
            drawNote("Working on \(workingName) · \(seconds)s", rightEdge: edieOrigin.x - 6, midY: rect.minY - 9)
        } else if !state.armed {
            drawNote(Self.shortReason(state.reason), rightEdge: edieOrigin.x - 6, midY: rect.minY - 9)
        }
    }

    static func shortReason(_ reason: String) -> String {
        let lower = reason.lowercased()
        if lower.contains("outside the timeline") || lower.contains("no click") { return "Click the Timeline to arm" }
        if lower.contains("text input") { return "Typing in a field" }
        if lower.contains("export") || lower.contains("import") || lower.contains("hidden") { return "Paused in Export/Import" }
        if lower.contains("bridge") { return "Edie bridge offline" }
        return reason
    }

    private func drawNote(_ text: String, rightEdge: CGFloat, midY: CGFloat) {
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 11, weight: .semibold),
            .foregroundColor: NSColor(srgbRed: 0.10, green: 0.07, blue: 0.03, alpha: 1),
        ]
        let string = NSAttributedString(string: text, attributes: attributes)
        let size = string.size()
        let width = min(size.width + 14, max(40, rightEdge - 4))
        let box = NSRect(x: rightEdge - width, y: midY - (size.height + 6) / 2, width: width, height: size.height + 6)
        Self.orange.setFill()
        NSBezierPath(roundedRect: box, xRadius: box.height / 2, yRadius: box.height / 2).fill()
        string.draw(with: box.insetBy(dx: 7, dy: 3), options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
    }

    // A speech bubble ending in a tail at `rightEdge` (Edie's side). Same size
    // and weight as the notes, but dark with an orange edge, so speaking reads
    // apart from status. Colours are the palette's PaletteStyle tokens:
    // canvas #262624, text #eceae3, accent #ff9a3d.
    private static let bubbleFill = NSColor(srgbRed: 0x26 / 255.0, green: 0x26 / 255.0, blue: 0x24 / 255.0, alpha: 0.97)
    private static let bubbleText = NSColor(srgbRed: 0xec / 255.0, green: 0xea / 255.0, blue: 0xe3 / 255.0, alpha: 1)

    private func drawSpeech(_ speech: Speech, elapsed: TimeInterval, rightEdge: CGFloat, midY: CGFloat) {
        let alpha = min(1, elapsed / Speech.fadeIn, max(0, (speech.duration - elapsed) / Speech.fadeOut))
        guard alpha > 0, let context = NSGraphicsContext.current else { return }
        // Two lines (2026-11-20, the user): the heading as the notes are, the
        // detail under it in a lighter weight and dimmer, so it reads second.
        let title = NSAttributedString(string: speech.title, attributes: [
            .font: NSFont.systemFont(ofSize: 11, weight: .semibold),
            .foregroundColor: Self.bubbleText,
        ])
        let detail = NSAttributedString(string: speech.detail, attributes: [
            .font: NSFont.systemFont(ofSize: 11, weight: .regular),
            .foregroundColor: Self.bubbleText.withAlphaComponent(0.62),
        ])
        let titleSize = title.size(), detailSize = detail.size()
        let tail: CGFloat = 6
        let right = rightEdge - tail
        let width = min(max(titleSize.width, detailSize.width) + 18, 380, max(40, right - 4))
        let lineGap: CGFloat = 1
        let height = ceil(titleSize.height) + lineGap + ceil(detailSize.height) + 10
        // The bottom stays where the one-line bubble's was (just above the
        // stroke); it grows upwards into the headroom.
        let box = NSRect(x: right - width, y: midY + 12 - height, width: width, height: height).integral
        context.saveGraphicsState()
        context.cgContext.setAlpha(CGFloat(alpha))
        let body = NSBezierPath(roundedRect: box.insetBy(dx: 0.5, dy: 0.5), xRadius: 7, yRadius: 7)
        body.lineWidth = 1
        Self.bubbleFill.setFill()
        body.fill()
        Self.orange.setStroke()
        body.stroke()
        // The tail, from low on the bubble's side towards his mouth.
        let top = NSPoint(x: box.maxX - 0.5, y: box.midY - 1), bottom = NSPoint(x: box.maxX - 0.5, y: box.midY + 6)
        let tip = NSPoint(x: rightEdge, y: box.midY + 7)
        let wedge = NSBezierPath()
        wedge.move(to: top); wedge.line(to: tip); wedge.line(to: bottom); wedge.close()
        Self.bubbleFill.setFill()
        wedge.fill()
        NSRect(x: box.maxX - 1, y: top.y, width: 1, height: bottom.y - top.y).fill()
        let edges = NSBezierPath()
        edges.lineWidth = 1
        edges.move(to: top); edges.line(to: tip); edges.line(to: bottom)
        edges.stroke()
        let inner = box.insetBy(dx: 9, dy: 5)
        let titleRect = NSRect(x: inner.minX, y: inner.minY, width: inner.width, height: ceil(titleSize.height))
        let detailRect = NSRect(x: inner.minX, y: titleRect.maxY + lineGap, width: inner.width, height: ceil(detailSize.height))
        title.draw(with: titleRect, options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
        detail.draw(with: detailRect, options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
        context.restoreGraphicsState()
    }
}

// Edie, the editor, as pixel rows (2026-11-19): Kino's look from Edit Assist
// (orange body; a big red maple leaf on his head since 2026-11-21, a beret before) holding a clapperboard. The clapstick is open at rest
// and snaps shut when a key fires. Same art as Creative Assist's ui/sprite.ts
// (`edie`); change both together. His art stays the 16 by 12 below; only his mouth
// (2026-11-20, a small smile half a pixel under his eyes, like Sage's) is finer:
// each frame is doubled onto a grid twice as fine and the mouth drawn there in half
// pixels. `draw` sizes cells from the rows, so he stays the same size.
enum EdieSprite {
    // talk / talkPause: speaking (Edie's nudges), mouth open and hand up, then
    // shut and hand lower, alternated; native only, like sleepy and shocked.
    enum Mood { case rest, blink, grin, sleepy, shocked, talk, talkPause }

    static let columns = 16
    // Rows above the line he sits on.
    static let seatRow = 11

    static let colors: [Character: NSColor] = [
        "O": hex(0xfaa046), "D": hex(0xcd8339), "R": hex(0xd7373c), "r": hex(0xa0232d), "K": hex(0x19191c),
        "B": hex(0x5f5f6c), "W": hex(0xf0f0f0), "P": hex(0xe8607a), "m": hex(0x19191c), "w": hex(0xd6ecff),
        "g": hex(0xb8692c), "S": hex(0x7a4a24), "y": hex(0xef5a30), "Y": hex(0xb02a1c),
    ]

    static let rest = [
        "................",
        "................",
        "..OOOOOOOO.....W",
        ".OOOOOOOOOO..WB.",
        ".OOOOOOOOOO.WB..",
        ".OOOOOOOOOOWB...",
        ".OOOOOOOOOOBBBBB",
        ".OOOOOOOOOOBWWWB",
        ".OOOOOOOOOOBBBBB",
        ".OOOOOOOOOOOWWBB",
        "..OOOOOOOO.BBBBB",
        "................",
    ]

    // Half-pixel mouths, on the fine grid (rows and columns doubled).
    typealias Edit = (Int, Int, Character)
    // Each stroke two fine pixels thick (2026-11-20, the user: twice as thick).
    static let smile: [Edit] = [(17, 9, "m"), (18, 9, "m"), (17, 14, "m"), (18, 14, "m")]
        + (10...13).flatMap { [(18, $0, Character("m")), (19, $0, Character("m"))] }
    static func mouth(_ mood: Mood) -> [Edit] {
        switch mood {
        case .rest, .blink, .talkPause: return smile
        // Wider and open, on a clean cut.
        case .grin: return (8...15).flatMap { [(17, $0, Character("m")), (18, $0, Character("m"))] }
            + (9...14).map { (19, $0, "m") } + (10...13).map { (20, $0, "m") }
        // A flat line, dozing.
        case .sleepy: return (10...13).flatMap { [(18, $0, Character("m")), (19, $0, Character("m"))] }
        // A little "o".
        case .shocked, .talk: return [(17, 11, "m"), (17, 12, "m"), (20, 11, "m"), (20, 12, "m")]
            + (10...13).flatMap { [(18, $0, Character("m")), (19, $0, Character("m"))] }
        }
    }

    // His art for a mood, whole pixels, no eyes, mouth or legs.
    static func art(_ mood: Mood) -> [String] {
        // The clapstick swung down onto the slate.
        let clap: [Edit] = [(2, 15, "."), (3, 13, "."), (3, 14, "."), (4, 12, "."), (4, 13, "."),
                            (5, 11, "W"), (5, 12, "B"), (5, 13, "W"), (5, 14, "B"), (5, 15, "W")]
        switch mood {
        case .rest, .blink: return rest
        case .grin: return put(rest, clap)
        case .sleepy: return put(rest, clap + [(0, 12, "w"), (0, 13, "w"), (0, 14, "w"), (0, 15, "w"), (1, 14, "w"), (2, 13, "w"), (3, 12, "w"), (3, 13, "w"), (3, 14, "w"), (3, 15, "w")])
        case .shocked: return put(rest, [(4, 0, "w"), (5, 0, "w")])
        case .talk: return put(rest, [(2, 0, "O"), (3, 0, "O"), (4, 0, "D")])
        case .talkPause: return put(rest, [(4, 0, "O"), (5, 0, "D")])
        }
    }

    // Fine-grid pixels of one colour over the given rows and columns.
    static func at(_ c: Character, _ rows: [Int], _ cols: [Int]) -> [Edit] {
        rows.flatMap { y in cols.map { x in (y, x, c) } }
    }

    // His eyes (2026-11-20, the user: a bit smaller, with a sparkle), three fine
    // pixels square, their bottoms where they were, each with a brown glint at its
    // top right; shut, just their bottom row; startled, wide as they were drawn.
    static func eyes(_ mood: Mood) -> [Edit] {
        switch mood {
        case .blink, .sleepy: return at("K", [15], [7, 8, 9, 14, 15, 16])
        case .shocked: return at("K", [12, 13, 14, 15], [6, 7, 8, 9, 14, 15, 16, 17]) + [(12, 6, "g"), (12, 14, "g")]
        default: return at("K", [13, 14, 15], [7, 8, 9, 14, 15, 16]) + [(13, 9, "g"), (13, 16, "g")]
        }
    }

    // His maple leaf (2026-11-21, traced from the user's picture of a Japanese maple leaf:
    // five pointed lobes, light orange-red above its midrib and dark red below, stem up
    // right), on the fine grid with `crown` rows added above him. It lies flat on his head
    // (drawn squashed to 60% height, as if seen in perspective) over its top, down to just
    // above his eyes, at 80% of the size it was first drawn. Its dark red covers half
    // again as much as traced (the user), so only its upper-left tips are light, and
    // light veins fan out across it from where its stem joins.
    static let crown = 8
    static let leaf: [Edit] = [
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "........y.......................",
        "........yyyy....................",
        ".........yyyyYy..y..............",
        ".yyyyyyyyyyyyyyyy...............",
        "...yyyyyyyYYyyYyYy..............",
        "......yyyyyyYYYyYY..............",
        ".......YyyYYYYyYYYy.............",
        ".....YyyYYYYYYyYYYY.............",
        "....YyYYYYYYYYyYYYYY............",
        "..YYYYYYYY..YYYY..YY............",
        ".YYYY.......YYYY................"
    ].enumerated().flatMap { (y: Int, row: String) -> [Edit] in
        row.enumerated().compactMap { (x: Int, c: Character) -> Edit? in c == "." ? nil : (y, x, c) }
    }
    // A frame with room above him for his leaf, and the leaf drawn in.
    static func crowned(_ rows: [String]) -> [String] {
        put(Array(repeating: String(repeating: ".", count: rows.first?.count ?? 0), count: crown) + rows, leaf)
    }

    // His corners rounded a little more (2026-11-20, the user), on the fine grid: a
    // fine pixel or two off each step of his outline.
    static let corners: [Edit] = [(4, 4), (4, 5), (4, 18), (4, 19), (6, 2), (6, 3), (6, 20), (6, 21),
                                  (19, 2), (19, 3), (19, 20), (19, 21), (21, 4), (21, 5), (21, 18), (21, 19)].map { ($0.0, $0.1, ".") }

    // His blush (2026-11-20, the user: like a drawing's, and seen), on the fine grid:
    // three rose strokes on each cheek, three fine pixels tall.
    static let blush: [Edit] = at("P", [15, 16, 17], [4, 6, 8, 17, 19, 21])
    // His face (eyes, mouth, blush) moved up and toward his right (2026-11-20, the
    // user: so he looks like he's facing that way).
    static let faceShift = (y: -2, x: -2)
    static func turned(_ edits: [Edit]) -> [Edit] {
        edits.map { (y: Int, x: Int, c: Character) -> Edit in (y + faceShift.y, x + faceShift.x, c) }
    }

    // Whole-pixel rows doubled onto the fine grid, with his blush and the mood's eyes and mouth.
    static func fine(_ rows: [String], _ mood: Mood) -> [String] {
        let doubled = rows.flatMap { row -> [String] in
            let wide = String(row.flatMap { [$0, $0] })
            return [wide, wide]
        }
        return put(doubled, corners + turned(blush + eyes(mood) + mouth(mood)))
    }

    // His legs (2026-11-20, the user: thicker), three fine pixels wide.
    static let leftLeg = [6, 7, 8], rightLeg = [15, 16, 17]

    // Standing: his legs are stubs under him.
    // `right`: facing screen right, as in the palette (2026-11-21, the user: "flip his
    // entire body"): all of him mirrored, leaf and clapperboard too.
    static func face(_ mood: Mood, right: Bool = false) -> [String] {
        let rows = crowned(put(fine(art(mood), mood), at("D", [22, 23], leftLeg + rightLeg)))
        return right ? rows.map { String($0.reversed()) } : rows
    }

    // Sitting on a line drawn under row 10; his legs hang over it, feet to the left,
    // a little short (2026-11-20, the user). `swing` swings his right leg (now and
    // then): -1 back, 0 still, 1 out. The shin and foot lean a fine pixel and two.
    static func sitting(_ mood: Mood, swing: Int = 0) -> [String] {
        let s = swing > 0 ? 1 : swing < 0 ? -1 : 0
        let shin = rightLeg.map { $0 + s }
        let legs = at("D", [22, 23, 24, 25], leftLeg) + at("D", [24, 25], [4, 5])
            + at("D", [22], rightLeg) + at("D", [23], shin)
            + at("D", [24, 25], (13...17).map { $0 + 2 * s })
        return crowned(put(fine(Array(art(mood).prefix(seatRow)) + Array(repeating: "................", count: 2), mood), legs))
    }

    // `pixel` is one of his whole pixels; finer rows are drawn in smaller cells.
    static func draw(_ rows: [String], at origin: NSPoint, pixel: CGFloat) {
        let cell = pixel * CGFloat(columns) / CGFloat(max(1, rows.first?.count ?? columns))
        for (y, row) in rows.enumerated() {
            for (x, ch) in row.enumerated() {
                guard let color = colors[ch] else { continue }
                color.setFill()
                NSRect(x: origin.x + CGFloat(x) * cell, y: origin.y + CGFloat(y) * cell, width: cell, height: cell).fill()
            }
        }
    }

    private static func put(_ rows: [String], _ edits: [Edit]) -> [String] {
        var grid = rows.map { Array($0) }
        for (y, x, c) in edits where y < grid.count && x < grid[y].count { grid[y][x] = c }
        return grid.map { String($0) }
    }

    private static func hex(_ v: Int) -> NSColor {
        NSColor(srgbRed: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
    }
}

// The command palette uses the same character as the Timeline highlight and
// the settings panel. Drawing the canonical sprite here prevents a second
// image asset from drifting away from Edie's current look.
final class EdiePaletteIconView: NSView {
    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        // Facing right, toward the commands (2026-11-21, the user).
        EdieSprite.draw(EdieSprite.face(.rest, right: true), at: .zero, pixel: 2)
    }
}
