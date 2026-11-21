import Foundation
import CoreGraphics

// A saved rectangle is a fallback, never evidence of a fresh AX lookup.
// Keeping these separate lets detection recover after a transient AX failure.
struct TimelineRegionCache {
    private(set) var liveRegion: CGRect?
    private(set) var lastKnownRegion: CGRect?
    private(set) var lastLookupAt = Date.distantPast
    // Premiere's Export, Import and Home modes replace the docked workspace
    // with a full-window screen: no panel tab strips and no Timeline controls.
    // The saved rectangle must not apply there -- the Export settings and
    // file-name fields sit right where the Timeline used to be.
    private(set) var panelsHidden = false
    // The Timeline controls as they were at the last matched lookup. When
    // Premiere lags republishing a tab strip after a resize, the panel is
    // inferred from how far its controls moved (TimelinePanelGeometry.inferred).
    private(set) var lastControls: CGRect?

    func needsLookup(at now: Date = Date()) -> Bool {
        now.timeIntervalSince(lastLookupAt) >= 2.0
    }

    mutating func recordLookup(_ region: CGRect?, panelsHidden: Bool = false, controls: CGRect? = nil, at now: Date = Date()) {
        if region != nil, let controls { lastControls = controls }
        liveRegion = region
        lastLookupAt = now
        self.panelsHidden = region == nil && panelsHidden
        if let region { lastKnownRegion = region }
    }

    mutating func restoreFallback(_ region: CGRect) {
        lastKnownRegion = region
    }

    mutating func invalidate() {
        liveRegion = nil
        lastLookupAt = .distantPast
    }
}

enum TimelinePanelGeometry {
    static func valid(_ rect: CGRect) -> Bool {
        rect.origin.x.isFinite && rect.origin.y.isFinite
            && rect.width.isFinite && rect.height.isFinite
            && rect.width > 0 && rect.height > 0
    }

    // The union of the Timeline-only controls. Adobe can publish hidden
    // controls with stale frames; never let those reach outside the window.
    static func controls(window: CGRect, markers: [CGRect]) -> CGRect? {
        let visible = markers.filter {
            valid($0) && window.contains(CGPoint(x: $0.midX, y: $0.midY))
        }.map { $0.intersection(window) }
        guard let first = visible.first else { return nil }
        return visible.dropFirst().reduce(first) { $0.union($1) }
    }

    // `statusBarTop`: the top of Premiere's status bar, when found. With no panel
    // below the Timeline its edge is just above that bar, not the window's
    // bottom (2026-11-19: the region ran 22pt past the panel).
    static func region(window: CGRect, markers: [CGRect], tabs: [CGRect], statusBarTop: CGFloat? = nil) -> CGRect? {
        guard valid(window), let controls = controls(window: window, markers: markers) else { return nil }
        let strips = tabs.filter {
            valid($0) && $0.height >= 10 && $0.height <= 80 && $0.width >= 200
                && window.contains($0)
        }
        let candidates = strips.filter {
            $0.minX <= controls.minX && $0.maxX >= controls.maxX
                && $0.maxY <= controls.minY && controls.minY - $0.maxY <= 120
        }
        guard let strip = candidates.max(by: { $0.maxY < $1.maxY }) else {
            // An unrelated tab elsewhere in the workspace is not a Timeline.
            // Let the caller use its last known rectangle during a redraw.
            return nil
        }
        let lowerEdge = strips.filter {
            $0.minY > controls.maxY && $0.minY > strip.maxY
                && $0.maxX > strip.minX && $0.minX < strip.maxX
        }.map(\.minY).min() ?? min(window.maxY, statusBarTop.map { $0 - 2 } ?? window.maxY)
        let region = CGRect(x: strip.minX, y: strip.minY,
                            width: strip.width, height: lowerEdge - strip.minY)
        return region.width >= 200 && region.height >= 120 ? region : nil
    }
}

extension TimelinePanelGeometry {
    // The bottom edge: the next panel's tab strip below, else the status bar.
    static func lowerEdge(window: CGRect, controls: CGRect, top: CGFloat, left: CGFloat, right: CGFloat,
                          tabs: [CGRect], statusBarTop: CGFloat?) -> CGFloat {
        tabs.filter {
            valid($0) && $0.height >= 10 && $0.height <= 80 && $0.width >= 200 && window.contains($0)
                && $0.minY > controls.maxY && $0.minY > top + 10 && $0.maxX > left && $0.minX < right
        }.map(\.minY).min() ?? min(window.maxY, statusBarTop.map { $0 - 2 } ?? window.maxY)
    }

    // Used when `region` finds no tab strip directly above the controls. That
    // happens right after a panel resize: Premiere moves the controls at once
    // but can keep publishing the tab strip at its old place (2026-11-19, the
    // stroke stayed on the old edge). The controls keep a fixed distance from
    // the panel's top, so the panel moved by as much as they did.
    //
    // 1. A strip above the controls, at the expected top (within 24pt), wins.
    // 2. Otherwise the last region is moved by the controls' offset.
    static func inferred(window: CGRect, markers: [CGRect], tabs: [CGRect], statusBarTop: CGFloat? = nil,
                         last: CGRect?, lastControls: CGRect?) -> CGRect? {
        guard valid(window), let controls = controls(window: window, markers: markers),
              let last, let lastControls, valid(last) else { return nil }
        let dy = controls.minY - lastControls.minY
        let dx = controls.minX - lastControls.minX
        let expectedTop = last.minY + dy
        let strip = tabs.filter {
            valid($0) && $0.height >= 10 && $0.height <= 80 && $0.width >= 200 && window.contains($0)
                && $0.minX <= controls.minX && $0.maxX >= controls.maxX
                && $0.maxY <= controls.minY && abs($0.minY - expectedTop) <= 24
        }.max(by: { $0.maxY < $1.maxY })
        let top = strip?.minY ?? expectedTop
        // Controls sit at the panel's left edge: a moved left edge moves them,
        // and the right edge stays where it was unless the whole panel moved.
        let left = strip?.minX ?? (last.minX + dx)
        var right = strip?.maxX ?? last.maxX
        if strip == nil, right - left < 200 { right = left + last.width }
        right = min(right, window.maxX)
        let bottom = lowerEdge(window: window, controls: controls, top: top, left: left, right: right,
                               tabs: tabs, statusBarTop: statusBarTop)
        let region = CGRect(x: left, y: top, width: right - left, height: bottom - top)
        guard region.width >= 200, region.height >= 120, window.contains(region.insetBy(dx: 1, dy: 1)),
              region.contains(CGPoint(x: controls.midX, y: controls.midY)) else { return nil }
        return region
    }
}
