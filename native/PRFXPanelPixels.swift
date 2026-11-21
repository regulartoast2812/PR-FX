import AppKit
import CoreMedia
import ScreenCaptureKit

// Panel rectangles from pixels (2026-11-19). Premiere's Accessibility frames
// lag behind a panel resize: after the Timeline's top edge was dragged up,
// every control and tab strip it published still sat at the old place, and the
// highlight stayed there. The pixels are never stale. Premiere lays panels out
// in rows and columns separated by black gutters (brightness near 0, against a
// panel background near 30), so cutting the window along every such line, and
// again inside each piece, leaves exactly the panels.
//
// Ported from Edit Assist's PanelReader.panelRects (same rules), working at one
// pixel per point. Needs the Screen Recording grant; without it the listener
// keeps using Accessibility alone.
enum PanelPixels {
    // The rectangles between the black lines, as fractions of the image.
    static func panelRects(in image: CGImage) -> [CGRect] {
        panelRects(rgba: rgba(of: image), width: image.width, height: image.height)
    }

    // The image as RGBA bytes, row-major, top row first.
    static func rgba(of image: CGImage) -> [UInt8] {
        let w = image.width, h = image.height
        var rgba = [UInt8](repeating: 0, count: w * h * 4)
        rgba.withUnsafeMutableBytes { raw in
            guard let context = CGContext(data: raw.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                          space: CGColorSpaceCreateDeviceRGB(),
                                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return }
            context.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        }
        return rgba
    }

    static func panelRects(rgba: [UInt8], width w: Int, height h: Int) -> [CGRect] {
        guard w >= 16, h >= 16, rgba.count == w * h * 4 else { return [] }
        var black = [Bool](repeating: false, count: w * h)
        for i in 0 ..< w * h {
            black[i] = (Int(rgba[i * 4]) * 30 + Int(rgba[i * 4 + 1]) * 59 + Int(rgba[i * 4 + 2]) * 11) / 100 <= 18
        }
        return panelRects(black: black, width: w, height: h)
    }

    // The same from a live frame (32BGRA, rows may be padded), without
    // drawing it into a second buffer first.
    static func panelRects(bgra base: UnsafeRawPointer, width w: Int, height h: Int, bytesPerRow: Int) -> [CGRect] {
        guard w >= 16, h >= 16 else { return [] }
        let bytes = base.assumingMemoryBound(to: UInt8.self)
        var black = [Bool](repeating: false, count: w * h)
        for y in 0 ..< h {
            let row = bytes + y * bytesPerRow
            for x in 0 ..< w {
                let p = row + x * 4
                black[y * w + x] = (Int(p[2]) * 30 + Int(p[1]) * 59 + Int(p[0]) * 11) / 100 <= 18
            }
        }
        return panelRects(black: black, width: w, height: h)
    }

    // Every pixel outside the known panels (gutters, the window's edges and
    // header), row-major, in pixels.
    static func gutterMask(panels: [CGRect], width w: Int, height h: Int) -> [Bool] {
        var gutter = [Bool](repeating: true, count: w * h)
        for panel in panels {
            let x0 = max(0, Int(panel.minX.rounded())), x1 = min(w, Int(panel.maxX.rounded()))
            let y0 = max(0, Int(panel.minY.rounded())), y1 = min(h, Int(panel.maxY.rounded()))
            guard x0 < x1, y0 < y1 else { continue }
            for y in y0 ..< y1 { for x in x0 ..< x1 { gutter[y * w + x] = false } }
        }
        return gutter
    }

    // Compares a 32BGRA frame with the previous one (`previous`, w*h pixels,
    // updated in place) row by row. Premiere repaints and reports its whole
    // window about 30 times a second even when nothing moves, so the
    // reported changes say nothing; the pixels do.
    static func compare(bgra base: UnsafeRawPointer, width w: Int, height h: Int, bytesPerRow: Int,
                        previous: inout [UInt32], gutter: [Bool]) -> (changed: Bool, onGutter: Bool) {
        guard previous.count == w * h, gutter.count == w * h else {
            previous = [UInt32](repeating: 0, count: w * h)
            previous.withUnsafeMutableBytes { out in
                for y in 0 ..< h { memcpy(out.baseAddress! + y * w * 4, base + y * bytesPerRow, w * 4) }
            }
            return (true, true)
        }
        var changed = false, onGutter = false
        previous.withUnsafeMutableBufferPointer { old in
            gutter.withUnsafeBufferPointer { gutter in
                for y in 0 ..< h {
                    let row = (base + y * bytesPerRow).assumingMemoryBound(to: UInt32.self)
                    let kept = old.baseAddress! + y * w
                    guard memcmp(row, kept, w * 4) != 0 else { continue }
                    changed = true
                    if !onGutter {
                        for x in 0 ..< w where row[x] != kept[x] && gutter[y * w + x] { onGutter = true; break }
                    }
                    memcpy(kept, row, w * 4)
                }
            }
        }
        return (changed, onGutter)
    }

    // `black` is row-major, top row first. Split out so it can be checked
    // without an image.
    static func panelRects(black: [Bool], width w: Int, height h: Int) -> [CGRect] {
        // A line is black across 90% of the region: a focus outline or a sash
        // handle can cross it.
        func rowShare(_ y: Int, _ x0: Int, _ x1: Int) -> Int { (x0 ..< x1).filter { black[y * w + $0] }.count * 100 / max(1, x1 - x0) }
        func columnShare(_ x: Int, _ y0: Int, _ y1: Int) -> Int { (y0 ..< y1).filter { black[$0 * w + x] }.count * 100 / max(1, y1 - y0) }
        func isBlack(_ x: Int, _ y: Int) -> Bool { black[y * w + x] }
        let minW = max(12, w / 40), minH = max(12, h / 40)
        var found: [CGRect] = []
        func cut(_ x0: Int, _ y0: Int, _ x1: Int, _ y1: Int, depth: Int) {
            var x0 = x0, y0 = y0, x1 = x1, y1 = y1
            // Trim the lines along its own edges.
            while y0 < y1, rowShare(y0, x0, x1) >= 90 { y0 += 1 }
            while y1 > y0, rowShare(y1 - 1, x0, x1) >= 90 { y1 -= 1 }
            while x0 < x1, columnShare(x0, y0, y1) >= 90 { x0 += 1 }
            while x1 > x0, columnShare(x1 - 1, y0, y1) >= 90 { x1 -= 1 }
            guard x1 - x0 >= minW, y1 - y0 >= minH else { return }
            // A divider is a thin black line with grey on both sides along
            // nearly its whole length. A thick black band is content (black
            // video); so is a thin one with black beside it.
            let thickest = 5
            func pieces(_ share: (Int) -> Int, _ across: (Int, Int, Int) -> Bool, _ from: Int, _ to: Int, _ length: Int) -> [(Int, Int)] {
                var result: [(Int, Int)] = [], start = from, index = from
                while index < to {
                    guard share(index) >= 90 else { index += 1; continue }
                    let runStart = index
                    while index < to, share(index) >= 90 { index += 1 }
                    guard index - runStart <= thickest, runStart - 2 >= from, index + 1 < to else { continue }
                    let along = (0 ..< length).filter { across($0, runStart, index) }.count
                    guard along * 100 >= length * 85 else { continue }
                    if runStart > start { result.append((start, runStart)) }
                    start = index
                }
                if to > start { result.append((start, to)) }
                return result
            }
            if depth < 12 {
                let rows = pieces({ rowShare($0, x0, x1) }, { i, a, b in
                    let x = x0 + i
                    return (a ..< b).allSatisfy { isBlack(x, $0) } && !isBlack(x, a - 2) && !isBlack(x, b + 1)
                }, y0, y1, x1 - x0)
                if rows.count > 1 { for (a, b) in rows { cut(x0, a, x1, b, depth: depth + 1) }; return }
                let columns = pieces({ columnShare($0, y0, y1) }, { i, a, b in
                    let y = y0 + i
                    return (a ..< b).allSatisfy { isBlack($0, y) } && !isBlack(a - 2, y) && !isBlack(b + 1, y)
                }, x0, x1, y1 - y0)
                if columns.count > 1 { for (a, b) in columns { cut(a, y0, b, y1, depth: depth + 1) }; return }
            }
            found.append(CGRect(x: CGFloat(x0) / CGFloat(w), y: CGFloat(y0) / CGFloat(h),
                                width: CGFloat(x1 - x0) / CGFloat(w), height: CGFloat(y1 - y0) / CGFloat(h)))
        }
        cut(0, 0, w, h, depth: 0)
        return found
    }

    static func same(_ a: [CGRect], _ b: [CGRect], tolerance: CGFloat = 2) -> Bool {
        a.count == b.count && zip(a, b).allSatisfy {
            abs($0.minX - $1.minX) <= tolerance && abs($0.minY - $1.minY) <= tolerance
                && abs($0.maxX - $1.maxX) <= tolerance && abs($0.maxY - $1.maxY) <= tolerance
        }
    }

    // Which pixel panel is the Timeline. Accessibility still names it, even
    // when its frames are stale: the panel holding most Timeline controls wins,
    // then the one overlapping the last known Timeline most. A panel with
    // neither is never chosen.
    //
    // Back from a maximized Timeline (the ` key, 2026-11-20): Accessibility
    // still has it filling the window, so its controls sit in the top-left
    // corner, over the Project panel, which then won and stuck. When the
    // reference fills the window but the pixels show docked panels again,
    // the markers are stale: ignore them and go back to where the Timeline
    // was docked before (`docked`), or draw nothing if that isn't known.
    //
    // The toolbar counts most (2026-11-20): after the Timeline was maximized
    // and put back, Premiere left its track-header buttons (Lock, Mute, Solo,
    // Output, about 29 of them) where they were while maximized, over the
    // Project panel, but moved its toolbar (Snap, Display Settings…, one set
    // per Timeline) to the real place. A panel with the toolbar wins.
    //
    // The panel's own pixels come first (2026-11-21, `looks`, one per panel,
    // from timelineLook): one panel that looks like a Timeline is it,
    // whatever Accessibility says; among several, the rules below pick.
    static func timelinePanel(_ panels: [CGRect], markers: [CGRect], toolbar: [CGRect] = [], reference: CGRect?,
                              window: CGRect? = nil, docked: CGRect? = nil, looks: [Int] = []) -> CGRect? {
        var markers = markers, toolbar = toolbar, reference = reference
        var looking: [CGRect] = []
        if looks.count == panels.count {
            looking = zip(panels, looks).filter { $0.1 >= timelineLookNeeded && $0.0.width >= 200 && $0.0.height >= 120 }.map(\.0)
            if looking.count == 1 { return looking[0] }
        }
        let split = panels.filter { $0.width >= 200 && $0.height >= 120 }.count > 1
        // A frame with no gutters (2026-11-20): while Premiere redraws after a
        // command, a capture can show one panel filling the window. It won on
        // overlap alone and made the whole window "the Timeline" for 1-5 s,
        // 58 times in a day: clicks in Project or Program armed every key and
        // the highlight framed the whole window. A real maximize (` key) moves
        // the Timeline's toolbar out of its docked place; here it hasn't moved,
        // so keep the docked Timeline. With no toolbar seen, the track-header
        // buttons decide; with neither, don't guess.
        if !split, let window, let docked, !fills(docked, window),
           panels.contains(where: { fills($0, window) }) {
            let near = docked.insetBy(dx: -8, dy: -8)
            func inDock(_ r: CGRect) -> Bool { near.contains(CGPoint(x: r.midX, y: r.midY)) }
            if !toolbar.isEmpty {
                if toolbar.allSatisfy(inDock) { return nil }
            } else if markers.isEmpty || markers.filter(inDock).count * 2 > markers.count {
                return nil
            }
        }
        if split, let window, let r = reference, fills(r, window) {
            // The toolbar, when it's in a docked panel, is current: it decides.
            markers = []
            reference = docked.flatMap { fills($0, window) ? nil : $0 }
            if reference == nil && toolbar.isEmpty { return nil }
        }
        func score(_ panel: CGRect) -> Double {
            let inside = markers.filter { panel.contains(CGPoint(x: $0.midX, y: $0.midY)) }.count
            let tools = toolbar.filter { panel.contains(CGPoint(x: $0.midX, y: $0.midY)) }.count
            var overlap = 0.0
            if let reference, panel.intersects(reference) {
                let shared = panel.intersection(reference)
                overlap = Double(shared.width * shared.height) / Double(max(1, reference.width * reference.height))
            }
            return Double(tools) * 1000 + Double(inside) * 10 + overlap
        }
        let usable = looking.isEmpty ? panels.filter { $0.width >= 200 && $0.height >= 120 } : looking
        guard let best = usable.max(by: { score($0) < score($1) }), score(best) >= 0.3 else { return nil }
        return best
    }

    // How much a panel looks like a Timeline in its own pixels (2026-11-21).
    // Accessibility's markers went stale on a 2560-wide window and the
    // Project panel won for minutes; the user: "a clear way of knowing the
    // panel is the timeline are these V# A# and icons, time number and
    // ruler". Each sign is looked for where the Timeline draws it:
    //   - the current time in Premiere's blue (67,160,255) in the panel's
    //     top-left corner (the Program monitor draws its blue time at the
    //     bottom, so it doesn't count there);
    //   - the time ruler: a row near the top with many 1px light ticks;
    //   - the work-area bar under the ruler, yellow (233,233,1);
    //   - the track headers' targeted buttons (V1, A1…), solid blue
    //     (0,92,200) blocks in the left part, stacked in one column (2 signs
    //     for two or more).
    // `pixel(x, y)` returns r, g, b; `panel` is in the same pixels. Two or
    // more signs: it's a Timeline.
    static let timelineLookNeeded = 2

    static func timelineLook(_ panel: CGRect, width w: Int, height h: Int, pixel: (Int, Int) -> (Int, Int, Int)) -> Int {
        let x0 = max(0, Int(panel.minX)), x1 = min(w, Int(panel.maxX))
        let y0 = max(0, Int(panel.minY)), y1 = min(h, Int(panel.maxY))
        guard x1 - x0 >= 200, y1 - y0 >= 120 else { return 0 }
        func luma(_ p: (Int, Int, Int)) -> Int { (p.0 * 30 + p.1 * 59 + p.2 * 11) / 100 }
        var signs = 0
        // Time: top 80, left 260.
        var blue = 0
        for y in y0 ..< min(y1, y0 + 80) {
            for x in x0 ..< min(x1, x0 + 260) {
                let (r, g, b) = pixel(x, y)
                if b >= 215, g >= 125, g <= 195, r >= 35, r <= 120 { blue += 1 }
            }
        }
        if blue >= 20 { signs += 1 }
        // Ruler and work-area bar: top 110, right of the track headers.
        let rx0 = x0 + (x1 - x0) / 4
        var ruler = false, yellowBar = false
        for y in y0 ..< min(y1, y0 + 110) where !(ruler && yellowBar) {
            var ticks = 0, yellow = 0
            var left = pixel(rx0, y), here = pixel(rx0 + 1, y)
            for x in rx0 + 1 ..< x1 - 1 {
                let right = pixel(x + 1, y)
                if luma(here) >= 100, abs(here.0 - here.2) <= 20, luma(left) <= 60, luma(right) <= 60 { ticks += 1 }
                if here.0 >= 200, here.1 >= 200, here.2 <= 70 { yellow += 1 }
                left = here; here = right
            }
            if ticks >= 12 { ruler = true }
            if yellow * 5 >= (x1 - rx0) * 2 { yellowBar = true }
        }
        if ruler { signs += 1 }
        if yellowBar { signs += 1 }
        // Targeted track buttons: rows holding a 12px+ run of their blue in
        // the left 300 (its left end), grouped into blocks 10px+ tall that
        // share one column.
        var rows: [Int?] = []
        for y in y0 ..< y1 {
            var start = 0, current = 0, found: Int?
            for x in x0 ..< min(x1, x0 + 300) {
                let (r, g, b) = pixel(x, y)
                if r <= 35, g >= 70, g <= 115, b >= 170, b <= 235 {
                    if current == 0 { start = x }
                    current += 1
                    if current >= 12 { found = start; break }
                } else { current = 0 }
            }
            rows.append(found)
        }
        var blockColumns: [Int] = [], run = 0, runColumn = 0
        for row in rows + [nil] {
            if let row, run == 0 || abs(row - runColumn) <= 6 {
                if run == 0 { runColumn = row }
                run += 1
                continue
            }
            if run >= 10 { blockColumns.append(runColumn) }
            run = row == nil ? 0 : 1
            runColumn = row ?? 0
        }
        let stacked = blockColumns.map { c in blockColumns.filter { abs($0 - c) <= 6 }.count }.max() ?? 0
        signs += min(2, stacked)
        return signs
    }

    static func timelineLooks(_ panels: [CGRect], width w: Int, height h: Int, pixel: (Int, Int) -> (Int, Int, Int)) -> [Int] {
        panels.map { timelineLook($0, width: w, height: h, pixel: pixel) }
    }

    // A panel maximized over the whole window (85 % of it or more).
    static func fills(_ rect: CGRect, _ window: CGRect) -> Bool {
        let shared = rect.intersection(window)
        return !shared.isNull && shared.width * shared.height >= 0.85 * window.width * window.height
    }
}

// Captures Premiere's main window (its own pixels only: our overlay is a
// separate window and is never in the picture) and cuts it into panels, off
// the main thread. Results are in Accessibility coordinates.
final class PanelSnapshotter {
    struct Snapshot {
        var window: CGRect
        var panels: [CGRect]
        var takenAt: Date
        // timelineLook of each panel (empty when not measured).
        var looks: [Int] = []
    }

    private(set) var latest: Snapshot?
    private var inFlight = false
    // A request made while a capture runs: the running one may predate what
    // was asked about (a mouse-up mid-capture), so one more follows it.
    private var queued: (pid: pid_t, completion: (Snapshot, Bool) -> Void)?
    // Nothing captured before this counts as fresh (set at a mouse-up).
    private var notBefore = Date.distantPast
    private var requestedAccess = false
    // Continuous capture while Premiere is in front (see PanelFeed).
    private let feed = PanelFeed()
    private var liveWindow: CGRect?
    private var liveHandler: ((Snapshot, Bool) -> Void)?
    private var latestIsLive = false

    var hasAccess: Bool { CGPreflightScreenCaptureAccess() }
    var isLive: Bool { feed.running }

    init() {
        feed.onPanels = { [weak self] local, looks in
            guard let self, let window = self.liveWindow, let handler = self.liveHandler else { return }
            let panels = local.map {
                CGRect(x: window.minX + $0.minX, y: window.minY + $0.minY, width: $0.width, height: $0.height).rounded()
            }
            self.apply(Snapshot(window: window, panels: panels, takenAt: Date(), looks: looks), live: true, completion: handler)
        }
    }

    // Keeps a live feed on Premiere's main window (`window`, its current
    // frame). A new size restarts it: the stream draws at one pixel per point
    // of the size it started with. A move only moves the panels.
    func keepLive(pid: pid_t, window: CGRect, onChange: @escaping (Snapshot, Bool) -> Void) {
        liveHandler = onChange
        guard hasAccess else { feed.stop(); return }
        if let previous = liveWindow, previous.size == window.size, previous.origin != window.origin,
           let latest, latestIsLive {
            let dx = window.minX - previous.minX, dy = window.minY - previous.minY
            self.latest = Snapshot(window: window, panels: latest.panels.map { $0.offsetBy(dx: dx, dy: dy) }, takenAt: latest.takenAt,
                                   looks: latest.looks)
        }
        liveWindow = window
        if feed.pid == pid, feed.size == window.size, feed.running || feed.starting { return }
        latestIsLive = false
        feed.start(pid: pid, size: window.size)
    }

    func stopLive() {
        feed.stop()
        liveWindow = nil
        latestIsLive = false
    }

    // Fresh means taken in the last few seconds of the same window frame,
    // and not before the last expire().
    // While the live feed runs its newest cut is the screen now: frames come
    // whenever pixels change, so an old one is old only because nothing moved.
    func fresh(window: CGRect?, maxAge: TimeInterval = 4, now: Date = Date()) -> Snapshot? {
        if let latest, latestIsLive, feed.running, window.map({ latest.window.equalTo($0) }) ?? true { return latest }
        guard let latest, PanelSnapshotter.isFresh(latest, window: window, notBefore: notBefore, maxAge: maxAge, now: now) else { return nil }
        return latest
    }

    static func isFresh(_ snapshot: Snapshot, window: CGRect?, notBefore: Date, maxAge: TimeInterval, now: Date) -> Bool {
        guard snapshot.takenAt >= notBefore, now.timeIntervalSince(snapshot.takenAt) <= maxAge else { return false }
        if let window, !snapshot.window.equalTo(window) { return false }
        return true
    }

    // A panel may have moved (the end of a drag, a tab click): pictures taken
    // before now no longer say where it is.
    func expire(at now: Date = Date()) {
        notBefore = now
        feed.cutEveryChange()
    }

    // `completion` runs on the main thread after every capture; `changed` says
    // whether the panels differ from the capture before it.
    func refresh(pid: pid_t, completion: @escaping (Snapshot, Bool) -> Void) {
        // The live feed already sees every change.
        guard !(feed.running && latestIsLive) else { return }
        guard !inFlight else { queued = (pid, completion); return }
        guard hasAccess else {
            if !requestedAccess {
                requestedAccess = true
                listenerLog("Screen Recording not granted; Timeline follows Accessibility only (stale after panel resizes). Requesting access.")
                _ = CGRequestScreenCaptureAccess()
            }
            return
        }
        inFlight = true
        Task.detached(priority: .userInitiated) { [weak self] in
            let snapshot = await PanelSnapshotter.capture(pid: pid)
            DispatchQueue.main.async {
                guard let self else { return }
                self.inFlight = false
                defer {
                    if let next = self.queued { self.queued = nil; self.refresh(pid: next.pid, completion: next.completion) }
                }
                guard let snapshot, !(self.feed.running && self.latestIsLive) else { return }
                self.apply(snapshot, live: false, completion: completion)
            }
        }
    }

    private func apply(_ snapshot: Snapshot, live: Bool, completion: (Snapshot, Bool) -> Void) {
        let previous = latest
        latest = snapshot
        latestIsLive = live
        guard let previous, previous.window == snapshot.window, PanelPixels.same(previous.panels, snapshot.panels) else {
            completion(snapshot, true)
            return
        }
        // Within 2pt of the last capture: keep the old rectangles, so
        // the stroke does not shimmer between near-identical cuts.
        let kept = Snapshot(window: previous.window, panels: previous.panels, takenAt: snapshot.takenAt, looks: snapshot.looks)
        latest = kept
        completion(kept, false)
    }

    private static func capture(pid: pid_t) async -> Snapshot? {
        // Dated when asked for, not when done: what it shows is the screen
        // at about this moment.
        let startedAt = Date()
        guard let content = try? await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true) else { return nil }
        let candidates = content.windows.filter {
            $0.owningApplication?.processID == pid && $0.windowLayer == 0 && $0.frame.width >= 300 && $0.frame.height >= 200
        }
        guard let window = candidates.max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }) else { return nil }
        let config = SCStreamConfiguration()
        // One pixel per point: a gutter is 2-3 points, plenty to see.
        config.width = Int(window.frame.width)
        config.height = Int(window.frame.height)
        config.showsCursor = false
        config.ignoreShadowsSingleWindow = true
        config.colorSpaceName = CGColorSpace.sRGB
        guard let image = try? await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(desktopIndependentWindow: window),
                                                                      configuration: config) else { return nil }
        let frame = window.frame
        let w = image.width, h = image.height
        let rgba = PanelPixels.rgba(of: image)
        let fractions = PanelPixels.panelRects(rgba: rgba, width: w, height: h)
        let looks = rgba.withUnsafeBufferPointer { p in
            PanelPixels.timelineLooks(fractions.map {
                CGRect(x: $0.minX * CGFloat(w), y: $0.minY * CGFloat(h), width: $0.width * CGFloat(w), height: $0.height * CGFloat(h)).rounded()
            }, width: w, height: h) { x, y in let i = (y * w + x) * 4; return (Int(p[i]), Int(p[i + 1]), Int(p[i + 2])) }
        }
        let panels = fractions.map {
            CGRect(x: frame.minX + $0.minX * frame.width, y: frame.minY + $0.minY * frame.height,
                   width: $0.width * frame.width, height: $0.height * frame.height).rounded()
        }
        return Snapshot(window: frame, panels: panels, takenAt: startedAt, looks: looks)
    }
}

// A continuous capture of Premiere's main window, after Edit Assist's LiveFeed
// (2026-11-19). The one-off pictures above cost 80-160 ms each (find the
// window, then capture) and were only taken on clicks and every 2 s, so the
// Timeline rectangle trailed a panel resize or a tab switch by 2-4 s. A stream
// delivers a frame within about 33 ms of any pixel change and nothing while
// the window is still; a frame whose changes are all inside known panels
// (playback, scrubbing) is not cut at all.
final class PanelFeed: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    private var stream: SCStream?
    private(set) var starting = false
    private(set) var pid: pid_t?
    private(set) var size: CGSize?
    // Bumped by stop(): a start still on its way is dropped when it lands.
    private var generation = 0
    private let queue = DispatchQueue(label: "PRFX.panelFeed", qos: .userInteractive)
    private let lock = NSLock()
    // Touched only on `queue`: the last cut, in window points.
    private var known: [CGRect] = []
    private var previous: [UInt32] = []
    private var gutter: [Bool] = []
    private var lastCut = Date.distantPast
    // Also only on `queue`: what the feed did, logged when it stops.
    private var frames = 0, still = 0, cuts = 0, cutTime: TimeInterval = 0
    // Set from the main thread (under `lock`): cut every changed frame until
    // then, whatever changed. A click or a mouse-up can open, close or split a
    // panel without moving a known gutter.
    private var cutEveryChangeUntil = Date.distantPast
    private var pending: (panels: [CGRect], looks: [Int])?
    private var scheduled = false
    // Main thread, newest cut only, in window points (top-left origin).
    // With each panel's timelineLook.
    var onPanels: (([CGRect], [Int]) -> Void)?

    var running: Bool { stream != nil }

    func start(pid: pid_t, size: CGSize) {
        let old = stream
        stream = nil
        generation += 1
        let mine = generation
        starting = true
        self.pid = pid
        self.size = size
        Task.detached(priority: .userInitiated) { [weak self] in
            if let old { try? await old.stopCapture() }
            guard let self else { return }
            let content = try? await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
            let window = content?.windows.filter {
                $0.owningApplication?.processID == pid && $0.windowLayer == 0 && $0.frame.width >= 300 && $0.frame.height >= 200
            }.max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height })
            let created = window.flatMap { self.makeStream($0) }
            let accepted: Bool = await MainActor.run {
                guard self.generation == mine else { return false }
                self.starting = false
                guard let created else { self.pid = nil; self.size = nil; return false }
                self.queue.async { self.known = []; self.previous = []; self.gutter = []; self.lastCut = .distantPast }
                // Registered before starting: the first frame can arrive
                // before startCapture returns, and a still window sends no
                // second one.
                self.stream = created
                return true
            }
            guard let created else { return }
            guard accepted else { try? await created.stopCapture(); return }
            do {
                try await created.startCapture()
                listenerLog("Premiere panels: live feed on (\(Int(window?.frame.width ?? 0))x\(Int(window?.frame.height ?? 0)), up to 30 fps)")
            } catch {
                listenerLog("Premiere panels: live feed failed to start (\(error.localizedDescription)); one-off pictures instead")
                await MainActor.run { if self.stream === created { self.stream = nil; self.pid = nil; self.size = nil } }
            }
        }
    }

    private func makeStream(_ window: SCWindow) -> SCStream? {
        let config = SCStreamConfiguration()
        // One pixel per point: a gutter is 2-3 points, plenty to see.
        config.width = Int(window.frame.width)
        config.height = Int(window.frame.height)
        config.showsCursor = false
        config.ignoreShadowsSingleWindow = true
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.colorSpaceName = CGColorSpace.sRGB
        config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        config.queueDepth = 4
        let stream = SCStream(filter: SCContentFilter(desktopIndependentWindow: window), configuration: config, delegate: self)
        return (try? stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)) != nil ? stream : nil
    }

    // Cut every changed frame for the next `seconds`.
    func cutEveryChange(for seconds: TimeInterval = 0.6) {
        lock.lock()
        cutEveryChangeUntil = Date().addingTimeInterval(seconds)
        lock.unlock()
    }

    func stop() {
        generation += 1
        starting = false
        pid = nil
        size = nil
        guard let current = stream else { return }
        stream = nil
        queue.async {
            listenerLog("Premiere panels: live feed off after \(self.frames) frames (\(self.still) unchanged), \(self.cuts) cut, \(Int(self.cutTime * 1000 / Double(max(1, self.cuts)))) ms each")
            self.frames = 0; self.still = 0; self.cuts = 0; self.cutTime = 0
        }
        Task.detached { try? await current.stopCapture() }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen,
              let info = (CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]])?.first,
              let raw = info[.status] as? Int, SCFrameStatus(rawValue: raw) == .complete,
              let buffer = CMSampleBufferGetImageBuffer(sample) else { return }
        frames += 1
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(buffer) else { return }
        let width = CVPixelBufferGetWidth(buffer), height = CVPixelBufferGetHeight(buffer)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
        let difference = PanelPixels.compare(bgra: base, width: width, height: height, bytesPerRow: bytesPerRow,
                                             previous: &previous, gutter: gutter)
        guard difference.changed else { still += 1; return }
        let now = Date()
        lock.lock()
        let eager = now < cutEveryChangeUntil
        lock.unlock()
        // A gutter changed: a panel moved, cut now. Anything else is cut at
        // most once a second (a panel split inside, a tab dragged out).
        guard difference.onGutter || eager || now.timeIntervalSince(lastCut) >= 1 else { return }
        lastCut = now
        let fractions = PanelPixels.panelRects(bgra: base, width: width, height: height, bytesPerRow: bytesPerRow)
        cuts += 1
        cutTime += Date().timeIntervalSince(now)
        let panels = fractions.map {
            CGRect(x: $0.minX * CGFloat(width), y: $0.minY * CGFloat(height), width: $0.width * CGFloat(width), height: $0.height * CGFloat(height))
        }
        if !PanelPixels.same(panels, known) || gutter.count != width * height {
            gutter = PanelPixels.gutterMask(panels: panels, width: width, height: height)
        }
        known = panels
        let bytes = base.assumingMemoryBound(to: UInt8.self)
        let looks = PanelPixels.timelineLooks(panels.map { $0.rounded() }, width: width, height: height) { x, y in
            let p = bytes + y * bytesPerRow + x * 4
            return (Int(p[2]), Int(p[1]), Int(p[0]))
        }
        lock.lock()
        pending = (panels, looks)
        let schedule = !scheduled
        scheduled = true
        lock.unlock()
        guard schedule else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.lock.lock()
            let newest = self.pending
            self.pending = nil
            self.scheduled = false
            self.lock.unlock()
            if let newest, self.stream === stream { self.onPanels?(newest.panels, newest.looks) }
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.stream === stream else { return }
            listenerLog("Premiere panels: live feed stopped (\(error.localizedDescription))")
            self.stream = nil
            self.pid = nil
            self.size = nil
        }
    }
}

extension CGRect {
    fileprivate func rounded() -> CGRect {
        CGRect(x: minX.rounded(), y: minY.rounded(), width: width.rounded(), height: height.rounded())
    }
}
