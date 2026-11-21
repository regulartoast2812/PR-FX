import Foundation
import CoreGraphics

// swiftc -module-cache-path /tmp/prfx-swift-module-cache native/PRFXPanelPixels.swift tools/check-panel-pixels.swift -o /tmp/prfx-check-panel-pixels && /tmp/prfx-check-panel-pixels
func listenerLog(_ message: String) {}

@main
struct PanelPixelChecks {
    static func main() {
        // A 200x100 window: grey panels, a 2px black gutter at x 120 and one
        // at y 40 across the left column only. A black video frame inside the
        // right panel must not be taken for a gutter.
        let w = 200, h = 100
        var black = [Bool](repeating: false, count: w * h)
        func fill(_ x0: Int, _ y0: Int, _ x1: Int, _ y1: Int) { for y in y0 ..< y1 { for x in x0 ..< x1 { black[y * w + x] = true } } }
        fill(120, 0, 122, h)       // column gutter
        fill(0, 40, 120, 42)       // row gutter, left column
        fill(140, 20, 190, 70)     // black video
        let rects = PanelPixels.panelRects(black: black, width: w, height: h).map {
            CGRect(x: ($0.minX * CGFloat(w)).rounded(), y: ($0.minY * CGFloat(h)).rounded(), width: ($0.width * CGFloat(w)).rounded(), height: ($0.height * CGFloat(h)).rounded())
        }
        precondition(rects.count == 3, "three panels, got \(rects)")
        precondition(rects.contains(CGRect(x: 0, y: 0, width: 120, height: 40)))
        precondition(rects.contains(CGRect(x: 0, y: 42, width: 120, height: 58)))
        precondition(rects.contains(CGRect(x: 122, y: 0, width: 78, height: 100)))

        // Real layout (2026-11-19, after the Timeline's top was dragged up).
        // Accessibility still placed the controls and the old region below.
        let panels = [CGRect(x: 1, y: 74, width: 331, height: 1021), CGRect(x: 336, y: 74, width: 879, height: 419),
                      CGRect(x: 336, y: 497, width: 48, height: 598), CGRect(x: 388, y: 497, width: 775, height: 598),
                      CGRect(x: 1219, y: 74, width: 508, height: 1021)]
        let staleMarkers = [CGRect(x: 476, y: 680, width: 24, height: 24), CGRect(x: 500, y: 1026, width: 24, height: 24)]
        let stale = CGRect(x: 463, y: 612, width: 700, height: 483)
        precondition(PanelPixels.timelinePanel(panels, markers: staleMarkers, reference: stale) == panels[3])
        precondition(PanelPixels.timelinePanel(panels, markers: [], reference: stale) == panels[3])
        // Nothing to go on: never guess.
        precondition(PanelPixels.timelinePanel(panels, markers: [], reference: nil) == nil)
        // A gutterless frame while Premiere redraws after a command (2026-11-20):
        // one panel fills the window but the toolbar is still docked. Not a
        // maximize: no answer, so the docked Timeline stays.
        do {
            let window = CGRect(x: 0, y: 33, width: 1728, height: 1084)
            let docked = CGRect(x: 402, y: 525, width: 762, height: 570)
            let whole = [CGRect(x: 1, y: 33, width: 1726, height: 1062)]
            let dockedTools = [CGRect(x: 420, y: 560, width: 20, height: 20), CGRect(x: 446, y: 560, width: 20, height: 20)]
            let dockedHeads = [CGRect(x: 410, y: 640, width: 16, height: 16), CGRect(x: 430, y: 640, width: 16, height: 16)]
            precondition(PanelPixels.timelinePanel(whole, markers: dockedHeads, toolbar: dockedTools, reference: docked,
                                                   window: window, docked: docked) == nil, "redraw frame, toolbar docked")
            precondition(PanelPixels.timelinePanel(whole, markers: dockedHeads, reference: docked,
                                                   window: window, docked: docked) == nil, "redraw frame, headers docked")
            precondition(PanelPixels.timelinePanel(whole, markers: [], reference: docked,
                                                   window: window, docked: docked) == nil, "redraw frame, nothing seen")
            // The ` key really maximized it: the toolbar moved to the top left.
            let movedTools = [CGRect(x: 20, y: 70, width: 20, height: 20), CGRect(x: 46, y: 70, width: 20, height: 20)]
            precondition(PanelPixels.timelinePanel(whole, markers: dockedHeads, toolbar: movedTools, reference: docked,
                                                   window: window, docked: docked) == whole[0], "real maximize")
            // Docked layout: unchanged.
            let split = [CGRect(x: 1, y: 74, width: 372, height: 1021), docked, CGRect(x: 1219, y: 74, width: 508, height: 1021)]
            precondition(PanelPixels.timelinePanel(split, markers: dockedHeads, toolbar: dockedTools, reference: docked,
                                                   window: window, docked: docked) == docked, "docked")
        }
        // Freshness (2026-11-19): a capture from before a mouse-up shows the
        // old layout and must not be used after it, however recent.
        let t0 = Date(timeIntervalSince1970: 1000)
        let win = CGRect(x: 0, y: 33, width: 1728, height: 1084)
        let shot = PanelSnapshotter.Snapshot(window: win, panels: panels, takenAt: t0)
        precondition(PanelSnapshotter.isFresh(shot, window: win, notBefore: .distantPast, maxAge: 4, now: t0 + 1))
        precondition(!PanelSnapshotter.isFresh(shot, window: win, notBefore: t0 + 0.5, maxAge: 4, now: t0 + 1), "taken before the mouse-up")
        precondition(PanelSnapshotter.isFresh(shot, window: win, notBefore: t0, maxAge: 4, now: t0 + 1), "taken at the mouse-up")
        precondition(!PanelSnapshotter.isFresh(shot, window: win, notBefore: .distantPast, maxAge: 4, now: t0 + 5), "too old")
        precondition(!PanelSnapshotter.isFresh(shot, window: win.offsetBy(dx: 10, dy: 0), notBefore: .distantPast, maxAge: 4, now: t0 + 1), "window moved")
        // Live frames (2026-11-19): 32BGRA rows, padded, cut the same as the
        // mask. Gutters are near black, panels grey (30), a bright pixel noise.
        let stride = w * 4 + 16
        var bgra = [UInt8](repeating: 0, count: stride * h)
        for y in 0 ..< h { for x in 0 ..< w {
            let v: UInt8 = black[y * w + x] ? 4 : (x == 10 && y == 10 ? 220 : 30)
            bgra[y * stride + x * 4] = v; bgra[y * stride + x * 4 + 1] = v; bgra[y * stride + x * 4 + 2] = v; bgra[y * stride + x * 4 + 3] = 255
        } }
        let live = bgra.withUnsafeBytes { PanelPixels.panelRects(bgra: $0.baseAddress!, width: w, height: h, bytesPerRow: stride) }
        precondition(live == PanelPixels.panelRects(black: black, width: w, height: h), "frame and mask cut alike")
        // A frame is cut only when a pixel outside the known panels changed
        // (Premiere reports its whole window changed on every repaint).
        let cut = [CGRect(x: 0, y: 0, width: 120, height: 40), CGRect(x: 0, y: 42, width: 120, height: 58), CGRect(x: 122, y: 0, width: 78, height: 100)]
        let gutter = PanelPixels.gutterMask(panels: cut, width: w, height: h)
        precondition(gutter[0 * w + 120] && gutter[41 * w + 5] && !gutter[10 * w + 10] && !gutter[99 * w + 199], "gutters are outside every panel")
        var previous: [UInt32] = []
        func compare(_ frame: [UInt8]) -> (changed: Bool, onGutter: Bool) {
            frame.withUnsafeBytes { PanelPixels.compare(bgra: $0.baseAddress!, width: w, height: h, bytesPerRow: stride, previous: &previous, gutter: gutter) }
        }
        precondition(compare(bgra) == (true, true), "the first frame is always cut")
        precondition(compare(bgra) == (false, false), "a repaint of the same pixels")
        var playing = bgra
        playing[50 * stride + 150 * 4] = 90
        precondition(compare(playing) == (true, false), "playback inside a panel")
        var moved = playing
        for y in 0 ..< h { moved[y * stride + 120 * 4] = 30; moved[y * stride + 120 * 4 + 1] = 30; moved[y * stride + 120 * 4 + 2] = 30 }
        precondition(compare(moved) == (true, true), "a gutter moved")
        precondition(compare(moved) == (false, false), "and is remembered")
        do {
            // Back from a maximized Timeline (` key): Accessibility still has it
            // filling the window, its controls in the top-left, over Project.
            let window = CGRect(x: 0, y: 33, width: 1728, height: 1084)
            let project = CGRect(x: 1, y: 74, width: 372, height: 1021)
            let monitor = CGRect(x: 376, y: 74, width: 1350, height: 448)
            let timeline = CGRect(x: 428, y: 525, width: 736, height: 570)
            let docked = [project, monitor, timeline]
            let full = CGRect(x: 1, y: 33, width: 1726, height: 1062)
            let corner = [CGRect(x: 10, y: 80, width: 60, height: 16), CGRect(x: 80, y: 80, width: 20, height: 16)]
            precondition(PanelPixels.timelinePanel(docked, markers: corner, reference: full, window: window, docked: timeline) == timeline,
                         "back from maximized: where it was docked, not the panel under the stale controls")
            precondition(PanelPixels.timelinePanel(docked, markers: corner, reference: full, window: window, docked: nil) == nil,
                         "back from maximized, docked spot unknown: draw nothing")
            precondition(PanelPixels.timelinePanel([full], markers: corner, reference: full, window: window, docked: timeline) == full,
                         "while maximized: the whole window")
            precondition(PanelPixels.timelinePanel(docked, markers: [], reference: timeline, window: window, docked: timeline) == timeline,
                         "docked as usual")
            // As seen live: the toolbar moved back, ~29 track-header buttons left over Project.
            let headers = (0 ..< 29).map { CGRect(x: 38 + CGFloat($0 % 4) * 24, y: 174 + CGFloat($0 / 4) * 41, width: 24, height: 24) }
            let tools = [CGRect(x: 442, y: 593, width: 24, height: 24), CGRect(x: 474, y: 593, width: 24, height: 24),
                         CGRect(x: 570, y: 593, width: 24, height: 24), CGRect(x: 602, y: 593, width: 24, height: 24)]
            precondition(PanelPixels.timelinePanel(docked, markers: headers + tools, toolbar: tools, reference: project) == timeline,
                         "the toolbar beats stale track headers, even with Project as the last pick")
            precondition(PanelPixels.timelinePanel(docked, markers: headers + tools, toolbar: tools, reference: full, window: window, docked: nil) == timeline,
                         "back from maximized with the toolbar current: found without a docked spot")
        }
        do {
            // The Timeline by its own pixels (2026-11-21): stale markers put
            // it over Project, but only one panel draws the blue time at its
            // top-left, a ruler, the yellow work-area bar and blue V1/A1
            // buttons. Program has a ruler on top and its blue time at the
            // bottom: one sign, not enough.
            let w = 1200, h = 600
            var px = [(Int, Int, Int)](repeating: (29, 29, 29), count: w * h)
            func paint(_ x0: Int, _ y0: Int, _ x1: Int, _ y1: Int, _ c: (Int, Int, Int)) {
                for y in y0 ..< y1 { for x in x0 ..< x1 { px[y * w + x] = c } }
            }
            let project = CGRect(x: 0, y: 0, width: 300, height: 600)
            let timeline = CGRect(x: 304, y: 0, width: 500, height: 600)
            let program = CGRect(x: 808, y: 0, width: 392, height: 600)
            paint(310, 30, 360, 40, (67, 160, 255))                       // time
            for x in Swift.stride(from: 440, to: 800, by: 10) { paint(x, 60, x + 1, 64, (150, 150, 150)) }  // ruler
            paint(430, 70, 800, 72, (233, 233, 1))                        // work-area bar
            paint(330, 200, 350, 230, (0, 92, 200)); paint(330, 240, 350, 270, (0, 92, 200))  // V1, A1
            for x in Swift.stride(from: 820, to: 1190, by: 10) { paint(x, 10, x + 1, 14, (150, 150, 150)) }  // Program ruler
            paint(815, 560, 870, 570, (67, 160, 255))                     // Program time, bottom
            let looks = PanelPixels.timelineLooks([project, timeline, program], width: w, height: h) { px[$1 * w + $0] }
            precondition(looks[0] == 0 && looks[1] == 5 && looks[2] == 1, "looks \(looks)")
            let overProject = [CGRect(x: 20, y: 200, width: 20, height: 20), CGRect(x: 60, y: 200, width: 20, height: 20)]
            precondition(PanelPixels.timelinePanel([project, timeline, program], markers: overProject, toolbar: overProject,
                                                   reference: project, looks: looks) == timeline, "pixels beat stale markers")
            precondition(PanelPixels.timelinePanel([project, timeline, program], markers: overProject, toolbar: overProject,
                                                   reference: project, looks: [0, 0, 1]) == project, "no look: markers decide as before")
        }
        print("Panel pixel checks passed")
    }
}
