using System;
using System.Globalization;

namespace PrFxShortcutListener
{
    // The palette's In/Out picker (2026-11-25, the user: "for the media placing from ctrl space let's build the
    // infrastructure for in-out point selection before placing bcuz that's 95% of the time"). Enter on a video or a sound
    // in the palette opens a small player; the editor scrubs, marks In and Out, and Enter places only that part at the
    // playhead. The bin item's own marks are never touched (the host applies the range for the one placement and puts the
    // bin's back). A line-for-line port of native/PRFXRangePick.swift: change both together. Pure (no WinForms or WPF), so
    // tools/check-windows-bridge checks it on macOS with the same cases as tools/check-range-pick.swift.
    //
    // Times are seconds from the start of the file. Marks sit on frames, as in Premiere: Out is the LAST frame kept, so
    // the range sent ends one frame after it.
    //
    // Rounding follows Swift's: .rounded() is half away from zero (never Math.Round's default banker's rounding),
    // .rounded(.up) is Ceiling, .rounded(.down) is Floor.
    internal struct RangePick : IEquatable<RangePick>
    {
        /// How long the media is, in seconds.
        public readonly double Duration;
        /// Frames per second the picker steps and shows timecode in: the media's own, else the sequence's, else 30.
        public readonly double Fps;
        public double Playhead { get; private set; }
        public double? MarkIn { get; private set; }
        /// The last frame kept.
        public double? MarkOut { get; private set; }
        /// Shuttle speed: 0 still, 1 2 4 8 forward (L), -1 -2 -4 -8 back (J).
        public double Rate { get; private set; }

        public const double MaxRate = 8;

        public RangePick(double duration, double fps)
        {
            Duration = IsFinite(duration) && duration > 0 ? duration : 0;
            Fps = UsableFps(fps);
            Playhead = 0;
            MarkIn = null;
            MarkOut = null;
            Rate = 0;
        }

        private static bool IsFinite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
        private static double Rounded(double value) => Math.Round(value, MidpointRounding.AwayFromZero);

        /// The first rate that makes sense of the three a caller may have; 30 when none does.
        public static double PickFps(double? media, double? sequence)
        {
            foreach (var value in new[] { media, sequence })
            {
                if (value.HasValue && IsFinite(value.Value) && value.Value >= 1 && value.Value <= 240) return value.Value;
            }
            return 30;
        }

        private static double UsableFps(double value) =>
            IsFinite(value) && value >= 1 && value <= 240 ? value : 30;

        public double Frame => 1 / Fps;
        /// How many whole frames the media holds (at least one).
        public int FrameCount => Math.Max(1, (int)Math.Ceiling(Duration * Fps - 1e-6));
        /// When the last frame starts.
        public double LastFrame => (double)(FrameCount - 1) / Fps;

        /// The frame `seconds` falls in, inside the media.
        public double Snapped(double seconds)
        {
            if (!IsFinite(seconds)) return 0;
            var index = Math.Min(Math.Max(0, Math.Floor(seconds * Fps + 1e-6)), (double)(FrameCount - 1));
            return index / Fps;
        }

        public int FrameIndex(double seconds) => (int)Rounded(Snapped(seconds) * Fps);

        // ---- Moving

        /// Put the playhead at a time (a click on the scrub bar, or the player's clock while it plays).
        public void Seek(double seconds) { Playhead = Snapped(seconds); }

        /// Move by whole frames (arrow keys; Shift moves ten). Stops any shuttle, as Premiere does.
        public void Step(int frames)
        {
            Rate = 0;
            Playhead = Snapped(Playhead + (double)frames / Fps + Frame / 2);
        }

        public void GoToStart() { Rate = 0; Playhead = 0; }
        public void GoToEnd() { Rate = 0; Playhead = LastFrame; }
        public void GoToIn() { if (MarkIn is double markIn) { Rate = 0; Playhead = markIn; } }
        public void GoToOut() { if (MarkOut is double markOut) { Rate = 0; Playhead = markOut; } }

        /// L: play forward, and each further press doubles the speed up to 8x. From reverse it goes to 1x forward.
        public void ShuttleForward() { Rate = Rate <= 0 ? 1 : Math.Min(Rate * 2, MaxRate); }
        /// J: the same, backward.
        public void ShuttleBackward() { Rate = Rate >= 0 ? -1 : Math.Max(Rate * 2, -MaxRate); }
        /// K: stop.
        public void Stop() { Rate = 0; }
        /// Space: play at 1x, or stop if anything is playing.
        public void TogglePlay() { Rate = Rate == 0 ? 1 : 0; }

        /// Where playback stops on its own: the end going forward, the start going back.
        public bool AtBoundary => (Rate > 0 && Playhead >= LastFrame) || (Rate < 0 && Playhead <= 0);

        // ---- Marking

        /// I: In here. An Out before it no longer makes a range, so it goes.
        public void MarkInHere()
        {
            MarkIn = Playhead;
            if (MarkOut is double markOut && markOut < Playhead) MarkOut = null;
        }

        /// O: Out here (this frame is kept). An In after it goes.
        public void MarkOutHere()
        {
            MarkOut = Playhead;
            if (MarkIn is double markIn && markIn > Playhead) MarkIn = null;
        }

        public void ClearIn() { MarkIn = null; }
        public void ClearOut() { MarkOut = null; }
        public void ClearMarks() { MarkIn = null; MarkOut = null; }

        /// Marks remembered from an earlier look at the same media, fitted to this one.
        public void Restore(double? savedIn, double? savedOut, double? savedPlayhead)
        {
            MarkIn = savedIn.HasValue ? Snapped(savedIn.Value) : (double?)null;
            MarkOut = savedOut.HasValue ? Snapped(savedOut.Value) : (double?)null;
            if (MarkIn is double markIn && MarkOut is double markOut && markOut < markIn) MarkOut = null;
            Playhead = Snapped(savedPlayhead ?? MarkIn ?? 0);
        }

        public bool HasMarks => MarkIn != null || MarkOut != null;

        /// What Enter places, in seconds from the file's start: In (or the start) to one frame after Out (or the end).
        /// null with no marks: the whole clip, placed exactly as before the picker existed.
        public (double InSeconds, double OutSeconds)? PlaceRange
        {
            get
            {
                if (!HasMarks) return null;
                var start = MarkIn ?? 0;
                // Never past the media's end: Premiere clamps there, and the host refuses an Out it can't read back.
                var end = Math.Min((MarkOut ?? LastFrame) + Frame, Duration);
                return (RoundedSeconds(start), RoundedSeconds(end));
            }
        }

        /// How long the marked part is (the whole media with no marks).
        public double MarkedSeconds
        {
            get
            {
                if (PlaceRange is (double, double) range) return range.OutSeconds - range.InSeconds;
                return Duration;
            }
        }

        private static double RoundedSeconds(double seconds) => Rounded(seconds * 1_000_000) / 1_000_000;

        // ---- Showing

        /// HH:MM:SS:FF, non-drop, at the picker's frame rate (rounded to a whole timebase: 29.97 counts 30 frames).
        public static string Timecode(double seconds, double fps)
        {
            var bas = Math.Max(1, (int)Rounded(UsableFps(fps)));
            var frames = Math.Max(0, (int)Math.Floor(seconds * UsableFps(fps) + 1e-6));
            var ff = frames % bas;
            var totalSeconds = frames / bas;
            return string.Format(CultureInfo.InvariantCulture, "{0:D2}:{1:D2}:{2:D2}:{3:D2}", totalSeconds / 3600, (totalSeconds / 60) % 60, totalSeconds % 60, ff);
        }

        /// M:SS.ss for sound, where frames mean little to the editor.
        public static string Clock(double seconds)
        {
            var safe = Math.Max(0, IsFinite(seconds) ? seconds : 0);
            var hundredths = (int)Math.Floor(safe * 100);
            var minutes = hundredths / 6000;
            var rest = (double)(hundredths % 6000) / 100;
            return minutes.ToString(CultureInfo.InvariantCulture) + ":" + rest.ToString("00.00", CultureInfo.InvariantCulture);
        }

        /// A short length for the footer: "4.2s", "1m 05s".
        public static string Length(double seconds)
        {
            var safe = Math.Max(0, IsFinite(seconds) ? seconds : 0);
            if (safe < 60) return safe.ToString("F1", CultureInfo.InvariantCulture) + "s";
            var whole = (int)Rounded(safe);
            return string.Format(CultureInfo.InvariantCulture, "{0}m {1:D2}s", whole / 60, whole % 60);
        }

        /// 0...1 positions along the scrub bar.
        public double Fraction(double seconds) => Duration > 0 ? Math.Min(Math.Max(seconds / Duration, 0), 1) : 0;
        public double Seconds(double atFraction) => Snapped(Math.Min(Math.Max(atFraction, 0), 1) * Duration);

        public bool Equals(RangePick other) =>
            Duration.Equals(other.Duration) && Fps.Equals(other.Fps) && Playhead.Equals(other.Playhead) &&
            Nullable.Equals(MarkIn, other.MarkIn) && Nullable.Equals(MarkOut, other.MarkOut) && Rate.Equals(other.Rate);
        public override bool Equals(object? obj) => obj is RangePick other && Equals(other);
        public override int GetHashCode() => Duration.GetHashCode() ^ (Fps.GetHashCode() * 397) ^ Playhead.GetHashCode();
        public static bool operator ==(RangePick a, RangePick b) => a.Equals(b);
        public static bool operator !=(RangePick a, RangePick b) => !a.Equals(b);
    }
}
