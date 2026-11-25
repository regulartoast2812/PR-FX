// Checks for Edie's After Effects Timeline finder (native/PRFXAETimeline.swift) on drawn layouts: black gutters
// between panels as AE draws them, the current-time readout in AE's blue at the Timeline's top left, the frame count
// under it, a blue playhead line and work area, and blue in other panels.
// swiftc -module-cache-path /tmp/prfx-swift-module-cache native/PRFXPanelPixels.swift native/PRFXAETimeline.swift tools/check-ae-timeline.swift -o /tmp/check-ae-timeline && /tmp/check-ae-timeline
import AppKit

func listenerLog(_ message: String) {}

nonisolated(unsafe) var failures = 0
func check(_ name: String, _ ok: Bool, _ detail: @autoclosure () -> String = "") {
    print((ok ? "ok   " : "FAIL ") + name + (ok ? "" : " — " + detail()))
    if !ok { failures += 1 }
}

struct Canvas {
    let w: Int, h: Int
    var rgba: [UInt8]
    init(_ w: Int, _ h: Int) { self.w = w; self.h = h; rgba = [UInt8](repeating: 0, count: w * h * 4) }
    mutating func fill(_ r: CGRect, _ c: (UInt8, UInt8, UInt8)) {
        for y in max(0, Int(r.minY)) ..< min(h, Int(r.maxY)) {
            for x in max(0, Int(r.minX)) ..< min(w, Int(r.maxX)) {
                let i = (y * w + x) * 4
                rgba[i] = c.0; rgba[i + 1] = c.1; rgba[i + 2] = c.2; rgba[i + 3] = 255
            }
        }
    }
    // Text-like strokes: every other column of a box.
    mutating func text(_ r: CGRect, _ c: (UInt8, UInt8, UInt8)) {
        var x = r.minX
        while x < r.maxX { fill(CGRect(x: x, y: r.minY, width: 1, height: r.height), c); x += 2 }
    }
}

let panelGrey: (UInt8, UInt8, UInt8) = (35, 35, 35)
let blue: (UInt8, UInt8, UInt8) = (64, 144, 240)

// The layout of the user's AE window (2026-11-25), at one pixel per point: toolbar, three panels across, Timeline
// along the bottom.
func aeLayout(timelineTop: Int = 598, readout: Bool = true, frameCount: Bool = true) -> Canvas {
    var c = Canvas(1728, 1084)
    c.fill(CGRect(x: 1, y: 0, width: 1726, height: 64), panelGrey)
    c.fill(CGRect(x: 1, y: 66, width: 928, height: timelineTop - 70), panelGrey)
    c.fill(CGRect(x: 933, y: 66, width: 568, height: timelineTop - 70), panelGrey)
    c.fill(CGRect(x: 1505, y: 66, width: 222, height: timelineTop - 70), panelGrey)
    c.fill(CGRect(x: 1, y: timelineTop, width: 1726, height: 1084 - timelineTop - 2), panelGrey)
    // The Comp panel's blue exposure value, small.
    c.text(CGRect(x: 720, y: timelineTop - 30, width: 20, height: 9), blue)
    if readout { c.text(CGRect(x: 15, y: timelineTop + 31, width: 72, height: 11), blue) }
    if frameCount { c.text(CGRect(x: 12, y: timelineTop + 46, width: 80, height: 7), blue) }
    // The playhead: a tall 1pt line; the work area: a bar.
    c.fill(CGRect(x: 735, y: timelineTop + 40, width: 1, height: 400), blue)
    c.fill(CGRect(x: 735, y: timelineTop + 40, width: 900, height: 3), blue)
    return c
}

func find(_ c: Canvas) -> CGRect? { AETimeline.timelinePanel(rgba: c.rgba, width: c.w, height: c.h) }

@main
enum AETimelineChecks {
    static func main() {
        let standard = find(aeLayout())
        check("finds the Timeline along the bottom", standard.map { $0.minY == 598 && $0.maxX == 1727 && $0.minX == 1 } == true, "\(String(describing: standard))")
        // AE outlines the panel you're in with a 1pt blue line.
        var focused = aeLayout()
        focused.fill(CGRect(x: 1, y: 598, width: 1726, height: 1), blue)
        focused.fill(CGRect(x: 1, y: 598, width: 1, height: 484), blue)
        focused.fill(CGRect(x: 1726, y: 598, width: 1, height: 484), blue)
        let outlined = find(focused)
        check("finds the Timeline when it's the panel you're in (blue outline)", outlined?.minY == 598, "\(String(describing: outlined))")
        // At one pixel per point most of the text is its darker antialiased edge.
        var soft = aeLayout(readout: false, frameCount: false)
        soft.text(CGRect(x: 15, y: 629, width: 72, height: 11), (16, 60, 110))
        check("finds a readout drawn mostly in its antialiased darker blue", find(soft) != nil)
        let higher = find(aeLayout(timelineTop: 420))
        check("follows it when it's taller", higher?.minY == 420, "\(String(describing: higher))")
        check("none when no composition is open (no readout)", find(aeLayout(readout: false)) == nil)
        check("the frame count under the readout doesn't stop it", find(aeLayout(frameCount: true)) != nil)
        check("the playhead, work area and the Comp panel's blue alone are not a readout", find(aeLayout(readout: false, frameCount: false)) == nil)

        // A Timeline docked at the top right, the readout in its corner.
        var right = Canvas(1400, 900)
        right.fill(CGRect(x: 1, y: 1, width: 600, height: 897), panelGrey)
        right.fill(CGRect(x: 604, y: 1, width: 795, height: 400), panelGrey)
        right.fill(CGRect(x: 604, y: 404, width: 795, height: 494), panelGrey)
        right.text(CGRect(x: 618, y: 435, width: 72, height: 11), blue)
        let docked = find(right)
        check("finds a Timeline docked bottom right", docked.map { $0.minX == 604 && $0.minY == 404 && $0.maxX == 1399 } == true, "\(String(describing: docked))")

        // Too wide or too tall a blue block is a picture, not a readout.
        var picture = aeLayout(readout: false, frameCount: false)
        picture.fill(CGRect(x: 15, y: 620, width: 240, height: 60), blue)
        check("a blue picture in the corner is not a readout", find(picture) == nil)

        check("readout blue: AE's #4090f0", AETimeline.isReadoutBlue(64, 144, 240))
        check("readout blue: not grey, white or orange", !AETimeline.isReadoutBlue(200, 200, 200) && !AETimeline.isReadoutBlue(255, 255, 255) && !AETimeline.isReadoutBlue(255, 154, 61))
        check("readout blue: not Premiere's violet label", !AETimeline.isReadoutBlue(166, 144, 224))
        check("After Effects by bundle id", AETimeline.isAfterEffects(nil) == false)

        print(failures == 0 ? "All AE Timeline checks passed." : "\(failures) AE Timeline check(s) failed.")
        exit(failures == 0 ? 0 : 1)
    }
}
