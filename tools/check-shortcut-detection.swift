import Foundation
import CoreGraphics

@main
enum ShortcutDetectionChecks {
    static func main() {
        let start = Date(timeIntervalSince1970: 1_000)
        let oldPanel = CGRect(x: 70, y: 600, width: 1100, height: 480)
        let movedPanel = CGRect(x: 400, y: 300, width: 1300, height: 700)
        var cache = TimelineRegionCache()

        cache.restoreFallback(oldPanel)
        precondition(cache.needsLookup(at: start), "Restoring disk geometry must not delay live detection")
        precondition(cache.liveRegion == nil)

        cache.recordLookup(oldPanel, at: start)
        precondition(!cache.needsLookup(at: start.addingTimeInterval(1)))
        precondition(cache.liveRegion == oldPanel)

        // A redraw briefly hides the AX controls. The fallback must remain
        // available without masquerading as a successful, newly sampled result.
        cache.recordLookup(nil, at: start.addingTimeInterval(2))
        precondition(cache.liveRegion == nil)
        precondition(cache.lastKnownRegion == oldPanel)
        for offset in [2.0, 2.5, 3.0, 3.5] {
            cache.restoreFallback(oldPanel)
            precondition(!cache.needsLookup(at: start.addingTimeInterval(offset)))
            precondition(cache.liveRegion == nil)
        }
        precondition(cache.needsLookup(at: start.addingTimeInterval(4)),
                     "Repeated fallback reads must not postpone the next AX attempt")
        cache.recordLookup(movedPanel, at: start.addingTimeInterval(4))
        precondition(cache.liveRegion == movedPanel)
        precondition(cache.lastKnownRegion == movedPanel)

        cache.invalidate()
        precondition(cache.needsLookup(at: start.addingTimeInterval(4.1)),
                     "A focus/layout change must not wait for the two-second cache TTL")
        precondition(cache.liveRegion == nil && cache.lastKnownRegion == movedPanel)
        cache.recordLookup(movedPanel, at: start.addingTimeInterval(4))

        // Continued failures are throttled but keep retrying every two seconds.
        for offset in stride(from: 6.0, through: 14.0, by: 2.0) {
            let now = start.addingTimeInterval(offset)
            precondition(cache.needsLookup(at: now))
            cache.recordLookup(nil, at: now)
            precondition(cache.lastKnownRegion == movedPanel)
            precondition(!cache.needsLookup(at: now.addingTimeInterval(1)))
        }
        // Captured from Premiere's live AX tree during verification.
        let window = CGRect(x: 0, y: 33, width: 1728, height: 1084)
        let controls = CGRect(x: 85, y: 701, width: 184, height: 359)
        let timelineTab = CGRect(x: 72, y: 633, width: 1132, height: 40)
        let tabs = [CGRect(x: -94, y: 91, width: 626, height: 24),
                    CGRect(x: 533, y: 91, width: 761, height: 40),
                    timelineTab, CGRect(x: 1260, y: 91, width: 467, height: 24)]
        let expected = CGRect(x: 72, y: 633, width: 1132, height: 484)
        precondition(TimelinePanelGeometry.region(window: window, markers: [controls], tabs: tabs) == expected)
        // The status bar (y 1097 on that machine) ends the panel, not the window.
        precondition(TimelinePanelGeometry.region(window: window, markers: [controls], tabs: tabs, statusBarTop: 1097)
            == CGRect(x: 72, y: 633, width: 1132, height: 462))

        // Hidden/invalid controls must not drag the union toward another panel.
        let hidden = CGRect(x: -500, y: 50, width: 20, height: 20)
        let invalid = CGRect(x: 90, y: 100, width: 0, height: 0)
        let misleadingTab = CGRect(x: -317, y: 674, width: 849, height: 24)
        // This overlapping tab extends outside its owning window; it must not
        // replace the Timeline with a narrower rectangle from another panel.
        precondition(TimelinePanelGeometry.region(window: window, markers: [controls, hidden, invalid], tabs: tabs + [misleadingTab]) == expected)
        precondition(TimelinePanelGeometry.region(window: window, markers: [controls, hidden, invalid], tabs: tabs) == expected)
        precondition(TimelinePanelGeometry.region(window: window, markers: [controls], tabs: Array(tabs.prefix(2))) == nil,
                     "Missing Timeline tab must not select a distant Project tab")
        precondition(TimelinePanelGeometry.region(window: window, markers: [hidden, invalid], tabs: tabs) == nil)

        let upperTab = CGRect(x: 72, y: 100, width: 1132, height: 40)
        let upperControls = CGRect(x: 85, y: 160, width: 184, height: 300)
        let upper = TimelinePanelGeometry.region(window: window, markers: [upperControls], tabs: [upperTab, timelineTab])!
        precondition(upper.maxY == timelineTab.minY, "Timeline above another panel must stop at its boundary")
        precondition(!upper.contains(CGPoint(x: 200, y: 800)))

        let shiftedWindow = window.offsetBy(dx: -1728, dy: -300)
        let shifted = TimelinePanelGeometry.region(window: shiftedWindow,
            markers: [controls.offsetBy(dx: -1728, dy: -300)],
            tabs: tabs.map { $0.offsetBy(dx: -1728, dy: -300) })
        precondition(shifted == expected.offsetBy(dx: -1728, dy: -300), "Negative display coordinates are valid")
        // Export/Import/Home mode: a healthy scan with no tab strips. The saved
        // rectangle stays for the return to Edit, but must not be trusted now.
        var modes = TimelineRegionCache()
        modes.recordLookup(oldPanel, at: start)
        modes.recordLookup(nil, panelsHidden: true, at: start.addingTimeInterval(3))
        precondition(modes.panelsHidden && modes.liveRegion == nil && modes.lastKnownRegion == oldPanel)
        modes.invalidate()
        precondition(modes.panelsHidden, "Invalidating for a refresh must not re-arm plain keys before the next scan")
        modes.recordLookup(nil, at: start.addingTimeInterval(6))
        precondition(!modes.panelsHidden, "A redraw miss is not a mode switch")
        modes.recordLookup(nil, panelsHidden: true, at: start.addingTimeInterval(8))
        modes.recordLookup(oldPanel, at: start.addingTimeInterval(10))
        precondition(!modes.panelsHidden, "Finding the Timeline clears full-window mode")

        // Resize (2026-11-19): the Timeline's top dragged up 200pt. Premiere moved
        // the controls but kept publishing the tab strip at its old place.
        let premiere = CGRect(x: 0, y: 33, width: 1728, height: 1084)
        let tlStrip = CGRect(x: 463, y: 612, width: 700, height: 40)
        let topStrips = [CGRect(x: 411, y: 74, width: 804, height: 40), CGRect(x: 1219, y: 74, width: 508, height: 24)]
        let before = [CGRect(x: 476, y: 680, width: 24, height: 24), CGRect(x: 500, y: 1026, width: 24, height: 24)]
        let lastPanel = TimelinePanelGeometry.region(window: premiere, markers: before, tabs: topStrips + [tlStrip], statusBarTop: 1097)!
        precondition(lastPanel == CGRect(x: 463, y: 612, width: 700, height: 483))
        let lastControls = TimelinePanelGeometry.controls(window: premiere, markers: before)
        let after = [CGRect(x: 476, y: 480, width: 24, height: 24), CGRect(x: 500, y: 1026, width: 24, height: 24)]
        precondition(TimelinePanelGeometry.region(window: premiere, markers: after, tabs: topStrips + [tlStrip], statusBarTop: 1097) == nil)
        precondition(TimelinePanelGeometry.inferred(window: premiere, markers: after, tabs: topStrips + [tlStrip], statusBarTop: 1097,
                                                    last: lastPanel, lastControls: lastControls)
            == CGRect(x: 463, y: 412, width: 700, height: 683), "A moved panel follows its controls")
        // Once Premiere republishes the strip at its new place, the strip wins.
        let moved = CGRect(x: 463, y: 411, width: 700, height: 40)
        precondition(TimelinePanelGeometry.inferred(window: premiere, markers: after, tabs: topStrips + [moved], statusBarTop: 1097,
                                                    last: lastPanel, lastControls: lastControls)
            == CGRect(x: 463, y: 411, width: 700, height: 684))
        // No controls (Export mode): nothing is inferred.
        precondition(TimelinePanelGeometry.inferred(window: premiere, markers: [], tabs: topStrips, statusBarTop: 1097,
                                                    last: lastPanel, lastControls: lastControls) == nil)
        var tracked = TimelineRegionCache()
        tracked.recordLookup(lastPanel, controls: lastControls, at: start)
        precondition(tracked.lastControls == lastControls)
        tracked.recordLookup(nil, controls: CGRect(x: 1, y: 1, width: 1, height: 1), at: start.addingTimeInterval(3))
        precondition(tracked.lastControls == lastControls, "A failed lookup keeps the matched controls")

        print("Shortcut detection cache and geometry checks passed")
    }
}
