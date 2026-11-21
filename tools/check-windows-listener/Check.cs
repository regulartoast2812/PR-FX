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

    // EdieSprite.face(.rest, right: true) from PRFXTimelineHighlight.swift, as the palette drew it before it used the port.
    private static readonly string[] FacingRight =
    {
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        "................................",
        ".......................y........",
        "....................yyyy........",
        "..............y..yYyyyy.........",
        "...............yyyyyyyyyyyyyyyy.",
        "..............yYyYyyYYyyyyyyy...",
        "..............YYyYYYyyyyyy......",
        "WW...........yYYYyYYYYyyYO......",
        "WW..........OYYYYyYYYYYYyyYO....",
        "..BBWW......YYYYYyYYYYYYYYyY....",
        "..BBWW....OOYYOOYYYYOOYYYYYYYY..",
        "....BBWW..OOOOOOYYYYOOOOOOOYYYY.",
        "....BBWW..OOOOOOOOOOOOOOOOOOOO..",
        "......BBWWOOOOOOOOOOOOOOOOOOOO..",
        "......BBWWOOOOOOOgKKOOOOgKKOOO..",
        "BBBBBBBBBBOOOOOOOKKKOOOOKKKOOO..",
        "BBBBBBBBBBOOPOPOPKKKOOOOKKKPOP..",
        "BBWWWWWWBBOOPOPOPOOOOOOOOPOPOP..",
        "BBWWWWWWBBOOPOPOPOOmOOOOmPOPOP..",
        "BBBBBBBBBBOOOOOOOOOmmmmmmOOOOO..",
        "BBBBBBBBBBOOOOOOOOOOmmmmOOOOOO..",
        "BBBBWWWWOOOOOOOOOOOOOOOOOOOOOO..",
        "BBBBWWWWOO..OOOOOOOOOOOOOOOO....",
        "BBBBBBBBBB..OOOOOOOOOOOOOOOO....",
        "BBBBBBBBBB....OOOOOOOOOOOO......",
        "..............DDD......DDD......",
        "..............DDD......DDD......",
    };

    private static int Main()
    {
        // ---- Edie
        var right = EdieSprite.Face(EdieSprite.Mood.Rest, right: true);
        var mismatch = Enumerable.Range(0, Math.Max(right.Length, FacingRight.Length)).FirstOrDefault(i => i >= right.Length || i >= FacingRight.Length || right[i] != FacingRight[i]);
        Expect(right.SequenceEqual(FacingRight), "edie: the port draws him facing right exactly as the macOS sprite" + (right.SequenceEqual(FacingRight) ? "" : " (first difference at row " + mismatch + ")"));
        var sitting = EdieSprite.Sitting(EdieSprite.Mood.Rest);
        Expect(sitting.Length == EdieSprite.Crown + 26 && sitting.All(r => r.Length == 32), "edie: sitting is 34 fine rows of 32 (leaf, body, legs over the line)");
        Expect(sitting[EdieSprite.Crown + 22].Contains('D') && sitting[EdieSprite.Crown + 25].Contains('D'), "edie: his legs hang over the line");
        Expect(!EdieSprite.Sitting(EdieSprite.Mood.Rest, 1).SequenceEqual(sitting) && EdieSprite.Sitting(EdieSprite.Mood.Rest, 0).SequenceEqual(sitting), "edie: a swing moves his leg, still doesn't");
        foreach (EdieSprite.Mood mood in Enum.GetValues(typeof(EdieSprite.Mood)))
            Expect(EdieSprite.Sitting(mood).Length == 34, "edie: " + mood + " draws");
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

        Console.WriteLine(failures == 0 ? "\nAll Windows listener checks passed." : "\n" + failures + " check(s) FAILED.");
        return failures == 0 ? 0 : 1;
    }
}
