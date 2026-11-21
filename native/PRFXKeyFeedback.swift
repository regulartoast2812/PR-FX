import AppKit
import Foundation

// Counts for the current listener session, reported through /health so the
// CEP panel can show a live success rate instead of an impression of one.
struct KeyStats {
    var fired = 0
    var passed = 0
    var delivered = 0
    var ok = 0
    var failed = 0
    var expired = 0
    var passedReasons: [String: Int] = [:]

    mutating func recordPassed(reason: String) {
        passed += 1
        passedReasons[KeyStats.reasonBucket(reason), default: 0] += 1
    }

    // Reasons carry detail (a role name, "(saved region)"). Bucket them so the
    // summary stays readable.
    static func reasonBucket(_ reason: String) -> String {
        if reason.hasPrefix("Text input") { return "text-field" }
        if reason.hasPrefix("Premiere is in Export") { return "full-window-mode" }
        if reason.hasPrefix("Last click was outside") { return "outside-timeline" }
        if reason.hasPrefix("No click recorded") { return "no-click-yet" }
        if reason.hasPrefix("Timeline panel could not") { return "timeline-not-found" }
        if reason.hasPrefix("Command bridge") { return "bridge-down" }
        return "other"
    }

    func json() -> String {
        let reasons = passedReasons.keys.sorted().map { "\"\($0)\":\(passedReasons[$0] ?? 0)" }.joined(separator: ",")
        return "{\"fired\":\(fired),\"passed\":\(passed),\"delivered\":\(delivered),\"ok\":\(ok),\"failed\":\(failed),\"expired\":\(expired),\"passedReasons\":{\(reasons)}}"
    }
}

// One line per keypress event, tab-separated, so a session can be measured
// afterwards with tools/key-report.sh. Writes happen off the main thread.
final class KeyJournal {
    private let url: URL
    private let queue = DispatchQueue(label: "com.prfx.shortcut-listener.journal")
    private let formatter = ISO8601DateFormatter()
    private let maxBytes: UInt64 = 5_000_000

    init() {
        url = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/PR FX Key Journal.tsv")
    }

    // The last command fired or done, for Edie's nudges ("you were on …").
    private let lastLock = NSLock()
    private var lastRun: (name: String, at: Date)?
    var lastCommand: (name: String, at: Date)? {
        lastLock.lock(); defer { lastLock.unlock() }
        return lastRun
    }

    // event: fired | passed | delivered | ok | failed | expired | rejected
    func record(_ event: String, seq: Int?, key: String, command: String, detail: String = "") {
        if event == "fired" || event == "ok", !command.isEmpty {
            lastLock.lock(); lastRun = (command, Date()); lastLock.unlock()
        }
        let stamp = formatter.string(from: Date())
        let fields = [stamp, event, seq.map(String.init) ?? "", key, command, detail].map(KeyJournal.clean)
        let line = fields.joined(separator: "\t") + "\n"
        queue.async { [url, maxBytes] in
            let manager = FileManager.default
            if let size = (try? manager.attributesOfItem(atPath: url.path))?[.size] as? UInt64, size > maxBytes {
                let rotated = url.deletingPathExtension().appendingPathExtension("1.tsv")
                try? manager.removeItem(at: rotated)
                try? manager.moveItem(at: url, to: rotated)
            }
            guard let data = line.data(using: .utf8) else { return }
            if manager.fileExists(atPath: url.path), let handle = try? FileHandle(forWritingTo: url) {
                handle.seekToEndOfFile()
                handle.write(data)
                try? handle.close()
            } else {
                let header = "time\tevent\tseq\tkey\tcommand\tdetail\n"
                try? (header + line).data(using: .utf8)?.write(to: url, options: .atomic)
            }
        }
    }

    private static func clean(_ value: String) -> String {
        value.replacingOccurrences(of: "\t", with: " ")
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "\r", with: " ")
    }
}

// A small banner near the bottom of the screen. It never activates the
// listener, so Premiere keeps keyboard focus while it is visible.
final class FeedbackToast {
    enum Kind { case ok, failed, skipped }

    private var panel: NSPanel?
    private var iconLabel: NSTextField?
    private var label: NSTextField?
    private var hideTimer: Timer?
    private var lastMessage = ""
    private var lastShownAt = Date.distantPast

    func show(_ message: String, kind: Kind, duration: TimeInterval) {
        // Repeating the same banner during a burst of identical keypresses
        // reads as flicker, not information.
        if message == lastMessage && Date().timeIntervalSince(lastShownAt) < 1.5 && panel?.isVisible == true {
            scheduleHide(after: duration)
            return
        }
        lastMessage = message
        lastShownAt = Date()
        // The listener is launched hidden (`open -gj`); a hidden app shows no
        // windows, so these banners never appeared. Unhide without taking focus.
        if NSApp.isHidden { NSApp.unhideWithoutActivation() }
        let panel = self.panel ?? makePanel()
        guard let label, let iconLabel else { return }
        label.stringValue = message
        switch kind {
        case .ok:
            iconLabel.stringValue = "✓"
            iconLabel.textColor = NSColor(srgbRed: 0.31, green: 0.86, blue: 0.55, alpha: 1)
        case .failed:
            iconLabel.stringValue = "×"
            iconLabel.textColor = NSColor(srgbRed: 1.0, green: 0.38, blue: 0.34, alpha: 1)
        case .skipped:
            iconLabel.stringValue = "!"
            iconLabel.textColor = NSColor(srgbRed: 1.0, green: 0.63, blue: 0.28, alpha: 1)
        }
        // One neutral surface in every state: colour belongs only to the status
        // icon, so long messages stay high-contrast over any Premiere panel.
        panel.contentView?.layer?.backgroundColor = NSColor(srgbRed: 0.075, green: 0.075, blue: 0.085, alpha: 0.97).cgColor

        let maxWidth: CGFloat = 620
        let minWidth: CGFloat = 260
        let textWidth = maxWidth - 58
        label.preferredMaxLayoutWidth = textWidth
        let fitting = label.sizeThatFits(NSSize(width: textWidth, height: 160))
        let size = NSSize(width: max(minWidth, min(maxWidth, ceil(fitting.width) + 58)), height: max(42, ceil(fitting.height) + 20))
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
        let visible = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let origin = NSPoint(x: visible.midX - size.width / 2, y: visible.minY + 96)
        panel.setFrame(NSRect(origin: origin, size: size), display: true)
        iconLabel.frame = NSRect(x: 14, y: (size.height - 20) / 2, width: 18, height: 20)
        label.frame = NSRect(x: 40, y: 10, width: size.width - 54, height: size.height - 20)
        panel.contentView?.layer?.cornerRadius = min(16, size.height / 2)
        panel.alphaValue = 1
        panel.orderFrontRegardless()
        scheduleHide(after: duration)
    }

    private func scheduleHide(after duration: TimeInterval) {
        hideTimer?.invalidate()
        let timer = Timer(timeInterval: duration, repeats: false) { [weak self] _ in
            guard let panel = self?.panel else { return }
            NSAnimationContext.runAnimationGroup({ context in
                context.duration = 0.25
                panel.animator().alphaValue = 0
            }, completionHandler: { [weak self] in
                guard let self, let panel = self.panel, panel.alphaValue < 0.05 else { return }
                panel.orderOut(nil)
            })
        }
        hideTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func makePanel() -> NSPanel {
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 300, height: 40),
                            styleMask: [.borderless, .nonactivatingPanel],
                            backing: .buffered, defer: true)
        panel.level = .statusBar
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.ignoresMouseEvents = true
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        let content = NSView(frame: panel.contentRect(forFrameRect: panel.frame))
        content.wantsLayer = true
        content.layer?.cornerRadius = 16
        content.layer?.masksToBounds = true
        content.layer?.borderWidth = 1
        content.layer?.borderColor = NSColor(calibratedWhite: 1, alpha: 0.12).cgColor
        let icon = NSTextField(labelWithString: "")
        icon.font = NSFont.systemFont(ofSize: 15, weight: .bold)
        icon.alignment = .center
        content.addSubview(icon)
        let text = NSTextField(wrappingLabelWithString: "")
        text.font = NSFont.systemFont(ofSize: 13, weight: .medium)
        text.textColor = .white
        text.alignment = .left
        text.maximumNumberOfLines = 3
        content.addSubview(text)
        panel.contentView = content
        self.panel = panel
        self.iconLabel = icon
        self.label = text
        return panel
    }
}
