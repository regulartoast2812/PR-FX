import Foundation

// Drives RangePick (native/PRFXRangePick.swift), the palette's In/Out picker, through the cases it must get right. Run:
// swiftc -module-cache-path /tmp/prfx-swift-module-cache native/PRFXRangePick.swift tools/check-range-pick.swift -o /tmp/prfx-check-range-pick && /tmp/prfx-check-range-pick

nonisolated(unsafe) var failures = 0

func check(_ ok: Bool, _ what: String) {
    print((ok ? "ok    " : "FAIL  ") + what)
    if !ok { failures += 1 }
}

func near(_ a: Double?, _ b: Double) -> Bool { a.map { abs($0 - b) < 1e-6 } ?? false }

@main
enum RangePickChecks {
static func main() {
    // Frame rate
    check(RangePick.pickFps(media: 25, sequence: 30) == 25, "the media's own rate wins")
    check(RangePick.pickFps(media: nil, sequence: 23.976) == 23.976, "then the sequence's")
    check(RangePick.pickFps(media: 0, sequence: nil) == 30, "else 30")
    check(RangePick(duration: 10, fps: .nan).fps == 30, "a rate that isn't a number becomes 30")

    // Frames
    var pick = RangePick(duration: 10, fps: 25)
    check(pick.frameCount == 250, "10 s at 25 fps is 250 frames")
    check(near(pick.lastFrame, 9.96), "the last frame starts one frame before the end")
    check(near(pick.snapped(1.019), 1.0), "a time inside a frame snaps to its start")
    check(near(pick.snapped(99), 9.96), "past the end snaps to the last frame")
    check(near(pick.snapped(-3), 0), "before the start snaps to 0")
    check(RangePick(duration: 0.01, fps: 25).frameCount == 1, "a sliver of media still has one frame")

    // Stepping
    pick.step(frames: 1)
    check(near(pick.playhead, 0.04), "→ steps one frame")
    pick.step(frames: 10)
    check(near(pick.playhead, 0.44), "⇧→ steps ten")
    pick.step(frames: -100)
    check(near(pick.playhead, 0), "stepping back stops at the start")
    pick.goToEnd()
    check(near(pick.playhead, 9.96), "End goes to the last frame")
    pick.step(frames: 1)
    check(near(pick.playhead, 9.96), "stepping forward stops at the last frame")
    var rates = RangePick(duration: 10, fps: 23.976)
    for _ in 0..<1000 { rates.step(frames: 1) }
    check(rates.frameIndex(rates.playhead) == 239, "a thousand single steps at 23.976 land on whole frames, no drift")

    // Marking
    pick = RangePick(duration: 10, fps: 25)
    check(pick.placeRange == nil, "no marks places the whole clip, as before")
    pick.seek(to: 2)
    pick.markInHere()
    pick.seek(to: 4)
    pick.markOutHere()
    check(near(pick.placeRange?.inSeconds, 2) && near(pick.placeRange?.outSeconds, 4.04), "Out keeps its frame: the range ends one frame after it")
    check(near(pick.markedSeconds, 2.04), "the marked length counts the Out frame")
    pick.seek(to: 5)
    pick.markInHere()
    check(pick.markOut == nil && near(pick.markIn, 5), "In after Out clears Out")
    pick.seek(to: 3)
    pick.markOutHere()
    check(pick.markIn == nil && near(pick.markOut, 3), "Out before In clears In")
    check(near(pick.placeRange?.inSeconds, 0) && near(pick.placeRange?.outSeconds, 3.04), "only Out: from the start")
    pick.clearMarks()
    pick.seek(to: 7)
    pick.markInHere()
    check(near(pick.placeRange?.inSeconds, 7) && near(pick.placeRange?.outSeconds, 10), "only In: to the end of the media")
    pick.seek(to: 7)
    pick.markOutHere()
    check(near(pick.placeRange?.outSeconds, 7.04), "In and Out on one frame places that one frame")
    pick.clearIn()
    check(pick.markIn == nil && pick.markOut != nil, "⌥I clears In alone")
    pick.clearOut()
    check(!pick.hasMarks && pick.placeRange == nil, "⌥O clears Out; with neither, the whole clip")

    // Uneven end: the last frame is short
    var uneven = RangePick(duration: 10.01, fps: 25)
    uneven.goToEnd()
    uneven.markOutHere()
    check(near(uneven.placeRange?.outSeconds, 10.01), "Out on a short last frame ends at the media's end, never past it")
    check(uneven.frameCount == 251, "a part frame at the end counts as a frame")

    // Going to marks
    pick = RangePick(duration: 10, fps: 25)
    pick.seek(to: 1); pick.markInHere(); pick.seek(to: 6); pick.markOutHere(); pick.seek(to: 8)
    pick.goToIn()
    check(near(pick.playhead, 1), "⇧I goes to In")
    pick.goToOut()
    check(near(pick.playhead, 6), "⇧O goes to Out")
    var bare = RangePick(duration: 10, fps: 25)
    bare.seek(to: 3)
    bare.goToIn()
    check(near(bare.playhead, 3), "⇧I with no In stays put")

    // Shuttle
    pick = RangePick(duration: 10, fps: 25)
    pick.shuttleForward()
    check(pick.rate == 1, "L plays")
    pick.shuttleForward(); pick.shuttleForward(); pick.shuttleForward(); pick.shuttleForward()
    check(pick.rate == 8, "more L doubles up to 8x and stays there")
    pick.shuttleBackward()
    check(pick.rate == -1, "J from forward plays back at 1x")
    pick.shuttleBackward()
    check(pick.rate == -2, "J again doubles back")
    pick.stop()
    check(pick.rate == 0, "K stops")
    pick.togglePlay()
    check(pick.rate == 1, "Space plays")
    pick.togglePlay()
    check(pick.rate == 0, "Space again stops")
    pick.shuttleForward()
    pick.step(frames: 1)
    check(pick.rate == 0, "a frame step stops playback")
    pick.goToEnd(); pick.shuttleForward()
    check(pick.atBoundary, "playing forward at the last frame is at its stop")

    // Remembered marks
    var again = RangePick(duration: 10, fps: 25)
    again.restore(markIn: 2.01, markOut: 1, playhead: nil)
    check(near(again.markIn, 2) && again.markOut == nil, "restored marks snap to frames, and an Out before In is dropped")
    check(near(again.playhead, 2), "a restored pick starts at its In")
    again.restore(markIn: nil, markOut: 50, playhead: 3)
    check(near(again.markOut, 9.96) && near(again.playhead, 3), "a remembered Out past a shorter file sits on its last frame")

    // Showing
    check(RangePick.timecode(3723.5, fps: 25) == "01:02:03:12", "timecode HH:MM:SS:FF")
    check(RangePick.timecode(1, fps: 29.97) == "00:00:00:29", "29.97 counts 30 frames a second, non-drop")
    check(RangePick.timecode(0, fps: 30) == "00:00:00:00", "timecode at the start")
    check(RangePick.clock(65.257) == "1:05.25", "sound shows M:SS.ss")
    check(RangePick.length(4.24) == "4.2s" && RangePick.length(65) == "1m 05s", "short lengths for the footer")
    check(near(pick.fraction(5), 0.5) && near(pick.seconds(atFraction: 0.5), 5), "scrub bar fractions both ways")

    print(failures == 0 ? "\nAll range pick checks passed." : "\n\(failures) range pick check(s) FAILED.")
    exit(failures == 0 ? 0 : 1)
}
}
