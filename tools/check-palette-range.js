// Drives client/palette-range.js, the panel palette's In/Out picker, through the same cases as
// tools/check-range-pick.swift (the Swift reference, native/PRFXRangePick.swift). Run:
// node tools/check-palette-range.js
'use strict';
var path = require('path');
var RangePick = require(path.join(__dirname, '..', 'client', 'palette-range.js')).PRFXRangePick;

var failures = 0;

function check(ok, what) {
  console.log((ok ? 'ok    ' : 'FAIL  ') + what);
  if (!ok) failures += 1;
}

function near(a, b) { return a !== null && a !== undefined && Math.abs(a - b) < 1e-6; }
function range(pick) { return pick.placeRange() || {}; }

// Frame rate
check(RangePick.pickFps(25, 30) === 25, "the media's own rate wins");
check(RangePick.pickFps(null, 23.976) === 23.976, "then the sequence's");
check(RangePick.pickFps(0, null) === 30, 'else 30');
check(new RangePick(10, NaN).fps === 30, "a rate that isn't a number becomes 30");

// Frames
var pick = new RangePick(10, 25);
check(pick.frameCount() === 250, '10 s at 25 fps is 250 frames');
check(near(pick.lastFrame(), 9.96), 'the last frame starts one frame before the end');
check(near(pick.snapped(1.019), 1.0), 'a time inside a frame snaps to its start');
check(near(pick.snapped(99), 9.96), 'past the end snaps to the last frame');
check(near(pick.snapped(-3), 0), 'before the start snaps to 0');
check(new RangePick(0.01, 25).frameCount() === 1, 'a sliver of media still has one frame');

// Stepping
pick.step(1);
check(near(pick.playhead, 0.04), '→ steps one frame');
pick.step(10);
check(near(pick.playhead, 0.44), '⇧→ steps ten');
pick.step(-100);
check(near(pick.playhead, 0), 'stepping back stops at the start');
pick.goToEnd();
check(near(pick.playhead, 9.96), 'End goes to the last frame');
pick.step(1);
check(near(pick.playhead, 9.96), 'stepping forward stops at the last frame');
var rates = new RangePick(10, 23.976);
for (var i = 0; i < 1000; i++) rates.step(1);
check(rates.frameIndex(rates.playhead) === 239, 'a thousand single steps at 23.976 land on whole frames, no drift');

// Marking
pick = new RangePick(10, 25);
check(pick.placeRange() === null, 'no marks places the whole clip, as before');
pick.seek(2);
pick.markInHere();
pick.seek(4);
pick.markOutHere();
check(near(range(pick).inSeconds, 2) && near(range(pick).outSeconds, 4.04), 'Out keeps its frame: the range ends one frame after it');
check(near(pick.markedSeconds(), 2.04), 'the marked length counts the Out frame');
pick.seek(5);
pick.markInHere();
check(pick.markOut === null && near(pick.markIn, 5), 'In after Out clears Out');
pick.seek(3);
pick.markOutHere();
check(pick.markIn === null && near(pick.markOut, 3), 'Out before In clears In');
check(near(range(pick).inSeconds, 0) && near(range(pick).outSeconds, 3.04), 'only Out: from the start');
pick.clearMarks();
pick.seek(7);
pick.markInHere();
check(near(range(pick).inSeconds, 7) && near(range(pick).outSeconds, 10), 'only In: to the end of the media');
pick.seek(7);
pick.markOutHere();
check(near(range(pick).outSeconds, 7.04), 'In and Out on one frame places that one frame');
pick.clearIn();
check(pick.markIn === null && pick.markOut !== null, '⌥I clears In alone');
pick.clearOut();
check(!pick.hasMarks() && pick.placeRange() === null, '⌥O clears Out; with neither, the whole clip');

// Uneven end: the last frame is short
var uneven = new RangePick(10.01, 25);
uneven.goToEnd();
uneven.markOutHere();
check(near(range(uneven).outSeconds, 10.01), "Out on a short last frame ends at the media's end, never past it");
check(uneven.frameCount() === 251, 'a part frame at the end counts as a frame');

// Going to marks
pick = new RangePick(10, 25);
pick.seek(1); pick.markInHere(); pick.seek(6); pick.markOutHere(); pick.seek(8);
pick.goToIn();
check(near(pick.playhead, 1), '⇧I goes to In');
pick.goToOut();
check(near(pick.playhead, 6), '⇧O goes to Out');
var bare = new RangePick(10, 25);
bare.seek(3);
bare.goToIn();
check(near(bare.playhead, 3), '⇧I with no In stays put');

// Shuttle
pick = new RangePick(10, 25);
pick.shuttleForward();
check(pick.rate === 1, 'L plays');
pick.shuttleForward(); pick.shuttleForward(); pick.shuttleForward(); pick.shuttleForward();
check(pick.rate === 8, 'more L doubles up to 8x and stays there');
pick.shuttleBackward();
check(pick.rate === -1, 'J from forward plays back at 1x');
pick.shuttleBackward();
check(pick.rate === -2, 'J again doubles back');
pick.stop();
check(pick.rate === 0, 'K stops');
pick.togglePlay();
check(pick.rate === 1, 'Space plays');
pick.togglePlay();
check(pick.rate === 0, 'Space again stops');
pick.shuttleForward();
pick.step(1);
check(pick.rate === 0, 'a frame step stops playback');
pick.goToEnd(); pick.shuttleForward();
check(pick.atBoundary(), 'playing forward at the last frame is at its stop');

// Remembered marks
var again = new RangePick(10, 25);
again.restore(2.01, 1, null);
check(near(again.markIn, 2) && again.markOut === null, 'restored marks snap to frames, and an Out before In is dropped');
check(near(again.playhead, 2), 'a restored pick starts at its In');
again.restore(null, 50, 3);
check(near(again.markOut, 9.96) && near(again.playhead, 3), 'a remembered Out past a shorter file sits on its last frame');

// Showing
check(RangePick.timecode(3723.5, 25) === '01:02:03:12', 'timecode HH:MM:SS:FF');
check(RangePick.timecode(1, 29.97) === '00:00:00:29', '29.97 counts 30 frames a second, non-drop');
check(RangePick.timecode(0, 30) === '00:00:00:00', 'timecode at the start');
check(RangePick.clock(65.257) === '1:05.25', 'sound shows M:SS.ss');
check(RangePick.length(4.24) === '4.2s' && RangePick.length(65) === '1m 05s', 'short lengths for the footer');
check(near(pick.fraction(5), 0.5) && near(pick.secondsAtFraction(0.5), 5), 'scrub bar fractions both ways');

// The JS copy only: a value copy, so the picker can keep a remembered pick apart from the live one.
var original = new RangePick(10, 25);
original.seek(2); original.markInHere();
var copied = original.copy();
copied.clearMarks();
check(near(original.markIn, 2) && copied.markIn === null, 'copy() is a separate pick, as a Swift struct copy is');

console.log(failures === 0 ? '\nAll range pick checks passed.' : '\n' + failures + ' range pick check(s) FAILED.');
process.exit(failures === 0 ? 0 : 1);
