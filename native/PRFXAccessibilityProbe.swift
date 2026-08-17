import AppKit
import ApplicationServices

// Accessibility diagnostics for PR FX.
//
// Premiere exposes very little through the Accessibility API, and what it does
// expose changes between releases. These probes exist so that question can be
// answered by measurement in a couple of minutes rather than by guessing at
// Premiere's UI tree, which is how the shortcut scope logic went wrong before.
//
// Both are inert unless their flag file exists, so they cost one fileExists
// check per focus change when off:
//
//   ~/Library/Application Support/PR FX Palette/ax-diagnostic
//   ~/Library/Application Support/PR FX Palette/ax-probe
//
// Output goes to ~/Library/Logs/PR FX Shortcut Listener.log
extension ShortcutListener {

    var axDiagnosticEnabled: Bool { axFlagExists("ax-diagnostic") }
    var axProbeEnabled: Bool { axFlagExists("ax-probe") }

    private func axFlagExists(_ name: String) -> Bool {
        FileManager.default.fileExists(atPath: settingsURL.deletingLastPathComponent()
            .appendingPathComponent(name).path)
    }

    // Diagnostic only. Dumps every attribute of the focused window and each
    // ancestor of the focused element separately, so we can see which ones
    // carry structural identity (role/subrole/identifier) versus user content
    // (project, sequence and clip names) that must never drive the decision.
    func logAXDiagnostic(verdict: (active: Bool, reason: String)) {
        guard axDiagnosticEnabled else { return }
        guard let application = NSWorkspace.shared.frontmostApplication, isPremiere(application) else { return }
        guard AXIsProcessTrusted() else {
            let fingerprint = "untrusted"
            if fingerprint != lastDiagnosticFingerprint {
                lastDiagnosticFingerprint = fingerprint
                listenerLog("AX DIAGNOSTIC: Accessibility is not granted; no focus data available.")
            }
            return
        }
        let appElement = AXUIElementCreateApplication(application.processIdentifier)
        var lines: [String] = []
        if let window = axElement(appElement, kAXFocusedWindowAttribute as CFString) {
            lines.append("  [focused window] " + describeAXElement(window))
        } else {
            lines.append("  [focused window] <none>")
        }
        if let focused = axElement(appElement, kAXFocusedUIElementAttribute as CFString) {
            var current: AXUIElement? = focused
            var depth = 0
            while let element = current, depth < 10 {
                lines.append("  [chain \(depth)] " + describeAXElement(element))
                current = axElement(element, kAXParentAttribute as CFString)
                depth += 1
            }
        } else {
            lines.append("  [chain] <no focused element>")
        }
        let body = lines.joined(separator: "\n")
        let fingerprint = body
        guard fingerprint != lastDiagnosticFingerprint else { return }
        lastDiagnosticFingerprint = fingerprint
        listenerLog("AX DIAGNOSTIC: verdict=\(verdict.active ? "ALLOW" : "DENY") reason=\"\(verdict.reason)\"\n\(body)")
    }

    // Walks DOWN from the focused window. The earlier diagnostic only walked UP
    // from the focused element, which Premiere refuses to publish. Panels may
    // still exist as descendants, and any of three signals would give us real
    // panel scoping: a tab group's selected child, an AXFocused descendant, or
    // panel frames we can test against the pointer.
    func logAXPanelProbe() {
        guard axProbeEnabled else { return }
        guard Date().timeIntervalSince(lastProbeAt) > 1.0 else { return }
        lastProbeAt = Date()
        guard let application = NSWorkspace.shared.frontmostApplication, isPremiere(application),
              AXIsProcessTrusted() else { return }
        let appElement = AXUIElementCreateApplication(application.processIdentifier)
        guard let window = axElement(appElement, kAXFocusedWindowAttribute as CFString) else {
            listenerLog("AX PROBE: no focused window")
            return
        }
        let pointer = NSEvent.mouseLocation
        var queue: [(element: AXUIElement, depth: Int)] = [(window, 0)]
        var lines: [String] = []
        var scanned = 0
        var tabGroups = 0
        var focusedFlags = 0
        while !queue.isEmpty && scanned < 800 {
            let (element, depth) = queue.removeFirst()
            scanned += 1
            if depth < 14, let children = axChildren(element) {
                for child in children { queue.append((child, depth + 1)) }
            }
            let role = axString(element, kAXRoleAttribute as CFString) ?? ""
            let subrole = axString(element, kAXSubroleAttribute as CFString) ?? ""
            let title = axString(element, kAXTitleAttribute as CFString) ?? ""
            let description = axString(element, kAXDescriptionAttribute as CFString) ?? ""
            let focused = axBool(element, kAXFocusedAttribute as CFString)
            let selected = axBool(element, kAXSelectedAttribute as CFString)
            if role.contains("Tab") { tabGroups += 1 }
            if focused == true { focusedFlags += 1 }
            let interesting = !title.isEmpty || !description.isEmpty
                || focused == true || selected == true
                || role.contains("Tab") || role.contains("Radio") || role.contains("Group")
            guard interesting else { continue }
            var frameNote = ""
            if let origin = axPoint(element, kAXPositionAttribute as CFString),
               let size = axSize(element, kAXSizeAttribute as CFString) {
                // AX origins are top-left based; NSEvent.mouseLocation is
                // bottom-left based. Flip the pointer before testing.
                let screenHeight = NSScreen.screens.first?.frame.height ?? 0
                let flipped = CGPoint(x: pointer.x, y: screenHeight - pointer.y)
                let rect = CGRect(origin: origin, size: size)
                frameNote = " frame=(\(Int(origin.x)),\(Int(origin.y)) \(Int(size.width))x\(Int(size.height)))"
                    + (rect.contains(flipped) ? " UNDER-POINTER" : "")
            }
            lines.append("  d\(depth) role=\(role.isEmpty ? "-" : role) sub=\(subrole.isEmpty ? "-" : subrole)"
                + " title=\(title.isEmpty ? "-" : "\"\(title)\"")"
                + " desc=\(description.isEmpty ? "-" : "\"\(description)\"")"
                + " focused=\(focused.map(String.init) ?? "-") selected=\(selected.map(String.init) ?? "-")"
                + frameNote)
        }
        let header = "AX PROBE: scanned=\(scanned) tabish=\(tabGroups) focusedFlags=\(focusedFlags) reported=\(lines.count)"
        let body = lines.prefix(70).joined(separator: "\n")
        guard header + body != lastProbeFingerprint else { return }
        lastProbeFingerprint = header + body
        listenerLog(header + (body.isEmpty ? "\n  <no descendants reported>" : "\n" + body))
    }





    func describeAXElement(_ element: AXUIElement) -> String {
        let attributes: [(String, CFString)] = [
            ("role", kAXRoleAttribute as CFString),
            ("subrole", kAXSubroleAttribute as CFString),
            ("identifier", kAXIdentifierAttribute as CFString),
            ("title", kAXTitleAttribute as CFString),
            ("description", kAXDescriptionAttribute as CFString),
            ("help", kAXHelpAttribute as CFString),
            ("value", kAXValueAttribute as CFString)
        ]
        var parts: [String] = []
        for (label, attribute) in attributes {
            let raw = axString(element, attribute) ?? ""
            let trimmed = raw.count > 120 ? String(raw.prefix(120)) + "…" : raw
            parts.append("\(label)=" + (trimmed.isEmpty ? "-" : "\"\(trimmed)\""))
        }
        return parts.joined(separator: " ")
    }
}
