using System;

namespace PrFxShortcutListener
{
    // Edie's nudges, a port of EdieNudges in PRFXEdieNudges.swift (2026-11-21). When the editor has gone quiet in
    // Premiere for a while, Edie says one short line in a speech bubble beside him on the Timeline highlight.
    //
    //   still there   no input at all for NudgeAfter (default 2 min) while Premiere is in front with the highlight
    //                 drawn. Once per quiet stretch; gone at the next input or after 9 s.
    //   welcome back  input resumes after AwayAfter or more of nothing (5 min, or 2.5x NudgeAfter if longer). Shown
    //                 within 4 s of the return, as soon as Premiere is in front again; 6 s.
    //
    // Pure logic, no Windows calls: tools/check-windows-bridge drives it on any OS.
    internal sealed class EdieNudges
    {
        public enum Kind { StillThere, WelcomeBack }

        public sealed class Line
        {
            public Kind Kind;
            public string Title = "";
            public string Detail = "";
        }

        public double NudgeAfter = 120;
        public double AwayAfter => Math.Max(300, NudgeAfter * 2.5);
        public const double WelcomeWindow = 4;

        private double lastIdle;
        private bool nudged;
        private double? pendingAway, pendingUntil;
        private int said;

        // Called five times a second. `idle` is seconds since any input; `eligible` is: setting on, Premiere in
        // front, the highlight drawn, palette closed. `lastName`/`lastAt` is the last command run (null if none).
        // Returns whether input arrived since the previous call and, at most once per quiet stretch, a line to say.
        public Line? Tick(double idle, bool eligible, double now, string? lastName, double lastAt, out bool resumed)
        {
            resumed = idle < lastIdle;
            if (resumed)
            {
                if (lastIdle >= AwayAfter) { pendingAway = lastIdle; pendingUntil = now + WelcomeWindow; }
                nudged = false;
            }
            lastIdle = idle;
            if (pendingAway is double away && pendingUntil is double until)
            {
                if (now > until) { pendingAway = pendingUntil = null; }
                else if (eligible)
                {
                    pendingAway = pendingUntil = null;
                    // A command run while away (from the chat, say) is still "where we were".
                    return Make(Kind.WelcomeBack, WelcomeLine(away, lastName, lastAt, now));
                }
            }
            // Not into an empty room: past AwayAfter the welcome does the job.
            if (!nudged && eligible && idle >= NudgeAfter && idle < AwayAfter)
            {
                nudged = true;
                return Make(Kind.StillThere, StillThereLine(lastName, lastAt, now));
            }
            return null;
        }

        private static Line Make(Kind kind, (string, string) line) => new Line { Kind = kind, Title = line.Item1, Detail = line.Item2 };

        private (string, string) Pick(params (string, string)[] lines) => lines[said++ % lines.Length];

        // With a command to go on he names it; without one, a plain line. Each set rotates.
        private (string, string) StillThereLine(string? lastName, double lastAt, double now)
        {
            if (lastName != null && now - lastAt < 4 * 3600)
            {
                var name = Short(lastName);
                return Pick(("Still with me?", "We left off at " + name + "."),
                            ("Lost in thought?", "Last thing was " + name + "."),
                            ("Take your time.", name + " was " + Span(now - lastAt) + " ago."));
            }
            return Pick(("Still with me?", "Take your time."),
                        ("Lost in thought?", "I’m right here."),
                        ("Quiet a while.", "Ready to pick it back up?"));
        }

        private (string, string) WelcomeLine(double away, string? lastName, double lastAt, double now)
        {
            if (lastName != null && now - lastAt < 12 * 3600)
            {
                var name = Short(lastName);
                return Pick(("Welcome back!", "You were on " + name + "."),
                            ("You’re back!", "Last thing was " + name + ", " + Span(now - lastAt) + " ago."));
            }
            return Pick(("Welcome back!", "You were away " + Span(away) + "."),
                        ("Hey, you’re back.", "Ready when you are."));
        }

        public static string Span(double seconds)
        {
            var minutes = Math.Max(1, (int)Math.Round(seconds / 60, MidpointRounding.AwayFromZero));
            if (minutes < 60) return minutes + " min";
            int hours = minutes / 60, rest = minutes % 60;
            return rest == 0 ? hours + " hr" : hours + " hr " + rest + " min";
        }

        public static string Short(string name) => name.Length <= 30 ? name : name.Substring(0, 29).Trim() + "…";
    }
}
