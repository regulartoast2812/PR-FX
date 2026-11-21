import Foundation
import CoreGraphics
import Carbon.HIToolbox

// Why this file exists
// --------------------
// Shortcuts used to be Carbon hotkeys. Carbon can only be scoped by
// registering and unregistering, so every click between the Timeline and any
// other panel tore the whole set down and rebuilt it -- 238,833 registrations
// in ten weeks of one editor's log. A keypress that lands while a key is
// unregistered goes straight to Premiere and leaves no trace anywhere, which
// is exactly the "works half the time, never says why" failure.
//
// An event tap sees every keystroke instead. It is installed once, never
// unregistered, and decides per keystroke whether to consume it. That also
// makes every skipped keypress observable, which Carbon could never do.

struct KeyChord: Hashable, CustomStringConvertible {
    let keyCode: UInt16
    let ctrl: Bool
    let alt: Bool
    let shift: Bool
    let cmd: Bool

    init(keyCode: UInt16, ctrl: Bool, alt: Bool, shift: Bool, cmd: Bool) {
        self.keyCode = keyCode
        self.ctrl = ctrl
        self.alt = alt
        self.shift = shift
        self.cmd = cmd
    }

    // Only the four chord modifiers count. Caps Lock, Fn and the numeric-pad
    // bit must not stop Shift+W from matching -- Carbon ignored them too.
    init(keyCode: UInt16, flags: CGEventFlags) {
        self.init(keyCode: keyCode,
                  ctrl: flags.contains(.maskControl),
                  alt: flags.contains(.maskAlternate),
                  shift: flags.contains(.maskShift),
                  cmd: flags.contains(.maskCommand))
    }

    var description: String {
        "\(ctrl ? "Ctrl+" : "")\(alt ? "Option+" : "")\(shift ? "Shift+" : "")\(cmd ? "Cmd+" : "")\(keyCode)"
    }
}

enum KeyCodeMap {
    private static let table: [String: Int] = {
        var map: [String: Int] = ["Space": kVK_Space]
        let letters: [(String, Int)] = [
            ("A", kVK_ANSI_A), ("B", kVK_ANSI_B), ("C", kVK_ANSI_C), ("D", kVK_ANSI_D),
            ("E", kVK_ANSI_E), ("F", kVK_ANSI_F), ("G", kVK_ANSI_G), ("H", kVK_ANSI_H),
            ("I", kVK_ANSI_I), ("J", kVK_ANSI_J), ("K", kVK_ANSI_K), ("L", kVK_ANSI_L),
            ("M", kVK_ANSI_M), ("N", kVK_ANSI_N), ("O", kVK_ANSI_O), ("P", kVK_ANSI_P),
            ("Q", kVK_ANSI_Q), ("R", kVK_ANSI_R), ("S", kVK_ANSI_S), ("T", kVK_ANSI_T),
            ("U", kVK_ANSI_U), ("V", kVK_ANSI_V), ("W", kVK_ANSI_W), ("X", kVK_ANSI_X),
            ("Y", kVK_ANSI_Y), ("Z", kVK_ANSI_Z)
        ]
        for (letter, code) in letters { map["Key" + letter] = code }
        let digits = [kVK_ANSI_0, kVK_ANSI_1, kVK_ANSI_2, kVK_ANSI_3, kVK_ANSI_4,
                      kVK_ANSI_5, kVK_ANSI_6, kVK_ANSI_7, kVK_ANSI_8, kVK_ANSI_9]
        for (index, code) in digits.enumerated() { map["Digit\(index)"] = code }
        return map
    }()

    // nil for anything the CEP capture cannot produce. The Carbon path used to
    // map unknown codes to Space, which silently bound the wrong key.
    static func keyCode(for code: String) -> UInt16? {
        table[code].map { UInt16($0) }
    }
}

// Builds the lookup the tap consults on every keystroke. The first binding of
// a chord wins and later duplicates are reported, matching Carbon, which
// refused a second registration of the same chord.
struct ChordTable {
    private(set) var ids: [KeyChord: UInt32] = [:]
    private(set) var duplicates: [String] = []
    private(set) var unmappable: [String] = []

    mutating func add(code: String, ctrl: Bool, alt: Bool, shift: Bool, cmd: Bool, id: UInt32, label: String) {
        guard let keyCode = KeyCodeMap.keyCode(for: code) else {
            unmappable.append(label)
            return
        }
        let chord = KeyChord(keyCode: keyCode, ctrl: ctrl, alt: alt, shift: shift, cmd: cmd)
        if ids[chord] != nil {
            duplicates.append(label)
            return
        }
        ids[chord] = id
    }

    func id(for chord: KeyChord) -> UInt32? { ids[chord] }
    var count: Int { ids.count }
}

private let prfxKeyTapCallback: CGEventTapCallBack = { _, type, event, refcon in
    guard let refcon else { return Unmanaged.passUnretained(event) }
    let tap = Unmanaged<KeyTap>.fromOpaque(refcon).takeUnretainedValue()
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        tap.reenable(after: type)
        return Unmanaged.passUnretained(event)
    }
    return tap.handler(type, event) ? nil : Unmanaged.passUnretained(event)
}

// Owns the CGEventTap. The handler runs on the main run loop and must return
// quickly: macOS disables a tap whose callback stalls, and while it stalls
// every keystroke on the machine waits. So the handler only decides; logging,
// queueing and UI happen after it returns.
final class KeyTap {
    // Returns true to consume the event.
    let handler: (CGEventType, CGEvent) -> Bool
    private let onReenable: (String) -> Void
    private var machPort: CFMachPort?
    private var source: CFRunLoopSource?
    private(set) var reenableCount = 0

    init?(handler: @escaping (CGEventType, CGEvent) -> Bool, onReenable: @escaping (String) -> Void) {
        self.handler = handler
        self.onReenable = onReenable
        let types: [CGEventType] = [.keyDown, .keyUp, .leftMouseDown, .leftMouseUp, .rightMouseDown]
        let mask = types.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << CGEventMask($1.rawValue)) }
        guard let port = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: mask,
            callback: prfxKeyTapCallback,
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        ) else { return nil }
        machPort = port
        let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, port, 0)
        source = runLoopSource
        CFRunLoopAddSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
        CGEvent.tapEnable(tap: port, enable: true)
    }

    var isEnabled: Bool {
        guard let machPort else { return false }
        return CGEvent.tapIsEnabled(tap: machPort)
    }

    // Re-arms after macOS switched the tap off. Without this a single slow
    // callback would end shortcut delivery until the listener restarted.
    func reenable(after type: CGEventType) {
        guard let machPort else { return }
        reenableCount += 1
        CGEvent.tapEnable(tap: machPort, enable: true)
        let reason = type == .tapDisabledByTimeout ? "timeout" : "user input"
        DispatchQueue.main.async { [onReenable] in onReenable(reason) }
    }

    func ensureEnabled() -> Bool {
        guard let machPort else { return false }
        if CGEvent.tapIsEnabled(tap: machPort) { return false }
        CGEvent.tapEnable(tap: machPort, enable: true)
        reenableCount += 1
        return true
    }

    func invalidate() {
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        if let machPort { CFMachPortInvalidate(machPort) }
        source = nil
        machPort = nil
    }

    deinit { invalidate() }
}
