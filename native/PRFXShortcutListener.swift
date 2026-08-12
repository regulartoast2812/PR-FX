import AppKit
import Foundation
import Carbon.HIToolbox
import Network

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
}

private struct Command: Codable {
    let type: String
    let name: String
    let transitionFrames: Int
    let id: String?
}

private final class ShortcutListener: NSObject {
    private let settingsURL: URL
    private var settings: Settings
    private var hotKeyRef: EventHotKeyRef?
    private var eventHandler: EventHandlerRef?
    private var panel: NSPanel?
    private var searchField: NSSearchField?
    private var listView: NSTableView?
    private var visibleCommands: [Command] = []
    private var commandBridge: CommandBridge?
    private let customCommands = [
        Command(type: "custom", name: "Remove Transitions on Selected Tracks", transitionFrames: 30, id: "remove-transitions")
    ]
    private var commands = [
        Command(type: "custom", name: "Remove Transitions on Selected Tracks", transitionFrames: 30, id: "remove-transitions"),
        Command(type: "effect", name: "Gaussian Blur", transitionFrames: 30, id: nil),
        Command(type: "effect", name: "Lumetri Color", transitionFrames: 30, id: nil),
        Command(type: "effect", name: "Crop", transitionFrames: 30, id: nil)
    ]

    override init() {
        let support = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/PR FX Palette", isDirectory: true)
        settingsURL = support.appendingPathComponent("settings.json")
        settings = Settings(shortcut: Shortcut(code: "Space", ctrl: true, alt: false, shift: false, meta: false), transitionFrames: 30)
        super.init()
        commandBridge = try? CommandBridge { [weak self] catalog in
            DispatchQueue.main.async {
                guard let self, !catalog.isEmpty else { return }
                self.commands = self.customCommands + catalog
                self.filterCommands()
            }
        }
        loadSettings()
        installHotKey()
        makePalette()
    }

    deinit {
        if let hotKeyRef { UnregisterEventHotKey(hotKeyRef) }
        if let eventHandler { RemoveEventHandler(eventHandler) }
    }

    private func loadSettings() {
        guard let data = try? Data(contentsOf: settingsURL), let loaded = try? JSONDecoder().decode(Settings.self, from: data) else { return }
        settings = loaded
    }

    private func installHotKey() {
        let eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let context = Unmanaged.passUnretained(self).toOpaque()
        InstallEventHandler(GetApplicationEventTarget(), { _, event, userData in
            guard let event, let userData else { return noErr }
            var hotKeyID = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil, MemoryLayout<EventHotKeyID>.size, nil, &hotKeyID)
            if hotKeyID.id == 1 { Unmanaged<ShortcutListener>.fromOpaque(userData).takeUnretainedValue().showPaletteIfPremiereIsActive() }
            return noErr
        }, 1, [eventType], context, &eventHandler)

        let id = EventHotKeyID(signature: OSType(0x50524658), id: 1) // "PRFX"
        RegisterEventHotKey(keyCode(for: settings.shortcut.code), carbonModifiers(for: settings.shortcut), id, GetApplicationEventTarget(), 0, &hotKeyRef)
    }

    private func showPaletteIfPremiereIsActive() {
        guard isPremiere(NSWorkspace.shared.frontmostApplication) else { return }
        loadSettings()
        searchField?.stringValue = ""
        filterCommands()
        panel?.center()
        panel?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        searchField?.becomeFirstResponder()
    }

    private func makePalette() {
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 350, height: 276), styleMask: [.titled, .closable, .utilityWindow, .fullSizeContentView], backing: .buffered, defer: false)
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.hidesOnDeactivate = true
        panel.isMovableByWindowBackground = true
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
        title.frame = NSRect(x: 14, y: 234, width: 130, height: 16)
        content.addSubview(title)
        let hotkey = NSTextField(labelWithString: display(settings.shortcut).uppercased())
        hotkey.alignment = .right
        hotkey.font = .monospacedSystemFont(ofSize: 10, weight: .semibold)
        hotkey.textColor = NSColor(calibratedRed: 0.84, green: 0.45, blue: 0.18, alpha: 1)
        hotkey.frame = NSRect(x: 160, y: 234, width: 176, height: 16)
        hotkey.autoresizingMask = [.minXMargin]
        content.addSubview(hotkey)

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
        let table = NSTableView()
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
        filterCommands()

        let footer = NSTextField(labelWithString: "↑ ↓  navigate     ↵  apply to selected clips     esc  close")
        footer.textColor = NSColor(calibratedWhite: 0.58, alpha: 1)
        footer.font = .systemFont(ofSize: 9, weight: .medium)
        footer.alignment = .center
        footer.frame = NSRect(x: 14, y: 12, width: 322, height: 14)
        content.addSubview(footer)
    }

    private func filterCommands() {
        let query = searchField?.stringValue.lowercased().trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        visibleCommands = commands.filter { query.isEmpty || ($0.name + " " + $0.type).lowercased().contains(query) }.map { Command(type: $0.type, name: $0.name, transitionFrames: settings.transitionFrames, id: $0.id) }
        listView?.reloadData()
        if !visibleCommands.isEmpty { listView?.selectRowIndexes(IndexSet(integer: 0), byExtendingSelection: false) }
    }

    @objc private func applySelection(_ sender: Any?) {
        let row = listView?.selectedRow ?? -1
        guard visibleCommands.indices.contains(row) else { return }
        let command = visibleCommands[row]
        guard let commandBridge else {
            NSAlert(error: NSError(domain: "PRFX", code: 1, userInfo: [NSLocalizedDescriptionKey: "The local command bridge could not start. Quit any previous PR FX listener, then run native/run-macos.sh again."])).runModal()
            return
        }
        commandBridge.enqueue(command)
        panel?.orderOut(nil)
        NSWorkspace.shared.runningApplications.first(where: isPremiere)?.activate(options: [])
    }

    private func moveSelection(_ delta: Int) {
        guard let table = listView, !visibleCommands.isEmpty else { return }
        let current = table.selectedRow < 0 ? 0 : table.selectedRow
        let next = max(0, min(visibleCommands.count - 1, current + delta))
        table.selectRowIndexes(IndexSet(integer: next), byExtendingSelection: false)
        table.scrollRowToVisible(next)
    }

    private func keyCode(for code: String) -> UInt32 {
        switch code { case "Space": return UInt32(kVK_Space); case "KeyA": return UInt32(kVK_ANSI_A); case "KeyB": return UInt32(kVK_ANSI_B); case "KeyC": return UInt32(kVK_ANSI_C); case "KeyD": return UInt32(kVK_ANSI_D); case "KeyE": return UInt32(kVK_ANSI_E); case "KeyF": return UInt32(kVK_ANSI_F); case "KeyG": return UInt32(kVK_ANSI_G); case "KeyH": return UInt32(kVK_ANSI_H); case "KeyI": return UInt32(kVK_ANSI_I); case "KeyJ": return UInt32(kVK_ANSI_J); case "KeyK": return UInt32(kVK_ANSI_K); case "KeyL": return UInt32(kVK_ANSI_L); case "KeyM": return UInt32(kVK_ANSI_M); case "KeyN": return UInt32(kVK_ANSI_N); case "KeyO": return UInt32(kVK_ANSI_O); case "KeyP": return UInt32(kVK_ANSI_P); case "KeyQ": return UInt32(kVK_ANSI_Q); case "KeyR": return UInt32(kVK_ANSI_R); case "KeyS": return UInt32(kVK_ANSI_S); case "KeyT": return UInt32(kVK_ANSI_T); case "KeyU": return UInt32(kVK_ANSI_U); case "KeyV": return UInt32(kVK_ANSI_V); case "KeyW": return UInt32(kVK_ANSI_W); case "KeyX": return UInt32(kVK_ANSI_X); case "KeyY": return UInt32(kVK_ANSI_Y); case "KeyZ": return UInt32(kVK_ANSI_Z); case "Digit0": return UInt32(kVK_ANSI_0); case "Digit1": return UInt32(kVK_ANSI_1); case "Digit2": return UInt32(kVK_ANSI_2); case "Digit3": return UInt32(kVK_ANSI_3); case "Digit4": return UInt32(kVK_ANSI_4); case "Digit5": return UInt32(kVK_ANSI_5); case "Digit6": return UInt32(kVK_ANSI_6); case "Digit7": return UInt32(kVK_ANSI_7); case "Digit8": return UInt32(kVK_ANSI_8); case "Digit9": return UInt32(kVK_ANSI_9); default: return UInt32(kVK_Space) }
    }
    private func carbonModifiers(for key: Shortcut) -> UInt32 {
        var result: UInt32 = 0
        if key.ctrl { result |= UInt32(controlKey) }
        if key.alt { result |= UInt32(optionKey) }
        if key.shift { result |= UInt32(shiftKey) }
        if key.meta { result |= UInt32(cmdKey) }
        return result
    }
    private func display(_ key: Shortcut) -> String {
        var parts: [String] = []
        if key.ctrl { parts.append("Ctrl") }; if key.alt { parts.append("Option") }; if key.shift { parts.append("Shift") }; if key.meta { parts.append("Cmd") }
        parts.append(key.code == "Space" ? "Space" : String(key.code.dropFirst(3)))
        return parts.joined(separator: " + ")
    }
    private func isPremiere(_ application: NSRunningApplication?) -> Bool {
        application?.bundleIdentifier?.hasPrefix("com.adobe.PremierePro") == true
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
    func controlTextDidChange(_ notification: Notification) { filterCommands() }
    func control(_ control: NSControl, textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
        if commandSelector == #selector(NSResponder.insertNewline(_:)) { applySelection(nil); return true }
        if commandSelector == #selector(NSResponder.moveDown(_:)) { moveSelection(1); return true }
        if commandSelector == #selector(NSResponder.moveUp(_:)) { moveSelection(-1); return true }
        if commandSelector == #selector(NSResponder.cancelOperation(_:)) {
            panel?.orderOut(nil)
            NSWorkspace.shared.runningApplications.first(where: isPremiere)?.activate(options: [])
            return true
        }
        return false
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
        typeLabel.stringValue = command.type == "custom" ? "FUNCTION" : command.type.replacingOccurrences(of: "-", with: " ").uppercased()
        if command.type == "transition" {
            typeLabel.textColor = NSColor(calibratedRed: 0.39, green: 0.69, blue: 0.86, alpha: 1)
        } else if command.type == "audio-transition" {
            typeLabel.textColor = NSColor(calibratedRed: 0.42, green: 0.76, blue: 0.61, alpha: 1)
        } else if command.type == "custom" {
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
    private let queue = DispatchQueue(label: "com.prfx.shortcut-listener.bridge")
    private let catalogHandler: ([Command]) -> Void

    init(catalogHandler: @escaping ([Command]) -> Void) throws {
        self.catalogHandler = catalogHandler
        listener = try NWListener(using: .tcp, on: NWEndpoint.Port(rawValue: 27389)!)
        listener.newConnectionHandler = { [weak self] connection in self?.receive(connection) }
        listener.start(queue: queue)
    }

    func enqueue(_ command: Command) {
        lock.lock()
        pendingCommand = command
        lock.unlock()
    }

    private func receive(_ connection: NWConnection) {
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, _, _ in
            guard let self else { return }
            let request = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            if request.hasPrefix("GET /next ") {
                self.lock.lock()
                let command = self.pendingCommand
                self.pendingCommand = nil
                self.lock.unlock()
                let body = String(data: (try? JSONEncoder().encode(command)) ?? Data("null".utf8), encoding: .utf8) ?? "null"
                self.respond(connection, status: "200 OK", body: body)
            } else if request.hasPrefix("POST /catalog ") {
                let body = request.components(separatedBy: "\r\n\r\n").last ?? ""
                if let catalog = try? JSONDecoder().decode([Command].self, from: Data(body.utf8)) {
                    self.catalogHandler(catalog)
                    self.respond(connection, status: "200 OK", body: "{\"ok\":true}")
                } else {
                    self.respond(connection, status: "400 Bad Request", body: "{\"error\":\"invalid catalog\"}")
                }
            } else {
                self.respond(connection, status: "404 Not Found", body: "{\"error\":\"not found\"}")
            }
        }
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

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
