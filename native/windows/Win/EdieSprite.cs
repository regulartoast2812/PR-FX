using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;

namespace PrFxShortcutListener
{
    // Edie as pixel rows, a line-for-line port of EdieSprite in PRFXTimelineHighlight.swift (2026-11-21).
    // Same art as Creative Assist's ui/sprite.ts (`edie`): change all three together.
    // His art is 16 by 12 whole pixels; each frame is doubled onto a grid twice as fine, where his eyes,
    // mouth, blush, rounded corners, legs and maple leaf are drawn. `Draw` sizes cells from the rows.
    internal static class EdieSprite
    {
        // TypeDown/TypeLeft/TypeRight/TypeUp: at his laptop while an AI function works (2026-11-22), looking down at it,
        // both hands on the keys, the left or the right lifted for a tap, or glancing up.
        public enum Mood { Rest, Blink, Grin, Sleepy, Shocked, Talk, TalkPause, TypeDown, TypeLeft, TypeRight, TypeUp }

        public static bool IsTyping(Mood mood) => mood == Mood.TypeDown || mood == Mood.TypeLeft || mood == Mood.TypeRight || mood == Mood.TypeUp;

        public const int Columns = 16;
        // Rows above the line he sits on.
        public const int SeatRow = 11;
        // Fine rows added above him for his leaf.
        public const int Crown = 8;

        private static readonly Dictionary<char, Color> Colors = new Dictionary<char, Color>
        {
            ['O'] = Hex(0xfaa046), ['D'] = Hex(0xcd8339), ['R'] = Hex(0xd7373c), ['r'] = Hex(0xa0232d), ['K'] = Hex(0x19191c),
            ['B'] = Hex(0x5f5f6c), ['W'] = Hex(0xf0f0f0), ['P'] = Hex(0xe8607a), ['m'] = Hex(0x19191c), ['w'] = Hex(0xd6ecff),
            ['g'] = Hex(0xb8692c), ['S'] = Hex(0x7a4a24), ['y'] = Hex(0xef5a30), ['Y'] = Hex(0xb02a1c),
            ['L'] = Hex(0xc3c6cd), ['H'] = Hex(0xe3e5ea), ['E'] = Hex(0x585a64), ['A'] = Hex(0x8b8e97), ['k'] = Hex(0x33343b),
        };

        private static readonly string[] RestRows =
        {
            "................",
            "................",
            "..OOOOOOOO.....W",
            ".OOOOOOOOOO..WB.",
            ".OOOOOOOOOO.WB..",
            ".OOOOOOOOOOWB...",
            ".OOOOOOOOOOBBBBB",
            ".OOOOOOOOOOBWWWB",
            ".OOOOOOOOOOBBBBB",
            ".OOOOOOOOOOOWWBB",
            "..OOOOOOOO.BBBBB",
            "................",
        };

        private struct Edit
        {
            public int Y, X; public char C;
            public Edit(int y, int x, char c) { Y = y; X = x; C = c; }
        }

        private static IEnumerable<Edit> At(char c, IEnumerable<int> rows, IEnumerable<int> cols)
        {
            var cs = cols.ToList();
            foreach (var y in rows) foreach (var x in cs) yield return new Edit(y, x, c);
        }

        private static IEnumerable<int> Span(int from, int to) => Enumerable.Range(from, to - from + 1);

        // Each stroke two fine pixels thick.
        private static readonly List<Edit> Smile = new List<Edit> { new Edit(17, 9, 'm'), new Edit(18, 9, 'm'), new Edit(17, 14, 'm'), new Edit(18, 14, 'm') }
            .Concat(At('m', new[] { 18, 19 }, Span(10, 13))).ToList();

        private static IEnumerable<Edit> Mouth(Mood mood)
        {
            switch (mood)
            {
                case Mood.Grin:
                    return At('m', new[] { 17, 18 }, Span(8, 15)).Concat(At('m', new[] { 19 }, Span(9, 14))).Concat(At('m', new[] { 20 }, Span(10, 13)));
                case Mood.Sleepy:
                    return At('m', new[] { 18, 19 }, Span(10, 13));
                case Mood.Shocked:
                case Mood.Talk:
                    return new[] { new Edit(17, 11, 'm'), new Edit(17, 12, 'm'), new Edit(20, 11, 'm'), new Edit(20, 12, 'm') }
                        .Concat(At('m', new[] { 18, 19 }, Span(10, 13)));
                default:
                    return Smile;
            }
        }

        // His art for a mood, whole pixels, no eyes, mouth or legs.
        private static string[] Art(Mood mood)
        {
            // The clapstick swung down onto the slate.
            var clap = new[] { new Edit(2, 15, '.'), new Edit(3, 13, '.'), new Edit(3, 14, '.'), new Edit(4, 12, '.'), new Edit(4, 13, '.'),
                               new Edit(5, 11, 'W'), new Edit(5, 12, 'B'), new Edit(5, 13, 'W'), new Edit(5, 14, 'B'), new Edit(5, 15, 'W') };
            switch (mood)
            {
                case Mood.Grin: return Put(RestRows, clap);
                case Mood.Sleepy:
                    return Put(RestRows, clap.Concat(new[] { new Edit(0, 12, 'w'), new Edit(0, 13, 'w'), new Edit(0, 14, 'w'), new Edit(0, 15, 'w'), new Edit(1, 14, 'w'),
                        new Edit(2, 13, 'w'), new Edit(3, 12, 'w'), new Edit(3, 13, 'w'), new Edit(3, 14, 'w'), new Edit(3, 15, 'w') }));
                case Mood.Shocked: return Put(RestRows, new[] { new Edit(4, 0, 'w'), new Edit(5, 0, 'w') });
                case Mood.Talk: return Put(RestRows, new[] { new Edit(2, 0, 'O'), new Edit(3, 0, 'O'), new Edit(4, 0, 'D') });
                case Mood.TalkPause: return Put(RestRows, new[] { new Edit(4, 0, 'O'), new Edit(5, 0, 'D') });
                // His hand off the clapperboard, which stands aside while he types: the slate's edge where it was.
                case Mood.TypeDown: case Mood.TypeLeft: case Mood.TypeRight: case Mood.TypeUp: return Put(RestRows, new[] { new Edit(9, 11, 'B') });
                default: return RestRows;
            }
        }

        // Three fine pixels square with a brown glint at each one's top right; shut, just their bottom row;
        // startled, wide as they were drawn.
        private static IEnumerable<Edit> Eyes(Mood mood)
        {
            switch (mood)
            {
                case Mood.Blink:
                case Mood.Sleepy:
                    return At('K', new[] { 15 }, new[] { 7, 8, 9, 14, 15, 16 });
                // Looking down at his screen: the lower two rows of each eye, no glint.
                case Mood.TypeDown:
                case Mood.TypeLeft:
                case Mood.TypeRight:
                    return At('K', new[] { 14, 15 }, new[] { 7, 8, 9, 14, 15, 16 });
                case Mood.Shocked:
                    return At('K', new[] { 12, 13, 14, 15 }, new[] { 6, 7, 8, 9, 14, 15, 16, 17 }).Concat(new[] { new Edit(12, 6, 'g'), new Edit(12, 14, 'g') });
                default:
                    return At('K', new[] { 13, 14, 15 }, new[] { 7, 8, 9, 14, 15, 16 }).Concat(new[] { new Edit(13, 9, 'g'), new Edit(13, 16, 'g') });
            }
        }

        // His Japanese maple leaf, on the fine grid with Crown rows above him.
        private static readonly List<Edit> Leaf = LeafEdits(new[]
        {
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "................................",
            "........y.......................",
            "........yyyy....................",
            ".........yyyyYy..y..............",
            ".yyyyyyyyyyyyyyyy...............",
            "...yyyyyyyYYyyYyYy..............",
            "......yyyyyyYYYyYY..............",
            ".......YyyYYYYyYYYy.............",
            ".....YyyYYYYYYyYYYY.............",
            "....YyYYYYYYYYyYYYYY............",
            "..YYYYYYYY..YYYY..YY............",
            ".YYYY.......YYYY................",
        });

        private static List<Edit> LeafEdits(string[] rows)
        {
            var edits = new List<Edit>();
            for (var y = 0; y < rows.Length; y++)
                for (var x = 0; x < rows[y].Length; x++)
                    if (rows[y][x] != '.') edits.Add(new Edit(y, x, rows[y][x]));
            return edits;
        }

        private static string[] Crowned(string[] rows)
        {
            var width = rows.Length > 0 ? rows[0].Length : 0;
            return Put(Enumerable.Repeat(new string('.', width), Crown).Concat(rows).ToArray(), Leaf);
        }

        private static readonly Edit[] Corners = new[] { (4, 4), (4, 5), (4, 18), (4, 19), (6, 2), (6, 3), (6, 20), (6, 21),
            (19, 2), (19, 3), (19, 20), (19, 21), (21, 4), (21, 5), (21, 18), (21, 19) }.Select(p => new Edit(p.Item1, p.Item2, '.')).ToArray();

        private static readonly List<Edit> Blush = At('P', new[] { 15, 16, 17 }, new[] { 4, 6, 8, 17, 19, 21 }).ToList();

        // His face moved up and toward his right, so he looks that way.
        private static IEnumerable<Edit> Turned(IEnumerable<Edit> edits) => edits.Select(e => new Edit(e.Y - 2, e.X - 2, e.C));

        // Whole-pixel rows doubled onto the fine grid, with his blush and the mood's eyes and mouth.
        private static string[] Fine(string[] rows, Mood mood)
        {
            var doubled = rows.SelectMany(row =>
            {
                var wide = string.Concat(row.Select(c => new string(c, 2)));
                return new[] { wide, wide };
            }).ToArray();
            return Put(doubled, Corners.Concat(Turned(Blush.Concat(Eyes(mood)).Concat(Mouth(mood)))));
        }

        private static readonly int[] LeftLeg = { 6, 7, 8 }, RightLeg = { 15, 16, 17 };

        // His tiny arms (2026-11-22, the user: "add tiny arms and hand on the side. hands are pretty much just
        // circles/ovals"): a round hand, a circle four fine pixels across in his legs' darker orange, on each side, in
        // the frame's fine rows (leaf included). The back one at his far side (columns 0-3), the front one on the
        // clapperboard's near edge (21-24), where his hand always was. Talking, his back arm is the one he waves.
        // Creative Assist draws the same (sprite.ts edieHand, edieArms).
        private static IEnumerable<Edit> Hand(int top, int left) =>
            At('D', new[] { top, top + 3 }, new[] { left + 1, left + 2 }).Concat(At('D', new[] { top + 1, top + 2 }, Span(left, left + 3)));

        private static IEnumerable<Edit> Arms(Mood mood) =>
            mood == Mood.Talk || mood == Mood.TalkPause ? Hand(25, 21) : Hand(23, 0).Concat(Hand(25, 21));

        // A laptop in front of him (2026-11-22, the user: "let him type and look down on a laptop"; twice as big,
        // 2026-11-23; seen three-quarters from behind, 2026-11-26, the user: "make edie's laptop sits infront of him.
        // angle like this labtop i attached (flip)"). Its silver lid's back (L, a light mark H) turned toward him: its
        // near edge tall, on the side he faces, with a thin dark side (E), the lid narrowing to its far hinge corner, a
        // dark edge under it. Past its far edge the base sticks out as a darker wedge (A) with a sliver of keys (k) and
        // two ports. One hand rests on those keys, the other comes round the lid's near edge, one lifted a whole pixel
        // for a tap. LaptopArt is drawn facing right over fine columns 0-23 from row 22 (just under his eyes);
        // `mirrored` (sitting on the Timeline, facing left) flips it about his middle, column x to 23 - x, so it is
        // always ahead of him. Frames he types in are 36 fine rows. The port of the Swift EdieSprite.laptop; Creative
        // Assist draws the same (sprite.ts edieLaptop).
        public const int TypingRows = 36;

        private static readonly string[] LaptopArt =
        {
            "..................LLE...",
            "...........LLLLLLLLLE...",
            "........LLLLLLLLLLLLE...",
            ".....LLLLLLLLLLLLLLLEE..",
            ".....LLLLLLLLLLLLLLLLE..",
            ".....LLLLLLLHHLLLLLLLE..",
            ".....LLLLLLLHHLLLLLLLE..",
            ".....LLLLLLLLLLLLLLLLE..",
            ".....LLLLLLLLLLLLLLLLE..",
            "...AALLLLLLLLLLLLLLLLE..",
            ".AAkkLLLLLLLLLLLLLLLLE..",
            "AkkkkLLLLLLLLLLLLLLLLE..",
            "AAAAAEEEEEEEEEEEEEEEEE..",
            ".AkAk...................",
        };

        private static IEnumerable<Edit> Laptop(Mood mood, bool mirrored = false)
        {
            const int top = 22;
            var body = LaptopArt.SelectMany((row, y) => row.Select((c, x) => new Edit(top + y, x, c)).Where(e => e.C != '.'));
            IEnumerable<Edit> KeyHand(int x, int y, bool lifted)
            {
                var t = top + y - (lifted ? 2 : 0);
                return At('D', new[] { t, t + 2 }, new[] { x + 1, x + 2 }).Concat(At('D', new[] { t + 1 }, Span(x, x + 3)));
            }
            var edits = body.Concat(KeyHand(0, 8, mood == Mood.TypeLeft)).Concat(KeyHand(20, 7, mood == Mood.TypeRight)).ToList();
            return mirrored ? edits.Select(e => new Edit(e.Y, 23 - e.X, e.C)).ToList() : edits;
        }

        // A frame with empty rows added under it, to its keyboard's bottom.
        private static string[] Roomy(string[] rows) =>
            rows.Concat(Enumerable.Repeat(new string('.', rows.Length > 0 ? rows[0].Length : Columns * 2), Math.Max(0, TypingRows - rows.Length))).ToArray();

        // Standing: his legs are stubs under him. `right`: all of him mirrored, facing screen right. Either way his
        // clapperboard is ahead of him, on the side he faces (2026-11-22, the user: "have the clapper in front of him in
        // all instances aside from timeline rectangle"); sitting on the Timeline he keeps it behind him.
        public static string[] Face(Mood mood, bool right = false)
        {
            var rows = Crowned(Put(Fine(Art(mood), mood), At('D', new[] { 22, 23 }, LeftLeg.Concat(RightLeg))));
            var mirrored = Ahead(rows.Select(r => new string(r.Reverse().ToArray())).ToArray());
            var toRight = IsTyping(mood) ? Put(Roomy(mirrored), Laptop(mood)) : Put(mirrored, Arms(mood));
            return right ? toRight : toRight.Select(r => new string(r.Reverse().ToArray())).ToArray();
        }

        // Facing right his body is fine columns 10-31 and the clapperboard (his hand on it) 0-9: the body moves 8 left
        // and the clapperboard, mirrored back so its stick rises outward, goes to the right edge, his hand over its near
        // side. The port of the Swift EdieSprite.ahead; Creative Assist draws him the same (sprite.ts edieAhead).
        public static string[] Ahead(string[] right)
        {
            return right.Select(r =>
            {
                var row = Enumerable.Repeat('.', r.Length).ToArray();
                for (var x = 10; x < r.Length; x++) if (r[x] != '.') row[x - 8] = r[x];
                for (var x = 0; x < 10; x++) if (r[x] == 'B' || r[x] == 'W') row[r.Length - 1 - x] = r[x];
                for (var x = 0; x < 10; x++) if (r[x] == 'O') row[r.Length - 1 - x] = 'O';
                return new string(row);
            }).ToArray();
        }

        // Sitting on a line drawn under whole row 10; his legs hang over it, feet to the left.
        // `swing` swings his right leg: -1 back, 0 still, 1 out.
        public static string[] Sitting(Mood mood, int swing = 0)
        {
            var s = Math.Sign(swing);
            var shin = RightLeg.Select(x => x + s);
            var legs = At('D', new[] { 22, 23, 24, 25 }, LeftLeg).Concat(At('D', new[] { 24, 25 }, new[] { 4, 5 }))
                .Concat(At('D', new[] { 22 }, RightLeg)).Concat(At('D', new[] { 23 }, shin))
                .Concat(At('D', new[] { 24, 25 }, Span(13, 17).Select(x => x + 2 * s)));
            var body = Art(mood).Take(SeatRow).Concat(Enumerable.Repeat(new string('.', Columns), 2)).ToArray();
            var rows = Crowned(Put(Fine(body, mood), legs));
            return IsTyping(mood) ? Put(Roomy(rows), Laptop(mood, mirrored: true)) : Put(rows, Arms(mood));
        }

        // `pixel` is one of his whole pixels; finer rows are drawn in smaller cells.
        public static void Draw(Graphics g, string[] rows, float x, float y, float pixel)
        {
            var cell = pixel * Columns / Math.Max(1, rows.Length > 0 ? rows[0].Length : Columns);
            var brushes = new Dictionary<char, SolidBrush>();
            try
            {
                for (var row = 0; row < rows.Length; row++)
                    for (var col = 0; col < rows[row].Length; col++)
                    {
                        var ch = rows[row][col];
                        if (!Colors.TryGetValue(ch, out var color)) continue;
                        if (!brushes.TryGetValue(ch, out var brush)) brushes[ch] = brush = new SolidBrush(color);
                        g.FillRectangle(brush, x + col * cell, y + row * cell, cell, cell);
                    }
            }
            finally { foreach (var b in brushes.Values) b.Dispose(); }
        }

        private static string[] Put(string[] rows, IEnumerable<Edit> edits)
        {
            var grid = rows.Select(r => r.ToCharArray()).ToArray();
            foreach (var e in edits)
                if (e.Y >= 0 && e.Y < grid.Length && e.X >= 0 && e.X < grid[e.Y].Length) grid[e.Y][e.X] = e.C;
            return grid.Select(r => new string(r)).ToArray();
        }

        private static Color Hex(int v) => Color.FromArgb((v >> 16) & 255, (v >> 8) & 255, v & 255);
    }
}
