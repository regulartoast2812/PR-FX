using System;
using System.Collections.Generic;

namespace PrFxShortcutListener
{
    // Edie's pacing on the Timeline highlight, a port of EdiePace in PRFXTimelineHighlight.swift (2026-11-22, the user:
    // "edie clapper animation is way too fast, it needs to be how we as human do it with correct pacing, none of the
    // animation should be in unrealist speed"). Creative Assist paces his standing sprite the same way (ui/sprite.ts
    // `ediePace`). Every pose is held for a time picked within a range a person would recognise, so nothing ticks like
    // a metronome:
    //   blink    eyes shut 0.11-0.15 s, every 3-6 s at random, one time in five twice (0.14-0.22 s open between).
    //            It used to be one 0.2 s refresh in every twenty, exactly every 4 s.
    //   leg      still for 7-18 s, then one or two swings: out 0.35-0.6 s, still 0.2-0.35 s, back 0.35-0.6 s, still
    //            0.2-0.35 s. It used to be two swings of 0.4 s holds every 11 s exactly.
    //   talking  mouth open 0.17-0.32 s, shut 0.11-0.24 s, for as long as he talks (was 0.25 s each, exactly).
    //   typing   while an AI function works (the user: "when he's working on a long task like this let him type and
    //            look down on a laptop"): bursts of taps, a hand lifted 0.08-0.15 s and down 0.07-0.13 s, pauses of
    //            0.5-2 s looking down at the screen, now and then a glance up (0.45-1 s); never the same move twice
    //            running.
    // With reduced motion (Windows' "Animation effects" off, macOS's Reduce motion) he holds still: eyes open, legs
    // still, typing hands down. Pure logic in seconds, no Windows calls: tools/check-windows-bridge drives it.
    internal sealed class EdiePace
    {
        public enum Hands { Down, Left, Right, Up }

        public struct Pose
        {
            public bool Blink;
            public int Swing;
            public Hands Typing;
            // When (seconds, the same clock as `now`) any of it changes next.
            public double Next;
        }

        private struct Step<T>
        {
            public T Value; public double Seconds; public string? Move;
            public Step(T value, double seconds, string? move = null) { Value = value; Seconds = seconds; Move = move; }
        }

        // One of his poses running through a queue of steps, refilled when it empties.
        private sealed class Track<T>
        {
            private readonly Queue<Step<T>> queue = new Queue<Step<T>>();
            private readonly Func<List<Step<T>>> refill;
            public T Value;
            public double Ends = double.NegativeInfinity;
            public string? LastMove;

            public Track(T start, Func<List<Step<T>>> refill) { Value = start; this.refill = refill; }

            public void Restart(double now, IEnumerable<Step<T>> first)
            {
                queue.Clear();
                foreach (var s in first) queue.Enqueue(s);
                Ends = now;
                LastMove = null;
            }

            public void Advance(double now)
            {
                while (now >= Ends)
                {
                    if (queue.Count == 0)
                    {
                        var steps = refill();
                        if (steps.Count > 0 && steps[0].Move != null) LastMove = steps[0].Move;
                        foreach (var s in steps) queue.Enqueue(s);
                    }
                    var step = queue.Dequeue();
                    Value = step.Value;
                    // Woken late (a sleep, a busy UI thread): this pose starts now rather than racing through the run.
                    Ends = (now - Ends > 0.25 ? now : Ends) + step.Seconds;
                }
            }
        }

        public static readonly double[] BlinkShut = { 0.11, 0.15 }, BlinkEvery = { 3.0, 6.0 }, BlinkApart = { 0.14, 0.22 };
        public const double BlinkTwice = 0.2;
        public static readonly double[] SwingStill = { 7.0, 18.0 }, SwingOut = { 0.35, 0.6 }, SwingPass = { 0.2, 0.35 };
        public static readonly double[] TalkOpen = { 0.17, 0.32 }, TalkShut = { 0.11, 0.24 };
        public static readonly double[] TapUp = { 0.08, 0.15 }, TapDown = { 0.07, 0.13 }, TypePause = { 0.5, 2.0 }, TypeGlance = { 0.45, 1.0 };

        private readonly Func<double> random;
        private readonly Track<bool> blink;
        private readonly Track<int> swing;
        private readonly Track<Hands> typing;
        private bool wasTyping, started;

        public EdiePace(Func<double>? random = null)
        {
            var r = new Random();
            this.random = random ?? (() => r.NextDouble());
            blink = new Track<bool>(false, BlinkRun);
            swing = new Track<int>(0, SwingRun);
            typing = new Track<Hands>(Hands.Down, () => TypingRun(typing!.LastMove));
        }

        private double Pick(double[] range) => range[0] + (range[1] - range[0]) * random();

        private List<Step<bool>> BlinkRun()
        {
            var run = new List<Step<bool>> { new Step<bool>(false, Pick(BlinkEvery)), new Step<bool>(true, Pick(BlinkShut)) };
            if (random() < BlinkTwice) { run.Add(new Step<bool>(false, Pick(BlinkApart))); run.Add(new Step<bool>(true, Pick(BlinkShut))); }
            return run;
        }

        private List<Step<int>> SwingRun()
        {
            var run = new List<Step<int>> { new Step<int>(0, Pick(SwingStill)) };
            var swings = random() < 0.5 ? 1 : 2;
            for (var i = 0; i < swings; i++)
            {
                run.Add(new Step<int>(1, Pick(SwingOut)));
                run.Add(new Step<int>(0, Pick(SwingPass)));
                run.Add(new Step<int>(-1, Pick(SwingOut)));
                run.Add(new Step<int>(0, Pick(SwingPass)));
            }
            return run;
        }

        // His typing moves: (name, weight, how many times over, the beats).
        private static readonly (string Name, double Weight, int[] Repeat, Hands[] Beats)[] TypingMoves =
        {
            ("burst", 4, new[] { 3, 7 }, new[] { Hands.Left, Hands.Down, Hands.Right, Hands.Down }),
            ("pecks", 2, new[] { 1, 2 }, new[] { Hands.Right, Hands.Down }),
            ("quick", 2, new[] { 2, 4 }, new[] { Hands.Left, Hands.Down, Hands.Left, Hands.Down, Hands.Right, Hands.Down }),
            ("glance", 1, new[] { 1, 1 }, new[] { Hands.Up }),
        };

        // One move (a burst first, then any but the last one, by weight) and the pause after it.
        private List<Step<Hands>> TypingRun(string? last)
        {
            var move = TypingMoves[0];
            if (last != null)
            {
                var choices = Array.FindAll(TypingMoves, m => m.Name != last);
                var total = 0.0;
                foreach (var m in choices) total += m.Weight;
                var roll = random() * total;
                move = choices[choices.Length - 1];
                foreach (var m in choices) { roll -= m.Weight; if (roll < 0) { move = m; break; } }
            }
            var times = move.Repeat[0] + (int)Math.Floor(random() * (move.Repeat[1] - move.Repeat[0] + 1));
            var run = new List<Step<Hands>>();
            for (var t = 0; t < times; t++)
                foreach (var hands in move.Beats)
                    run.Add(new Step<Hands>(hands, Pick(hands == Hands.Up ? TypeGlance : hands == Hands.Down ? TapDown : TapUp), run.Count == 0 ? move.Name : null));
            run.Add(new Step<Hands>(Hands.Down, Pick(TypePause)));
            return run;
        }

        // Where he is at `now` (seconds). `typing`: an AI function is working, so he's at his laptop.
        public Pose At(double now, bool motion, bool isTyping)
        {
            if (!motion) { wasTyping = false; started = false; return new Pose { Blink = false, Swing = 0, Typing = Hands.Down, Next = now + 1 }; }
            if (!started)
            {
                started = true;
                blink.Restart(now, new[] { new Step<bool>(false, Pick(BlinkEvery)) });
                swing.Restart(now, new[] { new Step<int>(0, Pick(SwingStill)) });
            }
            if (isTyping && !wasTyping) typing.Restart(now, new[] { new Step<Hands>(Hands.Down, Pick(TypePause)) });
            wasTyping = isTyping;
            blink.Advance(now);
            swing.Advance(now);
            var next = Math.Min(blink.Ends, swing.Ends);
            if (isTyping) { typing.Advance(now); next = Math.Min(next, typing.Ends); }
            return new Pose { Blink = blink.Value, Swing = swing.Value, Typing = isTyping ? typing.Value : Hands.Down, Next = next };
        }

        // His mouth while he talks: open and shut in turn, each for its own time, enough to cover `length` seconds.
        public static double[] TalkBeats(Func<double> random, double length)
        {
            var beats = new List<double>();
            var total = 0.0;
            while (total < length)
            {
                var range = beats.Count % 2 == 0 ? TalkOpen : TalkShut;
                var beat = range[0] + (range[1] - range[0]) * random();
                beats.Add(beat);
                total += beat;
            }
            return beats.ToArray();
        }

        // Open (`true`) or shut `elapsed` seconds into his talking.
        public static bool TalkMouthOpen(double[] beats, double elapsed)
        {
            var at = 0.0;
            for (var i = 0; i < beats.Length; i++) { at += beats[i]; if (elapsed < at) return i % 2 == 0; }
            return false;
        }
    }
}
