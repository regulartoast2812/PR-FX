import AppKit
import ScreenCaptureKit

// Edie on After Effects' Timeline (2026-11-25, the user: "for AE, i want to have edie sitting there too, tho maybe not
// needing clicking into timeline to arm"). AE FX's own helper holds its keys whenever After Effects is in front, so
// nothing here arms or takes keys: Edie only sits on the Timeline panel's top-right corner, awake, with no stroke.
//
// Where the Timeline is comes from pixels, as Premiere's does (PRFXPanelPixels.swift): AE lays its panels out with
// the same black gutters, so PanelPixels.panelRects cuts the window into pieces. The Timeline is the piece holding
// AE's current-time readout, the one large run of blue text (about #4090f0) at a panel's top left; the playhead
// line and the work area are blue too, but a line or a bar, never a word. The Timeline's top row of pieces spans
// the whole panel (tabs, readout and column headers sit above the split between layers and ruler), so that piece's
// top-right corner is the panel's.
enum AETimeline {
    static func isAfterEffects(_ application: NSRunningApplication?) -> Bool {
        application?.bundleIdentifier?.hasPrefix("com.adobe.AfterEffects") == true
    }

    // AE's readout blue (about #4090f0) and its antialiased edges, which at one pixel per point are most of the
    // text (about #10406c): clearly blue at any brightness, and nothing grey, white, orange or violet.
    static func isReadoutBlue(_ r: Int, _ g: Int, _ b: Int) -> Bool {
        b >= 90 && b - r >= 60 && g > r + 20 && g < b - 20
    }

    // The readout's box inside `panel` (pixels), if it has one: the first band of blue rows in the panel's top-left
    // corner (the frame count under it, smaller and also blue, is left out), at least 40 blue pixels spread like a
    // line of digits: 50-220 wide, 9-24 tall (the readout is 10; the frame count, 7).
    static func readout(in panel: CGRect, width w: Int, height h: Int, pixel: (Int, Int) -> (Int, Int, Int)) -> CGRect? {
        // 3 in from the edge: AE draws a 1pt blue border round the panel you're in.
        let x0 = max(0, Int(panel.minX) + 3), y0 = max(0, Int(panel.minY) + 3)
        let x1 = min(w, x0 + 260, Int(panel.maxX) - 3), y1 = min(h, y0 + 90, Int(panel.maxY) - 3)
        guard x1 > x0, y1 > y0 else { return nil }
        var count = 0, minX = Int.max, minY = -1, maxX = -1, maxY = -1, gap = 0
        for y in y0 ..< y1 {
            var row = 0
            for x in x0 ..< x1 {
                let (r, g, b) = pixel(x, y)
                guard isReadoutBlue(r, g, b) else { continue }
                row += 1
                minX = min(minX, x); maxX = max(maxX, x)
            }
            if row > 0 {
                if minY < 0 { minY = y }
                maxY = y
                count += row
                gap = 0
            } else if minY >= 0 {
                gap += 1
                // Two clear rows end the band: what follows is the frame count, or nothing.
                if gap >= 2 { break }
            }
        }
        guard minY >= 0, count >= 40 else { return nil }
        let box = CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1)
        guard box.width >= 50, box.width <= 220, box.height >= 9, box.height <= 24 else { return nil }
        return box
    }

    // The Timeline's piece among `panels` (pixels): the one whose top left holds the readout; with two (two
    // Timelines open), the larger.
    static func timelinePanel(_ panels: [CGRect], width w: Int, height h: Int, pixel: (Int, Int) -> (Int, Int, Int)) -> CGRect? {
        panels.filter { $0.width >= 300 && $0.height >= 40 && readout(in: $0, width: w, height: h, pixel: pixel) != nil }
            .max { $0.width * $0.height < $1.width * $1.height }
    }

    static func whole(_ r: CGRect) -> CGRect {
        CGRect(x: r.minX.rounded(), y: r.minY.rounded(), width: r.width.rounded(), height: r.height.rounded())
    }

    static func timelinePanel(rgba: [UInt8], width w: Int, height h: Int) -> CGRect? {
        let fractions = PanelPixels.panelRects(rgba: rgba, width: w, height: h)
        let panels = fractions.map {
            whole(CGRect(x: $0.minX * CGFloat(w), y: $0.minY * CGFloat(h), width: $0.width * CGFloat(w), height: $0.height * CGFloat(h)))
        }
        return rgba.withUnsafeBufferPointer { p in
            timelinePanel(panels, width: w, height: h) { x, y in let i = (y * w + x) * 4; return (Int(p[i]), Int(p[i + 1]), Int(p[i + 2])) }
        }
    }
}

// Looks at After Effects' main window about once a second while AE is in front, and keeps where its Timeline is
// (screen points, top-left origin, as CGWindowList). One picture costs about 100 ms off the main thread; nothing
// runs while AE is behind.
final class AETimelineWatcher {
    private(set) var window: CGRect?
    private(set) var timeline: CGRect?
    private var lastAsked = Date.distantPast
    private var inFlight = false
    private var loggedFound: Bool?
    static let every: TimeInterval = 1.0

    // AE's largest on-screen window, and the windows in front of it that hide part of it (other apps', and AE's own
    // dialogs and floating panels), as Premiere's covers: Edie isn't drawn over them.
    static func windows(pid: pid_t) -> (main: CGRect, covers: [CGRect])? {
        guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
        var frames: [(bounds: CGRect, index: Int)] = []
        for (index, info) in list.enumerated() {
            guard (info[kCGWindowOwnerPID as String] as? Int32) == pid,
                  (info[kCGWindowLayer as String] as? Int) == 0,
                  let boundsDict = info[kCGWindowBounds as String] as? NSDictionary,
                  let bounds = CGRect(dictionaryRepresentation: boundsDict),
                  bounds.width >= 300, bounds.height >= 200 else { continue }
            frames.append((bounds, index))
        }
        guard let main = frames.max(by: { $0.bounds.width * $0.bounds.height < $1.bounds.width * $1.bounds.height }) else { return nil }
        let own = ProcessInfo.processInfo.processIdentifier
        var covers: [CGRect] = []
        for info in list.prefix(main.index) {
            guard let owner = info[kCGWindowOwnerPID as String] as? Int32, owner != own,
                  (info[kCGWindowLayer as String] as? Int ?? 0) >= 0,
                  (info[kCGWindowAlpha as String] as? Double ?? 1) > 0.05,
                  let boundsDict = info[kCGWindowBounds as String] as? NSDictionary,
                  let bounds = CGRect(dictionaryRepresentation: boundsDict),
                  bounds.width >= 20, bounds.height >= 20, bounds.intersects(main.bounds),
                  owner != pid || (bounds.width >= 80 && bounds.height >= 40),
                  !bounds.contains(main.bounds) else { continue }
            covers.append(bounds)
        }
        return (main.bounds, covers)
    }

    // Called on the highlight's 0.2 s tick while AE is in front. Asks for a new picture when the last is a second
    // old or the window moved; `changed` runs on the main thread when the Timeline's place changes.
    func tick(pid: pid_t, window: CGRect, changed: @escaping () -> Void) {
        let moved = self.window.map { !$0.equalTo(window) } ?? true
        if moved { timeline = nil; self.window = window }
        guard !inFlight, moved || Date().timeIntervalSince(lastAsked) >= Self.every else { return }
        guard CGPreflightScreenCaptureAccess() else { return }
        inFlight = true
        lastAsked = Date()
        // On the main actor; the capture itself (a static async function) runs off it.
        Task { @MainActor [weak self] in
            let found = await AETimelineWatcher.capture(pid: pid)
            guard let self else { return }
            self.inFlight = false
            guard let found, found.window.equalTo(self.window ?? .null) else { return }
            if (found.timeline != nil) != self.loggedFound {
                self.loggedFound = found.timeline != nil
                listenerLog(found.timeline.map { "After Effects Timeline at \(NSStringFromRect($0)); Edie sits on it" }
                            ?? "After Effects Timeline not found (no composition open, or it's hidden); Edie hides")
            }
            if found.timeline != self.timeline { self.timeline = found.timeline; changed() }
        }
    }

    func reset() { window = nil; timeline = nil }

    private static func capture(pid: pid_t) async -> (window: CGRect, timeline: CGRect?)? {
        guard let content = try? await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true) else { return nil }
        let candidates = content.windows.filter {
            $0.owningApplication?.processID == pid && $0.windowLayer == 0 && $0.frame.width >= 300 && $0.frame.height >= 200
        }
        guard let window = candidates.max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }) else { return nil }
        let config = SCStreamConfiguration()
        config.width = Int(window.frame.width)
        config.height = Int(window.frame.height)
        config.showsCursor = false
        config.ignoreShadowsSingleWindow = true
        config.colorSpaceName = CGColorSpace.sRGB
        guard let image = try? await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(desktopIndependentWindow: window),
                                                                      configuration: config) else { return nil }
        let frame = window.frame
        let w = image.width, h = image.height
        guard let found = AETimeline.timelinePanel(rgba: PanelPixels.rgba(of: image), width: w, height: h) else { return (frame, nil) }
        let sx = frame.width / CGFloat(w), sy = frame.height / CGFloat(h)
        return (frame, AETimeline.whole(CGRect(x: frame.minX + found.minX * sx, y: frame.minY + found.minY * sy,
                                               width: found.width * sx, height: found.height * sy)))
    }
}
