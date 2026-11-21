import Foundation
import CoreGraphics
import Carbon.HIToolbox

@main
enum KeyChordChecks {
    static func main() {
        // Unknown codes must not silently become Space (the old Carbon mapping).
        precondition(KeyCodeMap.keyCode(for: "KeyW") == UInt16(kVK_ANSI_W))
        precondition(KeyCodeMap.keyCode(for: "Digit7") == UInt16(kVK_ANSI_7))
        precondition(KeyCodeMap.keyCode(for: "Space") == UInt16(kVK_Space))
        precondition(KeyCodeMap.keyCode(for: "BracketLeft") == nil)

        var table = ChordTable()
        table.add(code: "KeyW", ctrl: false, alt: false, shift: true, cmd: false, id: 2, label: "Shift+W up")
        table.add(code: "KeyW", ctrl: false, alt: false, shift: true, cmd: false, id: 3, label: "Shift+W dup")
        table.add(code: "KeyW", ctrl: true, alt: false, shift: true, cmd: false, id: 4, label: "Ctrl+Shift+W")
        table.add(code: "F13", ctrl: false, alt: false, shift: false, cmd: false, id: 5, label: "F13")
        precondition(table.count == 2)
        precondition(table.duplicates == ["Shift+W dup"], "First binding of a chord wins")
        precondition(table.unmappable == ["F13"])

        let w = UInt16(kVK_ANSI_W)
        precondition(table.id(for: KeyChord(keyCode: w, flags: [.maskShift])) == 2)
        // Caps Lock, Fn and keypad bits must not break a match.
        precondition(table.id(for: KeyChord(keyCode: w, flags: [.maskShift, .maskAlphaShift, .maskSecondaryFn, .maskNumericPad])) == 2)
        precondition(table.id(for: KeyChord(keyCode: w, flags: [.maskShift, .maskControl])) == 4)
        // Extra chord modifiers must not match a plainer binding.
        precondition(table.id(for: KeyChord(keyCode: w, flags: [.maskShift, .maskCommand])) == nil)
        precondition(table.id(for: KeyChord(keyCode: w, flags: [])) == nil)

        var queue = PendingCommands<String>(capacity: 2, maxAge: 5)
        let start = Date(timeIntervalSince1970: 1_000)
        queue.append("a", at: start)
        queue.append("b", at: start)
        precondition(!queue.append("c", at: start))
        precondition(queue.drainDiscarded() == ["c"], "A rejected command must be reported")
        queue.expire(at: start.addingTimeInterval(6))
        precondition(queue.drainDiscarded() == ["a", "b"], "Expired commands must be reported, in order")
        precondition(queue.drainDiscarded().isEmpty)
        precondition(queue.dropped == 3)

        var stats = KeyStats()
        stats.recordPassed(reason: "Last click was outside the Timeline panel (saved region)")
        stats.recordPassed(reason: "Text input is focused (AXTextField)")
        precondition(stats.passedReasons == ["outside-timeline": 1, "text-field": 1])
        print("Key chord, discard reporting and stats checks passed")
    }
}
