using System;
using System.Linq;
using PrFxShortcutListener;

// Windows-only checks (2026-11-21): Edie's sprite as the macOS EdieSprite draws him, and the Timeline playhead
// detector. Exit code 0 = all passed.
internal static class Check
{
    private static int failures;

    private static void Expect(bool condition, string label)
    {
        Console.WriteLine((condition ? "ok   " : "FAIL ") + label);
        if (!condition) failures++;
    }

    // EdieSprite.face(.rest, right: true): facing right with his clapperboard ahead of him (2026-11-22), his tiny arms
    // with round hands (2026-11-22), as Creative Assist's sprite.ts draws his rest frame.
    private static readonly string[] FacingRight =
    {
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "...............y................",
        "............yyyy................",
        "......y..yYyyyy.................",
        ".......yyyyyyyyyyyyyyyy.........",
        "......yYyYyyYYyyyyyyy...........",
        "......YYyYYYyyyyyy..............",
        ".....yYYYyYYYYyyYO............WW",
        "....OYYYYyYYYYYYyyYO..........WW",
        "....YYYYYyYYYYYYYYyY......WWBB..",
        "..OOYYOOYYYYOOYYYYYYYY....WWBB..",
        "..OOOOOOYYYYOOOOOOOYYYY.WWBB....",
        "..OOOOOOOOOOOOOOOOOOOO..WWBB....",
        "..OOOOOOOOOOOOOOOOOOOOWWBB......",
        "..OOOOOOOgKKOOOOgKKOOOWWBB......",
        "..OOOOOOOKKKOOOOKKKOOOBBBBBBBBBB",
        "..OOPOPOPKKKOOOOKKKPOPBBBBBBBBBB",
        "..OOPOPOPOOOOOOOOPOPOPBBWWWWWWBB",
        ".DDOPOPOPOOmOOOOmPOPOPBBWWWWWWBB",
        "DDDDOOOOOOOmmmmmmOOOOOBBBBBBBBBB",
        "DDDDOOOOOOOOmmmmOOOOOODDBBBBBBBB",
        ".DDOOOOOOOOOOOOOOOOOODDDDWWWBBBB",
        "....OOOOOOOOOOOOOOOO.DDDDWWWBBBB",
        "....OOOOOOOOOOOOOOOO..DDBBBBBBBB",
        "......OOOOOOOOOOOO....BBBBBBBBBB",
        "......DDD......DDD..............",
        "......DDD......DDD..............",
    };

    // EdieSprite.face(.typeDown, right: true): at his laptop, looking down at it, his clapperboard aside (2026-11-22), the
    // laptop twice as big (2026-11-23) and seen three-quarters from behind (2026-11-26: its near edge on the side he faces,
    // the base and keys sticking out past its far edge), the frame 36 rows: Creative Assist's working frame 5 with the 4
    // empty rows it moves from above his leaf to under his feet put back on top.
    private static readonly string[] TypingRight =
    {
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "...............y................",
        "............yyyy................",
        "......y..yYyyyy.................",
        ".......yyyyyyyyyyyyyyyy.........",
        "......yYyYyyYYyyyyyyy...........",
        "......YYyYYYyyyyyy..............",
        ".....yYYYyYYYYyyYO............WW",
        "....OYYYYyYYYYYYyyYO..........WW",
        "....YYYYYyYYYYYYYYyY......WWBB..",
        "..OOYYOOYYYYOOYYYYYYYY....WWBB..",
        "..OOOOOOYYYYOOOOOOOYYYY.WWBB....",
        "..OOOOOOOOOOOOOOOOOOOO..WWBB....",
        "..OOOOOOOOOOOOOOOOOOOOWWBB......",
        "..OOOOOOOOOOOOOOOOOOOOWWBB......",
        "..OOOOOOOKKKOOOOKKKOOOBBBBBBBBBB",
        "..OOPOPOPKKKOOOOKKKPOPBBBBBBBBBB",
        "..OOPOPOPOOOOOOOOPLLEPBBWWWWWWBB",
        "..OOPOPOPOOLLLLLLLLLEPBBWWWWWWBB",
        "..OOOOOOLLLLLLLLLLLLEOBBBBBBBBBB",
        "..OOOLLLLLLLLLLLLLLLEEBBBBBBBBBB",
        "..OOOLLLLLLLLLLLLLLLLEBBWWWWBBBB",
        "....OLLLLLLLHHLLLLLLLEBBWWWWBBBB",
        "....OLLLLLLLHHLLLLLLLEBBBBBBBBBB",
        ".....LLLLLLLLLLLLLLLLDDBBBBBBBBB",
        ".DD..LLLLLLLLLLLLLLLDDDD........",
        "DDDDALLLLLLLLLLLLLLLLDD.........",
        ".DDkkLLLLLLLLLLLLLLLLE..........",
        "AkkkkLLLLLLLLLLLLLLLLE..........",
        "AAAAAEEEEEEEEEEEEEEEEE..........",
        ".AkAk...........................",
    };

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "--stand-in-premiere") return LiveFocus.StandInMain(args);
        // ---- Edie
        var right = EdieSprite.Face(EdieSprite.Mood.Rest, right: true);
        var mismatch = Enumerable.Range(0, Math.Max(right.Length, FacingRight.Length)).FirstOrDefault(i => i >= right.Length || i >= FacingRight.Length || right[i] != FacingRight[i]);
        Expect(right.SequenceEqual(FacingRight), "edie: facing right, his clapperboard ahead of him, as the macOS sprite and Creative Assist draw him" + (right.SequenceEqual(FacingRight) ? "" : " (first difference at row " + mismatch + ")"));
        var left = EdieSprite.Face(EdieSprite.Mood.Rest);
        Expect(left.SequenceEqual(FacingRight.Select(r => new string(r.Reverse().ToArray()))), "edie: facing left, the same mirrored: his clapperboard ahead of him on the left");
        Expect(EdieSprite.Sitting(EdieSprite.Mood.Rest).Skip(EdieSprite.Crown + 12).Take(8).All(r => r.Substring(22).IndexOfAny(new[] { 'B', 'W' }) >= 0), "edie: sitting on the Timeline he keeps it behind him (on the right, facing left)");
        var sitting = EdieSprite.Sitting(EdieSprite.Mood.Rest);
        Expect(sitting.Length == EdieSprite.Crown + 26 && sitting.All(r => r.Length == 32), "edie: sitting is 34 fine rows of 32 (leaf, body, legs over the line)");
        Expect(sitting[EdieSprite.Crown + 22].Contains('D') && sitting[EdieSprite.Crown + 25].Contains('D'), "edie: his legs hang over the line");
        Expect(!EdieSprite.Sitting(EdieSprite.Mood.Rest, 1).SequenceEqual(sitting) && EdieSprite.Sitting(EdieSprite.Mood.Rest, 0).SequenceEqual(sitting), "edie: a swing moves his leg, still doesn't");
        Expect(EdieSprite.Face(EdieSprite.Mood.TypeDown, right: true).SequenceEqual(TypingRight), "edie: at his laptop as Creative Assist draws him (working frame 5)");
        Expect(!EdieSprite.Face(EdieSprite.Mood.TypeLeft, right: true).SequenceEqual(TypingRight) && !EdieSprite.Face(EdieSprite.Mood.TypeRight, right: true).SequenceEqual(TypingRight), "edie: a tap lifts a hand");
        int HandPixels(string[] rows, int fromCol, int toCol) => rows.Take(EdieSprite.Crown + 22).Sum(r => r.Substring(fromCol, toCol - fromCol + 1).Count(c => c == 'D'));
        Expect(HandPixels(sitting, 0, 3) == 12 && HandPixels(sitting, 21, 24) == 12, "edie: sitting, a round hand on each side (12 fine pixels each)");
        var typingSit = EdieSprite.Sitting(EdieSprite.Mood.TypeDown);
        Expect(typingSit.Any(r => r.Contains("LLLLLLLLLL")) && typingSit.Skip(EdieSprite.Crown + 12).Take(10).All(r => r.Substring(22).IndexOfAny(new[] { 'B', 'W' }) >= 0), "edie: typing on the Timeline, a laptop in front of him, the clapperboard still behind him");
        Expect(typingSit.All(r => r.Substring(22).IndexOf('O') < 0) && typingSit.Take(EdieSprite.Crown + 18).All(r => r.Substring(22).IndexOf('D') < 0), "edie: typing, no hand on the clapperboard");
        foreach (EdieSprite.Mood mood in Enum.GetValues(typeof(EdieSprite.Mood)))
            Expect(EdieSprite.Sitting(mood).Length == (mood.ToString().StartsWith("Type") ? EdieSprite.TypingRows : 34), "edie: " + mood + " draws");
        Expect(typingSit[EdieSprite.Crown + 17].Substring(2, 2) == "EE" && typingSit[EdieSprite.Crown + 27].Substring(19, 4) == "kAkA", "edie: typing on the Timeline, the laptop turned the other way (he faces left): near edge on the left, its keys sticking out on the right");
        Expect(!EdieSprite.Sitting(EdieSprite.Mood.Grin).SequenceEqual(sitting) && !EdieSprite.Sitting(EdieSprite.Mood.Sleepy).SequenceEqual(sitting), "edie: grin and sleepy differ from rest");

        // ---- the playhead detector, on drawn panels (BGRA)
        const int w = 200, h = 120, stride = w * 4;
        byte[] Panel()
        {
            var px = new byte[stride * h];
            for (var i = 0; i < px.Length; i += 4) { px[i] = 29; px[i + 1] = 29; px[i + 2] = 29; px[i + 3] = 255; }
            return px;
        }
        void Paint(byte[] px, int x0, int y0, int x1, int y1, byte r, byte g, byte b)
        {
            for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) { var i = y * stride + x * 4; px[i] = b; px[i + 1] = g; px[i + 2] = r; }
        }
        var timeline = Panel();
        Paint(timeline, 60, 10, 160, 40, 120, 160, 210);   // a clip
        Paint(timeline, 90, 8, 91, 104, 64, 150, 243);     // the playhead, over the clip
        Expect(TimelinePanel.LongestBlueRun(timeline, stride, w, h) / (double)h >= 0.4, "timeline: a playhead running down the panel is found");
        var program = Panel();
        Paint(program, 90, 100, 92, 110, 64, 150, 243);    // the Program monitor's small playhead marker
        Paint(program, 10, 20, 190, 100, 120, 160, 210);   // and a big blue picture
        Expect(TimelinePanel.LongestBlueRun(program, stride, w, h) / (double)h < 0.4, "timeline: a short marker and clip-blue areas are not a playhead");

        // ---- the Timeline by its look (the drawn panels from tools/check-panel-pixels.swift), at 100% and 150%:
        // blue time top-left, ruler, yellow work-area bar, V1 and A1. Program: a ruler on top and its blue time at
        // the bottom, one sign. An empty panel: none.
        foreach (var scale in new[] { 1.0, 1.5 })
        {
            int S(double v) => (int)Math.Round(v * scale);
            int pw = S(500), ph = S(600), ps = pw * 4;
            byte[] Blank()
            {
                var px = new byte[ps * ph];
                for (var i = 0; i < px.Length; i += 4) { px[i] = 29; px[i + 1] = 29; px[i + 2] = 29; px[i + 3] = 255; }
                return px;
            }
            void Fill(byte[] px, double x0, double y0, double x1, double y1, byte r, byte g, byte b)
            {
                for (var y = S(y0); y < S(y1); y++) for (var x = S(x0); x < S(x1); x++) { var i = y * ps + x * 4; px[i] = b; px[i + 1] = g; px[i + 2] = r; }
            }
            var look = Blank();
            Fill(look, 6, 30, 56, 40, 67, 160, 255);
            for (var x = 136; x < 496; x += 10) Fill(look, x, 60, x + 1, 64, 150, 150, 150);
            Fill(look, 126, 70, 496, 72, 233, 233, 1);
            Fill(look, 26, 200, 46, 230, 0, 92, 200); Fill(look, 26, 240, 46, 270, 0, 92, 200);
            var monitor = Blank();
            for (var x = 12; x < 382; x += 10) Fill(monitor, x, 10, x + 1, 14, 150, 150, 150);
            Fill(monitor, 7, 560, 62, 570, 67, 160, 255);
            Expect(TimelinePanel.TimelineLook(look, ps, pw, ph, scale) == 5, "look at " + scale * 100 + "%: time, ruler, work-area bar and two track buttons (" + TimelinePanel.TimelineLook(look, ps, pw, ph, scale) + ")");
            Expect(TimelinePanel.TimelineLook(monitor, ps, pw, ph, scale) == 1, "look at " + scale * 100 + "%: the Program monitor shows one sign, not enough (" + TimelinePanel.TimelineLook(monitor, ps, pw, ph, scale) + ")");
            Expect(TimelinePanel.TimelineLook(Blank(), ps, pw, ph, scale) == 0, "look at " + scale * 100 + "%: an empty panel shows none");
        }

        LiveFocus.Run(Expect);

        Console.WriteLine(failures == 0 ? "\nAll Windows listener checks passed." : "\n" + failures + " check(s) FAILED.");
        return failures == 0 ? 0 : 1;
    }
}
