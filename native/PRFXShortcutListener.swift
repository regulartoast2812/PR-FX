import AppKit
import ApplicationServices
import Foundation
import Carbon.HIToolbox
import Darwin
import Network

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

    init(type: String, name: String, transitionFrames: Int?, id: String?, transitionPlacement: String? = nil, moveMode: String? = nil, staggerFrames: Int? = nil, staggerGroup: Int? = nil) {
        self.type = type
        self.name = name
        self.transitionFrames = transitionFrames
        self.id = id
        self.transitionPlacement = transitionPlacement
        self.moveMode = moveMode
        self.staggerFrames = staggerFrames
        self.staggerGroup = staggerGroup
    }
}

private let prfxFunctionCommands = [
    Command(type: "custom", name: "[System] Dump QE + DOM API", transitionFrames: 30, id: "dump-qe-api"),
    Command(type: "custom", name: "[System] Inspect Selected Clip", transitionFrames: 30, id: "inspect-selected-clip"),
    Command(type: "custom", name: "Undo Last PR FX Effect Apply", transitionFrames: 30, id: "undo-last-palette-action"),
    Command(type: "custom", name: "Remove Transitions on Selected Clips", transitionFrames: 30, id: "remove-transitions"),
    Command(type: "custom", name: "Move Selected Clips Up", transitionFrames: 30, id: "move-selected-clips-up"),
    Command(type: "custom", name: "Move Selected Clips Down", transitionFrames: 30, id: "move-selected-clips-down"),
    Command(type: "custom", name: "Pull Group In to Playhead", transitionFrames: 30, id: "pull-group-in"),
    Command(type: "custom", name: "Pull Group Out to Playhead", transitionFrames: 30, id: "pull-group-out"),
    Command(type: "custom", name: "Retract Speed In to Playhead", transitionFrames: 30, id: "retract-speed-in-to-playhead"),
    Command(type: "custom", name: "Retract Speed Out to Playhead", transitionFrames: 30, id: "retract-speed-out-to-playhead"),
    Command(type: "custom", name: "Undo Last PR FX Action (Any)", transitionFrames: 30, id: "undo-last-prfx-action"),
    Command(type: "custom", name: "Undo Last PR FX Arrange Action", transitionFrames: 30, id: "undo-last-arrange"),
    Command(type: "custom", name: "Redo Last PR FX Arrange Action", transitionFrames: 30, id: "redo-last-arrange"),
    Command(type: "custom", name: "Perfect Pitch (Correct Speed Transposition)", transitionFrames: 30, id: "perfect-pitch"),
    Command(type: "custom", name: "Place Source Monitor Clip at Playhead", transitionFrames: 30, id: "place-source-clip"),
    Command(type: "custom", name: "Place Bin Clips at Playhead in Row", transitionFrames: 30, id: "place-bin-clips"),
    Command(type: "custom", name: "Place Bin Clips at Playhead in Column", transitionFrames: 30, id: "place-bin-clips-column"),
    Command(type: "custom", name: "Replace Selected Clips from Bin", transitionFrames: 30, id: "replace-from-bin"),
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
// Accessibility/TCC has proven too brittle for this tool: ad-hoc rebuilds can
// make macOS report the listener as untrusted even when the toggle is visibly
// enabled. Keep shortcut scoping simple and permission-free: arm while Premiere
// is frontmost, and do not inspect Premiere's Accessibility tree for panel focus.
private let prfxBypassAccessibilityFocus = true

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
    case full(String)

    var reason: String {
        switch self {
        case .none(let reason), .modifierOnly(let reason), .full(let reason): return reason
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
        }
    }

    func arms(_ shortcut: Shortcut) -> Bool {
        switch self {
        case .none: return false
        case .full: return true
        case .modifierOnly: return shortcut.ctrl || shortcut.alt || shortcut.meta
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
    private var eventHandler: EventHandlerRef?
    private var panel: NSPanel?
    private var searchField: NSSearchField?
    private var listView: NSTableView?
    private var paletteTitle: NSTextField?
    private var paletteHotkey: NSTextField?
    private var paletteFooter: NSTextField?
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
    private var focusPollTimer: Timer?
    private var axObserver: AXObserver?
    private var axObservedPid: pid_t = 0
    private var axObservedElement: AXUIElement?
    private var shortcutScopeReason = "Starting"
    private var clickMonitor: Any?
    // Last mouse-down in Accessibility coordinates (top-left origin).
    private var lastClickPoint: CGPoint?
    private var cachedTimelineRegion: CGRect?
    private var cachedRegionAt = Date.distantPast
    private var attemptedTimelineRegionLogRestore = false
    private var registeredScopeRank = -1
    private var settingsFileModifiedAt: Date?
    private var settingsRevision = 0
    // Diagnostic state. The logging itself lives in PRFXAccessibilityProbe.swift;
    // stored properties cannot, because Swift extensions may not add storage.
    var lastDiagnosticFingerprint = ""
    var lastProbeAt = Date.distantPast
    var lastProbeFingerprint = ""
    private var commands = prfxFunctionCommands + [
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
        settings = Settings(shortcut: Shortcut(code: "Space", ctrl: true, alt: false, shift: false, meta: false), transitionFrames: 30, staggerFrames: 5, staggerGroup: 1, bindings: [])
        super.init()
        listenerLog("Listener build: \(prfxListenerBuild)")
        guard acquireSingleInstanceLock() else {
            listenerLog("Another PR FX Shortcut Listener instance is already active; exiting before registering shortcuts.")
            DispatchQueue.main.async { NSApp.terminate(nil) }
            return
        }
        loadCatalog()
        commandBridge = try? CommandBridge(
            catalogHandler: { [weak self] catalog in
                DispatchQueue.main.async {
                    guard let self else { return }
                    guard catalog.count >= 25 else {
                        listenerLog("Rejected incomplete catalog: \(catalog.count) command(s)")
                        return
                    }
                    // CEP is the single command registry. It sends functions and
                    // Premiere's live effects/transitions together, in display order.
                    self.commands = self.mergingBuiltInFunctions(into: catalog)
                    self.saveCatalog()
                    self.catalogRevision += 1
                    listenerLog("Catalog synced: \(catalog.count) command(s), revision \(self.catalogRevision)")
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
            }
        )
        guard commandBridge != nil else {
            listenerLog("Command bridge could not start. Another PR FX listener may already be running; this instance will exit instead of grabbing shortcuts without a bridge.")
            DispatchQueue.main.async { NSApp.terminate(nil) }
            return
        }
        loadSettings()
        promptForAccessibilityIfNeeded()
        observeClicks()
        observeFrontmostApplication()
        makePalette()
        NotificationCenter.default.addObserver(self, selector: #selector(listenerWillResignActive(_:)), name: NSApplication.willResignActiveNotification, object: nil)
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
        commands = mergingBuiltInFunctions(into: catalog)
        listenerLog("Restored cached catalog: \(catalog.count) command(s)")
    }

    private func saveCatalog() {
        guard commands.count >= 25, let data = try? JSONEncoder().encode(commands) else { return }
        try? FileManager.default.createDirectory(at: catalogURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: catalogURL, options: .atomic)
    }

    private func mergingBuiltInFunctions(into catalog: [Command]) -> [Command] {
        let managedIDs = Set(prfxFunctionCommands.compactMap(\.id))
        return prfxFunctionCommands + catalog.filter { command in
            if let id = command.id, retiredCommandIDs.contains(id) { return false }
            return !(command.type == "custom" && command.id.map(managedIDs.contains) == true)
        }
    }

    deinit {
        focusPollTimer?.invalidate()
        hotKeyRefreshTimer?.invalidate()
        if let clickMonitor { NSEvent.removeMonitor(clickMonitor) }
        removeFocusObserver()
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
                if binding.command.id == "undo-last-palette-action" {
                    return Binding(shortcut: binding.shortcut, command: Command(type: "custom", name: "Undo Last PR FX Effect Apply", transitionFrames: binding.command.transitionFrames, id: binding.command.id))
                }
                if binding.command.id == "remove-transitions" {
                    return Binding(shortcut: binding.shortcut, command: Command(type: "custom", name: "Remove Transitions on Selected Clips", transitionFrames: binding.command.transitionFrames, id: binding.command.id))
                }
                return binding
            }
            settings = Settings(shortcut: loaded.shortcut, transitionFrames: loaded.transitionFrames, staggerFrames: loaded.staggerFrames ?? 5, staggerGroup: loaded.staggerGroup ?? 1, bindings: bindings)
            settingsFileModifiedAt = settingsModificationDate()
            let changed = settingsSignature(settings) != previousSignature
            if changed { settingsRevision += 1 }
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
            if focus.arms(binding.shortcut) { armed += 1 }
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
        let settingsChanged = reloadSettingsIfNeeded()
        updateHotKeyRegistration(force: settingsChanged)
        let accessibilityTrusted = prfxBypassAccessibilityFocus ? false : AXIsProcessTrusted()
        let currentFocus = timelineShortcutFocus()
        let mode: String
        if isPremiere(NSWorkspace.shared.frontmostApplication) && !hotKeyRefs.isEmpty {
            if registeredScopeRank == paletteFallbackScopeRank {
                mode = "palette-only"
            } else if registeredScopeRank == 1 {
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
        let expectedCounts = expectedArmCounts(for: currentFocus)
        let armedBindings = hotKeyCommands.isEmpty && savedBindings > 0 ? expectedCounts.armed : hotKeyCommands.count
        let withheldBindings = max(0, savedBindings - armedBindings)
        return "{\"mode\":\"\(mode)\",\"listenerBuild\":\"\(jsonEscape(prfxListenerBuild))\",\"bindings\":\(savedBindings),\"armedBindings\":\(armedBindings),\"withheldBindings\":\(withheldBindings),\"accessibilityTrusted\":\(accessibilityTrusted ? "true" : "false"),\"accessibilityBypassed\":\(prfxBypassAccessibilityFocus ? "true" : "false"),\"catalogCount\":\(commands.count),\"catalogRevision\":\(catalogRevision),\"pendingCommand\":\"\(jsonEscape(pending))\",\"focus\":\"\(jsonEscape(shortcutScopeReason))\",\"paletteFrameSaved\":\(paletteFrameSaved)}"
    }

    // Carbon hotkeys are global by API design and they consume registered keys.
    // Keep them registered only while Premiere's Timeline/Sequence panel owns
    // focus, so typing in bins, search fields, and rename fields passes through.
    // The app is ad-hoc signed, so every rebuild changes its code identity and
    // macOS discards the previous Accessibility grant. Without that grant the
    // listener cannot read focus and refuses to arm any shortcut, which looks
    // exactly like the tool being broken. Ask for it explicitly instead.
    private func promptForAccessibilityIfNeeded() {
        guard !prfxBypassAccessibilityFocus else {
            listenerLog("Accessibility focus detection bypassed; shortcuts scope to Premiere frontmost.")
            return
        }
        guard !AXIsProcessTrusted() else { return }
        listenerLog("Accessibility is not granted; prompting. Timeline shortcuts stay disabled until it is enabled.")
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
            self?.updateFocusPolling()
            self?.refreshHotKeys()
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
            self.updateFocusPolling()
            self.refreshHotKeys()
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
        updateHotKeyRegistration(force: false)
    }

    private func updateHotKeyRegistration(force: Bool) {
        let settingsChanged = reloadSettingsIfNeeded()
        let shouldForce = force || settingsChanged
        guard bridgeReady else {
            shortcutScopeReason = "Command bridge is not ready"
            if !hotKeyRefs.isEmpty { unregisterHotKeys() }
            if shouldForce { listenerLog("Timeline shortcuts paused: command bridge is not ready") }
            return
        }
        let focus = timelineShortcutFocus()
        shortcutScopeReason = focus.reason
        if !prfxBypassAccessibilityFocus {
            logAXDiagnostic(verdict: (focus.armsAnything, focus.reason))
            logAXPanelProbe()
        }
        guard focus.armsAnything else {
            if canArmPaletteWithoutAccessibility() {
                if !shouldForce && registeredScopeRank == paletteFallbackScopeRank { return }
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
        if !shouldForce && registeredScopeRank == focus.rank { return }
        unregisterHotKeys()
        installHotKeyHandler()
        var armed = 0
        var withheld = 0
        if focus.arms(settings.shortcut) {
            registerHotKey(settings.shortcut, id: 1, command: nil)
            armed += 1
        } else { withheld += 1 }
        for (offset, binding) in (settings.bindings ?? []).enumerated() {
            if focus.arms(binding.shortcut) {
                registerHotKey(binding.shortcut, id: UInt32(offset + 2), command: binding.command)
                armed += 1
            } else { withheld += 1 }
        }
        registeredScopeRank = focus.rank
        listenerLog("Timeline shortcuts active (\(focus.reason)): \(armed) armed"
            + (withheld > 0 ? ", \(withheld) withheld — modifier-less keys need the Timeline located" : ""))
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
            listenerLog("Shortcut registration failed for \(display(shortcut)) (OSStatus \(result))")
            return
        }
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
        if focus.arms(shortcut) { return true }
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
            applyMappedCommand(command)
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

    private func showPaletteIfPremiereIsActive() {
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
        listenerLog("Opening palette")
        loadSettings()
        unregisterHotKeys()
        if pendingTransitionCommand != nil || pendingMoveCommand != nil || pendingStaggerCommand != nil { resetApplyMenu() }
        searchField?.stringValue = ""
        filterCommands(resetSelection: true)
        restorePaletteFrame()
        panel?.makeKeyAndOrderFront(nil)
        startPaletteFrameTracking()
        NSApp.activate(ignoringOtherApps: true)
        searchField?.becomeFirstResponder()
    }

    @objc private func listenerWillResignActive(_ notification: Notification) {
        savePaletteFrame(reason: "listener resign active")
        // If the palette auto-hides because the user clicks back into Premiere,
        // macOS does not always deliver the activation/focus sequence we used
        // to rely on. Explicitly re-evaluate shortly after deactivation.
        scheduleHotKeyRefresh(after: 0.20)
    }

    private func applyMappedCommand(_ command: Command) {
        guard isPremiere(NSWorkspace.shared.frontmostApplication) else { return }
        guard timelineShortcutFocus().armsAnything else {
            unregisterHotKeys()
            return
        }
        commandBridge?.enqueue(Command(type: command.type, name: command.name, transitionFrames: settings.transitionFrames, id: command.id, moveMode: command.moveMode, staggerFrames: settings.staggerFrames ?? 5, staggerGroup: settings.staggerGroup ?? 1))
    }

    private func makePalette() {
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 350, height: 276), styleMask: [.titled, .closable, .utilityWindow, .fullSizeContentView], backing: .buffered, defer: false)
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.hidesOnDeactivate = true
        panel.isMovableByWindowBackground = true
        panel.acceptsMouseMovedEvents = true
        panel.delegate = self
        panel.standardWindowButton(.miniaturizeButton)?.isHidden = true
        panel.standardWindowButton(.zoomButton)?.isHidden = true
        let content = NSView(frame: panel.contentView!.bounds)
        content.autoresizingMask = [.width, .height]
        content.wantsLayer = true
        content.layer?.backgroundColor = NSColor(calibratedRed: 0.105, green: 0.105, blue: 0.105, alpha: 1).cgColor
        panel.contentView = content

        let title = NSTextField(labelWithString: "FX PALETTE")
        title.font = .systemFont(ofSize: 10, weight: .bold)
        title.textColor = NSColor(calibratedRed: 0.88, green: 0.91, blue: 0.98, alpha: 1)
        title.lineBreakMode = .byTruncatingTail
        title.frame = NSRect(x: 14, y: 234, width: 190, height: 16)
        content.addSubview(title)
        paletteTitle = title
        let hotkey = NSTextField(labelWithString: display(settings.shortcut).uppercased())
        hotkey.alignment = .right
        hotkey.font = .monospacedSystemFont(ofSize: 10, weight: .semibold)
        hotkey.textColor = NSColor(calibratedRed: 0.84, green: 0.45, blue: 0.18, alpha: 1)
        hotkey.frame = NSRect(x: 196, y: 234, width: 140, height: 16)
        hotkey.autoresizingMask = [.minXMargin]
        content.addSubview(hotkey)
        paletteHotkey = hotkey

        let search = NSSearchField(frame: NSRect(x: 14, y: 190, width: 322, height: 28))
        search.placeholderString = "Search effects, transitions, presets…"
        search.font = .systemFont(ofSize: 12, weight: .regular)
        search.focusRingType = .none
        search.backgroundColor = NSColor(calibratedRed: 0.09, green: 0.09, blue: 0.09, alpha: 1)
        search.textColor = NSColor(calibratedWhite: 0.88, alpha: 1)
        search.delegate = self
        search.sendsSearchStringImmediately = true
        search.wantsLayer = true
        search.layer?.cornerRadius = 8
        search.layer?.borderWidth = 1
        search.layer?.borderColor = NSColor(calibratedRed: 0.68, green: 0.31, blue: 0.09, alpha: 1).cgColor
        content.addSubview(search)
        searchField = search

        let listContainer = NSView(frame: NSRect(x: 14, y: 42, width: 322, height: 138))
        listContainer.wantsLayer = true
        listContainer.layer?.backgroundColor = NSColor(calibratedRed: 0.075, green: 0.075, blue: 0.075, alpha: 1).cgColor
        listContainer.layer?.cornerRadius = 5
        content.addSubview(listContainer)
        let scroll = NSScrollView(frame: listContainer.bounds.insetBy(dx: 1, dy: 1))
        scroll.autoresizingMask = [.width, .height]
        scroll.hasVerticalScroller = true
        scroll.hasHorizontalScroller = false
        scroll.autohidesScrollers = true
        scroll.scrollerStyle = .overlay
        scroll.verticalScroller?.controlSize = .mini
        scroll.drawsBackground = false
        scroll.borderType = .noBorder
        let table = CommandTableView()
        table.headerView = nil
        table.rowHeight = 28
        table.intercellSpacing = NSSize(width: 0, height: 0)
        table.selectionHighlightStyle = .regular
        table.backgroundColor = .clear
        table.usesAlternatingRowBackgroundColors = false
        table.target = self
        table.doubleAction = #selector(applySelection(_:))
        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("command"))
        column.width = 306
        column.resizingMask = .autoresizingMask
        table.addTableColumn(column)
        table.delegate = self
        table.dataSource = self
        scroll.documentView = table
        listContainer.addSubview(scroll)
        listView = table
        self.panel = panel
        observePaletteFrameChanges(panel)
        restorePaletteFrame()
        filterCommands(resetSelection: true)

        let footer = NSTextField(labelWithString: "↑ ↓  navigate     ↵  apply + close     ⇧↵  apply + keep open     esc  close")
        footer.textColor = NSColor(calibratedWhite: 0.58, alpha: 1)
        footer.font = .systemFont(ofSize: 9, weight: .medium)
        footer.alignment = .center
        footer.frame = NSRect(x: 14, y: 12, width: 322, height: 14)
        content.addSubview(footer)
        paletteFooter = footer
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
            panel.setFrame(savedFrame, display: false)
            listenerLog("Palette frame restored: \(NSStringFromRect(savedFrame))")
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

    private func filterCommands(resetSelection: Bool = false) {
        let previousRow = listView?.selectedRow ?? -1
        let previousKey = visibleCommands.indices.contains(previousRow) ? commandIdentity(visibleCommands[previousRow]) : nil
        if pendingTransitionCommand != nil {
            visibleCommands = transitionPlacementCommands()
        } else if pendingMoveCommand != nil {
            visibleCommands = moveModeCommands()
        } else if pendingStaggerCommand != nil {
            visibleCommands = staggerFrameCommands()
        } else {
            let query = searchField?.stringValue.lowercased().trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            visibleCommands = commands.filter { query.isEmpty || ($0.name + " " + $0.type).lowercased().contains(query) }.map { Command(type: $0.type, name: $0.name, transitionFrames: settings.transitionFrames, id: $0.id, moveMode: $0.moveMode, staggerFrames: settings.staggerFrames ?? 5, staggerGroup: settings.staggerGroup ?? 1) }
        }
        listView?.reloadData()
        if !visibleCommands.isEmpty {
            var row = 0
            if !resetSelection {
                if let key = previousKey, let matched = visibleCommands.firstIndex(where: { commandIdentity($0) == key }) {
                    row = matched
                } else if previousRow >= 0 {
                    row = max(0, min(visibleCommands.count - 1, previousRow))
                }
            }
            listView?.selectRowIndexes(IndexSet(integer: row), byExtendingSelection: false)
        }
    }

    @objc private func applySelection(_ sender: Any?) {
        applyCurrentSelection(keepPaletteOpen: false)
    }

    private func applyCurrentSelection(keepPaletteOpen: Bool) {
        // AppKit can send the Return command more than once while a search field
        // is handing focus back to the panel. A palette selection is one action.
        guard !isSubmittingPaletteCommand else { return }
        let row = listView?.selectedRow ?? -1
        guard visibleCommands.indices.contains(row) else { return }
        let command = visibleCommands[row]
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
        let effectiveCommand = Command(type: command.type, name: command.name, transitionFrames: command.transitionFrames ?? settings.transitionFrames, id: command.id, transitionPlacement: command.transitionPlacement, moveMode: command.moveMode, staggerFrames: command.staggerFrames ?? settings.staggerFrames ?? 5, staggerGroup: command.staggerGroup ?? settings.staggerGroup ?? 1)
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
        paletteTitle?.stringValue = command.name.uppercased()
        paletteHotkey?.stringValue = "TRANSITION"
        searchField?.stringValue = ""
        searchField?.placeholderString = "Length in frames • CEP default \(settings.transitionFrames)"
        paletteFooter?.stringValue = "↑ ↓  choose placement     ↵  apply + close     ⇧↵  apply + keep open     esc  back"
        filterCommands(resetSelection: true)
        if let search = searchField { panel?.makeFirstResponder(search) }
    }

    private func showMoveApplyMenu(for command: Command) {
        pendingMoveCommand = command
        catalogQuery = searchField?.stringValue ?? ""
        paletteTitle?.stringValue = command.name.uppercased()
        paletteHotkey?.stringValue = "FUNCTION"
        searchField?.stringValue = ""
        searchField?.placeholderString = "Choose move behavior"
        paletteFooter?.stringValue = "↑ ↓  choose behavior     ↵  move + close     ⇧↵  move + keep open     esc  back"
        filterCommands(resetSelection: true)
        if let search = searchField { panel?.makeFirstResponder(search) }
    }

    private func showStaggerApplyMenu(for command: Command) {
        pendingStaggerCommand = command
        searchField?.stringValue = ""
        paletteTitle?.stringValue = command.name.uppercased()
        paletteHotkey?.stringValue = "FUNCTION"
        searchField?.placeholderString = "Frames per step • default \(settings.staggerFrames ?? 5)"
        paletteFooter?.stringValue = "↑ ↓  choose step     ↵  stagger + close     ⇧↵  stagger + keep open     esc  back"
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
        paletteTitle?.stringValue = "FX PALETTE"
        paletteHotkey?.stringValue = display(settings.shortcut).uppercased()
        searchField?.stringValue = catalogQuery
        searchField?.placeholderString = "Search effects, transitions, presets…"
        paletteFooter?.stringValue = "↑ ↓  navigate     ↵  apply + close     ⇧↵  apply + keep open     esc  close"
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
        guard let table = listView, !visibleCommands.isEmpty else { return }
        (table as? CommandTableView)?.suppressHoverBriefly()
        let current = table.selectedRow < 0 ? 0 : table.selectedRow
        let next = max(0, min(visibleCommands.count - 1, current + delta))
        table.selectRowIndexes(IndexSet(integer: next), byExtendingSelection: false)
        table.scrollRowToVisible(next)
    }

    private func keyCode(for code: String) -> UInt32 {
        switch code { case "Space": return UInt32(kVK_Space); case "KeyA": return UInt32(kVK_ANSI_A); case "KeyB": return UInt32(kVK_ANSI_B); case "KeyC": return UInt32(kVK_ANSI_C); case "KeyD": return UInt32(kVK_ANSI_D); case "KeyE": return UInt32(kVK_ANSI_E); case "KeyF": return UInt32(kVK_ANSI_F); case "KeyG": return UInt32(kVK_ANSI_G); case "KeyH": return UInt32(kVK_ANSI_H); case "KeyI": return UInt32(kVK_ANSI_I); case "KeyJ": return UInt32(kVK_ANSI_J); case "KeyK": return UInt32(kVK_ANSI_K); case "KeyL": return UInt32(kVK_ANSI_L); case "KeyM": return UInt32(kVK_ANSI_M); case "KeyN": return UInt32(kVK_ANSI_N); case "KeyO": return UInt32(kVK_ANSI_O); case "KeyP": return UInt32(kVK_ANSI_P); case "KeyQ": return UInt32(kVK_ANSI_Q); case "KeyR": return UInt32(kVK_ANSI_R); case "KeyS": return UInt32(kVK_ANSI_S); case "KeyT": return UInt32(kVK_ANSI_T); case "KeyU": return UInt32(kVK_ANSI_U); case "KeyV": return UInt32(kVK_ANSI_V); case "KeyW": return UInt32(kVK_ANSI_W); case "KeyX": return UInt32(kVK_ANSI_X); case "KeyY": return UInt32(kVK_ANSI_Y); case "KeyZ": return UInt32(kVK_ANSI_Z); case "Digit0": return UInt32(kVK_ANSI_0); case "Digit1": return UInt32(kVK_ANSI_1); case "Digit2": return UInt32(kVK_ANSI_2); case "Digit3": return UInt32(kVK_ANSI_3); case "Digit4": return UInt32(kVK_ANSI_4); case "Digit5": return UInt32(kVK_ANSI_5); case "Digit6": return UInt32(kVK_ANSI_6); case "Digit7": return UInt32(kVK_ANSI_7); case "Digit8": return UInt32(kVK_ANSI_8); case "Digit9": return UInt32(kVK_ANSI_9); default: return UInt32(kVK_Space) }
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
        if accessibilityTrusted, let role = focusedTextInputRole(application) {
            return .none("Text input is focused (\(role))")
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
            return .modifierOnly("Last click was outside the Timeline panel")
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
        return allowModifierFallback ? .modifierOnly(outsideReason) : .none(outsideReason)
    }

    // Descriptions that appear only inside Premiere's Timeline panel. Premiere
    // publishes no panel containers, but it does publish these controls with
    // real frames, so the panel's rectangle can be derived from them.
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
        clickMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            guard let self else { return }
            self.lastClickPoint = self.axPointFromScreen(NSEvent.mouseLocation)
            // Re-arm immediately after the editor clicks back into the
            // Timeline. Waiting for Premiere's AX notification or the 1s safety
            // poll made shortcuts feel random when pressed quickly after a
            // panel click.
            DispatchQueue.main.async { [weak self] in
                guard let self, self.isPremiere(NSWorkspace.shared.frontmostApplication) else { return }
                self.scheduleHotKeyRefresh()
            }
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
        if Date().timeIntervalSince(cachedRegionAt) < 2.0 { return cachedTimelineRegion }
        let appElement = AXUIElementCreateApplication(application.processIdentifier)
        // Scan every window, not just the focused one: editors often tear the
        // Timeline off into its own window on a second display, and it would be
        // invisible to a focused-window-only walk.
        var windows: [AXUIElement] = []
        if let list = axChildren(appElement, kAXWindowsAttribute as CFString) { windows = list }
        if windows.isEmpty, let focused = axElement(appElement, kAXFocusedWindowAttribute as CFString) {
            windows = [focused]
        }
        var region: CGRect?
        for window in windows {
            if let found = timelineRegion(inWindow: window) { region = found; break }
        }
        guard let region else {
            cachedTimelineRegion = nil
            cachedRegionAt = Date()
            return nil
        }
        if cachedTimelineRegion.map({ !$0.equalTo(region) }) ?? true {
            listenerLog("Timeline region: (\(Int(region.minX)),\(Int(region.minY)) \(Int(region.width))x\(Int(region.height)))")
        }
        cacheTimelineRegion(region)
        return region
    }

    private func cacheTimelineRegion(_ region: CGRect) {
        guard isUsableTimelineRegion(region) else { return }
        cachedTimelineRegion = region
        cachedRegionAt = Date()
        let string = NSStringFromRect(region)
        let existing = (try? String(contentsOf: timelineRegionURL, encoding: .utf8))?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard existing != string else { return }
        try? FileManager.default.createDirectory(at: timelineRegionURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? string.data(using: .utf8)?.write(to: timelineRegionURL, options: .atomic)
    }

    private func savedTimelineRegion() -> CGRect? {
        if let cached = cachedTimelineRegion, isUsableTimelineRegion(cached) { return cached }
        if let stored = try? String(contentsOf: timelineRegionURL, encoding: .utf8),
           let region = parseStoredTimelineRegion(stored) {
            cachedTimelineRegion = region
            cachedRegionAt = Date()
            return region
        }
        if let region = restoreTimelineRegionFromLog() {
            cacheTimelineRegion(region)
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
        var markerUnion: CGRect?
        var tabStrips: [CGRect] = []
        var queue: [(element: AXUIElement, depth: Int)] = [(window, 0)]
        var scanned = 0
        while !queue.isEmpty && scanned < 800 {
            let (element, depth) = queue.removeFirst()
            scanned += 1
            if depth < 14, let children = axChildren(element) {
                for child in children { queue.append((child, depth + 1)) }
            }
            guard let description = axString(element, kAXDescriptionAttribute as CFString),
                  !description.isEmpty,
                  ShortcutListener.timelineMarkers.contains(description) || description == "UI_TabsContainer",
                  let origin = axPoint(element, kAXPositionAttribute as CFString),
                  let size = axSize(element, kAXSizeAttribute as CFString) else { continue }
            let rect = CGRect(origin: origin, size: size)
            if description == "UI_TabsContainer" { tabStrips.append(rect); continue }
            markerUnion = markerUnion.map { $0.union(rect) } ?? rect
        }
        guard var region = markerUnion else { return nil }
        // Prefer the tab strip directly above the markers and horizontally
        // overlapping them: that is this panel group's own tab bar.
        let candidates = tabStrips.filter { $0.minY <= region.minY && $0.maxX > region.minX && $0.minX < region.maxX }
        if let strip = candidates.max(by: { $0.minY < $1.minY }) {
            region = CGRect(x: strip.minX, y: strip.minY,
                            width: strip.width, height: windowRect.maxY - strip.minY)
        } else {
            region = CGRect(x: windowRect.minX, y: max(windowRect.minY, region.minY - 30),
                            width: windowRect.width, height: windowRect.maxY - max(windowRect.minY, region.minY - 30))
        }
        return region
    }

    private static let textInputRoles: Set<String> = [
        "AXTextField", "AXTextArea", "AXComboBox", "AXSearchField", "AXSecureTextField"
    ]

    // Checks the focused element and its immediate parent: Premiere sometimes
    // puts focus on an inner element of a compound text control.
    private func focusedTextInputRole(_ application: NSRunningApplication) -> String? {
        let appElement = AXUIElementCreateApplication(application.processIdentifier)
        guard let focused = axElement(appElement, kAXFocusedUIElementAttribute as CFString) else { return nil }
        var current: AXUIElement? = focused
        var depth = 0
        while let element = current, depth < 2 {
            for attribute in [kAXRoleAttribute, kAXSubroleAttribute] {
                if let value = axString(element, attribute as CFString),
                   ShortcutListener.textInputRoles.contains(value) {
                    return value
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
    func numberOfRows(in tableView: NSTableView) -> Int { visibleCommands.count }
    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let id = NSUserInterfaceItemIdentifier("command-row")
        let cell = tableView.makeView(withIdentifier: id, owner: self) as? CommandRowView ?? CommandRowView()
        cell.identifier = id
        cell.configure(visibleCommands[row])
        return cell
    }
}

extension ShortcutListener: NSSearchFieldDelegate {
    func controlTextDidChange(_ notification: Notification) {
        let isOptionPane = pendingTransitionCommand != nil || pendingMoveCommand != nil || pendingStaggerCommand != nil
        filterCommands(resetSelection: !isOptionPane)
    }
    func control(_ control: NSControl, textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
        if commandSelector == #selector(NSResponder.insertNewline(_:)) {
            let keepPaletteOpen = NSApp.currentEvent?.modifierFlags.contains(.shift) == true
            applyCurrentSelection(keepPaletteOpen: keepPaletteOpen)
            return true
        }
        if commandSelector == #selector(NSResponder.moveDown(_:)) { moveSelection(1); return true }
        if commandSelector == #selector(NSResponder.moveUp(_:)) { moveSelection(-1); return true }
        if commandSelector == #selector(NSResponder.cancelOperation(_:)) {
            if self.pendingTransitionCommand != nil || self.pendingMoveCommand != nil || self.pendingStaggerCommand != nil { resetApplyMenu() }
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
        guard row >= 0 && row < numberOfRows && selectedRow != row else { return }
        selectRowIndexes(IndexSet(integer: row), byExtendingSelection: false)
    }
}

private final class CommandRowView: NSTableCellView {
    private let nameLabel = NSTextField(labelWithString: "")
    private let typeLabel = NSTextField(labelWithString: "")
    private let selectionBackground = CALayer()

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.cornerRadius = 6
        layer?.backgroundColor = NSColor.clear.cgColor
        selectionBackground.cornerRadius = 5
        selectionBackground.backgroundColor = NSColor.clear.cgColor
        layer?.insertSublayer(selectionBackground, at: 0)
        layer?.borderWidth = 0
        nameLabel.font = .systemFont(ofSize: 11, weight: .medium)
        nameLabel.textColor = NSColor(calibratedWhite: 0.93, alpha: 1)
        typeLabel.font = .systemFont(ofSize: 8, weight: .bold)
        typeLabel.alignment = .right
        addSubview(nameLabel)
        addSubview(typeLabel)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func layout() {
        super.layout()
        selectionBackground.frame = bounds.insetBy(dx: 2, dy: 2)
        nameLabel.frame = NSRect(x: 12, y: 6, width: bounds.width - 98, height: 15)
        typeLabel.frame = NSRect(x: bounds.width - 78, y: 8, width: 66, height: 12)
    }
    override var backgroundStyle: NSView.BackgroundStyle {
        didSet {
            selectionBackground.backgroundColor = backgroundStyle == .emphasized
                ? NSColor(calibratedRed: 0.095, green: 0.095, blue: 0.095, alpha: 1).cgColor
                : NSColor.clear.cgColor
            needsDisplay = true
        }
    }
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        NSColor(calibratedRed: 0.12, green: 0.12, blue: 0.12, alpha: 1).setStroke()
        let path = NSBezierPath()
        path.move(to: NSPoint(x: 12, y: 0.5))
        path.line(to: NSPoint(x: bounds.width - 12, y: 0.5))
        path.lineWidth = 1
        path.stroke()
    }
    func configure(_ command: Command) {
        nameLabel.stringValue = command.name
        typeLabel.stringValue = command.type == "custom" || command.type == "move-mode" || command.type == "stagger-frames" ? "FUNCTION" : command.type == "transition-placement" ? "TRANSITION" : command.type.replacingOccurrences(of: "-", with: " ").uppercased()
        if command.type == "transition" {
            typeLabel.textColor = NSColor(calibratedRed: 0.39, green: 0.69, blue: 0.86, alpha: 1)
        } else if command.type == "transition-placement" {
            typeLabel.textColor = NSColor(calibratedRed: 0.39, green: 0.69, blue: 0.86, alpha: 1)
        } else if command.type == "audio-transition" {
            typeLabel.textColor = NSColor(calibratedRed: 0.42, green: 0.76, blue: 0.61, alpha: 1)
        } else if command.type == "custom" || command.type == "move-mode" || command.type == "stagger-frames" {
            typeLabel.textColor = NSColor(calibratedRed: 0.33, green: 0.72, blue: 0.68, alpha: 1)
        } else {
            typeLabel.textColor = NSColor(calibratedRed: 0.84, green: 0.45, blue: 0.18, alpha: 1)
        }
    }
}

private final class CommandBridge {
    private let listener: NWListener
    private let lock = NSLock()
    private var pendingCommand: Command?
    private var pendingCommandName = ""
    private let queue = DispatchQueue(label: "com.prfx.shortcut-listener.bridge")
    private let catalogHandler: ([Command]) -> Void
    private let healthHandler: () -> String
    private let settingsReloadHandler: () -> Void
    private let stateHandler: (NWListener.State) -> Void

    init(catalogHandler: @escaping ([Command]) -> Void, healthHandler: @escaping () -> String, settingsReloadHandler: @escaping () -> Void, stateHandler: @escaping (NWListener.State) -> Void) throws {
        self.catalogHandler = catalogHandler
        self.healthHandler = healthHandler
        self.settingsReloadHandler = settingsReloadHandler
        self.stateHandler = stateHandler
        listener = try NWListener(using: .tcp, on: NWEndpoint.Port(rawValue: 27389)!)
        listener.stateUpdateHandler = { state in
            stateHandler(state)
        }
        listener.newConnectionHandler = { [weak self] connection in self?.receive(connection) }
        listener.start(queue: queue)
    }

    func enqueue(_ command: Command) {
        lock.lock()
        pendingCommand = command
        pendingCommandName = command.name
        lock.unlock()
        listenerLog("Queued palette command: \(command.name) [placement: \(command.transitionPlacement ?? "default"), move: \(command.moveMode ?? "default")]")
    }

    func pendingName() -> String {
        lock.lock()
        let name = pendingCommandName
        lock.unlock()
        return name
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
            if request.hasPrefix("GET /next ") {
                self.lock.lock()
                let command = self.pendingCommand
                self.pendingCommand = nil
                self.pendingCommandName = ""
                self.lock.unlock()
                if let command { listenerLog("CEP collected palette command: \(command.name) [placement: \(command.transitionPlacement ?? "default"), move: \(command.moveMode ?? "default")]") }
                let body = String(data: (try? JSONEncoder().encode(command)) ?? Data("null".utf8), encoding: .utf8) ?? "null"
                self.respond(connection, status: "200 OK", body: body)
            } else if request.hasPrefix("GET /health ") {
                self.respond(connection, status: "200 OK", body: self.healthHandler())
            } else if request.hasPrefix("POST /catalog ") {
                let bodyStart = headerEnd + 4
                let body = requestData.subdata(in: bodyStart..<totalLength)
                if let catalog = try? JSONDecoder().decode([Command].self, from: body) {
                    self.catalogHandler(catalog)
                    self.respond(connection, status: "200 OK", body: "{\"ok\":true}")
                } else {
                    self.respond(connection, status: "400 Bad Request", body: "{\"error\":\"invalid catalog\"}")
                }
            } else if request.hasPrefix("POST /reload-settings ") {
                self.settingsReloadHandler()
                self.respond(connection, status: "200 OK", body: "{\"ok\":true}")
            } else {
                self.respond(connection, status: "404 Not Found", body: "{\"error\":\"not found\"}")
            }
        }
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
