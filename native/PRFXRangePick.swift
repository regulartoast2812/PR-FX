import Foundation

// The palette's In/Out picker (2026-11-25, the user: "for the media placing from ctrl space let's build the
// infrastructure for in-out point selection before placing bcuz that's 95% of the time"). Enter on a video or a sound
// in the palette opens a small player; the editor scrubs, marks In and Out, and Enter places only that part at the
// playhead. The bin item's own marks are never touched (the host applies the range for the one placement and puts the
// bin's back). Pure: no AppKit or AVFoundation, so tools/check-range-pick.swift checks it, and
// native/windows/Core/RangePick.cs and client/palette-range.js port it line for line.
//
// Times are seconds from the start of the file. Marks sit on frames, as in Premiere: Out is the LAST frame kept, so
// the range sent ends one frame after it.

struct RangePick: Equatable {
    /// How long the media is, in seconds.
    let duration: Double
    /// Frames per second the picker steps and shows timecode in: the media's own, else the sequence's, else 30.
    let fps: Double
    private(set) var playhead: Double = 0
    private(set) var markIn: Double? = nil
    /// The last frame kept.
    private(set) var markOut: Double? = nil
    /// Shuttle speed: 0 still, 1 2 4 8 forward (L), -1 -2 -4 -8 back (J).
    private(set) var rate: Double = 0

    static let maxRate: Double = 8

    init(duration: Double, fps: Double) {
        self.duration = duration.isFinite && duration > 0 ? duration : 0
        self.fps = RangePick.usableFps(fps)
    }

    /// The first rate that makes sense of the three a caller may have; 30 when none does.
    static func pickFps(media: Double?, sequence: Double?) -> Double {
        for value in [media, sequence] {
            if let value, value.isFinite, value >= 1, value <= 240 { return value }
        }
        return 30
    }

    private static func usableFps(_ value: Double) -> Double {
        value.isFinite && value >= 1 && value <= 240 ? value : 30
    }

    var frame: Double { 1 / fps }
    /// How many whole frames the media holds (at least one).
    var frameCount: Int { max(1, Int((duration * fps - 1e-6).rounded(.up))) }
    /// When the last frame starts.
    var lastFrame: Double { Double(frameCount - 1) / fps }

    /// The frame `seconds` falls in, inside the media.
    func snapped(_ seconds: Double) -> Double {
        guard seconds.isFinite else { return 0 }
        let index = min(max(0, (seconds * fps + 1e-6).rounded(.down)), Double(frameCount - 1))
        return index / fps
    }

    func frameIndex(_ seconds: Double) -> Int { Int((snapped(seconds) * fps).rounded()) }

    // MARK: Moving

    /// Put the playhead at a time (a click on the scrub bar, or the player's clock while it plays).
    mutating func seek(to seconds: Double) { playhead = snapped(seconds) }

    /// Move by whole frames (arrow keys; Shift moves ten). Stops any shuttle, as Premiere does.
    mutating func step(frames: Int) {
        rate = 0
        playhead = snapped(playhead + Double(frames) / fps + frame / 2)
    }

    mutating func goToStart() { rate = 0; playhead = 0 }
    mutating func goToEnd() { rate = 0; playhead = lastFrame }
    mutating func goToIn() { if let markIn { rate = 0; playhead = markIn } }
    mutating func goToOut() { if let markOut { rate = 0; playhead = markOut } }

    /// L: play forward, and each further press doubles the speed up to 8x. From reverse it goes to 1x forward.
    mutating func shuttleForward() { rate = rate <= 0 ? 1 : min(rate * 2, RangePick.maxRate) }
    /// J: the same, backward.
    mutating func shuttleBackward() { rate = rate >= 0 ? -1 : max(rate * 2, -RangePick.maxRate) }
    /// K: stop.
    mutating func stop() { rate = 0 }
    /// Space: play at 1x, or stop if anything is playing.
    mutating func togglePlay() { rate = rate == 0 ? 1 : 0 }

    /// Where playback stops on its own: the end going forward, the start going back.
    var atBoundary: Bool { (rate > 0 && playhead >= lastFrame) || (rate < 0 && playhead <= 0) }

    // MARK: Marking

    /// I: In here. An Out before it no longer makes a range, so it goes.
    mutating func markInHere() {
        markIn = playhead
        if let markOut, markOut < playhead { self.markOut = nil }
    }

    /// O: Out here (this frame is kept). An In after it goes.
    mutating func markOutHere() {
        markOut = playhead
        if let markIn, markIn > playhead { self.markIn = nil }
    }

    mutating func clearIn() { markIn = nil }
    mutating func clearOut() { markOut = nil }
    mutating func clearMarks() { markIn = nil; markOut = nil }

    /// Marks remembered from an earlier look at the same media, fitted to this one.
    mutating func restore(markIn savedIn: Double?, markOut savedOut: Double?, playhead savedPlayhead: Double?) {
        markIn = savedIn.map(snapped)
        markOut = savedOut.map(snapped)
        if let markIn, let markOut, markOut < markIn { self.markOut = nil }
        playhead = snapped(savedPlayhead ?? markIn ?? 0)
    }

    var hasMarks: Bool { markIn != nil || markOut != nil }

    /// What Enter places, in seconds from the file's start: In (or the start) to one frame after Out (or the end).
    /// nil with no marks: the whole clip, placed exactly as before the picker existed.
    var placeRange: (inSeconds: Double, outSeconds: Double)? {
        guard hasMarks else { return nil }
        let start = markIn ?? 0
        // Never past the media's end: Premiere clamps there, and the host refuses an Out it can't read back.
        let end = min((markOut ?? lastFrame) + frame, duration)
        return (RangePick.rounded(start), RangePick.rounded(end))
    }

    /// How long the marked part is (the whole media with no marks).
    var markedSeconds: Double {
        if let range = placeRange { return range.outSeconds - range.inSeconds }
        return duration
    }

    private static func rounded(_ seconds: Double) -> Double { (seconds * 1_000_000).rounded() / 1_000_000 }

    // MARK: Showing

    /// HH:MM:SS:FF, non-drop, at the picker's frame rate (rounded to a whole timebase: 29.97 counts 30 frames).
    static func timecode(_ seconds: Double, fps: Double) -> String {
        let base = max(1, Int(usableFps(fps).rounded()))
        let frames = max(0, Int((seconds * usableFps(fps) + 1e-6).rounded(.down)))
        let ff = frames % base
        let totalSeconds = frames / base
        return String(format: "%02d:%02d:%02d:%02d", totalSeconds / 3600, (totalSeconds / 60) % 60, totalSeconds % 60, ff)
    }

    /// M:SS.ss for sound, where frames mean little to the editor.
    static func clock(_ seconds: Double) -> String {
        let safe = max(0, seconds.isFinite ? seconds : 0)
        let hundredths = Int((safe * 100).rounded(.down))
        let minutes = hundredths / 6000
        let rest = Double(hundredths % 6000) / 100
        return String(format: "%d:%05.2f", minutes, rest)
    }

    /// A short length for the footer: "4.2s", "1m 05s".
    static func length(_ seconds: Double) -> String {
        let safe = max(0, seconds.isFinite ? seconds : 0)
        if safe < 60 { return String(format: "%.1fs", safe) }
        let whole = Int(safe.rounded())
        return String(format: "%dm %02ds", whole / 60, whole % 60)
    }

    /// 0...1 positions along the scrub bar.
    func fraction(_ seconds: Double) -> Double { duration > 0 ? min(max(seconds / duration, 0), 1) : 0 }
    func seconds(atFraction fraction: Double) -> Double { snapped(min(max(fraction, 0), 1) * duration) }
}
