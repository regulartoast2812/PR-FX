import AppKit
import ApplicationServices
import Foundation
import Carbon.HIToolbox
import Darwin
import Network
import Security

#if !PRFX_GENERATED_BUILD
private let prfxListenerBuild = "source-dev"
#endif

private struct Shortcut: Codable {
    let code: String
    let ctrl: Bool
    let alt: Bool
    let shift: Bool
    let meta: Bool
}

private struct Settings: Codable {
    let shortcut: Shortcut
    let transitionFrames: Int
    let staggerFrames: Int?
    let staggerGroup: Int?
    let bindings: [Binding]?
    // "problems" (default): failures and skipped shortcuts; "all": also
    // successes; "off": no banners. Written by the CEP General tab.
    let shortcutFeedback: String?
    // "on" (default): banner when the Timeline arms and when Premiere enters
    // Export/Import mode; "off": silent. Written by the PR FX app.
    let announceScope: String?
    // "on": draw the region keystrokes are judged against over Premiere
    // (PRFXTimelineHighlight.swift). "off" (default). Written by the PR FX page.
    let timelineHighlight: String?
    // "on" (default): Edie says one short line beside the highlight after
    // edieNudgeMinutes (default 2) with no input, and when input resumes after
    // a longer gap (PRFXEdieNudges.swift). "off": he stays quiet.
    var edieNudges: String? = nil
    var edieNudgeMinutes: Double? = nil
}

private struct Command: Codable {
    let type: String
    let name: String
    // A binding from CEP only needs the command identity. The native palette
    // adds the current duration at execution time, so this must stay optional.
    let transitionFrames: Int?
    let id: String?
    let transitionPlacement: String?
    let moveMode: String?
    let staggerFrames: Int?
    let staggerGroup: Int?
    // Set only on commands fired by a shortcut. CEP echoes `seq` back through
    // POST /result so each keypress can be followed to its outcome.
    let seq: Int?
    let key: String?
    // Saved Effect Presets are identified by UID; the name is only a fallback
    // (two presets in different bins may share it).
    let presetUid: String?
    // The project item the palette's Media search places (host place-project-item), by its nodeId.
    let mediaId: String?

    init(type: String, name: String, transitionFrames: Int?, id: String?, transitionPlacement: String? = nil, moveMode: String? = nil, staggerFrames: Int? = nil, staggerGroup: Int? = nil, seq: Int? = nil, key: String? = nil, presetUid: String? = nil, mediaId: String? = nil) {
        self.type = type
        self.name = name
        self.transitionFrames = transitionFrames
        self.id = id
        self.transitionPlacement = transitionPlacement
        self.moveMode = moveMode
        self.staggerFrames = staggerFrames
        self.staggerGroup = staggerGroup
        self.seq = seq
        self.key = key
        self.presetUid = presetUid
        self.mediaId = mediaId
    }
}

private struct CommandResult: Codable {
    let seq: Int
    let ok: Bool
    let message: String?
    let ms: Int?
}

private struct RuntimeRegistration: Codable {
    let runtime: String
    let supportedIds: [String]
}

private let prfxFallbackCommands = [
    Command(type: "custom", name: "[System] Dump QE + DOM API", transitionFrames: 30, id: "dump-qe-api"),
    Command(type: "custom", name: "[System] Inspect Selected Clip", transitionFrames: 30, id: "inspect-selected-clip"),
    Command(type: "custom", name: "[System] Failure Report", transitionFrames: 30, id: "failure-report"),
    Command(type: "custom", name: "[System] Preset Report", transitionFrames: 30, id: "preset-report"),
    Command(type: "custom", name: "[System] Probe Lumetri Preset Apply", transitionFrames: 30, id: "probe-preset-routes"),
    Command(type: "custom", name: "[System] Clear Failure Ledger", transitionFrames: 30, id: "clear-failure-ledger"),
    Command(type: "custom", name: "Undo Last Edie Effect Apply", transitionFrames: 30, id: "undo-last-palette-action"),
    Command(type: "custom", name: "Remove Transitions on Selected Clips", transitionFrames: 30, id: "remove-transitions"),
    Command(type: "custom", name: "Move Selected Clips Up as Group", transitionFrames: 30, id: "move-selected-clips-up", moveMode: "group"),
    Command(type: "custom", name: "Move Selected Clips Up Individually", transitionFrames: 30, id: "move-selected-clips-up", moveMode: "individual"),
    Command(type: "custom", name: "Move Selected Clips Down as Group", transitionFrames: 30, id: "move-selected-clips-down", moveMode: "group"),
    Command(type: "custom", name: "Move Selected Clips Down Individually", transitionFrames: 30, id: "move-selected-clips-down", moveMode: "individual"),
    Command(type: "custom", name: "Pull Group In to Playhead", transitionFrames: 30, id: "pull-group-in"),
    Command(type: "custom", name: "Pull Group Out to Playhead", transitionFrames: 30, id: "pull-group-out"),
    Command(type: "custom", name: "Retract Speed In to Playhead", transitionFrames: 30, id: "retract-speed-in-to-playhead"),
    Command(type: "custom", name: "Retract Speed Out to Playhead", transitionFrames: 30, id: "retract-speed-out-to-playhead"),
    Command(type: "custom", name: "Undo Last Edie Action (Any)", transitionFrames: 30, id: "undo-last-prfx-action"),
    Command(type: "custom", name: "Undo Last Edie Arrange Action", transitionFrames: 30, id: "undo-last-arrange"),
    Command(type: "custom", name: "Redo Last Edie Arrange Action", transitionFrames: 30, id: "redo-last-arrange"),
    Command(type: "custom", name: "Select Everything Starting Before Playhead", transitionFrames: 30, id: "select-before-playhead"),
    Command(type: "custom", name: "Adjustment Layer Over Selection", transitionFrames: 30, id: "adjustment-layer-over-selection"),
    Command(type: "custom", name: "Perfect Pitch (Correct Speed Transposition)", transitionFrames: 30, id: "perfect-pitch"),
    Command(type: "custom", name: "Place Source Monitor Clip at Playhead", transitionFrames: 30, id: "place-source-clip"),
    Command(type: "custom", name: "Place Bin Clips at Playhead in Row", transitionFrames: 30, id: "place-bin-clips"),
    Command(type: "custom", name: "Place Bin Clips at Playhead in Column", transitionFrames: 30, id: "place-bin-clips-column"),
    Command(type: "custom", name: "Replace Selected Clips from Bin", transitionFrames: 30, id: "replace-from-bin"),
    Command(type: "custom", name: "Replace & Fit to Slot from Bin", transitionFrames: 30, id: "replace-fit-from-bin"),
    Command(type: "custom", name: "Bulk Replace — Dry Run (no changes)", transitionFrames: 30, id: "bulk-replace-preview"),
    Command(type: "custom", name: "Bulk Replace from Bin by Name", transitionFrames: 30, id: "bulk-replace-by-name"),
    Command(type: "custom", name: "Queue Cuts to Media Encoder", transitionFrames: 30, id: "queue-cuts-to-ame"),
    Command(type: "custom", name: "Trim In to Playhead", transitionFrames: 30, id: "trim-in-to-playhead"),
    Command(type: "custom", name: "Trim Out to Playhead", transitionFrames: 30, id: "trim-out-to-playhead"),
    Command(type: "custom", name: "Close Gaps Between Selected Clips", transitionFrames: 30, id: "close-selected-gaps"),
    Command(type: "custom", name: "Clean Up by Selected", transitionFrames: 30, id: "clean-up-track-rows"),
    Command(type: "custom", name: "Clean Up by Timeline", transitionFrames: 30, id: "fill-track-rows-down"),
    Command(type: "custom", name: "Snap Track Blocks In to Playhead", transitionFrames: 30, id: "snap-tracks-in"),
    Command(type: "custom", name: "Snap Track Blocks Out to Playhead", transitionFrames: 30, id: "snap-tracks-out"),
    Command(type: "custom", name: "Stagger Ascending", transitionFrames: 30, id: "stagger-ascending"),
    Command(type: "custom", name: "Stagger Descending", transitionFrames: 30, id: "stagger-descending")
]

private let retiredCommandIDs: Set<String> = ["stretch-speed-to-playhead"]
// Arming on "Premiere is frontmost" alone makes every modifier-less binding live
// in the Project panel, the Source monitor and every rename box -- pressing S to
// type a name runs Move Down instead. Panel scoping is the feature, not an
// optimisation, so this stays false.
//
// It was briefly set true while chasing ad-hoc rebuild/TCC instability, but that
// made shortcut keys live in bins and rename fields. Keep the safe behavior:
// Timeline-aware arming when Accessibility can confirm it, saved-region fallback
// when it cannot, and modifier-only degradation when panel detection is missing.
private let prfxBypassAccessibilityFocus = false

private struct Binding: Codable {
    let shortcut: Shortcut
    let command: Command
}

// How much of the shortcut set may be armed right now.
//
// `full` means the Timeline was positively identified as the active panel, so
// even a modifier-less key is safe. `modifierOnly` means Premiere is frontmost
// and no text field has focus, but the Timeline could not be located — most
// likely a localized Premiere, an Adobe rename of the control descriptions the
// lookup depends on, or a workspace without a Timeline. Keys carrying a
// modifier remain safe there because typing never produces them, so the tool
// degrades instead of falling silent.
private enum ShortcutScope {
    case none(String)
    case modifierOnly(String)
    // The last click was in another Premiere panel (Project, Source, Program).
    // Like .modifierOnly, plus the commands that work on the Project panel's
    // selection: those are run right after selecting clips there, and refusing
    // them as "outside the Timeline" blocked Shift+X 10 times in a row
    // (2026-11-20).
    case otherPanel(String)
    case full(String)

    static let projectSelectionCommands: Set<String> = [
        "place-bin-clips", "place-bin-clips-column", "replace-from-bin", "replace-fit-from-bin",
    ]

    var reason: String {
        switch self {
        case .none(let reason), .modifierOnly(let reason), .otherPanel(let reason), .full(let reason): return reason
        }
    }

    var armsAnything: Bool {
        if case .none = self { return false }
        return true
    }

    // Kept distinct from `reason` so registration can tell a scope *change*
    // from a mere reason change and re-register only when the arming set moves.
    var rank: Int {
        switch self {
        case .none: return 0
        case .modifierOnly: return 1
        case .full: return 2
        case .otherPanel: return 3
        }
    }

    func arms(_ shortcut: Shortcut, command: Command? = nil) -> Bool {
        switch self {
        case .none: return false
        case .full: return true
        case .modifierOnly: return shortcut.ctrl || shortcut.alt || shortcut.meta
        case .otherPanel:
            if shortcut.ctrl || shortcut.alt || shortcut.meta { return true }
            return command?.id.map(ShortcutScope.projectSelectionCommands.contains) ?? false
        }
    }
}

func listenerLog(_ message: String) {
    let url = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Logs/PR FX Shortcut Listener.log")
    let line = "\(ISO8601DateFormatter().string(from: Date())) \(message)\n"
    if let data = line.data(using: .utf8) {
        if FileManager.default.fileExists(atPath: url.path) {
            if let handle = try? FileHandle(forWritingTo: url) {
                handle.seekToEndOfFile()
                handle.write(data)
                try? handle.close()
            }
        } else {
            try? data.write(to: url, options: .atomic)
        }
    }
}

// AXObserver callbacks are C function pointers, so the listener is passed
// through the refcon rather than captured.
private let shortcutListenerFocusChanged: AXObserverCallback = { _, _, _, context in
    guard let context else { return }
    let listener = Unmanaged<ShortcutListener>.fromOpaque(context).takeUnretainedValue()
    DispatchQueue.main.async { listener.focusChangedFromObserver() }
}

private let paletteFallbackScopeRank = -2

// This accessory app has no main Edit menu. Route its standard equivalents to
// the active field editor instead of letting NSApplication discard them.
// The palette's colours: the settings panel's warm dark neutrals and its orange
// accent. Three copies, change all of them together: client/styles.css :root,
// native/PRFXShortcutListener.swift PaletteStyle (this one) and
// native/windows/Win/PaletteForm.cs PaletteStyle.
private enum PaletteStyle {
    static func hex(_ v: Int, _ alpha: CGFloat = 1) -> NSColor {
        NSColor(srgbRed: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: alpha)
    }
    static let canvas = hex(0x262624)
    static let card = hex(0x2f2f2d)
    static let line = hex(0x3e3e38)
    static let text = hex(0xeceae3)
    static let muted = hex(0xa3a096)
    static let faint = hex(0x6f6c64)
    static let accent = hex(0xff9a3d)
    static let accentSoft = hex(0xff9a3d, 0.22)
    static let orange = hex(0xd4a26a), blue = hex(0x86a6d0), cyan = hex(0x7db5ae), purple = hex(0xa99cd4)
    // Media wears Premiere's default label colours (Preferences ▸ Labels): Violet video, Caribbean audio,
    // Lavender stills, Forest sequences, Iris the rest. Each tab takes its type's colour, each item its own kind's.
    static let labelVideo = hex(0xa690e0), labelAudio = hex(0x29d698), labelStill = hex(0xe385e3), labelOther = hex(0x729acc), labelSequence = hex(0x51b858)
    static func label(_ category: PaletteCategory) -> NSColor {
        switch category {
        case .commands: return accent
        case .video: return labelVideo
        case .audio, .sfx, .bgm: return labelAudio
        case .media: return labelOther
        case .sequences: return labelSequence
        }
    }
    static func label(_ m: PaletteMedia) -> NSColor {
        switch m.kind {
        case "video": return labelVideo
        case "audio": return labelAudio
        case "image": return labelStill
        case "sequence": return labelSequence
        default: return labelOther
        }
    }

    static func colour(_ type: String) -> NSColor {
        switch type {
        case "transition", "transition-placement": return blue
        case "audio-transition": return cyan
        case "custom", "move-mode", "stagger-frames": return accent
        case "preset", "ai-function": return purple
        default: return orange
        }
    }

    static func symbol(_ type: String) -> String {
        switch type {
        case "ai-function": return "sparkles"
        case "custom": return "bolt.fill"
        case "effect": return "wand.and.stars"
        case "audio-effect": return "speaker.wave.2.fill"
        case "transition": return "rectangle.righthalf.inset.filled"
        case "audio-transition": return "waveform.path"
        case "preset": return "star.fill"
        case "transition-placement": return "arrow.left.and.right"
        case "move-mode": return "arrow.up.arrow.down"
        case "stagger-frames": return "stairs"
        default: return "circle.fill"
        }
    }

    static func mediaSymbol(_ media: PaletteMedia) -> String {
        if PaletteSearch.category(of: media) == .bgm { return "music.note" }
        switch media.kind {
        case "video": return "film"
        case "audio": return "waveform"
        case "image": return "photo"
        case "sequence": return "film.stack"
        default: return "square.stack.3d.up"
        }
    }
}

private final class PalettePanel: NSPanel {
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard let editor = firstResponder as? NSTextView,
              editor.isFieldEditor, editor.isEditable else {
            return super.performKeyEquivalent(with: event)
        }
        let modifiers = event.modifierFlags.intersection([.command, .shift, .option, .control])
        let key = event.charactersIgnoringModifiers?.lowercased()
        if modifiers == [.command] {
            switch key {
            case "a": editor.selectAll(nil)
            case "c": editor.copy(nil)
            case "x": editor.cut(nil)
            case "v": editor.paste(nil)
            case "z":
                if editor.undoManager?.canUndo == true { editor.undoManager?.undo() }
            default: return super.performKeyEquivalent(with: event)
            }
            return true
        }
        if modifiers == [.command, .shift], key == "z" {
            if editor.undoManager?.canRedo == true { editor.undoManager?.redo() }
            return true
        }
        return super.performKeyEquivalent(with: event)
    }
}

final class ShortcutListener: NSObject {
    let settingsURL: URL
    private let catalogURL: URL
    private let paletteFrameURL: URL
    private let timelineRegionURL: URL
    private var settings: Settings
    private var singleInstanceLockHandle: FileHandle?
    private var bridgeReady = false
    private var hotKeyRefs: [EventHotKeyRef] = []
    private var hotKeyCommands: [UInt32: Command] = [:]
    // Which shortcut each id was registered for, so the scope can be re-checked
    // against THAT key when it fires rather than against "any key at all".
    private var hotKeyShortcuts: [UInt32: Shortcut] = [:]
    private var failedHotKeyIDs: Set<UInt32> = []
    private var lastHotKeyRetryAt = Date.distantPast
    private var eventHandler: EventHandlerRef?
    private var panel: NSPanel?
    private var searchField: NSTextField?
    private var listView: NSTableView?
    private var paletteFooter: NSTextField?
    // Laid out like Sage's search in Creative Assist (PRFXPaletteSearch.swift): Commands and Media,
    // Tab and Shift+Tab between them, each with its count; rows grouped under coloured section names.
    private var tabsView: PaletteTabsView?
    private var paletteCategory: PaletteCategory = .commands
    private var paletteRows: [PaletteRow] = []
    private var paletteMedia: [PaletteMedia] = []
    private var mediaAskedAt: Date?
    private var mediaLoadedAt: Date?
    private var mediaError: String?
    private var recentCommandKeys: [String] = []
    private var recentMediaIDs: [String] = []
    private var shortcutLabels: [String: String] = [:]
    // 640 wide so the five tabs (Commands, Media, Video, SFX, BGM) fit on one line with their counts.
    private let paletteSize = NSSize(width: 640, height: 440)
    private var pendingTransitionCommand: Command?
    private var pendingMoveCommand: Command?
    private var pendingStaggerCommand: Command?
    private var catalogQuery = ""
    private var visibleCommands: [Command] = []
    private var commandBridge: CommandBridge?
    private let paletteFrameDefaultsKey = "PRFXPaletteWindowFrame.v1"
    private var paletteFrameSaveTimer: Timer?
    private var hotKeyRefreshTimer: Timer?
    private var lastSavedPaletteFrameString = ""
    private var isSubmittingPaletteCommand = false
    private var catalogRevision = 0
    private var catalogFingerprint = ""
    private var focusPollTimer: Timer?
    private var axObserver: AXObserver?
    private var axObservedPid: pid_t = 0
    private var axObservedElement: AXUIElement?
    private var shortcutScopeReason = "Starting"
    private var clickMonitor: Any?
    // Last mouse-down in Accessibility coordinates (top-left origin).
    private var lastClickPoint: CGPoint?
    private var timelineRegionCache = TimelineRegionCache()
    private var timelineDetectionDetails = "No live lookup yet"
    private var lastScanTabStrips = 0
    // Controls of the last matched window scan, stored with the region.
    private var lastScanControls: CGRect?
    private var lastScanMarkers: [CGRect] = []
    // The Timeline's own toolbar (Snap, Display Settings…): one set per
    // Timeline, and kept current by Premiere when the track headers aren't.
    private var lastScanToolbar: [CGRect] = []
    private static let timelineToolbarMarkers: Set<String> = [
        "Snap in Timeline", "Timeline Display Settings", "Caption track options",
        "Insert and overwrite sequences as nests or individual clips"
    ]
    private let panelSnapshotter = PanelSnapshotter()
    // What the last Accessibility walk said (or the saved region), for
    // picking the Timeline out of a capture that lands after that walk.
    private var lastPixelReference: CGRect?
    private var dockedTimelineRegion: CGRect?
    private var lastInferredLog = Date.distantPast
    private var lastHighlightWindow: CGRect?
    private var lastScanElements = 0
    private var attemptedTimelineRegionLogRestore = false
    private var registeredScopeRank = -1
    private var settingsFileModifiedAt: Date?
    private var settingsRevision = 0
    // Diagnostic state. The logging itself lives in PRFXAccessibilityProbe.swift;
    // stored properties cannot, because Swift extensions may not add storage.
    var lastDiagnosticFingerprint = ""
    var lastProbeAt = Date.distantPast
    var lastProbeFingerprint = ""
    // Event-tap delivery. See PRFXKeyTap.swift for why Carbon was replaced.
    private var keyTap: KeyTap?
    private var chordTable = ChordTable()
    private var chordShortcuts: [UInt32: Shortcut] = [:]
    private var chordCommands: [UInt32: Command] = [:]
    // Key codes whose keyDown was consumed; their keyUp and auto-repeats are
    // consumed too so Premiere never sees half a keystroke.
    private var swallowedKeyCodes: Set<UInt16> = []
    // Refreshed by every scope evaluation, read by the tap without any
    // Accessibility call: the tap must never block on a busy Premiere.
    private var cachedTextInputRole: String?
    private var cachedTextInputFrame: CGRect?
    private var currentScope: ShortcutScope = .none("Starting")
    private var loggedScopeRank = -99
    // Last state announced with a banner ("armed", "full-window", "other"), so
    // activation banners fire on transitions only.
    private var announcedScopeKind = ""
    private var secureInputActive = false
    private var lastTapAttemptAt = Date.distantPast
    private var loggedTapUnavailable = false
    private var keyStats = KeyStats()
    private var commandSeq = 0
    private var inFlight: [Int: (key: String, name: String, firedAt: Date)] = [:]
    private let journal = KeyJournal()
    private let toast = FeedbackToast()
    private let highlight = TimelineHighlight()
    private var workingAISeq: Int?
    private var highlightTimer: Timer?
    private var nudges = EdieNudges()
    private var commands = prfxFallbackCommands + [
        Command(type: "effect", name: "Gaussian Blur", transitionFrames: 30, id: nil),
        Command(type: "effect", name: "Lumetri Color", transitionFrames: 30, id: nil),
        Command(type: "effect", name: "Crop", transitionFrames: 30, id: nil)
    ]

    override init() {
        let support = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/PR FX Palette", isDirectory: true)
        settingsURL = support.appendingPathComponent("settings.json")
        catalogURL = support.appendingPathComponent("catalog.json")
        paletteFrameURL = support.appendingPathComponent("palette-frame.txt")
        timelineRegionURL = support.appendingPathComponent("timeline-region.txt")
        settings = Settings(shortcut: Shortcut(code: "Space", ctrl: true, alt: false, shift: false, meta: false), transitionFrames: 30, staggerFrames: 5, staggerGroup: 1, bindings: [], shortcutFeedback: "problems", announceScope: "on", timelineHighlight: "off")
        super.init()
        listenerLog("Listener build: \(prfxListenerBuild)")
        guard acquireSingleInstanceLock() else {
            listenerLog("Another PR FX Shortcut Listener instance is already active; exiting before registering shortcuts.")
            DispatchQueue.main.async { NSApp.terminate(nil) }
            return
        }
        loadCatalog()
        commandBridge = try? CommandBridge(
            catalogHandler: { [weak self] catalog, fingerprint in
                DispatchQueue.main.async {
                    guard let self else { return }
                    guard catalog.count >= 25 else {
                        listenerLog("Rejected incomplete catalog: \(catalog.count) command(s)")
                        return
                    }
                    let sanitized = self.sanitizedCatalog(catalog)
                    if self.catalogFingerprint == fingerprint && self.commands.count == sanitized.count {
                        return
                    }
                    // CEP is the single command registry. Native keeps only a
                    // small fallback list for pre-CEP startup and then adopts
                    // CEP's exact catalog so split variants cannot drift.
                    self.commands = sanitized
                    self.catalogFingerprint = fingerprint
                    self.saveCatalog()
                    self.catalogRevision += 1
                    listenerLog("Catalog synced: \(sanitized.count) command(s), revision \(self.catalogRevision), fingerprint \(fingerprint)")
                    self.filterCommands()
                }
            },
            healthHandler: { [weak self] in self?.healthPayload() ?? "{\"mode\":\"offline\",\"bindings\":0}" },
            settingsReloadHandler: { [weak self] in DispatchQueue.main.async {
                self?.loadSettings()
                self?.filterCommands()
                self?.refreshHotKeys()
            }},
            stateHandler: { [weak self] state in
                DispatchQueue.main.async { self?.commandBridgeStateChanged(state) }
            },
            outcomeHandler: { [weak self] outcome in
                DispatchQueue.main.async { self?.recordOutcome(outcome) }
            },
            controlToken: ShortcutListener.writeBridgeToken(in: support),
            controlHandler: { [weak self] route, body in
                DispatchQueue.main.async { self?.handleControl(route, body: body) }
            },
            catalogPayloadHandler: { [weak self] in
                guard let self, let data = try? JSONEncoder().encode(self.commands) else { return "[]" }
                return String(data: data, encoding: .utf8) ?? "[]"
            },
            settingsPayloadHandler: { [weak self] in
                guard let self, let data = try? Data(contentsOf: self.settingsURL) else { return "{}" }
                return String(data: data, encoding: .utf8) ?? "{}"
            },
            settingsWriteHandler: { [weak self] patch in
                self?.writeSettingsPatch(patch) ?? "{\"error\":\"listener unavailable\"}"
            }
        )
        guard commandBridge != nil else {
            listenerLog("Command bridge could not start. Another PR FX listener may already be running; this instance will exit instead of grabbing shortcuts without a bridge.")
            DispatchQueue.main.async { NSApp.terminate(nil) }
            return
        }
        commandBridge?.mediaHandler = { [weak self] body in
            let list = try? JSONDecoder().decode(PaletteMediaList.self, from: body)
            DispatchQueue.main.async { self?.receiveMedia(list) }
        }
        loadSettings()
        loadPaletteRecent()
        promptForAccessibilityIfNeeded()
        observeClicks()
        startHighlightRefresh()
        observeFrontmostApplication()
        makePalette()
        NotificationCenter.default.addObserver(self, selector: #selector(listenerWillResignActive(_:)), name: NSApplication.willResignActiveNotification, object: nil)
        let sweep = Timer(timeInterval: 1.0, repeats: true) { [weak self] _ in self?.commandBridge?.sweep() }
        RunLoop.main.add(sweep, forMode: .common)
    }

    private func acquireSingleInstanceLock() -> Bool {
        let lockURL = settingsURL.deletingLastPathComponent().appendingPathComponent("listener.lock")
        do {
            try FileManager.default.createDirectory(at: lockURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            if !FileManager.default.fileExists(atPath: lockURL.path) {
                FileManager.default.createFile(atPath: lockURL.path, contents: nil)
            }
            let handle = try FileHandle(forWritingTo: lockURL)
            guard flock(handle.fileDescriptor, LOCK_EX | LOCK_NB) == 0 else {
                try? handle.close()
                return false
            }
            singleInstanceLockHandle = handle
            try? handle.truncate(atOffset: 0)
            if let data = "\(ProcessInfo.processInfo.processIdentifier)\n".data(using: .utf8) {
                handle.write(data)
                handle.synchronizeFile()
            }
            listenerLog("Singleton listener lock acquired.")
            return true
        } catch {
            listenerLog("Could not create listener singleton lock: \(error.localizedDescription). Shortcuts stay disabled.")
            return false
        }
    }

    private func commandBridgeStateChanged(_ state: NWListener.State) {
        switch state {
        case .ready:
            bridgeReady = true
            listenerLog("Command bridge ready; hotkeys may arm.")
            refreshHotKeys()
        case .failed(let error):
            bridgeReady = false
            unregisterHotKeys()
            listenerLog("Command bridge failed before/after startup: \(error.localizedDescription). Hotkeys disabled.")
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { NSApp.terminate(nil) }
        case .cancelled:
            bridgeReady = false
            unregisterHotKeys()
            listenerLog("Command bridge cancelled; hotkeys disabled.")
        default:
            break
        }
    }

    private func loadCatalog() {
        guard let data = try? Data(contentsOf: catalogURL),
              let catalog = try? JSONDecoder().decode([Command].self, from: data),
              catalog.count >= 25 else { return }
        commands = sanitizedCatalog(catalog)
        catalogFingerprint = ""
        listenerLog("Restored cached catalog: \(catalog.count) command(s)")
    }

    private func saveCatalog() {
        guard commands.count >= 25, let data = try? JSONEncoder().encode(commands) else { return }
        try? FileManager.default.createDirectory(at: catalogURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: catalogURL, options: .atomic)
    }

    private func sanitizedCatalog(_ catalog: [Command]) -> [Command] {
        return catalog.filter { command in
            if let id = command.id, retiredCommandIDs.contains(id) { return false }
            return true
        }
    }

    deinit {
        focusPollTimer?.invalidate()
        hotKeyRefreshTimer?.invalidate()
        if let clickMonitor { NSEvent.removeMonitor(clickMonitor) }
        removeFocusObserver()
        keyTap?.invalidate()
        unregisterHotKeys()
        if let eventHandler { RemoveEventHandler(eventHandler) }
        if let handle = singleInstanceLockHandle {
            flock(handle.fileDescriptor, LOCK_UN)
            try? handle.close()
        }
        NSWorkspace.shared.notificationCenter.removeObserver(self)
    }

    private func settingsSignature(_ value: Settings) -> String {
        guard let data = try? JSONEncoder().encode(value) else { return "" }
        return String(data: data, encoding: .utf8) ?? ""
    }

    private func settingsModificationDate() -> Date? {
        let attributes = try? FileManager.default.attributesOfItem(atPath: settingsURL.path)
        return attributes?[.modificationDate] as? Date
    }

    private func writeSettingsPatch(_ patchData: Data) -> String {
        guard let patch = (try? JSONSerialization.jsonObject(with: patchData)) as? [String: Any] else {
            return "{\"error\":\"invalid settings patch\"}"
        }
        var current: [String: Any] = [:]
        if let data = try? Data(contentsOf: settingsURL),
           let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            current = value
        }
        for (key, value) in patch { current[key] = value }
        guard JSONSerialization.isValidJSONObject(current),
              let data = try? JSONSerialization.data(withJSONObject: current, options: []) else {
            return "{\"error\":\"settings could not be encoded\"}"
        }
        let temp = settingsURL.deletingLastPathComponent().appendingPathComponent("settings.uxp.\(ProcessInfo.processInfo.processIdentifier).tmp")
        do {
            try FileManager.default.createDirectory(at: settingsURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: temp, options: .atomic)
            if FileManager.default.fileExists(atPath: settingsURL.path) {
                _ = try FileManager.default.replaceItemAt(settingsURL, withItemAt: temp)
            } else {
                try FileManager.default.moveItem(at: temp, to: settingsURL)
            }
        } catch {
            try? FileManager.default.removeItem(at: temp)
            return "{\"error\":\"settings were not saved\"}"
        }
        DispatchQueue.main.async { [weak self] in
            self?.loadSettings()
            self?.filterCommands()
            self?.refreshHotKeys()
        }
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    @discardableResult
    private func loadSettings() -> Bool {
        let previousSignature = settingsSignature(settings)
        guard let data = try? Data(contentsOf: settingsURL) else {
            settingsFileModifiedAt = settingsModificationDate()
            return false
        }
        do {
            let loaded = try JSONDecoder().decode(Settings.self, from: data)
            let bindings = (loaded.bindings ?? []).filter { binding in
                guard let id = binding.command.id else { return true }
                return !retiredCommandIDs.contains(id)
            }.map { binding -> Binding in
                let renamed = ["undo-last-palette-action": "Undo Last Edie Effect Apply", "undo-last-prfx-action": "Undo Last Edie Action (Any)",
                               "undo-last-arrange": "Undo Last Edie Arrange Action", "redo-last-arrange": "Redo Last Edie Arrange Action"]
                if let id = binding.command.id, let name = renamed[id] {
                    return Binding(shortcut: binding.shortcut, command: Command(type: "custom", name: name, transitionFrames: binding.command.transitionFrames, id: id))
                }
                if binding.command.id == "remove-transitions" {
                    return Binding(shortcut: binding.shortcut, command: Command(type: "custom", name: "Remove Transitions on Selected Clips", transitionFrames: binding.command.transitionFrames, id: binding.command.id))
                }
                return binding
            }
            settings = Settings(shortcut: loaded.shortcut, transitionFrames: loaded.transitionFrames, staggerFrames: loaded.staggerFrames ?? 5, staggerGroup: loaded.staggerGroup ?? 1, bindings: bindings, shortcutFeedback: loaded.shortcutFeedback ?? "problems", announceScope: loaded.announceScope ?? "on", timelineHighlight: loaded.timelineHighlight ?? "off", edieNudges: loaded.edieNudges, edieNudgeMinutes: loaded.edieNudgeMinutes)
            settingsFileModifiedAt = settingsModificationDate()
            let changed = settingsSignature(settings) != previousSignature
            if changed { settingsRevision += 1 }
            rebuildChordTable()
            listenerLog("Loaded \((settings.bindings ?? []).count) command shortcut(s)" + (changed ? " [settings revision \(settingsRevision)]" : ""))
            return changed
        } catch {
            listenerLog("Settings load failed: \(error.localizedDescription)")
            return false
        }
    }

    private func expectedArmCounts(for focus: ShortcutScope) -> (armed: Int, withheld: Int) {
        var armed = 0
        var withheld = 0
        for binding in settings.bindings ?? [] {
            if focus.arms(binding.shortcut, command: binding.command) { armed += 1 }
            else { withheld += 1 }
        }
        return (armed, withheld)
    }

    @discardableResult
    private func reloadSettingsIfNeeded() -> Bool {
        let current = settingsModificationDate()
        if let current, let known = settingsFileModifiedAt,
           abs(current.timeIntervalSince(known)) < 0.001 {
            return false
        }
        if current == nil && settingsFileModifiedAt == nil { return false }
        listenerLog("Detected settings.json change; reloading shortcut bindings")
        return loadSettings()
    }

    private func healthPayload() -> String {
        if !Thread.isMainThread {
            return DispatchQueue.main.sync { self.healthPayload() }
        }
        let accessibilityTrusted = prfxBypassAccessibilityFocus ? false : AXIsProcessTrusted()
        let mode: String
        if usesKeyTap && isPremiere(NSWorkspace.shared.frontmostApplication) && bridgeReady {
            switch currentScope {
            case .full: mode = "active"
            case .modifierOnly, .otherPanel: mode = "modifier-only"
            case .none: mode = "paused"
            }
        } else if isPremiere(NSWorkspace.shared.frontmostApplication) && !hotKeyRefs.isEmpty {
            if registeredScopeRank == paletteFallbackScopeRank {
                mode = "palette-only"
            } else if registeredScopeRank == 1 || registeredScopeRank == 3 {
                mode = "modifier-only"
            } else {
                mode = "active"
            }
        } else {
            mode = "paused"
        }
        let pending = commandBridge?.pendingName() ?? ""
        let paletteFrameSaved = FileManager.default.fileExists(atPath: paletteFrameURL.path) ? "true" : "false"
        let savedBindings = (settings.bindings ?? []).count
        let armedBindings = usesKeyTap ? expectedArmCounts(for: currentScope).armed : hotKeyCommands.count
        let withheldBindings = max(0, savedBindings - armedBindings)
        let deliveryMode = usesKeyTap ? "event-tap" : (secureInputActive ? "carbon-secure-input" : "carbon")
        let transport = (commandBridge?.queueHealth() ?? "") + ",\"failedRegistrations\":\(usesKeyTap ? 0 : failedHotKeyIDs.count),\"deliveryMode\":\"\(deliveryMode)\",\"tapReenables\":\(keyTap?.reenableCount ?? 0),\"keyStats\":\(keyStats.json())"
        let detection = ",\"timelineRegion\":\"\(jsonEscape(timelineRegionCache.liveRegion.map(NSStringFromRect) ?? ""))\",\"savedTimelineRegion\":\"\(jsonEscape(timelineRegionCache.lastKnownRegion.map(NSStringFromRect) ?? ""))\",\"lastClick\":\"\(jsonEscape(lastClickPoint.map(NSStringFromPoint) ?? ""))\",\"timelineDetection\":\"\(jsonEscape(timelineDetectionDetails))\",\"focusPollingActive\":\(focusPollTimer?.isValid == true),\"lookupAgeSeconds\":\(Date().timeIntervalSince(timelineRegionCache.lastLookupAt))"
            + ",\"geometry\":{\"live\":\(rectJSON(timelineRegionCache.liveRegion)),\"saved\":\(rectJSON(timelineRegionCache.lastKnownRegion)),\"window\":\(rectJSON(premiereWindowFrame())),\"click\":\(lastClickPoint.map { "[\(Int($0.x)),\(Int($0.y))]" } ?? "null"),\"panelsHidden\":\(timelineRegionCache.panelsHidden),\"premiereFrontmost\":\(isPremiere(NSWorkspace.shared.frontmostApplication))}"
            + ",\"scopeKind\":\"\(scopeKindName(keystrokeScope()))\",\"keyScope\":\"\(jsonEscape(keystrokeScope().reason))\",\"feedback\":\"\(jsonEscape(feedbackMode))\",\"announceScope\":\"\(jsonEscape(settings.announceScope ?? "on"))\""
        return "{\"mode\":\"\(mode)\",\"listenerBuild\":\"\(jsonEscape(prfxListenerBuild))\",\"bindings\":\(savedBindings),\"armedBindings\":\(armedBindings),\"withheldBindings\":\(withheldBindings),\"accessibilityTrusted\":\(accessibilityTrusted ? "true" : "false"),\"accessibilityBypassed\":\(prfxBypassAccessibilityFocus ? "true" : "false"),\"catalogCount\":\(commands.count),\"catalogRevision\":\(catalogRevision),\"catalogFingerprint\":\"\(jsonEscape(catalogFingerprint))\",\"pendingCommand\":\"\(jsonEscape(pending))\",\"focus\":\"\(jsonEscape(shortcutScopeReason))\",\"paletteFrameSaved\":\(paletteFrameSaved)\(detection)\(transport)}"
    }

    // Carbon hotkeys are global by API design and consume registered keys.
    // Modifier-less shortcuts must stay Timeline-aware so typing in bins, search
    // fields, and rename fields passes through. Modifier shortcuts can degrade
    // to Premiere-frontmost when Timeline detection is unavailable.
    private func promptForAccessibilityIfNeeded() {
        guard !prfxBypassAccessibilityFocus else {
            listenerLog("Accessibility focus detection bypassed; shortcuts scope to Premiere frontmost.")
            return
        }
        guard !AXIsProcessTrusted() else { return }
        listenerLog("Accessibility is not granted; prompting. Modifier shortcuts may arm from Premiere, while Shift/plain keys need a saved Timeline region.")
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
    }

    private func observeFrontmostApplication() {
        let notifications = NSWorkspace.shared.notificationCenter
        notifications.addObserver(self, selector: #selector(frontmostApplicationChanged(_:)), name: NSWorkspace.didActivateApplicationNotification, object: nil)
        notifications.addObserver(self, selector: #selector(frontmostApplicationChanged(_:)), name: NSWorkspace.didTerminateApplicationNotification, object: nil)
        updateFocusPolling()
    }

    @objc private func frontmostApplicationChanged(_ notification: Notification) {
        DispatchQueue.main.async { [weak self] in
            self?.panelSnapshotter.expire()
            self?.timelineRegionCache.invalidate()
            self?.updateFocusPolling()
            self?.updateHotKeyRegistration(force: false)
        }
    }

    private func refreshHotKeys() {
        updateHotKeyRegistration(force: true)
    }

    private func scheduleHotKeyRefresh(after delay: TimeInterval = 0.08) {
        hotKeyRefreshTimer?.invalidate()
        let timer = Timer(timeInterval: delay, repeats: false) { [weak self] timer in
            timer.invalidate()
            guard let self else { return }
            self.hotKeyRefreshTimer = nil
            self.timelineRegionCache.invalidate()
            self.updateFocusPolling()
            self.updateHotKeyRegistration(force: false)
        }
        hotKeyRefreshTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func updateFocusPolling() {
        guard let premiere = NSWorkspace.shared.runningApplications.first(where: isPremiere),
              isPremiere(NSWorkspace.shared.frontmostApplication) else {
            focusPollTimer?.invalidate()
            focusPollTimer = nil
            removeFocusObserver()
            return
        }
        if prfxBypassAccessibilityFocus {
            removeFocusObserver()
            guard focusPollTimer == nil else { return }
            let timer = Timer(timeInterval: 1.0, repeats: true) { [weak self] _ in
                self?.updateHotKeyRegistration(force: false)
            }
            focusPollTimer = timer
            RunLoop.main.add(timer, forMode: .common)
            return
        }
        // Accessibility notifications drive scope changes; the timer is only a
        // safety net for notifications Premiere fails to emit, so it can run far
        // slower than the old 0.35s poll and still never leave a hotkey armed
        // for long. Each poll walks the AX focus chain, so this also cuts the
        // steady-state cost by roughly two thirds.
        installFocusObserver(for: premiere)
        guard focusPollTimer == nil else { return }
        let timer = Timer(timeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.updateHotKeyRegistration(force: false)
        }
        focusPollTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    // A Carbon hotkey consumes the keystroke the moment it fires, so any delay
    // between focus leaving the Timeline and the hotkey being unregistered is a
    // window where a keypress meant for another panel is swallowed instead of
    // reaching Premiere. Observing focus directly closes that window.
    private func installFocusObserver(for application: NSRunningApplication) {
        let pid = application.processIdentifier
        if axObserver != nil && axObservedPid == pid { return }
        removeFocusObserver()
        guard AXIsProcessTrusted() else { return }
        var created: AXObserver?
        guard AXObserverCreate(pid, shortcutListenerFocusChanged, &created) == .success,
              let observer = created else {
            listenerLog("Focus observer unavailable; falling back to timer polling only")
            return
        }
        let element = AXUIElementCreateApplication(pid)
        let context = Unmanaged.passUnretained(self).toOpaque()
        var attached = 0
        for notification in [kAXFocusedUIElementChangedNotification, kAXFocusedWindowChangedNotification] {
            if AXObserverAddNotification(observer, element, notification as CFString, context) == .success {
                attached += 1
            }
        }
        guard attached > 0 else {
            listenerLog("Focus observer rejected by Premiere; falling back to timer polling only")
            return
        }
        CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes)
        axObserver = observer
        axObservedPid = pid
        axObservedElement = element
        listenerLog("Focus observer attached to Premiere (pid \(pid))")
    }

    private func removeFocusObserver() {
        guard let observer = axObserver else {
            axObservedPid = 0
            axObservedElement = nil
            return
        }
        if let element = axObservedElement {
            AXObserverRemoveNotification(observer, element, kAXFocusedUIElementChangedNotification as CFString)
            AXObserverRemoveNotification(observer, element, kAXFocusedWindowChangedNotification as CFString)
        }
        CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes)
        axObserver = nil
        axObservedPid = 0
        axObservedElement = nil
    }

    fileprivate func focusChangedFromObserver() {
        timelineRegionCache.invalidate()
        updateHotKeyRegistration(force: false)
    }

    private func updateHotKeyRegistration(force: Bool) {
        let settingsChanged = reloadSettingsIfNeeded()
        let shouldForce = force || settingsChanged
        updateDeliveryMode()
        guard bridgeReady else {
            shortcutScopeReason = "Command bridge is not ready"
            currentScope = .none("Command bridge is not ready")
            if !hotKeyRefs.isEmpty { unregisterHotKeys() }
            if shouldForce { listenerLog("Timeline shortcuts paused: command bridge is not ready") }
            return
        }
        let focus = timelineShortcutFocus()
        shortcutScopeReason = focus.reason
        currentScope = focus
        announceScopeIfChanged(focus)
        if !prfxBypassAccessibilityFocus {
            logAXDiagnostic(verdict: (focus.armsAnything, focus.reason))
            logAXPanelProbe()
        }
        if usesKeyTap {
            // Nothing to register: the tap reads `currentScope` and friends on
            // each keystroke. Only log when the armed set actually changes.
            if !hotKeyRefs.isEmpty { unregisterHotKeys() }
            if shouldForce || focus.rank != loggedScopeRank {
                loggedScopeRank = focus.rank
                let counts = expectedArmCounts(for: focus)
                listenerLog("Shortcut scope (event tap): \(focus.reason) — \(counts.armed) live, \(counts.withheld) withheld")
            }
            return
        }
        guard focus.armsAnything else {
            if canArmPaletteWithoutAccessibility() {
                if !shouldForce && registeredScopeRank == paletteFallbackScopeRank {
                    retryFailedHotKeys()
                    return
                }
                unregisterHotKeys()
                installHotKeyHandler()
                registerHotKey(settings.shortcut, id: 1, command: nil)
                registeredScopeRank = paletteFallbackScopeRank
                if shouldForce {
                    listenerLog("Palette shortcut active without Accessibility; command shortcuts paused: \(focus.reason)")
                }
                return
            }
            if !hotKeyRefs.isEmpty { unregisterHotKeys() }
            if shouldForce { listenerLog("Timeline shortcuts paused: \(focus.reason)") }
            return
        }
        // Re-register when the set of armable shortcuts changes, not merely when
        // the reason text does. unregisterHotKeys() resets the rank, so an
        // explicit release always re-arms on the next evaluation.
        if !shouldForce && registeredScopeRank == focus.rank {
            retryFailedHotKeys()
            return
        }
        unregisterHotKeys()
        installHotKeyHandler()
        var armed = 0
        var withheld = 0
        if focus.arms(settings.shortcut) {
            registerHotKey(settings.shortcut, id: 1, command: nil)
            armed += 1
        } else { withheld += 1 }
        for (offset, binding) in (settings.bindings ?? []).enumerated() {
            if focus.arms(binding.shortcut, command: binding.command) {
                registerHotKey(binding.shortcut, id: UInt32(offset + 2), command: binding.command)
                armed += 1
            } else { withheld += 1 }
        }
        registeredScopeRank = focus.rank
        listenerLog("Timeline shortcuts active (\(focus.reason)): \(armed) armed"
            + (withheld > 0 ? ", \(withheld) withheld — modifier-less keys need the Timeline located" : ""))
    }

    // MARK: Event-tap delivery

    // Secure keyboard entry (password fields, Terminal's option, some password
    // managers) blinds every event tap system-wide while Carbon hotkeys keep
    // working, so Carbon stays as the fallback for exactly that window and for
    // a listener without Accessibility.
    private var usesKeyTap: Bool { keyTap != nil && !secureInputActive }

    private func updateDeliveryMode() {
        let secure = IsSecureEventInputEnabled()
        if secure != secureInputActive {
            secureInputActive = secure
            registeredScopeRank = -1
            loggedScopeRank = -99
            if secure {
                listenerLog("Secure keyboard entry is on in some app; the event tap cannot see keys, so Carbon hotkeys take over until it turns off")
            } else {
                unregisterHotKeys()
                listenerLog("Secure keyboard entry is off; event tap delivery resumed")
            }
        }
        if let keyTap {
            if keyTap.ensureEnabled() { listenerLog("Event tap was disabled by macOS; re-enabled") }
            return
        }
        guard !prfxBypassAccessibilityFocus, AXIsProcessTrusted(),
              Date().timeIntervalSince(lastTapAttemptAt) >= 10 else { return }
        lastTapAttemptAt = Date()
        keyTap = KeyTap(handler: { [unowned self] type, event in
            self.handleTapEvent(type, event)
        }, onReenable: { reason in
            listenerLog("Event tap re-enabled after macOS disabled it (\(reason))")
        })
        if keyTap != nil {
            unregisterHotKeys()
            loggedScopeRank = -99
            listenerLog("Event tap active: shortcuts are decided per keystroke and never unregistered (\(chordTable.count) chord(s))")
        } else if !loggedTapUnavailable {
            loggedTapUnavailable = true
            listenerLog("Event tap unavailable even with Accessibility; requesting Input Monitoring and staying on Carbon hotkeys")
            if !CGPreflightListenEventAccess() { _ = CGRequestListenEventAccess() }
        }
    }

    private func rebuildChordTable() {
        var table = ChordTable()
        var shortcuts: [UInt32: Shortcut] = [:]
        var mapped: [UInt32: Command] = [:]
        let palette = settings.shortcut
        table.add(code: palette.code, ctrl: palette.ctrl, alt: palette.alt, shift: palette.shift, cmd: palette.meta, id: 1, label: "palette \(display(palette))")
        shortcuts[1] = palette
        for (offset, binding) in (settings.bindings ?? []).enumerated() {
            let id = UInt32(offset + 2)
            let key = binding.shortcut
            table.add(code: key.code, ctrl: key.ctrl, alt: key.alt, shift: key.shift, cmd: key.meta, id: id, label: "\(display(key)) → \(binding.command.name)")
            shortcuts[id] = key
            mapped[id] = binding.command
        }
        for label in table.duplicates { listenerLog("Shortcut conflict: \(label) reuses a chord already bound; the first binding wins") }
        for label in table.unmappable { listenerLog("Shortcut skipped: \(label) uses a key the listener cannot map") }
        chordTable = table
        chordShortcuts = shortcuts
        chordCommands = mapped
    }

    // Runs inside the tap callback: decide, nothing else. No Accessibility
    // calls (a busy Premiere would stall every keystroke on the machine) and
    // no logging or file I/O -- that is dispatched after the decision.
    private func handleTapEvent(_ type: CGEventType, _ event: CGEvent) -> Bool {
        switch type {
        case .leftMouseDown, .rightMouseDown:
            // Recorded here, synchronously, so a click on the Timeline followed
            // at once by a keypress is judged against the new click.
            if isPremiere(NSWorkspace.shared.frontmostApplication) {
                lastClickPoint = event.location
                DispatchQueue.main.async { [weak self] in
                    self?.updateHotKeyRegistration(force: false)
                    self?.scheduleHotKeyRefresh()
                }
            }
            return false
        case .leftMouseUp:
            // The end of a drag: a panel divider, a resized or moved window,
            // a workspace tab. The panel may have moved, so look again.
            if isPremiere(NSWorkspace.shared.frontmostApplication) {
                DispatchQueue.main.async { [weak self] in self?.relookTimelineAfterDrag() }
            }
            return false
        case .keyUp:
            let code = UInt16(truncatingIfNeeded: event.getIntegerValueField(.keyboardEventKeycode))
            return swallowedKeyCodes.remove(code) != nil
        case .keyDown:
            break
        default:
            return false
        }
        let code = UInt16(truncatingIfNeeded: event.getIntegerValueField(.keyboardEventKeycode))
        if event.getIntegerValueField(.keyboardEventAutorepeat) != 0 {
            // Holding a consumed shortcut must not leak repeats into Premiere,
            // and must not fire the command again either.
            return swallowedKeyCodes.contains(code)
        }
        // A fresh press means any earlier press of this key has ended. If its
        // keyUp was lost (tap briefly disabled), the stale entry must not eat
        // this press's keyUp and leave Premiere with a key that never lifted.
        swallowedKeyCodes.remove(code)
        guard let id = chordTable.id(for: KeyChord(keyCode: code, flags: event.flags)),
              let shortcut = chordShortcuts[id],
              isPremiere(NSWorkspace.shared.frontmostApplication) else { return false }
        let scope: ShortcutScope = bridgeReady ? keystrokeScope() : .none("Command bridge is not ready")
        let label = display(shortcut)
        guard scope.arms(shortcut, command: chordCommands[id]) || (id == 1 && scope.armsAnything) else {
            let name = id == 1 ? "Open palette" : (chordCommands[id]?.name ?? "?")
            DispatchQueue.main.async { [weak self] in self?.recordPassedKey(label, name: name, reason: scope.reason) }
            return false
        }
        swallowedKeyCodes.insert(code)
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.shortcutScopeReason = scope.reason
            if id == 1 {
                self.showPaletteIfPremiereIsActive(alreadyScoped: true)
            } else if let command = self.chordCommands[id] {
                self.applyMappedCommand(command, key: label, alreadyScoped: true)
            }
        }
        return true
    }

    // The same verdict timelineShortcutFocus() would give, built only from
    // state it last cached. The click point is current (set in the tap); the
    // region and text-field state are refreshed on every click and focus change.
    //
    // A focused text field only withholds keys that type (plain and Shift
    // keys); Ctrl/Alt/Cmd chords and the palette key are never text. And the
    // Timeline never takes Accessibility focus, so a field clicked earlier
    // stays "focused" after the editor clicks back into the Timeline -- that
    // stale focus blocked 21 presses in a day. A field counts only when the
    // last click was on it or anywhere outside the Timeline.
    private func keystrokeScope() -> ShortcutScope {
        let live = timelineRegionCache.liveRegion
        let region = live ?? timelineRegionCache.lastKnownRegion
        if let role = cachedTextInputRole {
            let staleFocus = lastClickPoint.map { click in
                region?.contains(click) == true && cachedTextInputFrame?.contains(click) != true
            } ?? false
            if !staleFocus { return .modifierOnly("Text input is focused (\(role))") }
        }
        if timelineRegionCache.panelsHidden {
            return .modifierOnly(ShortcutListener.panelsHiddenReason)
        }
        guard let region else {
            return .modifierOnly("Timeline panel could not be located")
        }
        let source = live == nil ? " (saved region)" : ""
        guard let click = lastClickPoint else {
            if region.contains(currentMousePointInAXCoordinates()) {
                return .full("Timeline panel active (mouse over Timeline)\(source)")
            }
            return .modifierOnly("No click recorded yet; click the Timeline once")
        }
        return region.contains(click)
            ? .full("Timeline panel active\(source)")
            : .otherPanel("Last click was outside the Timeline panel\(source)")
    }

    // Five times a second: cheap when off (a string compare). When on, it
    // draws exactly what keystrokeScope() would decide right now.
    private func startHighlightRefresh() {
        guard highlightTimer == nil else { return }
        let timer = Timer(timeInterval: 0.2, repeats: true) { [weak self] _ in
            self?.updatePanelFeed()
            self?.refreshHighlight()
            self?.refreshNudge()
        }
        highlightTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    // Edie's nudges (PRFXEdieNudges.swift), on the same tick: one idle-time
    // read, the rest comparisons. He speaks only beside a live region with
    // Premiere in front and the palette closed, never taking focus or clicks.
    private var nudgeKind: EdieNudges.Kind?
    private func refreshNudge() {
        if !highlight.isSpeaking { nudgeKind = nil }
        guard (settings.edieNudges ?? "on") != "off" else {
            highlight.hush()
            return
        }
        let anyInput = CGEventType(rawValue: ~0)!
        let idle = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: anyInput)
        let eligible = !paletteInFront && highlight.isShowing
            && isPremiere(NSWorkspace.shared.frontmostApplication)
        nudges.nudgeAfter = max(0.1, min(60, settings.edieNudgeMinutes ?? 2)) * 60
        let last = journal.lastCommand.map { (name: $0.name, at: $0.at.timeIntervalSince1970) }
        let result = nudges.tick(idle: idle, eligible: eligible, now: Date().timeIntervalSince1970, last: last)
        // Gone at the next input; at once if the palette opens or Premiere goes behind.
        if !eligible || (result.resumed && nudgeKind == .stillThere) {
            highlight.hush()
        }
        if let line = result.line {
            highlight.say(line.title, line.detail, for: line.kind == .welcomeBack ? 6 : 9)
            nudgeKind = line.kind
        }
    }

    // Re-reads the Timeline after a mouse-up: once as soon as Premiere has
    // laid the panels out, and once more in case it republished frames late.
    private func relookTimelineAfterDrag() {
        // Pictures from before the mouse-up show the old layout.
        panelSnapshotter.expire()
        // A first picture as soon as Premiere has redrawn; its result is used
        // the moment it lands (snapToPixels), ahead of the walks below.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            guard let self, let premiere = NSWorkspace.shared.frontmostApplication, self.isPremiere(premiere) else { return }
            self.requestPanelSnapshot(premiere)
        }
        for delay in [0.25, 1.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                guard let self, self.isPremiere(NSWorkspace.shared.frontmostApplication) else { return }
                self.timelineRegionCache.invalidate()
                self.updateHotKeyRegistration(force: false)
            }
        }
    }

    // Keeps the live panel feed on Premiere's main window while Premiere is
    // in front, and off otherwise. Each new cut moves the Timeline rectangle
    // on that frame (snapToPixels), not at the next lookup.
    private func updatePanelFeed() {
        guard let premiere = NSWorkspace.shared.frontmostApplication, isPremiere(premiere),
              let window = premiereWindowFrame() else {
            if panelSnapshotter.isLive { panelSnapshotter.stopLive() }
            return
        }
        panelSnapshotter.keepLive(pid: premiere.processIdentifier, window: window) { [weak self] _, changed in
            guard let self, changed, self.isPremiere(NSWorkspace.shared.frontmostApplication) else { return }
            self.snapToPixels()
        }
    }

    // The palette is open and being used: the listener active, its panel key.
    private var paletteInFront: Bool {
        NSApp.isActive && panel?.isVisible == true && panel?.isKeyWindow == true
    }

    private func refreshHighlight() {
        // The palette makes the listener the active app, so Premiere isn't
        // frontmost while it's open. Keep the rectangle exactly as it was
        // (2026-11-20, the user: "I still need the rectangle"); it's judged
        // again once the palette closes and Premiere is back in front.
        // Only while the palette really is in front: the listener active and its
        // panel its key window. Clicking away to another app can leave the panel
        // "visible" with nobody looking at it, and the freeze then left the
        // rectangle over Chrome and VS Code (2026-11-20, "it's lingering outside").
        if paletteInFront, (settings.timelineHighlight ?? "off") == "on" { return }
        guard (settings.timelineHighlight ?? "off") == "on",
              isPremiere(NSWorkspace.shared.frontmostApplication),
              let windows = premiereWindows() else {
            highlight.hide()
            return
        }
        let window = windows.main
        // A resized or moved window moves every panel in it.
        if let previous = lastHighlightWindow, !previous.equalTo(window) {
            timelineRegionCache.invalidate()
            updateHotKeyRegistration(force: false)
        }
        lastHighlightWindow = window
        // Draw only what was just seen. A saved rectangle is a guess, and in
        // Export/Import or under a dialog it lands on top of the wrong thing.
        guard timelineRegionCache.liveRegion != nil, !timelineRegionCache.panelsHidden, !windows.dialogInFront else {
            highlight.hide()
            return
        }
        let scope = keystrokeScope()
        var armed = false
        if case .full = scope { armed = true }
        highlight.update(TimelineHighlightState(window: window, live: timelineRegionCache.liveRegion,
                                                saved: timelineRegionCache.lastKnownRegion, click: lastClickPoint,
                                                armed: armed, reason: scope.reason, covers: windows.covers))
    }

    private func scopeKindName(_ scope: ShortcutScope) -> String {
        switch scope { case .full: return "full"; case .modifierOnly, .otherPanel: return "modifier-only"; case .none: return "none" }
    }

    private var feedbackMode: String { settings.shortcutFeedback ?? "problems" }

    private func recordPassedKey(_ key: String, name: String, reason: String) {
        keyStats.recordPassed(reason: reason)
        journal.record("passed", seq: nil, key: key, command: name, detail: reason)
        highlight.flash(fired: false)
        listenerLog("Shortcut passed to Premiere: \(key) → \(name) — \(reason)")
        // Typing a capital letter into a field is the scoping working, not a
        // failure; a banner there would be noise.
        guard feedbackMode != "off", !["text-field", "full-window-mode"].contains(KeyStats.reasonBucket(reason)) else { return }
        let hint: String
        switch KeyStats.reasonBucket(reason) {
        case "outside-timeline", "no-click-yet": hint = "click the Timeline first"
        case "timeline-not-found": hint = "Edie can’t find the Timeline panel"
        case "bridge-down": hint = "the Edie bridge is offline"
        default: hint = reason
        }
        toast.show("\(key) · \(name) not run — \(hint)", kind: .skipped, duration: 2.2)
    }

    // Activation banners: the editor sees the moment shortcuts go live, and the
    // moment Export/Import mode pauses them, instead of discovering it by a
    // key doing nothing.
    private func announceScopeIfChanged(_ focus: ShortcutScope) {
        let kind: String
        if case .full = focus { kind = "armed" }
        else if focus.reason == ShortcutListener.panelsHiddenReason { kind = "full-window" }
        else if case .none = focus { kind = "" }
        else { kind = "other" }
        guard kind != announcedScopeKind else { return }
        let previous = announcedScopeKind
        announcedScopeKind = kind
        guard (settings.announceScope ?? "on") != "off", panel?.isVisible != true else { return }
        switch kind {
        case "armed":
            let live = expectedArmCounts(for: focus).armed
            toast.show("Timeline armed · \(live) shortcut\(live == 1 ? "" : "s") live", kind: .ok, duration: 1.1)
        case "full-window":
            toast.show("Shortcuts paused · Export/Import mode — chords with ⌃⌥⌘ still work", kind: .skipped, duration: 1.8)
        case "other" where previous == "full-window":
            toast.show("Panels back · click the Timeline to arm shortcuts", kind: .skipped, duration: 1.4)
        default:
            break
        }
    }

    // The PR FX app runs commands and opens the palette through these routes.
    // Token-checked in the bridge: the port is reachable from any web page.
    private func handleControl(_ route: String, body: Data) {
        switch route {
        case "/open-palette":
            listenerLog("PR FX app asked for the palette")
            showPaletteIfPremiereIsActive(alreadyScoped: true)
        case "/run":
            guard let command = try? JSONDecoder().decode(Command.self, from: body) else {
                listenerLog("PR FX app sent an unreadable command")
                return
            }
            guard let commandBridge else { return }
            let seq = nextTrackedSeq(key: "app", name: command.name)
            if command.type == "ai-function" { workingAISeq = seq; highlight.startWorking(command.name) }
            keyStats.fired += 1
            journal.record("fired", seq: seq, key: "app", command: command.name, detail: "PR FX app")
            commandBridge.enqueue(Command(type: command.type, name: command.name, transitionFrames: command.transitionFrames ?? settings.transitionFrames, id: command.id, transitionPlacement: command.transitionPlacement, moveMode: command.moveMode, staggerFrames: command.staggerFrames ?? settings.staggerFrames ?? 5, staggerGroup: command.staggerGroup ?? settings.staggerGroup ?? 1, seq: seq, key: "app", presetUid: command.presetUid))
        default:
            break
        }
    }

    static func writeBridgeToken(in support: URL) -> String {
        var bytes = [UInt8](repeating: 0, count: 24)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let token = bytes.map { String(format: "%02x", $0) }.joined()
        let url = support.appendingPathComponent("bridge-token")
        try? FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: url.path, contents: Data(token.utf8), attributes: [.posixPermissions: 0o600])
        return token
    }

    // Premiere's main window, plus whether another sizeable Premiere window (a
    // dialog, a sheet, the Export save panel, a floating panel) sits in front of
    // it over the Timeline. The window list is ordered front to back.
    // `covers`: other apps' windows in front of Premiere's main window (a
    // picture-in-picture video, a floating note), so the highlight leaves them
    // alone and is drawn only on the Premiere you can see.
    private func premiereWindows() -> (main: CGRect, dialogInFront: Bool, covers: [CGRect])? {
        guard let pid = NSWorkspace.shared.runningApplications.first(where: { isPremiere($0) })?.processIdentifier,
              let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
        var frames: [(bounds: CGRect, index: Int)] = []
        for (index, info) in list.enumerated() {
            guard (info[kCGWindowOwnerPID as String] as? Int32) == pid,
                  (info[kCGWindowLayer as String] as? Int) == 0,
                  let boundsDict = info[kCGWindowBounds as String] as? NSDictionary,
                  let bounds = CGRect(dictionaryRepresentation: boundsDict),
                  bounds.width >= 150, bounds.height >= 100 else { continue }
            frames.append((bounds, index))
        }
        guard let main = frames.max(by: { $0.bounds.width * $0.bounds.height < $1.bounds.width * $1.bounds.height }),
              let front = frames.first else { return nil }
        let over = timelineRegionCache.liveRegion ?? main.bounds
        // The highlight's area: the window and the room above it for Edie.
        let area = main.bounds.insetBy(dx: 0, dy: -TimelineHighlight.headroom / 2).offsetBy(dx: 0, dy: -TimelineHighlight.headroom / 2)
        let own = ProcessInfo.processInfo.processIdentifier
        var covers: [CGRect] = []
        // Premiere's own windows in front of its main one count too (2026-11-20: the
        // stroke was drawn over the Color Picker, a modal above layer 0): its dialogs,
        // menus and floating panels hide the rectangle as they hide the Timeline.
        // Only ones of a real size: a 66x20 strip sits on the window's top-left corner.
        for info in list.prefix(main.index) {
            guard let owner = info[kCGWindowOwnerPID as String] as? Int32, owner != own,
                  (info[kCGWindowLayer as String] as? Int ?? 0) >= 0,
                  (info[kCGWindowAlpha as String] as? Double ?? 1) > 0.05,
                  let boundsDict = info[kCGWindowBounds as String] as? NSDictionary,
                  let bounds = CGRect(dictionaryRepresentation: boundsDict),
                  bounds.width >= 20, bounds.height >= 20, bounds.intersects(area),
                  owner != pid || (bounds.width >= 80 && bounds.height >= 40),
                  // A clear overlay over the whole screen (another tool's) hides nothing.
                  !bounds.contains(main.bounds) else { continue }
            covers.append(bounds)
        }
        return (main.bounds, !front.bounds.equalTo(main.bounds) && front.bounds.intersects(over), covers)
    }

    // Premiere's main window in the same coordinates as Accessibility (top-left
    // of the primary display, points). Bounds need no Screen Recording grant.
    private func premiereWindowFrame() -> CGRect? {
        guard let pid = NSWorkspace.shared.runningApplications.first(where: { isPremiere($0) })?.processIdentifier,
              let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
        var best: CGRect?
        for info in list {
            guard (info[kCGWindowOwnerPID as String] as? Int32) == pid,
                  (info[kCGWindowLayer as String] as? Int) == 0,
                  let boundsDict = info[kCGWindowBounds as String] as? NSDictionary,
                  let bounds = CGRect(dictionaryRepresentation: boundsDict) else { continue }
            if bounds.width * bounds.height > (best.map { $0.width * $0.height } ?? 0) { best = bounds }
        }
        return best
    }

    private func rectJSON(_ rect: CGRect?) -> String {
        guard let rect else { return "null" }
        return "[\(Int(rect.origin.x)),\(Int(rect.origin.y)),\(Int(rect.width)),\(Int(rect.height))]"
    }

    private func recordOutcome(_ outcome: BridgeOutcome) {
        switch outcome {
        case .delivered(let command, let client):
            guard let seq = command.seq else { return }
            keyStats.delivered += 1
            journal.record("delivered", seq: seq, key: command.key ?? "", command: command.name, detail: client)
        case .discarded(let command):
            guard let seq = command.seq else { return }
            keyStats.expired += 1
            inFlight[seq] = nil
            if workingAISeq == seq { workingAISeq = nil; highlight.stopWorking() }
            let key = command.key ?? ""
            journal.record("expired", seq: seq, key: key, command: command.name, detail: "not collected within 5s")
            listenerLog("Command expired before CEP collected it: \(command.name) [\(key)]")
            if feedbackMode != "off" {
                toast.show("\(command.name) didn't run — Premiere was busy or the Edie engine isn't running", kind: .failed, duration: 4)
            }
        case .result(let result):
            let info = inFlight.removeValue(forKey: result.seq)
            if workingAISeq == result.seq { workingAISeq = nil; highlight.stopWorking() }
            let key = info?.key ?? ""
            let name = info?.name ?? "command #\(result.seq)"
            let elapsed = info.map { Int(Date().timeIntervalSince($0.firedAt) * 1000) }
            var message = (result.message ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if message.hasPrefix("ERROR:") { message = String(message.dropFirst(6)).trimmingCharacters(in: .whitespaces) }
            let detail = "\(elapsed.map { "\($0)ms" } ?? "") \(message)".trimmingCharacters(in: .whitespaces)
            if result.ok {
                keyStats.ok += 1
                journal.record("ok", seq: result.seq, key: key, command: name, detail: detail)
                if feedbackMode == "all" {
                    let quiet = message.isEmpty || message.hasPrefix("Applied ")
                    let shown = message.count > 140 ? String(message.prefix(137)) + "…" : message
                    toast.show(name + (quiet ? "" : " — \(shown)"), kind: .ok, duration: quiet ? 1.3 : 2.4)
                }
            } else {
                keyStats.failed += 1
                journal.record("failed", seq: result.seq, key: key, command: name, detail: detail)
                listenerLog("Command failed: \(name) [\(key)] — \(message)")
                if feedbackMode != "off" {
                    let shown = message.count > 180 ? String(message.prefix(177)) + "…" : message
                    toast.show(name + (shown.isEmpty ? "" : " — \(shown)"), kind: .failed, duration: 4.5)
                }
            }
        }
    }

    private func installHotKeyHandler() {
        guard eventHandler == nil else { return }
        let eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let context = Unmanaged.passUnretained(self).toOpaque()
        let result = InstallEventHandler(GetApplicationEventTarget(), { _, event, userData in
            guard let userData else { return noErr }
            let listener = Unmanaged<ShortcutListener>.fromOpaque(userData).takeUnretainedValue()
            var hotKeyID = EventHotKeyID()
            guard GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil, MemoryLayout<EventHotKeyID>.size, nil, &hotKeyID) == noErr else { return noErr }
            listener.handleHotKey(id: hotKeyID.id)
            return noErr
        }, 1, [eventType], context, &eventHandler)
        if result != noErr { listenerLog("Could not install Timeline shortcut handler (OSStatus \(result))") }
    }

    private func registerHotKey(_ shortcut: Shortcut, id: UInt32, command: Command?) {
        // Modifier-less shortcuts are allowed again now that scope is decided by
        // Timeline panel targeting: hotkeys are only registered while the last
        // click landed in the Timeline, so a bare key cannot reach a rename or
        // search field elsewhere in Premiere. Still worth noting in the log,
        // since a bare key has no margin if panel detection ever regresses.
        if !(shortcut.ctrl || shortcut.alt || shortcut.meta) {
            listenerLog("Note: \(display(shortcut)) has no modifier; it relies entirely on Timeline panel targeting.")
        }
        var reference: EventHotKeyRef?
        let eventID = EventHotKeyID(signature: OSType(0x50524658), id: id)
        let result = RegisterEventHotKey(keyCode(for: shortcut.code), carbonModifiers(for: shortcut), eventID, GetApplicationEventTarget(), 0, &reference)
        guard result == noErr, let reference else {
            failedHotKeyIDs.insert(id)
            lastHotKeyRetryAt = Date()
            listenerLog("Shortcut registration failed for \(display(shortcut)) (OSStatus \(result))")
            return
        }
        failedHotKeyIDs.remove(id)
        hotKeyRefs.append(reference)
        hotKeyShortcuts[id] = shortcut
        if let command { hotKeyCommands[id] = command }
        listenerLog("Registered \(command == nil ? "palette" : "command"): \(display(shortcut))")
    }

    private func unregisterHotKeys() {
        for hotKey in hotKeyRefs { UnregisterEventHotKey(hotKey) }
        hotKeyRefs.removeAll()
        hotKeyShortcuts.removeAll()
        registeredScopeRank = -1
        hotKeyCommands.removeAll()
        failedHotKeyIDs.removeAll()
    }

    private func retryFailedHotKeys() {
        guard !failedHotKeyIDs.isEmpty,
              Date().timeIntervalSince(lastHotKeyRetryAt) >= 2 else { return }
        lastHotKeyRetryAt = Date()
        // Retry only failed registrations; don't interrupt working shortcuts.
        let ids = failedHotKeyIDs
        if ids.contains(1) { registerHotKey(settings.shortcut, id: 1, command: nil) }
        for (offset, binding) in (settings.bindings ?? []).enumerated() {
            let id = UInt32(offset + 2)
            if ids.contains(id) { registerHotKey(binding.shortcut, id: id, command: binding.command) }
        }
    }

    private func shortcutCanArmWithoutTimelineDetection(_ shortcut: Shortcut) -> Bool {
        return shortcut.ctrl || shortcut.alt || shortcut.meta
    }

    private func canArmPaletteWithoutAccessibility() -> Bool {
        guard isPremiere(NSWorkspace.shared.frontmostApplication) else { return false }
        guard !AXIsProcessTrusted() else { return false }
        return shortcutCanArmWithoutTimelineDetection(settings.shortcut)
    }

    // Registration happens when focus changes; a key stays registered until the
    // next evaluation. Between clicking out of the Timeline and that evaluation
    // landing, a modifier-less key was still live -- `armsAnything` is true for
    // BOTH scopes, so the old guard let it through. Re-check the scope against
    // the shortcut that actually fired.
    private func scopeAllows(id: UInt32) -> Bool {
        if id == 1 && canArmPaletteWithoutAccessibility() {
            return true
        }
        let focus = timelineShortcutFocus()
        guard focus.armsAnything else {
            unregisterHotKeys()
            return false
        }
        guard let shortcut = hotKeyShortcuts[id] else { return focus.armsAnything }
        if focus.arms(shortcut, command: hotKeyCommands[id]) { return true }
        // This key is no longer allowed where the editor is working. Drop the
        // whole set; the next focus evaluation re-arms whatever is legitimate.
        listenerLog("Hotkey ignored: \(shortcut.code) needs the Timeline (\(focus.reason))")
        unregisterHotKeys()
        return false
    }

    private func handleHotKey(id: UInt32) {
        guard isPremiere(NSWorkspace.shared.frontmostApplication) else { return }
        guard scopeAllows(id: id) else { return }
        if id == 1 {
            showPaletteIfPremiereIsActive()
        } else if let command = hotKeyCommands[id] {
            applyMappedCommand(command, key: hotKeyShortcuts[id].map(display) ?? "?")
        }
    }

    private func carbonModifiers(for key: Shortcut) -> UInt32 {
        var modifiers: UInt32 = 0
        if key.ctrl { modifiers |= UInt32(controlKey) }
        if key.alt { modifiers |= UInt32(optionKey) }
        if key.shift { modifiers |= UInt32(shiftKey) }
        if key.meta { modifiers |= UInt32(cmdKey) }
        return modifiers
    }

    private func showPaletteIfPremiereIsActive(alreadyScoped: Bool = false) {
        if !alreadyScoped {
            guard isPremiere(NSWorkspace.shared.frontmostApplication) else {
                listenerLog("Hotkey ignored: Premiere is not frontmost")
                return
            }
            let focus = timelineShortcutFocus()
            guard focus.armsAnything || canArmPaletteWithoutAccessibility() else {
                unregisterHotKeys()
                listenerLog("Hotkey ignored: Timeline/Sequence panel is not focused")
                return
            }
            if !focus.armsAnything {
                listenerLog("Opening palette without Accessibility; command shortcuts remain paused")
            }
        }
        listenerLog("Opening palette")
        loadSettings()
        unregisterHotKeys()
        if pendingTransitionCommand != nil || pendingMoveCommand != nil || pendingStaggerCommand != nil { resetApplyMenu() }
        searchField?.stringValue = ""
        paletteCategory = .commands
        filterCommands(resetSelection: true)
        restorePaletteFrame()
        panel?.makeKeyAndOrderFront(nil)
        startPaletteFrameTracking()
        // No NSApp.activate: the palette is non-activating (see makePalette).
        if let search = searchField { panel?.makeFirstResponder(search) }
    }

    @objc private func listenerWillResignActive(_ notification: Notification) {
        savePaletteFrame(reason: "listener resign active")
        // If the palette auto-hides because the user clicks back into Premiere,
        // macOS does not always deliver the activation/focus sequence we used
        // to rely on. Explicitly re-evaluate shortly after deactivation.
        scheduleHotKeyRefresh(after: 0.20)
    }

    // `alreadyScoped`: the event tap decided at keystroke time and has already
    // consumed the key. Re-checking here would only add an Accessibility round
    // trip that can disagree with the decision and drop a consumed keypress.
    private func applyMappedCommand(_ command: Command, key: String, alreadyScoped: Bool = false) {
        if !alreadyScoped {
            guard isPremiere(NSWorkspace.shared.frontmostApplication) else { return }
            guard timelineShortcutFocus().armsAnything else {
                unregisterHotKeys()
                return
            }
        }
        let seq = nextTrackedSeq(key: key, name: command.name)
        if command.type == "ai-function" { workingAISeq = seq; highlight.startWorking(command.name) }
        highlight.flash(fired: true)
        keyStats.fired += 1
        journal.record("fired", seq: seq, key: key, command: command.name, detail: shortcutScopeReason)
        commandBridge?.enqueue(Command(type: command.type, name: command.name, transitionFrames: settings.transitionFrames, id: command.id, moveMode: command.moveMode, staggerFrames: settings.staggerFrames ?? 5, staggerGroup: settings.staggerGroup ?? 1, seq: seq, key: key, presetUid: command.presetUid))
    }

    private func nextTrackedSeq(key: String, name: String) -> Int {
        commandSeq += 1
        inFlight[commandSeq] = (key, name, Date())
        // A result that never arrives (Premiere quit mid-command) must not
        // grow this forever.
        if inFlight.count > 256, let oldest = inFlight.keys.min() { inFlight[oldest] = nil }
        return commandSeq
    }

    private func makePalette() {
        let size = paletteSize
        let panel = PalettePanel(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled, .closable, .utilityWindow, .fullSizeContentView, .nonactivatingPanel], backing: .buffered, defer: false)
        // Non-activating: the palette takes the keyboard while Premiere stays the
        // active app. Activating this listener made Premiere take activation back
        // while it settled from an app switch, and hidesOnDeactivate then closed
        // the palette a blink after it opened (it only stayed once Premiere had
        // been in front for 2-3s). It now closes when it loses key to another
        // app instead (windowDidResignKey).
        panel.becomesKeyOnlyIfNeeded = false
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.isFloatingPanel = true
        // Dark like the palette, so the caret and scroller are light.
        panel.appearance = NSAppearance(named: .darkAqua)
        // Above the Timeline highlight (screen-saver level), which stays drawn
        // while the palette is open: its stroke and Edie never cross the palette.
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.screenSaver.rawValue + 1)
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = true
        panel.acceptsMouseMovedEvents = true
        panel.delegate = self
        panel.standardWindowButton(.closeButton)?.isHidden = true
        panel.standardWindowButton(.miniaturizeButton)?.isHidden = true
        panel.standardWindowButton(.zoomButton)?.isHidden = true
        let content = NSView(frame: NSRect(origin: .zero, size: size))
        content.autoresizingMask = [.width, .height]
        content.wantsLayer = true
        content.layer?.backgroundColor = PaletteStyle.canvas.cgColor
        panel.contentView = content
        let w = size.width, h = size.height

        // Search row, 52 tall: Edie where Sage has the magnifier, the query, and esc.
        let character = EdiePaletteIconView(frame: NSRect(x: 12, y: h - 44, width: 32, height: 32))
        character.wantsLayer = true
        character.layer?.magnificationFilter = .nearest
        content.addSubview(character)

        let search = NSTextField(frame: NSRect(x: 52, y: h - 38, width: w - 52 - 56, height: 22))
        search.isBordered = false
        search.drawsBackground = false
        search.focusRingType = .none
        search.font = .systemFont(ofSize: 15, weight: .regular)
        search.textColor = PaletteStyle.text
        search.cell?.usesSingleLineMode = true
        search.cell?.wraps = false
        search.cell?.isScrollable = true
        search.delegate = self
        content.addSubview(search)
        searchField = search

        let esc = PaletteKeyCapView(frame: NSRect(x: w - 48, y: h - 36, width: 34, height: 18))
        esc.text = "esc"
        content.addSubview(esc)

        // Category tabs, with the line under them.
        let tabs = PaletteTabsView(frame: NSRect(x: 0, y: h - 52 - 38, width: w, height: 38))
        tabs.onSelect = { [weak self] category in
            guard let self, category != self.paletteCategory else { return }
            self.switchPaletteCategory(to: category)
        }
        content.addSubview(tabs)
        tabsView = tabs

        let footerLine = NSView(frame: NSRect(x: 0, y: 30, width: w, height: 1))
        footerLine.wantsLayer = true
        footerLine.layer?.backgroundColor = PaletteStyle.line.cgColor
        content.addSubview(footerLine)

        let scroll = NSScrollView(frame: NSRect(x: 0, y: 31, width: w, height: h - 52 - 38 - 31))
        scroll.hasVerticalScroller = true
        scroll.hasHorizontalScroller = false
        scroll.autohidesScrollers = true
        scroll.scrollerStyle = .overlay
        scroll.drawsBackground = false
        scroll.borderType = .noBorder
        scroll.contentInsets = NSEdgeInsets(top: 4, left: 0, bottom: 4, right: 0)
        let table = CommandTableView()
        table.style = .plain
        table.headerView = nil
        table.intercellSpacing = NSSize(width: 0, height: 0)
        table.selectionHighlightStyle = .regular
        table.backgroundColor = .clear
        table.usesAlternatingRowBackgroundColors = false
        table.target = self
        table.doubleAction = #selector(applySelection(_:))
        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("command"))
        column.width = w
        column.resizingMask = .autoresizingMask
        table.addTableColumn(column)
        table.delegate = self
        table.dataSource = self
        scroll.documentView = table
        content.addSubview(scroll)
        listView = table

        let footer = NSTextField(labelWithString: "")
        footer.textColor = PaletteStyle.faint
        footer.font = .systemFont(ofSize: 11, weight: .regular)
        footer.lineBreakMode = .byTruncatingTail
        footer.frame = NSRect(x: 16, y: 8, width: w - 32, height: 15)
        content.addSubview(footer)
        paletteFooter = footer

        self.panel = panel
        observePaletteFrameChanges(panel)
        restorePaletteFrame()
        filterCommands(resetSelection: true)
    }

    private func observePaletteFrameChanges(_ panel: NSPanel) {
        NotificationCenter.default.addObserver(self, selector: #selector(paletteFrameDidChange(_:)), name: NSWindow.didMoveNotification, object: panel)
        NotificationCenter.default.addObserver(self, selector: #selector(paletteFrameDidChange(_:)), name: NSWindow.didEndLiveResizeNotification, object: panel)
        NotificationCenter.default.addObserver(self, selector: #selector(paletteFrameDidChange(_:)), name: NSWindow.didResignKeyNotification, object: panel)
        NotificationCenter.default.addObserver(self, selector: #selector(paletteFrameDidChange(_:)), name: NSWindow.willCloseNotification, object: panel)
    }

    @objc private func paletteFrameDidChange(_ notification: Notification) {
        guard let window = notification.object as? NSWindow, window === panel else { return }
        savePaletteFrame(reason: "window notification")
    }

    private func restorePaletteFrame() {
        guard let panel else { return }
        if let savedFrame = loadSavedPaletteFrame(), isUsablePaletteFrame(savedFrame) {
            // The palette isn't resizable: keep where it was put (its top-left corner) at today's size,
            // so a frame saved by the older, smaller palette opens in the same place.
            let frame = NSRect(x: savedFrame.minX, y: savedFrame.maxY - paletteSize.height, width: paletteSize.width, height: paletteSize.height)
            panel.setFrame(isUsablePaletteFrame(frame) ? frame : savedFrame, display: false)
            listenerLog("Palette frame restored: \(NSStringFromRect(panel.frame))")
        } else {
            panel.center()
            listenerLog("Palette frame centered: no usable saved frame")
            savePaletteFrame(reason: "center fallback")
        }
    }

    private func loadSavedPaletteFrame() -> NSRect? {
        if let data = try? Data(contentsOf: paletteFrameURL),
           let string = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
           !string.isEmpty {
            let frame = NSRectFromString(string)
            if isUsablePaletteFrame(frame) {
                lastSavedPaletteFrameString = string
                return frame
            }
            listenerLog("Ignored unusable palette frame file: \(string)")
        }
        if let string = UserDefaults.standard.string(forKey: paletteFrameDefaultsKey) {
            let frame = NSRectFromString(string)
            if isUsablePaletteFrame(frame) {
                lastSavedPaletteFrameString = string
                return frame
            }
            listenerLog("Ignored unusable palette defaults frame: \(string)")
        }
        return nil
    }

    private func savePaletteFrame(reason: String = "unspecified") {
        guard let panel else { return }
        let frame = panel.frame
        guard isUsablePaletteFrame(frame) else {
            listenerLog("Skipped unusable palette frame save (\(reason)): \(NSStringFromRect(frame))")
            return
        }
        let string = NSStringFromRect(frame)
        guard string != lastSavedPaletteFrameString else { return }
        lastSavedPaletteFrameString = string
        do {
            try FileManager.default.createDirectory(at: paletteFrameURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try string.data(using: .utf8)?.write(to: paletteFrameURL, options: .atomic)
            UserDefaults.standard.set(string, forKey: paletteFrameDefaultsKey)
            UserDefaults.standard.synchronize()
            listenerLog("Palette frame saved (\(reason)): \(string)")
        } catch {
            listenerLog("Failed to save palette frame (\(reason)): \(error)")
        }
    }

    private func startPaletteFrameTracking() {
        paletteFrameSaveTimer?.invalidate()
        savePaletteFrame(reason: "show")
        paletteFrameSaveTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] timer in
            guard let self else {
                timer.invalidate()
                return
            }
            guard let panel = self.panel else {
                timer.invalidate()
                self.paletteFrameSaveTimer = nil
                return
            }
            if panel.isVisible {
                self.savePaletteFrame(reason: "visible poll")
            } else {
                self.savePaletteFrame(reason: "hidden poll")
                timer.invalidate()
                self.paletteFrameSaveTimer = nil
            }
        }
    }

    private func stopPaletteFrameTracking() {
        savePaletteFrame(reason: "hide")
        paletteFrameSaveTimer?.invalidate()
        paletteFrameSaveTimer = nil
    }

    private func hidePalette(returnToPremiere: Bool) {
        stopPaletteFrameTracking()
        panel?.orderOut(nil)
        if returnToPremiere {
            NSWorkspace.shared.runningApplications.first(where: isPremiere)?.activate(options: [])
            scheduleHotKeyRefresh(after: 0.20)
        }
    }

    private func isUsablePaletteFrame(_ frame: NSRect) -> Bool {
        guard frame.width >= 260,
              frame.height >= 180,
              frame.origin.x.isFinite,
              frame.origin.y.isFinite,
              frame.width.isFinite,
              frame.height.isFinite
        else { return false }
        return NSScreen.screens.contains { screen in
            screen.visibleFrame.intersects(frame)
        }
    }

    private func commandIdentity(_ command: Command) -> String {
        return [command.type, command.id ?? "", command.moveMode ?? "", command.name].joined(separator: "|")
    }

    private var inApplyMenu: Bool { pendingTransitionCommand != nil || pendingMoveCommand != nil || pendingStaggerCommand != nil }

    private func rowKey(_ row: Int) -> String? {
        guard paletteRows.indices.contains(row) else { return nil }
        switch paletteRows[row] {
        case let .command(index, _): return visibleCommands.indices.contains(index) ? "c:" + commandIdentity(visibleCommands[index]) : nil
        case let .media(index, _): return paletteMedia.indices.contains(index) ? "m:" + paletteMedia[index].id : nil
        default: return nil
        }
    }

    private func filterCommands(resetSelection: Bool = false) {
        let previousRow = listView?.selectedRow ?? -1
        let previousKey = rowKey(previousRow)
        let query = searchField?.stringValue ?? ""
        if inApplyMenu {
            if pendingTransitionCommand != nil { visibleCommands = transitionPlacementCommands() }
            else if pendingMoveCommand != nil { visibleCommands = moveModeCommands() }
            else { visibleCommands = staggerFrameCommands() }
            paletteRows = visibleCommands.indices.map { .command(index: $0, at: nil) }
        } else {
            visibleCommands = commands.map { Command(type: $0.type, name: $0.name, transitionFrames: settings.transitionFrames, id: $0.id, moveMode: $0.moveMode, staggerFrames: settings.staggerFrames ?? 5, staggerGroup: settings.staggerGroup ?? 1, presetUid: $0.presetUid) }
            shortcutLabels = [:]
            for binding in settings.bindings ?? [] where shortcutLabels[shortcutKey(binding.command)] == nil {
                shortcutLabels[shortcutKey(binding.command)] = compactDisplay(binding.shortcut)
            }
            let entries = visibleCommands.enumerated().map { PaletteEntry(type: $1.type, name: $1.name, index: $0) }
            let recent = recentCommandKeys.compactMap { key in visibleCommands.firstIndex { commandIdentity($0) == key } }
            let typed = !query.trimmingCharacters(in: .whitespaces).isEmpty
            let commandRows = PaletteSearch.commandRows(entries, query: query, recent: recent)
            var counts: [PaletteCategory: Int] = [.commands: typed ? PaletteSearch.count(commandRows) : entries.count]
            paletteRows = commandRows
            for category in PaletteCategory.allCases where category.isMedia {
                let rows = PaletteSearch.mediaRows(paletteMedia, query: query, loading: mediaLoading, error: mediaError, recent: recentMediaIDs, in: category)
                if category == paletteCategory { paletteRows = rows }
                counts[category] = paletteMedia.isEmpty && mediaLoading ? -1 : typed ? PaletteSearch.count(rows) : PaletteSearch.mediaCount(paletteMedia, in: category)
            }
            tabsView?.counts = counts
        }
        listView?.reloadData()
        var row: Int?
        if !resetSelection, let key = previousKey { row = paletteRows.indices.first { rowKey($0) == key } }
        if row == nil, !resetSelection, previousRow >= 0, !paletteRows.isEmpty {
            let from = min(previousRow, paletteRows.count - 1)
            row = PaletteSearch.selectable(paletteRows, from: from, step: 1) ?? PaletteSearch.selectable(paletteRows, from: from, step: -1)
        }
        if row == nil { row = PaletteSearch.selectable(paletteRows, from: 0, step: 1) }
        if let row {
            listView?.selectRowIndexes(IndexSet(integer: row), byExtendingSelection: false)
            listView?.scrollRowToVisible(row == PaletteSearch.selectable(paletteRows, from: 0, step: 1) ? 0 : row)
        } else {
            listView?.deselectAll(nil)
        }
        updatePaletteChrome()
    }

    private func updatePaletteChrome() {
        guard !inApplyMenu else { return }
        tabsView?.title = nil
        tabsView?.active = paletteCategory
        setPlaceholder(Self.palettePlaceholder(paletteCategory))
        paletteFooter?.stringValue = paletteCategory == .commands
            ? "↑↓ choose  ·  ↵ apply  ·  ⇧↵ apply, keep open  ·  Tab media  ·  esc close"
            : paletteCategory == .sequences
            ? "↑↓ choose  ·  ↵ open  ·  ⇧↵ open, keep open  ·  Tab next  ·  esc close"
            : "↑↓ choose  ·  ↵ place at playhead  ·  ⇧↵ place, keep open  ·  Tab next  ·  esc close"
    }

    private static func palettePlaceholder(_ category: PaletteCategory) -> String {
        switch category {
        case .commands: return "Search effects, transitions, presets and functions…"
        case .media: return "Search the project’s media by name…"
        case .video: return "Search the project’s video…"
        case .audio: return "Search every sound in the project…"
        case .sfx: return "Search sound effects, under 45 seconds…"
        case .bgm: return "Search ambience and music, 45 seconds or longer…"
        case .sequences: return "Search the project’s sequences…"
        }
    }

    private func setPlaceholder(_ text: String) {
        searchField?.placeholderAttributedString = NSAttributedString(string: text, attributes: [.foregroundColor: PaletteStyle.faint, .font: NSFont.systemFont(ofSize: 15)])
    }

    /// Tab goes to the next tab, Shift+Tab (`back`) to the one before; a click goes straight `to` one.
    private func switchPaletteCategory(back: Bool = false, to target: PaletteCategory? = nil) {
        guard !inApplyMenu else { return }
        paletteCategory = target ?? (back ? paletteCategory.previous() : paletteCategory.next())
        if paletteCategory.isMedia { refreshMediaIfStale() }
        filterCommands(resetSelection: true)
    }

    // MARK: Media

    private var mediaLoading: Bool {
        guard let asked = mediaAskedAt else { return false }
        return mediaLoadedAt.map { $0 < asked } ?? true
    }

    // Asks Premiere for the project's media (the next CEP poll runs prfx.listProjectMedia() and POSTs /media),
    // unless a list came in the last 10 seconds. The old list stays shown while a new one is read.
    private func refreshMediaIfStale() {
        let now = Date()
        if mediaLoading, let asked = mediaAskedAt, now.timeIntervalSince(asked) < 6 { return }
        if !mediaLoading, let loaded = mediaLoadedAt, now.timeIntervalSince(loaded) < 10 { return }
        mediaAskedAt = now
        commandBridge?.requestMedia()
        DispatchQueue.main.asyncAfter(deadline: .now() + 6) { [weak self] in
            guard let self, self.mediaAskedAt == now, self.mediaLoading else { return }
            self.mediaAskedAt = nil
            // An old list isn't kept as if it were the project's: it may be from another project, or stale.
            self.paletteMedia = []
            self.mediaLoadedAt = nil
            self.mediaError = "Premiere hasn’t answered. Open Window ▸ Extensions ▸ Edie, then Tab here again."
            listenerLog("Palette media: no answer from Premiere after 6s")
            self.filterCommands()
        }
    }

    private func receiveMedia(_ list: PaletteMediaList?) {
        mediaLoadedAt = Date()
        if mediaAskedAt == nil { mediaAskedAt = Date.distantPast }
        if let list, (list.error ?? "").isEmpty {
            paletteMedia = list.items
            mediaError = nil
            listenerLog("Palette media: \(list.items.count) item(s) from \(list.project ?? "the project"), \(list.audio ?? 0) sound, \(list.timed ?? 0) with a length, host \(list.host ?? "older than media-search-4"); " + (list.kinds ?? [:]).sorted { $0.value > $1.value }.prefix(24).map { "\($0.key) \($0.value)" }.joined(separator: ", "))
        } else {
            var error = list?.error ?? "Premiere sent a media list Edie couldn’t read."
            if error.hasPrefix("ERROR: ") { error = String(error.dropFirst(7)) }
            paletteMedia = []
            mediaError = error
            listenerLog("Palette media failed: \(error)")
        }
        filterCommands()
    }

    private func placeMedia(_ media: PaletteMedia, keepPaletteOpen: Bool) {
        remember(media: media.id)
        if media.kind == "sequence" {
            submit(Command(type: "custom", name: "Open “\(media.name)”", transitionFrames: nil, id: "open-project-sequence", mediaId: media.id), keepPaletteOpen: keepPaletteOpen)
            return
        }
        submit(Command(type: "custom", name: "Place “\(media.name)”", transitionFrames: nil, id: "place-project-item", mediaId: media.id), keepPaletteOpen: keepPaletteOpen)
    }

    // MARK: Recent

    private struct PaletteRecent: Codable { var commands: [String]; var media: [String] }
    private var paletteRecentURL: URL { settingsURL.deletingLastPathComponent().appendingPathComponent("palette-recent.json") }

    private func loadPaletteRecent() {
        guard let data = try? Data(contentsOf: paletteRecentURL), let recent = try? JSONDecoder().decode(PaletteRecent.self, from: data) else { return }
        recentCommandKeys = recent.commands
        recentMediaIDs = recent.media
    }

    // Not inout: saving reads both lists, which Swift forbids while one is being changed through inout.
    private func remember(command key: String? = nil, media id: String? = nil) {
        func bump(_ list: [String], _ key: String?) -> [String] {
            guard let key else { return list }
            return Array(([key] + list.filter { $0 != key }).prefix(5))
        }
        recentCommandKeys = bump(recentCommandKeys, key)
        recentMediaIDs = bump(recentMediaIDs, id)
        if let data = try? JSONEncoder().encode(PaletteRecent(commands: recentCommandKeys, media: recentMediaIDs)) {
            try? data.write(to: paletteRecentURL, options: .atomic)
        }
    }

    private func shortcutKey(_ command: Command) -> String { [command.type, command.id ?? "", command.name].joined(separator: "|") }

    private func compactDisplay(_ key: Shortcut) -> String {
        var text = (key.ctrl ? "⌃" : "") + (key.alt ? "⌥" : "") + (key.shift ? "⇧" : "") + (key.meta ? "⌘" : "")
        if key.code.hasPrefix("Key") { text += key.code.dropFirst(3) }
        else if key.code.hasPrefix("Digit") { text += key.code.dropFirst(5) }
        else if key.code.hasPrefix("Numpad") { text += "Num " + key.code.dropFirst(6) }
        else { text += key.code }
        return text
    }

    @objc private func applySelection(_ sender: Any?) {
        applyCurrentSelection(keepPaletteOpen: false)
    }

    private func applyCurrentSelection(keepPaletteOpen: Bool) {
        // AppKit can send the Return command more than once while a search field
        // is handing focus back to the panel. A palette selection is one action.
        guard !isSubmittingPaletteCommand else { return }
        let row = listView?.selectedRow ?? -1
        guard paletteRows.indices.contains(row) else { return }
        if case let .media(index, _) = paletteRows[row], paletteMedia.indices.contains(index) {
            placeMedia(paletteMedia[index], keepPaletteOpen: keepPaletteOpen)
            return
        }
        guard case let .command(index, _) = paletteRows[row], visibleCommands.indices.contains(index) else { return }
        let command = visibleCommands[index]
        if !inApplyMenu { remember(command: commandIdentity(command)) }
        if let transition = pendingTransitionCommand {
            let frames = transitionFramesFromPaletteField()
            let placementCommand = Command(type: transition.type, name: transition.name, transitionFrames: frames, id: transition.id, transitionPlacement: command.id ?? "both")
            resetApplyMenu()
            submit(placementCommand, keepPaletteOpen: keepPaletteOpen)
            return
        }
        if let stagger = pendingStaggerCommand {
            let frames = Int(command.id ?? "") ?? settings.staggerFrames ?? 5
            let staggerCommand = Command(type: stagger.type, name: stagger.name, transitionFrames: settings.transitionFrames, id: stagger.id, staggerFrames: frames, staggerGroup: settings.staggerGroup ?? 1)
            resetApplyMenu()
            submit(staggerCommand, keepPaletteOpen: keepPaletteOpen)
            return
        }
        if let move = pendingMoveCommand {
            let moveCommand = Command(type: move.type, name: move.name, transitionFrames: settings.transitionFrames, id: move.id, moveMode: command.id ?? "group")
            resetApplyMenu()
            submit(moveCommand, keepPaletteOpen: keepPaletteOpen)
            return
        }
        if command.type == "transition" || command.type == "audio-transition" {
            showTransitionApplyMenu(for: command)
            return
        }
        if command.type == "custom" && (command.id == "move-selected-clips-up" || command.id == "move-selected-clips-down") && command.moveMode == nil {
            showMoveApplyMenu(for: command)
            return
        }
        if command.type == "custom" && (command.id == "stagger-ascending" || command.id == "stagger-descending") {
            showStaggerApplyMenu(for: command)
            return
        }
        submit(command, keepPaletteOpen: keepPaletteOpen)
    }

    private func submit(_ command: Command, keepPaletteOpen: Bool = false) {
        guard let commandBridge else {
            NSAlert(error: NSError(domain: "PRFX", code: 1, userInfo: [NSLocalizedDescriptionKey: "The local command bridge could not start. Quit any previous PR FX listener, then run native/run-macos.sh again."])).runModal()
            return
        }
        isSubmittingPaletteCommand = true
        let seq = nextTrackedSeq(key: "palette", name: command.name)
        if command.type == "ai-function" { workingAISeq = seq; highlight.startWorking(command.name) }
        keyStats.fired += 1
        journal.record("fired", seq: seq, key: "palette", command: command.name, detail: "native palette")
        let effectiveCommand = Command(type: command.type, name: command.name, transitionFrames: command.transitionFrames ?? settings.transitionFrames, id: command.id, transitionPlacement: command.transitionPlacement, moveMode: command.moveMode, staggerFrames: command.staggerFrames ?? settings.staggerFrames ?? 5, staggerGroup: command.staggerGroup ?? settings.staggerGroup ?? 1, seq: seq, key: "palette", presetUid: command.presetUid, mediaId: command.mediaId)
        commandBridge.enqueue(effectiveCommand)
        if keepPaletteOpen {
            listenerLog("Keeping palette open after queued command: \(command.name)")
            panel?.makeKeyAndOrderFront(nil)
            if let search = searchField { panel?.makeFirstResponder(search) }
        } else {
            hidePalette(returnToPremiere: true)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
            self?.isSubmittingPaletteCommand = false
        }
    }

    private func showTransitionApplyMenu(for command: Command) {
        pendingTransitionCommand = command
        catalogQuery = searchField?.stringValue ?? ""
        tabsView?.title = (command.name, command.type == "audio-transition" ? "Audio transition" : "Transition", PaletteStyle.colour(command.type))
        searchField?.stringValue = ""
        setPlaceholder("Length in frames · default \(settings.transitionFrames)")
        paletteFooter?.stringValue = "↑↓ choose where it goes  ·  ↵ apply  ·  ⇧↵ apply, keep open  ·  esc back"
        filterCommands(resetSelection: true)
        if let search = searchField { panel?.makeFirstResponder(search) }
    }

    private func showMoveApplyMenu(for command: Command) {
        pendingMoveCommand = command
        catalogQuery = searchField?.stringValue ?? ""
        tabsView?.title = (command.name, "Function", PaletteStyle.accent)
        searchField?.stringValue = ""
        setPlaceholder("Choose how they move")
        paletteFooter?.stringValue = "↑↓ choose  ·  ↵ move  ·  ⇧↵ move, keep open  ·  esc back"
        filterCommands(resetSelection: true)
        if let search = searchField { panel?.makeFirstResponder(search) }
    }

    private func showStaggerApplyMenu(for command: Command) {
        pendingStaggerCommand = command
        catalogQuery = searchField?.stringValue ?? ""
        searchField?.stringValue = ""
        tabsView?.title = (command.name, "Function", PaletteStyle.accent)
        setPlaceholder("Frames per step · default \(settings.staggerFrames ?? 5)")
        paletteFooter?.stringValue = "↑↓ choose a step  ·  ↵ stagger  ·  ⇧↵ stagger, keep open  ·  esc back"
        filterCommands(resetSelection: true)
    }

    // Offers the typed frame count first, then common steps, so the prompt works
    // whether the editor types an exact number or just picks one.
    private func staggerFrameCommands() -> [Command] {
        let typed = searchField?.stringValue.trimmingCharacters(in: .whitespaces) ?? ""
        var frames: [Int] = []
        if let value = Int(typed), value >= 0, value <= 9999 { frames.append(value) }
        frames.append(max(0, settings.staggerFrames ?? 5))
        frames.append(contentsOf: [2, 3, 5, 10, 15, 20, 30])
        var seen = Set<Int>()
        return frames.filter { seen.insert($0).inserted }.map { value in
            Command(type: "stagger-frames", name: "\(value) frame\(value == 1 ? "" : "s") per step", transitionFrames: nil, id: String(value))
        }
    }

    private func resetApplyMenu() {
        pendingTransitionCommand = nil
        pendingMoveCommand = nil
        pendingStaggerCommand = nil
        tabsView?.title = nil
        searchField?.stringValue = catalogQuery
        filterCommands(resetSelection: true)
    }

    private func transitionFramesFromPaletteField() -> Int {
        let text = searchField?.stringValue.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return max(1, min(300, Int(text) ?? settings.transitionFrames))
    }

    private func transitionPlacementCommands() -> [Command] {
        return [
            Command(type: "transition-placement", name: "Both In + Out on each selected clip", transitionFrames: nil, id: "both"),
            Command(type: "transition-placement", name: "In points only", transitionFrames: nil, id: "in"),
            Command(type: "transition-placement", name: "Out points only", transitionFrames: nil, id: "out"),
            Command(type: "transition-placement", name: "Cuts between adjacent selected clips", transitionFrames: nil, id: "selected-cuts"),
            Command(type: "transition-placement", name: "Start + end of each selected group", transitionFrames: nil, id: "group-ends"),
            Command(type: "transition-placement", name: "Centered at every selected boundary", transitionFrames: nil, id: "centered")
        ]
    }

    private func moveModeCommands() -> [Command] {
        return [
            Command(type: "move-mode", name: "Move selection as a group", transitionFrames: nil, id: "group"),
            Command(type: "move-mode", name: "Move clips individually", transitionFrames: nil, id: "individual")
        ]
    }

    private func moveSelection(_ delta: Int) {
        guard let table = listView else { return }
        (table as? CommandTableView)?.suppressHoverBriefly()
        guard let next = PaletteSearch.move(paletteRows, from: table.selectedRow, by: delta) else { return }
        table.selectRowIndexes(IndexSet(integer: next), byExtendingSelection: false)
        // The first choice also shows its section name above it.
        table.scrollRowToVisible(next == PaletteSearch.selectable(paletteRows, from: 0, step: 1) ? 0 : next)
    }

    private func keyCode(for code: String) -> UInt32 {
        UInt32(KeyCodeMap.keyCode(for: code) ?? UInt16(kVK_Space))
    }
    private func display(_ key: Shortcut) -> String {
        var parts: [String] = []
        if key.ctrl { parts.append("Ctrl") }; if key.alt { parts.append("Option") }; if key.shift { parts.append("Shift") }; if key.meta { parts.append("Cmd") }
        parts.append(key.code == "Space" ? "Space" : String(key.code.dropFirst(3)))
        return parts.joined(separator: " + ")
    }
    func isPremiere(_ application: NSRunningApplication?) -> Bool {
        application?.bundleIdentifier?.hasPrefix("com.adobe.PremierePro") == true
    }

    private func timelineShortcutFocus() -> ShortcutScope {
        guard let application = NSWorkspace.shared.frontmostApplication, isPremiere(application) else {
            return .none("Premiere is not frontmost")
        }
        if prfxBypassAccessibilityFocus {
            return .full("Premiere is frontmost (Accessibility bypass)")
        }
        let accessibilityTrusted = AXIsProcessTrusted()
        // Premiere's Accessibility tree does not identify panels: every element
        // reports a generic role (AXLayoutArea, AXGroup, AXUnknown) with an
        // empty identifier, and the focus chain runs straight from a control to
        // the document window. The earlier keyword matcher only ever returned
        // true because the window title contains the project or sequence name,
        // which is present no matter which panel has focus — so it armed the
        // shortcut everywhere and broke outright on some project names.
        //
        // Text inputs are the one thing Premiere does report honestly, and they
        // are the case that actually matters: a hotkey must never swallow a
        // keystroke meant for a rename box or a search field. So deny on text
        // input and allow otherwise.
        if accessibilityTrusted {
            let textInput = focusedTextInput(application)
            cachedTextInputRole = textInput?.role
            cachedTextInputFrame = textInput?.frame
            if let role = cachedTextInputRole {
                return .none("Text input is focused (\(role))")
            }
        }
        guard accessibilityTrusted else {
            if let cachedScope = shortcutScopeFromSavedTimelineRegion(
                activeReason: "Timeline panel active (saved region; Accessibility unavailable)",
                outsideReason: "Last click was outside the saved Timeline region",
                missingClickReason: "Accessibility is not enabled; click the Timeline once",
                allowModifierFallback: false
            ) {
                return cachedScope
            }
            return .none("Accessibility is not enabled for PR FX Shortcut Listener")
        }
        // Premiere publishes no focused element and no panel containers, but it
        // does publish Timeline controls with real frames. Premiere gives a
        // panel keyboard focus when you click it, so the last click tells us
        // which panel is active.
        //
        // Locating the Timeline depends on Premiere's own English control
        // descriptions, which do not survive a localized install or an Adobe
        // rename. When that fails the tool must degrade rather than die: keys
        // carrying a modifier are safe in any panel because typing never
        // produces them, so they stay armed. Only modifier-less keys, which rely
        // entirely on panel targeting, are withheld.
        guard let region = timelineRegion(application) else {
            if timelineRegionCache.panelsHidden {
                return .modifierOnly(ShortcutListener.panelsHiddenReason)
            }
            if let cachedScope = shortcutScopeFromSavedTimelineRegion(
                activeReason: "Timeline panel active (saved region)",
                outsideReason: "Last click was outside the saved Timeline region",
                missingClickReason: "No click recorded yet; click the Timeline once",
                allowModifierFallback: true
            ) {
                return cachedScope
            }
            return .modifierOnly("Timeline panel could not be located")
        }
        guard let click = lastClickPoint else {
            let mouse = currentMousePointInAXCoordinates()
            if region.contains(mouse) {
                lastClickPoint = mouse
                listenerLog("Timeline panel active (mouse already over Timeline before first click)")
                return .full("Timeline panel active (mouse over Timeline)")
            }
            return .modifierOnly("No click recorded yet; click the Timeline once")
        }
        guard region.contains(click) else {
            // Working in another panel withholds modifier-less keys, but NOT
            // shortcuts carrying a modifier -- typing never produces those, so
            // they are safe anywhere in Premiere. Returning .none here also
            // disarmed the palette hotkey, which is the one shortcut that most
            // needs to work from the Source and Project panels.
            return .otherPanel("Last click was outside the Timeline panel")
        }
        return .full("Timeline panel active")
    }

    private func shortcutScopeFromSavedTimelineRegion(activeReason: String, outsideReason: String, missingClickReason: String, allowModifierFallback: Bool) -> ShortcutScope? {
        guard let region = savedTimelineRegion() else { return nil }
        guard let click = lastClickPoint else {
            let mouse = currentMousePointInAXCoordinates()
            if region.contains(mouse) {
                lastClickPoint = mouse
                listenerLog("Timeline panel active from saved region (mouse already over Timeline before first click)")
                return .full(activeReason)
            }
            return allowModifierFallback ? .modifierOnly(missingClickReason) : .none(missingClickReason)
        }
        if region.contains(click) { return .full(activeReason) }
        return allowModifierFallback ? .otherPanel(outsideReason) : .none(outsideReason)
    }

    // Descriptions that appear only inside Premiere's Timeline panel. Premiere
    // publishes no panel containers, but it does publish these controls with
    // real frames, so the panel's rectangle can be derived from them.
    static let panelsHiddenReason = "Premiere is in Export/Import mode (no Timeline on screen)"

    private static let timelineMarkers: Set<String> = [
        "Toggle Track Lock", "Toggle Track Output", "Mute Track", "Solo Track",
        "Snap in Timeline", "Timeline Display Settings", "Caption track options",
        "Insert and overwrite sequences as nests or individual clips"
    ]

    // Converts a Cocoa screen point (bottom-left origin) to Accessibility
    // coordinates (top-left origin). The flip is measured against the top edge
    // of the origin display, which is what AX uses as its reference for every
    // display — including ones positioned above or below it, where a plain
    // height would be wrong.
    private func axPointFromScreen(_ point: CGPoint) -> CGPoint {
        let primaryTop = NSScreen.screens.first?.frame.maxY ?? 0
        return CGPoint(x: point.x, y: primaryTop - point.y)
    }

    private func currentMousePointInAXCoordinates() -> CGPoint {
        return axPointFromScreen(NSEvent.mouseLocation)
    }

    private func observeClicks() {
        guard clickMonitor == nil else { return }
        clickMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .leftMouseUp, .rightMouseDown]) { [weak self] event in
            guard let self, self.isPremiere(NSWorkspace.shared.frontmostApplication) else { return }
            // The event tap records clicks itself, synchronously and in order
            // with keystrokes. This monitor is the Carbon-mode path only.
            guard self.keyTap == nil else { return }
            if event.type == .leftMouseUp { self.relookTimelineAfterDrag(); return }
            self.lastClickPoint = self.axPointFromScreen(NSEvent.mouseLocation)
            // Use the known geometry immediately, then re-check after Premiere
            // has processed the click (including focus entering a text field).
            // Do not unregister/re-register an unchanged shortcut set per click.
            self.updateHotKeyRegistration(force: false)
            self.scheduleHotKeyRefresh()
        }
    }

    // Derives the Timeline panel's rectangle: union the frames of Timeline-only
    // controls, then extend that union to the panel group's tab strip above it
    // and down to the bottom of the window, so the whole panel body counts and
    // not just the track-header column the marker controls live in.
    private func timelineRegion(_ application: NSRunningApplication) -> CGRect? {
        // Failures are cached too. Without that, a state where the Timeline is
        // genuinely absent — closed panel, modal dialog, a workspace without it —
        // would re-walk the whole element tree on every focus change and every
        // safety-timer tick, indefinitely.
        if !timelineRegionCache.needsLookup() { return timelineRegionCache.liveRegion }
        let appElement = AXUIElementCreateApplication(application.processIdentifier)
        // Scan every window, not just the focused one: editors often tear the
        // Timeline off into its own window on a second display, and it would be
        // invisible to a focused-window-only walk.
        var windows: [AXUIElement] = []
        if let list = axChildren(appElement, kAXWindowsAttribute as CFString) { windows = list }
        if let focused = axElement(appElement, kAXFocusedWindowAttribute as CFString) {
            windows.removeAll { CFEqual($0, focused) }
            windows.insert(focused, at: 0)
        }
        var region: CGRect?
        lastScanTabStrips = 0
        lastScanControls = nil
        lastScanMarkers = []
        lastScanToolbar = []
        lastScanElements = 0
        for window in windows {
            if let found = timelineRegion(inWindow: window) { region = found; break }
        }
        // A scan that reached the window but found no panel tab strip at
        // all is Export/Import/Home mode, not a redraw: a docked
        // workspace always has several (4 on the reference layout).
        let panelsHidden = region == nil && !windows.isEmpty && lastScanElements >= 10 && lastScanTabStrips == 0
        if !panelsHidden {
            // Accessibility frames lag a panel resize; the pixels do not. Snap
            // to the real panel when a fresh capture has it.
            lastPixelReference = region ?? timelineRegionCache.lastKnownRegion
            requestPanelSnapshot(application)
            if let snapped = pixelTimelineRegion(reference: lastPixelReference) { region = snapped }
        }
        guard let region else {
            if panelsHidden != timelineRegionCache.panelsHidden {
                listenerLog(panelsHidden ? "Premiere switched to a full-window mode (Export/Import/Home); plain-key shortcuts stand down" : "Premiere panels visible again")
            }
            timelineRegionCache.recordLookup(nil, panelsHidden: panelsHidden)
            return nil
        }
        if timelineRegionCache.lastKnownRegion.map({ !$0.equalTo(region) }) ?? true {
            listenerLog("Timeline region: (\(Int(region.minX)),\(Int(region.minY)) \(Int(region.width))x\(Int(region.height)))")
        }
        cacheTimelineRegion(region)
        return region
    }

    private func requestPanelSnapshot(_ application: NSRunningApplication) {
        panelSnapshotter.refresh(pid: application.processIdentifier) { [weak self] snapshot, changed in
            guard let self, self.isPremiere(NSWorkspace.shared.frontmostApplication) else { return }
            if changed {
                listenerLog("Premiere panels from pixels: \(snapshot.panels.count) in \(NSStringFromRect(snapshot.window)); looks like Timeline: \(snapshot.looks)")
                self.timelineRegionCache.invalidate()
                self.updateHotKeyRegistration(force: false)
            } else {
                self.snapToPixels()
            }
        }
    }

    // A capture landed showing the same panels as the one before it. The
    // lookup that asked for it may still have drawn Accessibility's stale
    // rectangle (no fresh capture yet then): use this one now rather than at
    // the next lookup, 2 s away. Was the 2-5 s lag after a resize or a tab
    // switch (2026-11-19).
    private func snapToPixels() {
        guard !timelineRegionCache.panelsHidden,
              let snapped = pixelTimelineRegion(reference: lastPixelReference),
              timelineRegionCache.liveRegion.map({ !$0.equalTo(snapped) }) ?? true else { return }
        listenerLog("Timeline region: (\(Int(snapped.minX)),\(Int(snapped.minY)) \(Int(snapped.width))x\(Int(snapped.height))) [pixels]")
        // The next cut is matched against this one, so a panel being dragged
        // is followed frame by frame.
        lastPixelReference = snapped
        cacheTimelineRegion(snapped)
        updateHotKeyRegistration(force: false)
        refreshHighlight()
    }

    private func pixelTimelineRegion(reference: CGRect?) -> CGRect? {
        guard let snapshot = panelSnapshotter.fresh(window: premiereWindowFrame()) else { return nil }
        guard let panel = PanelPixels.timelinePanel(snapshot.panels, markers: lastScanMarkers, toolbar: lastScanToolbar, reference: reference,
                                                    window: snapshot.window, docked: dockedTimelineRegion, looks: snapshot.looks) else { return nil }
        // Where it sits docked, for coming back from maximized (` key).
        if !PanelPixels.fills(panel, snapshot.window) { dockedTimelineRegion = panel }
        timelineDetectionDetails += "; pixels=\(NSStringFromRect(panel)); looks=\(snapshot.looks)"
        return panel
    }

    private func cacheTimelineRegion(_ region: CGRect) {
        guard isUsableTimelineRegion(region) else { return }
        timelineRegionCache.recordLookup(region, controls: lastScanControls)
        let string = NSStringFromRect(region)
        let existing = (try? String(contentsOf: timelineRegionURL, encoding: .utf8))?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard existing != string else { return }
        try? FileManager.default.createDirectory(at: timelineRegionURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? string.data(using: .utf8)?.write(to: timelineRegionURL, options: .atomic)
    }

    private func savedTimelineRegion() -> CGRect? {
        if let cached = timelineRegionCache.lastKnownRegion, isUsableTimelineRegion(cached) { return cached }
        if let stored = try? String(contentsOf: timelineRegionURL, encoding: .utf8),
           let region = parseStoredTimelineRegion(stored) {
            timelineRegionCache.restoreFallback(region)
            return region
        }
        if let region = restoreTimelineRegionFromLog() {
            timelineRegionCache.restoreFallback(region)
            listenerLog("Restored Timeline region from listener log")
            return region
        }
        return nil
    }

    private func parseStoredTimelineRegion(_ value: String) -> CGRect? {
        let region = NSRectFromString(value.trimmingCharacters(in: .whitespacesAndNewlines))
        return isUsableTimelineRegion(region) ? region : nil
    }

    private func isUsableTimelineRegion(_ region: CGRect) -> Bool {
        guard region.width >= 200, region.height >= 120 else { return false }
        return region.origin.x.isFinite && region.origin.y.isFinite
            && region.size.width.isFinite && region.size.height.isFinite
    }

    private func restoreTimelineRegionFromLog() -> CGRect? {
        guard !attemptedTimelineRegionLogRestore else { return nil }
        attemptedTimelineRegionLogRestore = true
        let logURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/PR FX Shortcut Listener.log")
        guard let data = try? Data(contentsOf: logURL) else { return nil }
        let tail = data.count > 2_000_000 ? data.suffix(2_000_000) : data[...]
        guard let text = String(data: Data(tail), encoding: .utf8) else { return nil }
        let pattern = #"Timeline region: \((-?[0-9]+),(-?[0-9]+) ([0-9]+)x([0-9]+)\)"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        for line in text.components(separatedBy: .newlines).reversed() {
            let nsLine = line as NSString
            let range = NSRange(location: 0, length: nsLine.length)
            guard let match = regex.firstMatch(in: line, range: range),
                  match.numberOfRanges == 5,
                  let x = Double(nsLine.substring(with: match.range(at: 1))),
                  let y = Double(nsLine.substring(with: match.range(at: 2))),
                  let width = Double(nsLine.substring(with: match.range(at: 3))),
                  let height = Double(nsLine.substring(with: match.range(at: 4))) else { continue }
            let region = CGRect(x: x, y: y, width: width, height: height)
            if isUsableTimelineRegion(region) { return region }
        }
        return nil
    }

    private func timelineRegion(inWindow window: AXUIElement) -> CGRect? {
        guard let windowOrigin = axPoint(window, kAXPositionAttribute as CFString),
              let windowSize = axSize(window, kAXSizeAttribute as CFString) else { return nil }
        let windowRect = CGRect(origin: windowOrigin, size: windowSize)
        var markers: [CGRect] = []
        var toolbar: [CGRect] = []
        var tabStrips: [CGRect] = []
        var statusBarTop: CGFloat?
        var queue: [(element: AXUIElement, depth: Int)] = [(window, 0)]
        var scanned = 0
        while !queue.isEmpty && scanned < 800 {
            let (element, depth) = queue.removeFirst()
            scanned += 1
            if depth < 14, let children = axChildren(element) {
                for child in children { queue.append((child, depth + 1)) }
            }
            // The status bar: a nameless, window-wide static text along the
            // bottom, directly under the window. It ends the Timeline when no
            // panel sits below it.
            if depth == 1, statusBarTop == nil,
               axString(element, kAXRoleAttribute as CFString) == "AXStaticText",
               let origin = axPoint(element, kAXPositionAttribute as CFString),
               let size = axSize(element, kAXSizeAttribute as CFString),
               size.width >= windowRect.width * 0.5, origin.y + size.height >= windowRect.maxY - 8 {
                statusBarTop = origin.y
            }
            guard let description = axString(element, kAXDescriptionAttribute as CFString),
                  !description.isEmpty,
                  ShortcutListener.timelineMarkers.contains(description) || description == "UI_TabsContainer",
                  let origin = axPoint(element, kAXPositionAttribute as CFString),
                  let size = axSize(element, kAXSizeAttribute as CFString) else { continue }
            let rect = CGRect(origin: origin, size: size)
            if description == "UI_TabsContainer" { tabStrips.append(rect); continue }
            markers.append(rect)
            if ShortcutListener.timelineToolbarMarkers.contains(description) { toolbar.append(rect) }
        }
        lastScanTabStrips += tabStrips.count
        if lastScanMarkers.isEmpty { lastScanMarkers = markers; lastScanToolbar = toolbar }
        lastScanElements += scanned
        var region = TimelinePanelGeometry.region(window: windowRect, markers: markers, tabs: tabStrips, statusBarTop: statusBarTop)
        var inferred = false
        if region == nil, let last = timelineRegionCache.lastKnownRegion, windowRect.intersects(last) {
            region = TimelinePanelGeometry.inferred(window: windowRect, markers: markers, tabs: tabStrips, statusBarTop: statusBarTop,
                                                    last: last, lastControls: timelineRegionCache.lastControls)
            inferred = region != nil
        }
        if region != nil { lastScanControls = TimelinePanelGeometry.controls(window: windowRect, markers: markers) }
        if inferred, Date().timeIntervalSince(lastInferredLog) > 10 {
            lastInferredLog = Date()
            listenerLog("Timeline region inferred from moved controls (tab strip not republished yet)")
        }
        timelineDetectionDetails = "scanned=\(scanned); window=\(NSStringFromRect(windowRect)); statusBarTop=\(statusBarTop.map { "\(Int($0))" } ?? "none"); markers=\(markers.map(NSStringFromRect).joined(separator: ";")); tabs=\(tabStrips.map(NSStringFromRect).joined(separator: ";")); matched=\(region != nil); inferred=\(inferred)"
        return region
    }

    private static let textInputRoles: Set<String> = [
        "AXTextField", "AXTextArea", "AXComboBox", "AXSearchField", "AXSecureTextField"
    ]

    // Checks the focused element and its immediate parent: Premiere sometimes
    // puts focus on an inner element of a compound text control.
    private func focusedTextInput(_ application: NSRunningApplication) -> (role: String, frame: CGRect?)? {
        let appElement = AXUIElementCreateApplication(application.processIdentifier)
        guard let focused = axElement(appElement, kAXFocusedUIElementAttribute as CFString) else { return nil }
        var current: AXUIElement? = focused
        var depth = 0
        while let element = current, depth < 2 {
            for attribute in [kAXRoleAttribute, kAXSubroleAttribute] {
                if let value = axString(element, attribute as CFString),
                   ShortcutListener.textInputRoles.contains(value) {
                    var frame: CGRect?
                    if let origin = axPoint(element, kAXPositionAttribute as CFString),
                       let size = axSize(element, kAXSizeAttribute as CFString) {
                        frame = CGRect(origin: origin, size: size)
                    }
                    return (value, frame)
                }
            }
            current = axElement(element, kAXParentAttribute as CFString)
            depth += 1
        }
        return nil
    }


    // Shared Accessibility accessors. These belong to the listener rather
    // than the diagnostics file: Timeline region lookup depends on them, so
    // removing the probe must never break shortcut scoping.
    func axChildren(_ element: AXUIElement, _ attribute: CFString = kAXChildrenAttribute as CFString) -> [AXUIElement]? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success,
              let value, CFGetTypeID(value) == CFArrayGetTypeID() else { return nil }
        return value as? [AXUIElement]
    }

    func axBool(_ element: AXUIElement, _ attribute: CFString) -> Bool? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success,
              let value, CFGetTypeID(value) == CFBooleanGetTypeID() else { return nil }
        return CFBooleanGetValue((value as! CFBoolean))
    }

    func axPoint(_ element: AXUIElement, _ attribute: CFString) -> CGPoint? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success,
              let value, CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
        var point = CGPoint.zero
        guard AXValueGetValue((value as! AXValue), .cgPoint, &point) else { return nil }
        return point
    }

    func axSize(_ element: AXUIElement, _ attribute: CFString) -> CGSize? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success,
              let value, CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
        var size = CGSize.zero
        guard AXValueGetValue((value as! AXValue), .cgSize, &size) else { return nil }
        return size
    }

    func axElement(_ element: AXUIElement, _ attribute: CFString) -> AXUIElement? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success,
              let value,
              CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return (value as! AXUIElement)
    }

    func axString(_ element: AXUIElement, _ attribute: CFString) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success,
              let value else { return nil }
        if CFGetTypeID(value) == AXUIElementGetTypeID() { return nil }
        return String(describing: value).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func jsonEscape(_ value: String) -> String {
        value.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "\r", with: " ")
    }
}

extension ShortcutListener: NSTableViewDataSource, NSTableViewDelegate {
    func numberOfRows(in tableView: NSTableView) -> Int { paletteRows.count }
    func tableView(_ tableView: NSTableView, heightOfRow row: Int) -> CGFloat {
        guard paletteRows.indices.contains(row) else { return 30 }
        switch paletteRows[row] {
        case .section: return row == 0 ? 26 : 32
        case .command: return 30
        case .media: return 42
        case .note: return 64
        }
    }
    func tableView(_ tableView: NSTableView, shouldSelectRow row: Int) -> Bool {
        paletteRows.indices.contains(row) && paletteRows[row].selectable
    }
    func tableView(_ tableView: NSTableView, rowViewForRow row: Int) -> NSTableRowView? {
        let view = PaletteSelectionRowView()
        if paletteRows.indices.contains(row), case let .media(index, _) = paletteRows[row], paletteMedia.indices.contains(index) { view.tint = PaletteStyle.label(paletteMedia[index]) } else { view.tint = PaletteStyle.accent }
        return view
    }
    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let id = NSUserInterfaceItemIdentifier("palette-row")
        let cell = tableView.makeView(withIdentifier: id, owner: self) as? PaletteRowView ?? PaletteRowView()
        cell.identifier = id
        guard paletteRows.indices.contains(row) else { return cell }
        switch paletteRows[row] {
        case let .section(title, count, colour):
            cell.show(.section(title: title, count: count, colour: colour == "recent" ? PaletteStyle.muted : colour == "media" ? PaletteStyle.label(paletteCategory) : PaletteStyle.colour(colour)))
        case let .command(index, at):
            let command = visibleCommands[index]
            cell.show(.item(name: command.name, at: at, symbol: PaletteStyle.symbol(command.type), colour: PaletteStyle.colour(command.type), detail: nil,
                            tag: inApplyMenu ? nil : shortcutLabels[shortcutKey(command)], tagIsKey: true))
        case let .media(index, at):
            let media = paletteMedia[index]
            cell.show(.item(name: media.name, at: at, symbol: PaletteStyle.mediaSymbol(media), colour: PaletteStyle.label(media), detail: PaletteSearch.whereText(media),
                            tag: media.ext.isEmpty ? nil : media.ext.lowercased(), tagIsKey: false))
        case let .note(text):
            cell.show(.note(text))
        }
        return cell
    }
}

extension ShortcutListener: NSTextFieldDelegate {
    func controlTextDidBeginEditing(_ notification: Notification) {
        (searchField?.currentEditor() as? NSTextView)?.allowsUndo = true
    }

    func controlTextDidChange(_ notification: Notification) {
        filterCommands(resetSelection: !inApplyMenu)
    }
    func control(_ control: NSControl, textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
        if commandSelector == #selector(NSResponder.insertNewline(_:)) {
            let keepPaletteOpen = NSApp.currentEvent?.modifierFlags.contains(.shift) == true
            applyCurrentSelection(keepPaletteOpen: keepPaletteOpen)
            return true
        }
        if commandSelector == #selector(NSResponder.insertTab(_:)) || commandSelector == #selector(NSResponder.insertBacktab(_:)) {
            switchPaletteCategory(back: commandSelector == #selector(NSResponder.insertBacktab(_:)))
            return true
        }
        if commandSelector == #selector(NSResponder.moveDown(_:)) { moveSelection(1); return true }
        if commandSelector == #selector(NSResponder.moveUp(_:)) { moveSelection(-1); return true }
        if commandSelector == #selector(NSResponder.pageDown(_:)) || commandSelector == #selector(NSResponder.scrollPageDown(_:)) { moveSelection(8); return true }
        if commandSelector == #selector(NSResponder.pageUp(_:)) || commandSelector == #selector(NSResponder.scrollPageUp(_:)) { moveSelection(-8); return true }
        if commandSelector == #selector(NSResponder.cancelOperation(_:)) {
            if inApplyMenu { resetApplyMenu() }
            else { hidePalette(returnToPremiere: true) }
            return true
        }
        return false
    }
}

extension ShortcutListener: NSWindowDelegate {
    func windowDidMove(_ notification: Notification) {
        guard let window = notification.object as? NSWindow, window === panel else { return }
        savePaletteFrame(reason: "delegate did move")
    }

    func windowDidEndLiveResize(_ notification: Notification) {
        guard let window = notification.object as? NSWindow, window === panel else { return }
        savePaletteFrame(reason: "delegate resize")
    }

    func windowWillClose(_ notification: Notification) {
        guard let window = notification.object as? NSWindow, window === panel else { return }
        savePaletteFrame(reason: "delegate close")
    }

    // Clicking into Premiere (or any app) takes the key from the palette: close
    // it, as hidesOnDeactivate did when the listener used to activate. One of
    // our own windows taking the key (an alert) leaves it open.
    func windowDidResignKey(_ notification: Notification) {
        guard let window = notification.object as? NSWindow, window === panel else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
            guard let self, let panel = self.panel, panel.isVisible, !panel.isKeyWindow else { return }
            guard NSApp.keyWindow == nil, NSApp.modalWindow == nil else { return }
            listenerLog("Palette lost the keyboard to \(NSWorkspace.shared.frontmostApplication?.localizedName ?? "another app"); closing")
            self.savePaletteFrame(reason: "lost key")
            self.hidePalette(returnToPremiere: false)
            self.scheduleHotKeyRefresh(after: 0.20)
        }
    }
}

private final class CommandTableView: NSTableView {
    private var hoverTrackingArea: NSTrackingArea?
    private var suppressHoverUntil = Date.distantPast

    func suppressHoverBriefly() {
        suppressHoverUntil = Date().addingTimeInterval(0.35)
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let area = hoverTrackingArea { removeTrackingArea(area) }
        let area = NSTrackingArea(rect: bounds, options: [.mouseMoved, .activeInKeyWindow, .inVisibleRect], owner: self, userInfo: nil)
        addTrackingArea(area)
        hoverTrackingArea = area
    }

    override func mouseMoved(with event: NSEvent) {
        super.mouseMoved(with: event)
        guard Date() >= suppressHoverUntil else { return }
        let point = convert(event.locationInWindow, from: nil)
        let row = self.row(at: point)
        guard row >= 0 && row < numberOfRows && selectedRow != row,
              delegate?.tableView?(self, shouldSelectRow: row) ?? true else { return }
        selectRowIndexes(IndexSet(integer: row), byExtendingSelection: false)
    }
}

// One palette row, drawn rather than built from labels so section names, items and notes share one view:
// a section name in its colour with a count capsule, an item (icon, name with the typed part picked out,
// a muted "where" line for media, a shortcut or file type on the right), or a note in place of results.
private final class PaletteRowView: NSView {
    enum Content {
        case section(title: String, count: Int, colour: NSColor)
        case item(name: String, at: Range<Int>?, symbol: String, colour: NSColor, detail: String?, tag: String?, tagIsKey: Bool)
        case note(String)
    }
    private var content: Content = .note("")

    func show(_ content: Content) {
        self.content = content
        needsDisplay = true
    }

    override var isFlipped: Bool { true }

    private static func text(_ string: String, size: CGFloat, weight: NSFont.Weight, colour: NSColor, align: NSTextAlignment = .left, wrap: Bool = false) -> NSAttributedString {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = wrap ? .byWordWrapping : .byTruncatingTail
        paragraph.alignment = align
        return NSAttributedString(string: string, attributes: [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: colour, .paragraphStyle: paragraph])
    }

    private static func picked(_ name: String, at: Range<Int>?, colour: NSColor) -> NSAttributedString {
        let result = NSMutableAttributedString(attributedString: text(name, size: 13.5, weight: .regular, colour: PaletteStyle.text))
        guard let at, at.lowerBound >= 0, at.upperBound <= name.count,
              let start = name.index(name.startIndex, offsetBy: at.lowerBound, limitedBy: name.endIndex),
              let end = name.index(name.startIndex, offsetBy: at.upperBound, limitedBy: name.endIndex) else { return result }
        result.addAttributes([.font: NSFont.systemFont(ofSize: 13.5, weight: .semibold), .foregroundColor: colour], range: NSRange(start..<end, in: name))
        return result
    }

    private func drawCapsule(_ string: String, right: CGFloat, midY: CGFloat, fill: NSColor, colour: NSColor, mono: Bool) -> CGFloat {
        let font = mono ? NSFont.monospacedSystemFont(ofSize: 10.5, weight: .medium) : NSFont.systemFont(ofSize: 10.5, weight: .semibold)
        let label = NSAttributedString(string: string, attributes: [.font: font, .foregroundColor: colour])
        let size = label.size()
        let box = NSRect(x: right - size.width - 12, y: midY - 9, width: size.width + 12, height: 18)
        fill.setFill()
        NSBezierPath(roundedRect: box, xRadius: mono ? 5 : 9, yRadius: mono ? 5 : 9).fill()
        label.draw(at: NSPoint(x: box.minX + 6, y: midY - size.height / 2))
        return box.minX
    }

    override func draw(_ dirtyRect: NSRect) {
        let w = bounds.width, h = bounds.height
        switch content {
        case let .section(title, count, colour):
            // Sentence case, 11.5 semibold in the group's colour, its count beside it, low in the row.
            let label = Self.text(title, size: 11.5, weight: .semibold, colour: colour)
            let size = label.size()
            let midY = h - 11
            label.draw(at: NSPoint(x: 18, y: midY - size.height / 2))
            let countText = NSAttributedString(string: "\(count)", attributes: [.font: NSFont.systemFont(ofSize: 10, weight: .semibold), .foregroundColor: colour])
            let countSize = countText.size()
            let box = NSRect(x: 18 + size.width + 7, y: midY - 8, width: countSize.width + 10, height: 16)
            colour.withAlphaComponent(0.16).setFill()
            NSBezierPath(roundedRect: box, xRadius: 8, yRadius: 8).fill()
            countText.draw(at: NSPoint(x: box.minX + 5, y: midY - countSize.height / 2))
        case let .item(name, at, symbol, colour, detail, tag, tagIsKey):
            let midY = h / 2
            if let image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)?
                .withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: detail == nil ? 12 : 14, weight: .medium)
                    .applying(NSImage.SymbolConfiguration(paletteColors: [colour]))) {
                let size = image.size
                image.draw(in: NSRect(x: 18 + (18 - size.width) / 2, y: midY - size.height / 2, width: size.width, height: size.height))
            }
            var right = w - 16
            if let tag, !tag.isEmpty {
                right = drawCapsule(tag, right: right, midY: midY,
                                    fill: tagIsKey ? PaletteStyle.line.withAlphaComponent(0.7) : colour.withAlphaComponent(0.14),
                                    colour: tagIsKey ? PaletteStyle.muted : colour, mono: tagIsKey) - 10
            }
            let left: CGFloat = 46
            let nameText = Self.picked(name, at: at, colour: colour)
            let nameHeight = nameText.size().height
            if let detail {
                nameText.draw(with: NSRect(x: left, y: midY - nameHeight - 0.5, width: right - left, height: nameHeight), options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
                let whereText = Self.text(detail, size: 11, weight: .regular, colour: PaletteStyle.muted)
                whereText.draw(with: NSRect(x: left, y: midY + 1.5, width: right - left, height: 15), options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
            } else {
                nameText.draw(with: NSRect(x: left, y: midY - nameHeight / 2, width: right - left, height: nameHeight), options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
            }
        case let .note(text):
            let label = Self.text(text, size: 12.5, weight: .regular, colour: PaletteStyle.muted, align: .center, wrap: true)
            let rect = NSRect(x: 32, y: 0, width: w - 64, height: h)
            let height = label.boundingRect(with: rect.size, options: [.usesLineFragmentOrigin]).height
            label.draw(with: NSRect(x: rect.minX, y: (h - height) / 2, width: rect.width, height: height + 2), options: [.usesLineFragmentOrigin])
        }
    }
}

// The chosen row: a soft rounded fill in the category's colour, like Sage's.
private final class PaletteSelectionRowView: NSTableRowView {
    var tint = PaletteStyle.accent
    override var isEmphasized: Bool { get { true } set {} }
    override func drawSelection(in dirtyRect: NSRect) {
        tint.withAlphaComponent(0.16).setFill()
        NSBezierPath(roundedRect: bounds.insetBy(dx: 8, dy: 1), xRadius: 7, yRadius: 7).fill()
    }
    override func drawBackground(in dirtyRect: NSRect) {}
}

// Commands · Media, each with an icon, its name and its count; the active one sits on a soft pill in its colour
// with its count filled in that colour, an empty one fades. In an apply menu the row names the command instead.
private final class PaletteTabsView: NSView {
    var active: PaletteCategory = .commands { didSet { needsDisplay = true } }
    /// -1 while it's still being read.
    var counts: [PaletteCategory: Int] = [:] { didSet { needsDisplay = true } }
    var title: (name: String, kind: String, colour: NSColor)? { didSet { needsDisplay = true } }
    var onSelect: ((PaletteCategory) -> Void)?
    private var tabRects: [PaletteCategory: NSRect] = [:]

    override var isFlipped: Bool { true }

    private func colour(_ category: PaletteCategory) -> NSColor { PaletteStyle.label(category) }
    private func symbol(_ category: PaletteCategory) -> String {
        switch category {
        case .commands: return "command"
        case .media: return "photo.on.rectangle.angled"
        case .video: return "film"
        case .audio: return "speaker.wave.2"
        case .sfx: return "waveform"
        case .bgm: return "music.note"
        case .sequences: return "film.stack"
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        let w = bounds.width, h = bounds.height
        PaletteStyle.line.setFill()
        NSRect(x: 0, y: h - 1, width: w, height: 1).fill()
        tabRects = [:]
        let midY = (h - 1) / 2
        if let title {
            let kind = NSAttributedString(string: title.kind, attributes: [.font: NSFont.systemFont(ofSize: 11.5, weight: .semibold), .foregroundColor: title.colour])
            let kindSize = kind.size()
            kind.draw(at: NSPoint(x: 18, y: midY - kindSize.height / 2))
            let paragraph = NSMutableParagraphStyle()
            paragraph.lineBreakMode = .byTruncatingTail
            let name = NSAttributedString(string: title.name, attributes: [.font: NSFont.systemFont(ofSize: 12.5, weight: .medium), .foregroundColor: PaletteStyle.text, .paragraphStyle: paragraph])
            let nameHeight = name.size().height
            name.draw(with: NSRect(x: 18 + kindSize.width + 8, y: midY - nameHeight / 2, width: w - kindSize.width - 44, height: nameHeight), options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
            return
        }
        // Seven tabs: when their natural size doesn't fit the palette's width, they draw tighter (less padding,
        // narrower count capsules), and if that still doesn't fit, without their icons, rather than run off the edge.
        let roomy = tabsWidth(compact: false) <= w - 10
        let iconless = !roomy && tabsWidth(compact: true) > w - 10
        let icon: CGFloat = iconless ? 0 : 14
        let pad: CGFloat = roomy ? 10 : iconless ? 6 : 7, iconGap: CGFloat = roomy ? 6 : iconless ? 0 : 5, capGap: CGFloat = roomy ? 7 : 5
        let capMin: CGFloat = roomy ? 30 : 22, between: CGFloat = roomy ? 4 : 2
        var x: CGFloat = roomy ? 10 : 6
        for category in PaletteCategory.allCases {
            let isActive = category == active
            let tint = colour(category)
            let count = counts[category]
            let labelText = NSAttributedString(string: category.label, attributes: [.font: NSFont.systemFont(ofSize: 12.5, weight: isActive ? .semibold : .medium), .foregroundColor: isActive ? PaletteStyle.text : PaletteStyle.muted])
            let countString = count.map { $0 < 0 ? "…" : "\($0)" } ?? ""
            let countText = NSAttributedString(string: countString, attributes: [.font: NSFont.systemFont(ofSize: 10, weight: .semibold), .foregroundColor: isActive ? PaletteStyle.canvas : PaletteStyle.muted])
            let labelSize = labelText.size(), countSize = countText.size()
            // At least three digits wide, so the tabs don't shift as counts change while typing.
            let capsuleWidth = countString.isEmpty ? 0 : max(countSize.width + 10, capMin)
            let width = pad + icon + iconGap + labelSize.width + (capsuleWidth > 0 ? capGap + capsuleWidth : 0) + pad
            let rect = NSRect(x: x, y: midY - 13, width: width, height: 26)
            tabRects[category] = rect
            NSGraphicsContext.saveGraphicsState()
            let faded = count == 0 && !isActive
            if isActive {
                tint.withAlphaComponent(0.15).setFill()
                NSBezierPath(roundedRect: rect, xRadius: 8, yRadius: 8).fill()
            }
            var cx = rect.minX + pad
            if !iconless, let image = NSImage(systemSymbolName: symbol(category), accessibilityDescription: nil)?
                .withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: 11.5, weight: .semibold)
                    .applying(NSImage.SymbolConfiguration(paletteColors: [(isActive ? tint : PaletteStyle.muted).withAlphaComponent(faded ? 0.45 : 1)]))) {
                image.draw(in: NSRect(x: cx + (14 - image.size.width) / 2, y: midY - image.size.height / 2, width: image.size.width, height: image.size.height), from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
            }
            cx += icon + iconGap
            labelText.draw(at: NSPoint(x: cx, y: midY - labelSize.height / 2))
            cx += labelSize.width + capGap
            if capsuleWidth > 0 {
                let box = NSRect(x: cx, y: midY - 8, width: capsuleWidth, height: 16)
                (isActive ? tint : PaletteStyle.line).setFill()
                NSBezierPath(roundedRect: box, xRadius: 8, yRadius: 8).fill()
                countText.draw(at: NSPoint(x: box.midX - countSize.width / 2, y: midY - countSize.height / 2))
            }
            if faded {
                PaletteStyle.canvas.withAlphaComponent(0.55).setFill()
                rect.fill(using: .sourceAtop)
            }
            NSGraphicsContext.restoreGraphicsState()
            x = rect.maxX + between
        }
        let hint = NSAttributedString(string: "Tab to switch", attributes: [.font: NSFont.systemFont(ofSize: 11, weight: .regular), .foregroundColor: PaletteStyle.faint])
        let hintSize = hint.size()
        if x + hintSize.width + 16 < w { hint.draw(at: NSPoint(x: w - hintSize.width - 16, y: midY - hintSize.height / 2)) }
    }

    /// How wide the row of tabs is, measured the way draw lays them out (the active tab's label is semibold).
    private func tabsWidth(compact: Bool) -> CGFloat {
        let pad: CGFloat = compact ? 7 : 10, iconGap: CGFloat = compact ? 5 : 6, capGap: CGFloat = compact ? 5 : 7
        let capMin: CGFloat = compact ? 22 : 30, between: CGFloat = compact ? 2 : 4
        var total: CGFloat = compact ? 6 : 10
        for category in PaletteCategory.allCases {
            let label = NSAttributedString(string: category.label, attributes: [.font: NSFont.systemFont(ofSize: 12.5, weight: category == active ? .semibold : .medium)])
            let countString = counts[category].map { $0 < 0 ? "…" : "\($0)" } ?? ""
            let countWidth = NSAttributedString(string: countString, attributes: [.font: NSFont.systemFont(ofSize: 10, weight: .semibold)]).size().width
            let capsule = countString.isEmpty ? 0 : max(countWidth + 10, capMin)
            total += pad + 14 + iconGap + label.size().width + (capsule > 0 ? capGap + capsule : 0) + pad + between
        }
        return total
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        if title == nil, let hit = tabRects.first(where: { $0.value.contains(point) }) { onSelect?(hit.key) }
        else { super.mouseDown(with: event) }
    }
}

// A small key cap, like the "Esc" at the end of Sage's search row.
private final class PaletteKeyCapView: NSView {
    var text = "" { didSet { needsDisplay = true } }
    override func draw(_ dirtyRect: NSRect) {
        let box = bounds.insetBy(dx: 0.5, dy: 0.5)
        let path = NSBezierPath(roundedRect: box, xRadius: 5, yRadius: 5)
        PaletteStyle.card.setFill()
        path.fill()
        PaletteStyle.line.setStroke()
        path.lineWidth = 1
        path.stroke()
        let label = NSAttributedString(string: text, attributes: [.font: NSFont.systemFont(ofSize: 10.5, weight: .medium), .foregroundColor: PaletteStyle.muted])
        let size = label.size()
        label.draw(at: NSPoint(x: (bounds.width - size.width) / 2, y: (bounds.height - size.height) / 2))
    }
}

private enum BridgeOutcome {
    case delivered(Command, client: String)
    case discarded(Command)
    case result(CommandResult)
}

private final class CommandBridge {
    private let listener: NWListener
    private let lock = NSLock()
    private var pendingCommands = PendingCommands<Command>()
    private let queue = DispatchQueue(label: "com.prfx.shortcut-listener.bridge")
    private let catalogHandler: ([Command], String) -> Void
    private let healthHandler: () -> String
    private let settingsReloadHandler: () -> Void
    private let stateHandler: (NWListener.State) -> Void
    private let outcomeHandler: (BridgeOutcome) -> Void
    private let controlToken: String
    private let controlHandler: (String, Data) -> Void
    private let catalogPayloadHandler: () -> String
    private let settingsPayloadHandler: () -> String
    private let settingsWriteHandler: (Data) -> String
    // Which CEP context last asked for work. The hidden engine extension polls
    // as "engine"; the settings panel defers to it while it is alive.
    private var lastPollAt: [String: Date] = [:]
    private var uxpSupportedIDs: Set<String> = []
    private let uxpFreshFor: TimeInterval = 2.5
    // The palette's Media search: when set, the next CEP poll with no real command waiting gets
    // {type:"media-list"} and answers with POST /media (prfx.listProjectMedia()). Never queued or journaled.
    private var mediaWanted = false
    var mediaHandler: ((Data) -> Void)?

    func requestMedia() {
        lock.lock()
        mediaWanted = true
        lock.unlock()
    }

    init(catalogHandler: @escaping ([Command], String) -> Void, healthHandler: @escaping () -> String, settingsReloadHandler: @escaping () -> Void, stateHandler: @escaping (NWListener.State) -> Void, outcomeHandler: @escaping (BridgeOutcome) -> Void, controlToken: String, controlHandler: @escaping (String, Data) -> Void, catalogPayloadHandler: @escaping () -> String, settingsPayloadHandler: @escaping () -> String, settingsWriteHandler: @escaping (Data) -> String) throws {
        self.controlToken = controlToken
        self.controlHandler = controlHandler
        self.catalogPayloadHandler = catalogPayloadHandler
        self.settingsPayloadHandler = settingsPayloadHandler
        self.settingsWriteHandler = settingsWriteHandler
        self.catalogHandler = catalogHandler
        self.healthHandler = healthHandler
        self.settingsReloadHandler = settingsReloadHandler
        self.stateHandler = stateHandler
        self.outcomeHandler = outcomeHandler
        listener = try NWListener(using: .tcp, on: NWEndpoint.Port(rawValue: 27389)!)
        listener.stateUpdateHandler = { state in
            stateHandler(state)
        }
        listener.newConnectionHandler = { [weak self] connection in self?.receive(connection) }
        listener.start(queue: queue)
    }

    func enqueue(_ command: Command) {
        lock.lock()
        let accepted = pendingCommands.append(command)
        let discarded = pendingCommands.drainDiscarded()
        lock.unlock()
        report(discarded)
        guard accepted else {
            listenerLog("Shortcut queue full; rejected: \(command.name)")
            return
        }
        listenerLog("Queued palette command: \(command.name) [placement: \(command.transitionPlacement ?? "default"), move: \(command.moveMode ?? "default")]")
    }

    func pendingName() -> String {
        lock.lock()
        pendingCommands.expire()
        let name = pendingCommands.first?.name ?? ""
        let discarded = pendingCommands.drainDiscarded()
        lock.unlock()
        report(discarded)
        return name
    }

    func queueHealth() -> String {
        lock.lock()
        pendingCommands.expire()
        let discarded = pendingCommands.drainDiscarded()
        let now = Date()
        let engineAge = lastPollAt["engine"].map { Int(now.timeIntervalSince($0) * 1000) } ?? -1
        let panelAge = lastPollAt["panel"].map { Int(now.timeIntervalSince($0) * 1000) } ?? -1
        let uxpAge = lastPollAt["uxp"].map { Int(now.timeIntervalSince($0) * 1000) } ?? -1
        let body = ",\"queuedCommands\":\(pendingCommands.count),\"droppedCommands\":\(pendingCommands.dropped),\"enginePollAgeMs\":\(engineAge),\"panelPollAgeMs\":\(panelAge),\"uxpPollAgeMs\":\(uxpAge),\"uxpSupportedCommands\":\(uxpSupportedIDs.count)"
        lock.unlock()
        report(discarded)
        return body
    }

    // Periodic sweep so an expired command is reported even when nothing else
    // touches the queue (CEP not polling at all is exactly that case).
    func sweep() {
        lock.lock()
        pendingCommands.expire()
        let discarded = pendingCommands.drainDiscarded()
        lock.unlock()
        report(discarded)
    }

    private func report(_ discarded: [Command]) {
        for command in discarded { outcomeHandler(.discarded(command)) }
    }

    private static func pollClient(in request: String) -> String {
        let firstLine = request.prefix { $0 != "\r" && $0 != "\n" }
        if firstLine.contains("client=engine") { return "engine" }
        if firstLine.contains("client=panel") { return "panel" }
        if firstLine.contains("client=uxp") { return "uxp" }
        return "legacy"
    }

    private func receive(_ connection: NWConnection) {
        connection.start(queue: queue)
        receiveRequest(connection, data: Data())
    }

    private func receiveRequest(_ connection: NWConnection, data: Data) {
        // Premiere's installed-FX catalog is well above a single 64 KB TCP read.
        // Assemble the declared HTTP body before decoding it; otherwise a valid
        // catalog is truncated and the palette silently remains on its fallback.
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] chunk, _, isComplete, error in
            guard let self else { return }
            var requestData = data
            if let chunk { requestData.append(chunk) }
            if error != nil {
                connection.cancel()
                return
            }
            guard let headerEnd = self.httpHeaderEnd(in: requestData) else {
                if isComplete { connection.cancel() }
                else { self.receiveRequest(connection, data: requestData) }
                return
            }
            let headerData = requestData.subdata(in: 0..<headerEnd)
            let header = String(data: headerData, encoding: .utf8) ?? ""
            let contentLength = self.httpContentLength(in: header)
            let totalLength = headerEnd + 4 + contentLength
            guard requestData.count >= totalLength || isComplete else {
                self.receiveRequest(connection, data: requestData)
                return
            }
            let request = String(data: requestData.subdata(in: 0..<min(requestData.count, totalLength)), encoding: .utf8) ?? ""
            if request.hasPrefix("GET /next ") || request.hasPrefix("GET /next?") {
                let client = CommandBridge.pollClient(in: request)
                self.lock.lock()
                let now = Date()
                self.lastPollAt[client] = now
                let uxpIsFresh = self.lastPollAt["uxp"].map { now.timeIntervalSince($0) < self.uxpFreshFor } == true
                let command: Command?
                if client == "uxp" {
                    command = self.pendingCommands.take(at: now, where: { command in
                        self.uxpSupportedIDs.contains(CommandBridge.uxpRouteKey(command))
                    })
                } else if uxpIsFresh {
                    command = self.pendingCommands.take(at: now, where: { command in
                        !self.uxpSupportedIDs.contains(CommandBridge.uxpRouteKey(command))
                    })
                } else {
                    command = self.pendingCommands.take(at: now)
                }
                var askForMedia = false
                if command == nil, client != "uxp", self.mediaWanted {
                    self.mediaWanted = false
                    askForMedia = true
                }
                let discarded = self.pendingCommands.drainDiscarded()
                self.lock.unlock()
                self.report(discarded)
                if askForMedia {
                    self.respond(connection, status: "200 OK", body: "{\"type\":\"media-list\",\"name\":\"List project media\"}")
                    return
                }
                if let command {
                    listenerLog("Runtime (\(client)) collected palette command: \(command.name) [placement: \(command.transitionPlacement ?? "default"), move: \(command.moveMode ?? "default")]")
                    self.outcomeHandler(.delivered(command, client: client))
                }
                let body = String(data: (try? JSONEncoder().encode(command)) ?? Data("null".utf8), encoding: .utf8) ?? "null"
                self.respond(connection, status: "200 OK", body: body)
            } else if request.hasPrefix("GET /health ") {
                self.respond(connection, status: "200 OK", body: self.healthHandler())
            } else if request.hasPrefix("GET /catalog-current ") {
                self.respond(connection, status: "200 OK", body: self.catalogPayloadHandler())
            } else if request.hasPrefix("GET /settings-current ") {
                self.respond(connection, status: "200 OK", body: self.settingsPayloadHandler())
            } else if request.hasPrefix("POST /catalog ") {
                let bodyStart = headerEnd + 4
                let body = requestData.subdata(in: bodyStart..<totalLength)
                if let catalog = try? JSONDecoder().decode([Command].self, from: body) {
                    let fingerprint = self.httpHeaderValue("x-prfx-catalog-fingerprint", in: header) ?? self.bodyFingerprint(body)
                    self.catalogHandler(catalog, fingerprint)
                    self.respond(connection, status: "200 OK", body: "{\"ok\":true,\"catalogFingerprint\":\"\(self.jsonEscape(fingerprint))\",\"catalogCount\":\(catalog.count)}")
                } else {
                    self.respond(connection, status: "400 Bad Request", body: "{\"error\":\"invalid catalog\"}")
                }
            } else if request.hasPrefix("POST /media ") {
                let body = requestData.subdata(in: (headerEnd + 4)..<totalLength)
                self.mediaHandler?(body)
                self.respond(connection, status: "200 OK", body: "{\"ok\":true}")
            } else if request.hasPrefix("POST /runtime ") {
                let bodyStart = headerEnd + 4
                let body = requestData.subdata(in: bodyStart..<totalLength)
                if let registration = try? JSONDecoder().decode(RuntimeRegistration.self, from: body), registration.runtime == "uxp" {
                    self.lock.lock()
                    self.uxpSupportedIDs = Set(registration.supportedIds.filter { !$0.isEmpty })
                    self.lastPollAt["uxp"] = Date()
                    let count = self.uxpSupportedIDs.count
                    self.lock.unlock()
                    self.respond(connection, status: "200 OK", body: "{\"ok\":true,\"supportedCommands\":\(count)}")
                } else {
                    self.respond(connection, status: "400 Bad Request", body: "{\"error\":\"invalid runtime registration\"}")
                }
            } else if request.hasPrefix("POST /result ") {
                let bodyStart = headerEnd + 4
                let body = requestData.subdata(in: bodyStart..<totalLength)
                if let result = try? JSONDecoder().decode(CommandResult.self, from: body) {
                    self.outcomeHandler(.result(result))
                    self.respond(connection, status: "200 OK", body: "{\"ok\":true}")
                } else {
                    self.respond(connection, status: "400 Bad Request", body: "{\"error\":\"invalid result\"}")
                }
            } else if request.hasPrefix("POST /uxp-run ") {
                let origin = self.httpHeaderValue("origin", in: header) ?? ""
                guard origin.isEmpty || origin == "null" || origin.hasPrefix("uxp://") || origin.hasPrefix("file://") else {
                    self.respond(connection, status: "403 Forbidden", body: "{\"error\":\"UXP origin required\"}")
                    return
                }
                self.lock.lock()
                let uxpIsFresh = self.lastPollAt["uxp"].map { Date().timeIntervalSince($0) < self.uxpFreshFor } == true
                self.lock.unlock()
                guard uxpIsFresh else {
                    self.respond(connection, status: "409 Conflict", body: "{\"error\":\"UXP runtime is not registered\"}")
                    return
                }
                let bodyStart = headerEnd + 4
                self.controlHandler("/run", requestData.subdata(in: bodyStart..<totalLength))
                self.respond(connection, status: "200 OK", body: "{\"ok\":true}")
            } else if request.hasPrefix("POST /settings-write ") {
                let origin = self.httpHeaderValue("origin", in: header) ?? ""
                guard origin.isEmpty || origin == "null" || origin.hasPrefix("uxp://") || origin.hasPrefix("file://") else {
                    self.respond(connection, status: "403 Forbidden", body: "{\"error\":\"UXP origin required\"}")
                    return
                }
                let bodyStart = headerEnd + 4
                let response = self.settingsWriteHandler(requestData.subdata(in: bodyStart..<totalLength))
                self.respond(connection, status: response.hasPrefix("{\"error\"") ? "400 Bad Request" : "200 OK", body: response)
            } else if request.hasPrefix("POST /uxp-open-palette ") || request.hasPrefix("POST /uxp-reveal ") || request.hasPrefix("POST /uxp-scan-folder ") || request.hasPrefix("POST /uxp-export-folder ") || request.hasPrefix("POST /uxp-undo ") {
                // The Edie UXP panel has no Node or shell: the listener opens the
                // palette, reveals log files and lists synced folders for it.
                let origin = self.httpHeaderValue("origin", in: header) ?? ""
                guard origin.isEmpty || origin == "null" || origin.hasPrefix("uxp://") || origin.hasPrefix("file://") else {
                    self.respond(connection, status: "403 Forbidden", body: "{\"error\":\"UXP origin required\"}")
                    return
                }
                let body = requestData.subdata(in: (headerEnd + 4)..<totalLength)
                if request.hasPrefix("POST /uxp-export-folder ") {
                    let response = CommandBridge.exportFolder(body)
                    self.respond(connection, status: response.hasPrefix("{\"error\"") ? "400 Bad Request" : "200 OK", body: response)
                } else if request.hasPrefix("POST /uxp-undo ") {
                    let response = CommandBridge.sendUndo(body)
                    self.respond(connection, status: response.hasPrefix("{\"error\"") ? "409 Conflict" : "200 OK", body: response)
                } else if request.hasPrefix("POST /uxp-scan-folder ") {
                    let response = CommandBridge.scanSyncFolder(body)
                    self.respond(connection, status: response.hasPrefix("{\"error\"") ? "400 Bad Request" : "200 OK", body: response)
                } else if request.hasPrefix("POST /uxp-reveal ") {
                    self.respond(connection, status: "200 OK", body: CommandBridge.revealLogFile(body))
                } else {
                    self.controlHandler("/open-palette", body)
                    self.respond(connection, status: "200 OK", body: "{\"ok\":true}")
                }
            } else if request.hasPrefix("POST /run ") || request.hasPrefix("POST /open-palette ") {
                // A custom header also forces a CORS preflight, which this server
                // never answers, so a web page cannot reach these routes at all.
                guard !self.controlToken.isEmpty, self.httpHeaderValue("x-prfx-token", in: header) == self.controlToken else {
                    self.respond(connection, status: "403 Forbidden", body: "{\"error\":\"bad token\"}")
                    return
                }
                let route = request.hasPrefix("POST /run ") ? "/run" : "/open-palette"
                let bodyStart = headerEnd + 4
                self.controlHandler(route, requestData.subdata(in: bodyStart..<totalLength))
                self.respond(connection, status: "200 OK", body: "{\"ok\":true}")
            } else if request.hasPrefix("POST /reload-settings ") {
                self.settingsReloadHandler()
                self.respond(connection, status: "200 OK", body: "{\"ok\":true}")
            } else {
                self.respond(connection, status: "404 Not Found", body: "{\"error\":\"not found\"}")
            }
        }
    }

    /// What the UXP runtime registers to take a command: its function id, or
    /// for effects and transitions (which have none) its type and name.
    fileprivate static func uxpRouteKey(_ command: Command) -> String {
        if let id = command.id, !id.isEmpty { return id }
        return command.type + ":" + command.name
    }

    /// `<project folder>/PR FX Exports`, created if missing, for the UXP
    /// Queue cuts to Media Encoder (UXP may not create folders itself).
    static func exportFolder(_ body: Data) -> String {
        struct ExportRequest: Decodable { let projectPath: String }
        guard let path = (try? JSONDecoder().decode(ExportRequest.self, from: body))?.projectPath,
              path.hasPrefix("/"), path.lowercased().hasSuffix(".prproj") else {
            return "{\"error\":\"Save the Premiere project first.\"}"
        }
        let folder = URL(fileURLWithPath: path).deletingLastPathComponent().appendingPathComponent("PR FX Exports", isDirectory: true)
        do { try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true) }
        catch { return "{\"error\":\"Could not create the PR FX Exports folder next to the project.\"}" }
        let escaped = folder.path.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
        return "{\"path\":\"\(escaped)\"}"
    }

    /// Premiere's own Undo or Redo, pressed for the UXP panel: UXP has no undo
    /// call. Only when Premiere is frontmost, so the keys never land elsewhere.
    static func sendUndo(_ body: Data) -> String {
        struct UndoRequest: Decodable { let redo: Bool?; let count: Int? }
        let request = try? JSONDecoder().decode(UndoRequest.self, from: body)
        let redo = request?.redo == true
        let count = max(1, min(request?.count ?? 1, 25))
        guard let premiere = NSWorkspace.shared.frontmostApplication,
              premiere.bundleIdentifier?.hasPrefix("com.adobe.PremierePro") == true else {
            return "{\"error\":\"Premiere is not in front.\"}"
        }
        let source = CGEventSource(stateID: .combinedSessionState)
        let flags: CGEventFlags = redo ? [.maskCommand, .maskShift] : [.maskCommand]
        for _ in 0..<count {
            let down = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(kVK_ANSI_Z), keyDown: true)
            let up = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(kVK_ANSI_Z), keyDown: false)
            down?.flags = flags; up?.flags = flags
            down?.postToPid(premiere.processIdentifier)
            up?.postToPid(premiere.processIdentifier)
            usleep(60_000)
        }
        return "{\"ok\":true,\"count\":\(count)}"
    }

    /// Opens one of Edie's own log files for the UXP panel. Only these known
    /// files, never a path from the request.
    static func revealLogFile(_ body: Data) -> String {
        struct Reveal: Decodable { let which: String }
        let which = (try? JSONDecoder().decode(Reveal.self, from: body))?.which ?? ""
        let home = FileManager.default.homeDirectoryForCurrentUser
        let logs = home.appendingPathComponent("Library/Logs", isDirectory: true)
        let targets: [String: URL] = [
            "failures": home.appendingPathComponent("Library/Application Support/PR FX Palette/failure-log.jsonl"),
            "journal": logs.appendingPathComponent("PR FX Key Journal.tsv"),
            "listenerLog": logs.appendingPathComponent("PR FX Shortcut Listener.log"),
        ]
        guard let target = targets[which] else { return "{\"ok\":false,\"message\":\"Unknown log.\"}" }
        guard FileManager.default.fileExists(atPath: target.path) else { return "{\"ok\":false,\"message\":\"Nothing logged yet.\"}" }
        DispatchQueue.main.async { NSWorkspace.shared.open(target) }
        return "{\"ok\":true}"
    }

    /// Media files under a synced folder, for the UXP panel's Sync now. Same
    /// rules as the CEP panel's scan: hidden files and links skipped, media
    /// extensions only; `stamp` (size:mtime ms) tells the panel what changed.
    static func scanSyncFolder(_ body: Data) -> String {
        struct ScanRequest: Decodable { let path: String }
        struct ScanFile: Encodable { let path: String; let relativePath: String; let stamp: String }
        struct ScanResult: Encodable { let files: [ScanFile]; let truncated: Bool }
        guard let request = try? JSONDecoder().decode(ScanRequest.self, from: body), !request.path.isEmpty else {
            return "{\"error\":\"A folder path is required.\"}"
        }
        let root = URL(fileURLWithPath: request.path, isDirectory: true).standardizedFileURL
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: root.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            return "{\"error\":\"This folder is no longer there.\"}"
        }
        let keys: [URLResourceKey] = [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey, .contentModificationDateKey]
        guard let walker = FileManager.default.enumerator(at: root, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles, .skipsPackageDescendants]) else {
            return "{\"error\":\"This folder cannot be read.\"}"
        }
        let media: Set<String> = ["3g2", "3gp", "aac", "aif", "aiff", "avi", "bwf", "cr2", "dng", "gif", "heic", "jpeg", "jpg", "m4a", "m4v", "mkv", "mov", "mp3", "mp4", "mpeg", "mpg", "mxf", "png", "psd", "r3d", "tga", "tif", "tiff", "wav", "webm"]
        let prefix = root.path.hasSuffix("/") ? root.path : root.path + "/"
        let pickedPrefix = request.path.hasSuffix("/") ? request.path : request.path + "/"
        let limit = 20_000
        var files: [ScanFile] = []
        var truncated = false
        for case let url as URL in walker {
            guard let values = try? url.resourceValues(forKeys: Set(keys)), values.isSymbolicLink != true, values.isRegularFile == true,
                  media.contains(url.pathExtension.lowercased()) else { continue }
            if files.count >= limit { truncated = true; break }
            let standard = url.standardizedFileURL.path
            let relative = standard.hasPrefix(prefix) ? String(standard.dropFirst(prefix.count)) : url.lastPathComponent
            // Keep the folder spelled as the user picked it (e.g. /private/...),
            // so paths match the ones Premiere stored on import.
            let path = pickedPrefix + relative
            let modified = Int64(((values.contentModificationDate ?? .distantPast).timeIntervalSince1970 * 1000).rounded(.down))
            files.append(ScanFile(path: path, relativePath: relative, stamp: "\(values.fileSize ?? 0):\(modified)"))
        }
        guard let data = try? JSONEncoder().encode(ScanResult(files: files, truncated: truncated)) else { return "{\"error\":\"Could not list this folder.\"}" }
        return String(data: data, encoding: .utf8) ?? "{\"error\":\"Could not list this folder.\"}"
    }

    private func httpHeaderEnd(in data: Data) -> Int? {
        let delimiter = Data("\r\n\r\n".utf8)
        return data.range(of: delimiter)?.lowerBound
    }

    private func httpContentLength(in header: String) -> Int {
        for line in header.components(separatedBy: "\r\n") {
            let parts = line.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
            if parts.count == 2 && parts[0].trimmingCharacters(in: .whitespaces).lowercased() == "content-length" {
                return Int(parts[1].trimmingCharacters(in: .whitespaces)) ?? 0
            }
        }
        return 0
    }

    private func httpHeaderValue(_ name: String, in header: String) -> String? {
        let target = name.lowercased()
        for line in header.components(separatedBy: "\r\n") {
            let parts = line.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
            if parts.count == 2 && parts[0].trimmingCharacters(in: .whitespaces).lowercased() == target {
                let value = parts[1].trimmingCharacters(in: .whitespacesAndNewlines)
                return value.isEmpty ? nil : value
            }
        }
        return nil
    }

    private func bodyFingerprint(_ data: Data) -> String {
        var hash: UInt32 = 2_166_136_261
        for byte in data {
            hash ^= UInt32(byte)
            hash = hash &* 16_777_619
        }
        return String(format: "fnv1a32-%08x-%d", hash, data.count)
    }

    private func jsonEscape(_ value: String) -> String {
        var result = ""
        for scalar in value.unicodeScalars {
            switch scalar {
            case "\"": result += "\\\""
            case "\\": result += "\\\\"
            case "\n": result += "\\n"
            case "\r": result += "\\r"
            case "\t": result += "\\t"
            default: result.unicodeScalars.append(scalar)
            }
        }
        return result
    }

    private func respond(_ connection: NWConnection, status: String, body: String) {
        let response = "HTTP/1.1 \(status)\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nContent-Length: \(body.lengthOfBytes(using: .utf8))\r\nConnection: close\r\n\r\n\(body)"
        connection.send(content: response.data(using: .utf8), completion: .contentProcessed { _ in connection.cancel() })
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var listener: ShortcutListener?
    func applicationDidFinishLaunching(_ notification: Notification) { listener = ShortcutListener() }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

// Declared with @main rather than as top-level statements: Swift only permits
// top-level code in a file named main.swift, and the listener is now built from
// more than one source file.
@main
enum PRFXShortcutListenerApp {
    // Held statically because NSApplication does not retain its delegate.
    private static let delegate = AppDelegate()

    static func main() {
        let app = NSApplication.shared
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
    }
}
