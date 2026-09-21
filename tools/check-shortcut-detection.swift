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
        print("Shortcut detection cache and geometry checks passed")
    }
}
