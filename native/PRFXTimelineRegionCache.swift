import Foundation
import CoreGraphics

// A saved rectangle is a fallback, never evidence of a fresh AX lookup.
// Keeping these separate lets detection recover after a transient AX failure.
struct TimelineRegionCache {
    private(set) var liveRegion: CGRect?
    private(set) var lastKnownRegion: CGRect?
    private(set) var lastLookupAt = Date.distantPast

    func needsLookup(at now: Date = Date()) -> Bool {
        now.timeIntervalSince(lastLookupAt) >= 2.0
    }

    mutating func recordLookup(_ region: CGRect?, at now: Date = Date()) {
        liveRegion = region
        lastLookupAt = now
        if let region { lastKnownRegion = region }
    }

    mutating func restoreFallback(_ region: CGRect) {
        lastKnownRegion = region
    }
}

enum TimelinePanelGeometry {
    static func region(window: CGRect, markers: [CGRect], tabs: [CGRect]) -> CGRect? {
        func valid(_ rect: CGRect) -> Bool {
            rect.origin.x.isFinite && rect.origin.y.isFinite
                && rect.width.isFinite && rect.height.isFinite
                && rect.width > 0 && rect.height > 0
        }
        guard valid(window) else { return nil }
        // Adobe can publish hidden controls and tab strips with stale frames.
        // Never let those extend the inferred panel outside its owning window.
        let visibleMarkers = markers.filter {
            valid($0) && window.contains(CGPoint(x: $0.midX, y: $0.midY))
        }.map { $0.intersection(window) }
        guard let first = visibleMarkers.first else { return nil }
        let controls = visibleMarkers.dropFirst().reduce(first) { $0.union($1) }
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
        }.map(\.minY).min() ?? window.maxY
        let region = CGRect(x: strip.minX, y: strip.minY,
                            width: strip.width, height: lowerEdge - strip.minY)
        return region.width >= 200 && region.height >= 120 ? region : nil
    }
}
