import AppKit

// The Timeline highlight (2026-11-19): shows, over Premiere, the exact region
// the listener judges every keystroke against, so the editor can see at a
// glance whether a shortcut is going to fire. Same technique as Edit Assist's
// inspection panel: a borderless, non-activating, click-through NSPanel at
// screen-saver level, laid over the Premiere window.
//
// No fill: a thin orange stroke laid over Premiere's own blue panel border, and
// Edie sitting on its top-right corner.
//   armed       full orange, Edie awake (blinks now and then, swings a leg; EdiePace times both)
//   not armed   faded orange, Edie dozing, and a short note saying why
//   key fired   the stroke pulses brighter, Edie grins
//   key passed  the stroke pulses red, Edie startles
//   working     an AI function runs: "Working on ...", and Edie types on a laptop, looking down at it
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

// Edie's pacing on the Timeline highlight (2026-11-22, the user: "edie clapper animation is
// way too fast, it needs to be how we as human do it with correct pacing, none of the
// animation should be in unrealist speed"). The Windows port is native/windows/Core/EdiePace.cs,
// line for line (checked there by tools/check-windows-bridge); Creative Assist paces his standing
// sprite the same way (ui/sprite.ts `ediePace`). Every pose is held for a time picked within a
// range a person would recognise, so nothing ticks like a metronome:
//   blink    eyes shut 0.11-0.15 s, every 3-6 s at random, one time in five twice (0.14-0.22 s
//            open between). It used to be one 0.2 s refresh in every twenty, exactly every 4 s.
//   leg      still for 7-18 s, then one or two swings: out 0.35-0.6 s, still 0.2-0.35 s, back
//            0.35-0.6 s, still 0.2-0.35 s. It used to be two swings of 0.4 s holds every 11 s.
//   talking  mouth open 0.17-0.32 s, shut 0.11-0.24 s, for as long as he talks (was 0.25 s each).
//   typing   while an AI function works (the user: "when he's working on a long task like this
//            let him type and look down on a laptop"): bursts of taps, a hand lifted 0.08-0.15 s
//            and down 0.07-0.13 s, pauses of 0.5-2 s looking down at the screen, now and then a
//            glance up (0.45-1 s); never the same move twice running.
// With Reduce motion on he holds still: eyes open, legs still, typing hands down.
final class EdiePace {
    enum Hands { case down, left, right, up }

    struct Pose {
        var blink: Bool
        var swing: Int
        var typing: Hands
        // When (seconds, the same clock as `now`) any of it changes next.
        var next: Double
    }

    struct Step<T> {
        var value: T
        var seconds: Double
        var move: String? = nil
    }

    // One of his poses running through a queue of steps, refilled when it empties.
    final class Track<T> {
        private var queue: [Step<T>] = []
        var refill: () -> [Step<T>] = { [] }
        var value: T
        var ends = -Double.infinity
        var lastMove: String?

        init(_ start: T) { value = start }

        func restart(_ now: Double, _ first: [Step<T>]) {
            queue = first
            ends = now
            lastMove = nil
        }

        func advance(_ now: Double) {
            while now >= ends {
                if queue.isEmpty {
                    let steps = refill()
                    if let move = steps.first?.move { lastMove = move }
                    queue = steps
                }
                let step = queue.removeFirst()
                value = step.value
                // Woken late (a sleep, a busy main thread): this pose starts now rather than racing through the run.
                ends = (now - ends > 0.25 ? now : ends) + step.seconds
            }
        }
    }

    static let blinkShut = (0.11, 0.15), blinkEvery = (3.0, 6.0), blinkApart = (0.14, 0.22)
    static let blinkTwice = 0.2
    static let swingStill = (7.0, 18.0), swingOut = (0.35, 0.6), swingPass = (0.2, 0.35)
    static let talkOpen = (0.17, 0.32), talkShut = (0.11, 0.24)
    static let tapUp = (0.08, 0.15), tapDown = (0.07, 0.13), typePause = (0.5, 2.0), typeGlance = (0.45, 1.0)

    private let random: () -> Double
    private let blink = Track<Bool>(false)
    private let swing = Track<Int>(0)
    private let typing = Track<Hands>(.down)
    private var wasTyping = false, started = false

    init(random: @escaping () -> Double = { Double.random(in: 0..<1) }) {
        self.random = random
        blink.refill = { [unowned self] in self.blinkRun() }
        swing.refill = { [unowned self] in self.swingRun() }
        typing.refill = { [unowned self] in self.typingRun(self.typing.lastMove) }
    }

    private func pick(_ range: (Double, Double)) -> Double { range.0 + (range.1 - range.0) * random() }

    private func blinkRun() -> [Step<Bool>] {
        var run = [Step(value: false, seconds: pick(Self.blinkEvery)), Step(value: true, seconds: pick(Self.blinkShut))]
        if random() < Self.blinkTwice { run += [Step(value: false, seconds: pick(Self.blinkApart)), Step(value: true, seconds: pick(Self.blinkShut))] }
        return run
    }

    private func swingRun() -> [Step<Int>] {
        var run = [Step(value: 0, seconds: pick(Self.swingStill))]
        let swings = random() < 0.5 ? 1 : 2
        for _ in 0..<swings {
            run += [Step(value: 1, seconds: pick(Self.swingOut)), Step(value: 0, seconds: pick(Self.swingPass)),
                    Step(value: -1, seconds: pick(Self.swingOut)), Step(value: 0, seconds: pick(Self.swingPass))]
        }
        return run
    }

    // His typing moves: (name, weight, how many times over, the beats).
    static let typingMoves: [(name: String, weight: Double, times: (Int, Int), beats: [Hands])] = [
        ("burst", 4, (3, 7), [.left, .down, .right, .down]),
        ("pecks", 2, (1, 2), [.right, .down]),
        ("quick", 2, (2, 4), [.left, .down, .left, .down, .right, .down]),
        ("glance", 1, (1, 1), [.up]),
    ]

    // One move (a burst first, then any but the last one, by weight) and the pause after it.
    private func typingRun(_ last: String?) -> [Step<Hands>] {
        var move = Self.typingMoves[0]
        if let last {
            let choices = Self.typingMoves.filter { $0.name != last }
            var roll = random() * choices.reduce(0) { $0 + $1.weight }
            move = choices[choices.count - 1]
            for m in choices { roll -= m.weight; if roll < 0 { move = m; break } }
        }
        let times = move.times.0 + Int((random() * Double(move.times.1 - move.times.0 + 1)).rounded(.down))
        var run: [Step<Hands>] = []
        for _ in 0..<times {
            for hands in move.beats {
                let range = hands == .up ? Self.typeGlance : hands == .down ? Self.tapDown : Self.tapUp
                run.append(Step(value: hands, seconds: pick(range), move: run.isEmpty ? move.name : nil))
            }
        }
        run.append(Step(value: .down, seconds: pick(Self.typePause)))
        return run
    }

    // Where he is at `now` (seconds). `isTyping`: an AI function is working, so he's at his laptop.
    func at(_ now: Double, motion: Bool, isTyping: Bool) -> Pose {
        if !motion { wasTyping = false; started = false; return Pose(blink: false, swing: 0, typing: .down, next: now + 1) }
        if !started {
            started = true
            blink.restart(now, [Step(value: false, seconds: pick(Self.blinkEvery))])
            swing.restart(now, [Step(value: 0, seconds: pick(Self.swingStill))])
        }
        if isTyping && !wasTyping { typing.restart(now, [Step(value: .down, seconds: pick(Self.typePause))]) }
        wasTyping = isTyping
        blink.advance(now)
        swing.advance(now)
        var next = min(blink.ends, swing.ends)
        if isTyping { typing.advance(now); next = min(next, typing.ends) }
        return Pose(blink: blink.value, swing: swing.value, typing: isTyping ? typing.value : .down, next: next)
    }

    // His mouth while he talks: open and shut in turn, each for its own time, enough to cover `length` seconds.
    static func talkBeats(_ random: () -> Double, _ length: Double) -> [Double] {
        var beats: [Double] = []
        var total = 0.0
        while total < length {
            let range = beats.count % 2 == 0 ? talkOpen : talkShut
            let beat = range.0 + (range.1 - range.0) * random()
            beats.append(beat)
            total += beat
        }
        return beats
    }

    // Open (`true`) or shut `elapsed` seconds into his talking.
    static func talkMouthOpen(_ beats: [Double], _ elapsed: Double) -> Bool {
        var at = 0.0
        for (i, beat) in beats.enumerated() {
            at += beat
            if elapsed < at { return i % 2 == 0 }
        }
        return false
    }
}

final class TimelineHighlight {
    private var panel: NSPanel?
    private var view: TimelineHighlightView?
    // Room above the window for Edie when the Timeline is docked at its top.
    static let headroom: CGFloat = 44
    private var workingTimer: Timer?
    // His blink, leg and typing (EdiePace); one timer that wakes once, when his pose next changes.
    private let pace = EdiePace()
    private var paceTimer: Timer?

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
        if view.state != state || view.area != area {
            view.state = state
            view.area = area
            view.needsDisplay = true
        }
        if !panel.isVisible {
            panel.orderFrontRegardless()
            listenerLog("Timeline highlight shown over \(NSStringFromRect(placed)) visible=\(panel.isVisible)")
        }
        stepPace()
    }

    // His pose now (EdiePace), and a wake when it next changes: awake or at his laptop only;
    // dozing he holds still. With Reduce motion on he holds still too.
    private func stepPace() {
        paceTimer?.invalidate()
        paceTimer = nil
        guard let view, let state = view.state, panel?.isVisible == true else { return }
        let now = Date().timeIntervalSince1970
        let motion = !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        let pose = pace.at(now, motion: motion, isTyping: view.workingName != nil)
        view.motion = motion
        if view.blink != pose.blink || view.swing != pose.swing || view.typing != pose.typing {
            view.blink = pose.blink
            view.swing = pose.swing
            view.typing = pose.typing
            view.needsDisplay = true
        }
        guard state.armed || view.workingName != nil else { return }
        let timer = Timer(timeInterval: max(0.015, min(60, pose.next - now)), repeats: false) { [weak self] _ in self?.stepPace() }
        paceTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    func flash(fired: Bool) {
        guard panel?.isVisible == true else { return }
        view?.flash(fired: fired)
    }

    func startWorking(_ name: String) {
        view?.workingName = name
        view?.workingStarted = Date()
        view?.needsDisplay = true
        stepPace()
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
        stepPace()
    }

    // Drawn and on screen (it only ever draws a live region).
    var isShowing: Bool { panel?.isVisible == true }
    var isSpeaking: Bool { view?.speech != nil }
    private var speechTimer: Timer?

    // Edie's nudges (PRFXEdieNudges.swift): one line in a bubble beside him.
    // Never takes focus or clicks: it's drawn in this click-through panel.
    func say(_ title: String, _ detail: String, for duration: TimeInterval) {
        guard let view, isShowing else { return }
        view.speech = TimelineHighlightView.Speech(title: title, detail: detail, started: Date(), duration: duration,
                                                   beats: EdiePace.talkBeats({ Double.random(in: 0..<1) }, TimelineHighlightView.Speech.talking))
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
        paceTimer?.invalidate()
        paceTimer = nil
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
    var typing = EdiePace.Hands.down
    var motion = true
    var workingName: String?
    var workingStarted = Date()
    // What Edie is saying, if anything (TimelineHighlight.say).
    struct Speech {
        var title: String
        var detail: String
        var started: Date
        var duration: TimeInterval
        // His mouth open and shut in turn, each for its own time (EdiePace.talkBeats).
        var beats: [Double] = []
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
            mood = spoken >= Speech.talking ? .rest
                : !motion ? .talk : (EdiePace.talkMouthOpen(speech?.beats ?? [], spoken) ? .talk : .talkPause)
        }
        // A long task (an AI function): at his laptop, typing and looking down at it.
        else if workingName != nil {
            switch typing {
            case .left: mood = .typeLeft
            case .right: mood = .typeRight
            case .up: mood = .typeUp
            case .down: mood = .typeDown
            }
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
    // typeDown / typeLeft / typeRight / typeUp: at his laptop while an AI function works
    // (2026-11-22), looking down at it, both hands on the keys, the left or the right lifted
    // for a tap, or glancing up.
    enum Mood { case rest, blink, grin, sleepy, shocked, talk, talkPause, typeDown, typeLeft, typeRight, typeUp }

    static func isTyping(_ mood: Mood) -> Bool { mood == .typeDown || mood == .typeLeft || mood == .typeRight || mood == .typeUp }

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
        case .rest, .blink, .talkPause, .typeDown, .typeLeft, .typeRight, .typeUp: return smile
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
        // His hand off the clapperboard, which stands aside while he types: the slate's edge where it was.
        case .typeDown, .typeLeft, .typeRight, .typeUp: return put(rest, [(9, 11, "B")])
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
        // Looking down at his screen: the lower two rows of each eye, no glint.
        case .typeDown, .typeLeft, .typeRight: return at("K", [14, 15], [7, 8, 9, 14, 15, 16])
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

    // His tiny arms (2026-11-22, the user: "add tiny arms and hand on the side. hands are
    // pretty much just circles/ovals"): a round hand, a circle four fine pixels across in his
    // legs' darker orange, on each side, in the frame's fine rows (leaf included). The back one
    // at his far side (columns 0-3), the front one on the clapperboard's near edge (21-24),
    // where his hand always was. Talking, his back arm is the one he waves. Creative Assist
    // draws the same (sprite.ts edieHand, edieArms); the Windows port is EdieSprite.cs.
    static func hand(_ top: Int, _ left: Int) -> [Edit] {
        at("D", [top, top + 3], [left + 1, left + 2]) + at("D", [top + 1, top + 2], Array(left...(left + 3)))
    }

    static func arms(_ mood: Mood) -> [Edit] {
        mood == .talk || mood == .talkPause ? hand(25, 21) : hand(23, 0) + hand(25, 21)
    }

    // A laptop on his lap or in front of him (2026-11-22, the user: "let him type and look
    // down on a laptop"; twice as big, 2026-11-23, the user: "make the laptop x2 bigger"): its
    // lid's back, grey with a light mark (4 by 4), 20 fine pixels wide and 12 tall from just
    // under his eyes, the light front edge of its keyboard (24 by 2) under it, below his feet
    // or seat, and his hands on the keys at its ends, one lifted a whole pixel for a tap. One
    // fine column of him shows between it and his clapperboard. Frames he types in are 36
    // fine rows, taller for its keyboard (4 standing, 2 sitting). Creative Assist draws the
    // same (sprite.ts edieLaptop; there he sits 4 rows higher in his box instead).
    static func laptop(_ mood: Mood) -> [Edit] {
        let top = 22
        func keyHand(_ x: Int, _ lifted: Bool) -> [Edit] {
            let y = top + (lifted ? 8 : 10)
            return at("D", [y, y + 2], [x + 1, x + 2]) + at("D", [y + 1], Array(x...(x + 3)))
        }
        return at("B", Array(top...(top + 11)), Array(1...20))
            + at("W", Array((top + 4)...(top + 7)), [9, 10, 11, 12])
            + at("W", [top + 12, top + 13], Array(0...23))
            + keyHand(0, mood == .typeLeft)
            + keyHand(18, mood == .typeRight)
    }
    // A frame with empty rows added under it, to its keyboard's bottom (row 35).
    static func roomy(_ rows: [String]) -> [String] {
        rows + Array(repeating: String(repeating: ".", count: rows.first?.count ?? 0), count: max(0, 36 - rows.count))
    }

    // Standing: his legs are stubs under him.
    // `right`: facing screen right, as in the palette (2026-11-21, the user: "flip his
    // entire body"): all of him mirrored, leaf and clapperboard too. Either way his
    // clapperboard is ahead of him, on the side he faces (2026-11-22, the user: "have the
    // clapper in front of him in all instances aside from timeline rectangle"); sitting on
    // the Timeline he keeps it behind him.
    static func face(_ mood: Mood, right: Bool = false) -> [String] {
        let rows = crowned(put(fine(art(mood), mood), at("D", [22, 23], leftLeg + rightLeg)))
        let mirrored = ahead(rows.map { String($0.reversed()) })
        let toRight = isTyping(mood) ? put(roomy(mirrored), laptop(mood)) : put(mirrored, arms(mood))
        return right ? toRight : toRight.map { String($0.reversed()) }
    }

    // Facing right his body is fine columns 10-31 and the clapperboard (his hand on it)
    // 0-9: the body moves 8 left and the clapperboard, mirrored back so its stick rises
    // outward, goes to the right edge, his hand over its near side. Creative Assist draws
    // him the same (app/ui/sprite.ts edieAhead).
    static func ahead(_ right: [String]) -> [String] {
        right.map { r -> String in
            let c = Array(r)
            var row = [Character](repeating: ".", count: c.count)
            for x in 10..<c.count where c[x] != "." { row[x - 8] = c[x] }
            for x in 0..<10 where c[x] == "B" || c[x] == "W" { row[c.count - 1 - x] = c[x] }
            for x in 0..<10 where c[x] == "O" { row[c.count - 1 - x] = "O" }
            return String(row)
        }
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
        let rows = crowned(put(fine(Array(art(mood).prefix(seatRow)) + Array(repeating: "................", count: 2), mood), legs))
        return isTyping(mood) ? put(roomy(rows), laptop(mood)) : put(rows, arms(mood))
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
