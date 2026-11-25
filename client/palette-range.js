/* The palette's In/Out picker (2026-11-25, the user: "for the media placing from ctrl space let's build the
   infrastructure for in-out point selection before placing bcuz that's 95% of the time"). A line-for-line port of
   native/PRFXRangePick.swift (checked by tools/check-range-pick.swift; this copy by tools/check-palette-range.js) for
   the panel's own #palette; native/windows/Core/RangePick.cs is the third copy. Change all three together.
   Pure: no DOM, so node checks it. Times are seconds from the start of the file. Marks sit on frames, as in Premiere:
   Out is the LAST frame kept, so the range sent ends one frame after it. Swift's struct is a value type; this is a
   plain object the picker owns, and `copy()` stands in where a value copy is wanted. */
(function (root) {
  'use strict';
  var MAX_RATE = 8;

  function isFiniteNumber(value) { return typeof value === 'number' && isFinite(value); }
  // Swift's .rounded() (to nearest, ties away from zero); Math.round ties toward +infinity.
  function roundHalfAway(value) { return value < 0 ? -Math.round(-value) : Math.round(value); }

  function usableFps(value) {
    return isFiniteNumber(value) && value >= 1 && value <= 240 ? value : 30;
  }

  /** The first rate that makes sense of the three a caller may have; 30 when none does. */
  function pickFps(media, sequence) {
    var values = [media, sequence];
    for (var i = 0; i < values.length; i++) {
      var value = values[i];
      if (isFiniteNumber(value) && value >= 1 && value <= 240) return value;
    }
    return 30;
  }

  function RangePick(duration, fps) {
    /** How long the media is, in seconds. */
    this.duration = isFiniteNumber(duration) && duration > 0 ? duration : 0;
    /** Frames per second the picker steps and shows timecode in: the media's own, else the sequence's, else 30. */
    this.fps = usableFps(fps);
    this.playhead = 0;
    this.markIn = null;
    /** The last frame kept. */
    this.markOut = null;
    /** Shuttle speed: 0 still, 1 2 4 8 forward (L), -1 -2 -4 -8 back (J). */
    this.rate = 0;
  }

  var P = RangePick.prototype;

  P.copy = function () {
    var other = new RangePick(this.duration, this.fps);
    other.playhead = this.playhead; other.markIn = this.markIn; other.markOut = this.markOut; other.rate = this.rate;
    return other;
  };

  P.frame = function () { return 1 / this.fps; };
  /** How many whole frames the media holds (at least one). */
  P.frameCount = function () { return Math.max(1, Math.ceil(this.duration * this.fps - 1e-6)); };
  /** When the last frame starts. */
  P.lastFrame = function () { return (this.frameCount() - 1) / this.fps; };

  /** The frame `seconds` falls in, inside the media. */
  P.snapped = function (seconds) {
    if (!isFiniteNumber(seconds)) return 0;
    var index = Math.min(Math.max(0, Math.floor(seconds * this.fps + 1e-6)), this.frameCount() - 1);
    return index / this.fps;
  };

  P.frameIndex = function (seconds) { return roundHalfAway(this.snapped(seconds) * this.fps); };

  // MARK: Moving

  /** Put the playhead at a time (a click on the scrub bar, or the player's clock while it plays). */
  P.seek = function (seconds) { this.playhead = this.snapped(seconds); };

  /** Move by whole frames (arrow keys; Shift moves ten). Stops any shuttle, as Premiere does. */
  P.step = function (frames) {
    this.rate = 0;
    this.playhead = this.snapped(this.playhead + frames / this.fps + this.frame() / 2);
  };

  P.goToStart = function () { this.rate = 0; this.playhead = 0; };
  P.goToEnd = function () { this.rate = 0; this.playhead = this.lastFrame(); };
  P.goToIn = function () { if (this.markIn !== null) { this.rate = 0; this.playhead = this.markIn; } };
  P.goToOut = function () { if (this.markOut !== null) { this.rate = 0; this.playhead = this.markOut; } };

  /** L: play forward, and each further press doubles the speed up to 8x. From reverse it goes to 1x forward. */
  P.shuttleForward = function () { this.rate = this.rate <= 0 ? 1 : Math.min(this.rate * 2, MAX_RATE); };
  /** J: the same, backward. */
  P.shuttleBackward = function () { this.rate = this.rate >= 0 ? -1 : Math.max(this.rate * 2, -MAX_RATE); };
  /** K: stop. */
  P.stop = function () { this.rate = 0; };
  /** Space: play at 1x, or stop if anything is playing. */
  P.togglePlay = function () { this.rate = this.rate === 0 ? 1 : 0; };

  /** Where playback stops on its own: the end going forward, the start going back. */
  P.atBoundary = function () { return (this.rate > 0 && this.playhead >= this.lastFrame()) || (this.rate < 0 && this.playhead <= 0); };

  // MARK: Marking

  /** I: In here. An Out before it no longer makes a range, so it goes. */
  P.markInHere = function () {
    this.markIn = this.playhead;
    if (this.markOut !== null && this.markOut < this.playhead) this.markOut = null;
  };

  /** O: Out here (this frame is kept). An In after it goes. */
  P.markOutHere = function () {
    this.markOut = this.playhead;
    if (this.markIn !== null && this.markIn > this.playhead) this.markIn = null;
  };

  P.clearIn = function () { this.markIn = null; };
  P.clearOut = function () { this.markOut = null; };
  P.clearMarks = function () { this.markIn = null; this.markOut = null; };

  /** Marks remembered from an earlier look at the same media, fitted to this one. */
  P.restore = function (savedIn, savedOut, savedPlayhead) {
    this.markIn = savedIn === null || savedIn === undefined ? null : this.snapped(savedIn);
    this.markOut = savedOut === null || savedOut === undefined ? null : this.snapped(savedOut);
    if (this.markIn !== null && this.markOut !== null && this.markOut < this.markIn) this.markOut = null;
    var at = savedPlayhead !== null && savedPlayhead !== undefined ? savedPlayhead : this.markIn !== null ? this.markIn : 0;
    this.playhead = this.snapped(at);
  };

  P.hasMarks = function () { return this.markIn !== null || this.markOut !== null; };

  /** What Enter places, in seconds from the file's start: In (or the start) to one frame after Out (or the end).
      null with no marks: the whole clip, placed exactly as before the picker existed. */
  P.placeRange = function () {
    if (!this.hasMarks()) return null;
    var start = this.markIn !== null ? this.markIn : 0;
    // Never past the media's end: Premiere clamps there, and the host refuses an Out it can't read back.
    var end = Math.min((this.markOut !== null ? this.markOut : this.lastFrame()) + this.frame(), this.duration);
    return { inSeconds: rounded(start), outSeconds: rounded(end) };
  };

  /** How long the marked part is (the whole media with no marks). */
  P.markedSeconds = function () {
    var range = this.placeRange();
    if (range) return range.outSeconds - range.inSeconds;
    return this.duration;
  };

  function rounded(seconds) { return roundHalfAway(seconds * 1000000) / 1000000; }

  // MARK: Showing

  function pad(value, width) { value = String(value); while (value.length < width) value = '0' + value; return value; }

  /** HH:MM:SS:FF, non-drop, at the picker's frame rate (rounded to a whole timebase: 29.97 counts 30 frames). */
  function timecode(seconds, fps) {
    var base = Math.max(1, roundHalfAway(usableFps(fps)));
    // Swift traps on Int(NaN); here a time that isn't a number shows the start.
    var frames = isFiniteNumber(seconds) ? Math.max(0, Math.floor(seconds * usableFps(fps) + 1e-6)) : 0;
    var ff = frames % base;
    var totalSeconds = Math.floor(frames / base);
    return pad(Math.floor(totalSeconds / 3600), 2) + ':' + pad(Math.floor(totalSeconds / 60) % 60, 2) + ':' + pad(totalSeconds % 60, 2) + ':' + pad(ff, 2);
  }

  /** M:SS.ss for sound, where frames mean little to the editor. */
  function clock(seconds) {
    var safe = Math.max(0, isFiniteNumber(seconds) ? seconds : 0);
    var hundredths = Math.floor(safe * 100);
    var minutes = Math.floor(hundredths / 6000);
    var rest = (hundredths % 6000) / 100;
    return minutes + ':' + pad(rest.toFixed(2), 5);
  }

  /** A short length for the footer: "4.2s", "1m 05s". */
  function length(seconds) {
    var safe = Math.max(0, isFiniteNumber(seconds) ? seconds : 0);
    if (safe < 60) return safe.toFixed(1) + 's';
    var whole = roundHalfAway(safe);
    return Math.floor(whole / 60) + 'm ' + pad(whole % 60, 2) + 's';
  }

  /** 0...1 positions along the scrub bar. */
  P.fraction = function (seconds) { return this.duration > 0 ? Math.min(Math.max(seconds / this.duration, 0), 1) : 0; };
  P.secondsAtFraction = function (fraction) { return this.snapped(Math.min(Math.max(fraction, 0), 1) * this.duration); };

  RangePick.maxRate = MAX_RATE;
  RangePick.pickFps = pickFps;
  RangePick.timecode = timecode;
  RangePick.clock = clock;
  // A function's own `length` is read-only, so Swift's static `length` is defined over it.
  Object.defineProperty(RangePick, 'length', { value: length });

  root.PRFXRangePick = RangePick;
}(typeof window !== 'undefined' ? window : this));
