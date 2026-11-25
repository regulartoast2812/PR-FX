using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading;
using PrFxShortcutListener;

// Exercises CommandBridge, PendingCommands, Json, Shortcuts and settings parsing
// exactly as CEP talks to them. Exit code 0 = all checks passed.
internal static class Check
{
    private static int failures;

    private static void Expect(bool condition, string label)
    {
        Console.WriteLine((condition ? "ok   " : "FAIL ") + label);
        if (!condition) failures++;
    }

    private static int Main()
    {
        var support = Path.Combine(Path.GetTempPath(), "prfx-windows-check-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(support);
        Environment.SetEnvironmentVariable("PRFX_SUPPORT_DIR", support);

        // ---- JSON round trip, including keys the listener never heard of
        var sample = "{\"type\":\"custom\",\"name\":\"Ünïcode \\\"quoted\\\" \\u2014 dash\",\"id\":\"x\",\"presetUid\":\"abc\",\"future\":{\"nested\":[1,2.5,true,null]}}";
        var parsed = (Dictionary<string, object?>)Json.Parse(sample)!;
        var again = (Dictionary<string, object?>)Json.Parse(Json.Serialize(parsed))!;
        Expect(Json.Str(again, "name") == "Ünïcode \"quoted\" — dash", "json: unicode and escapes survive a round trip");
        Expect(Json.Serialize(again["future"]) == "{\"nested\":[1,2.5,true,null]}", "json: unknown fields pass through untouched");
        Expect(!Json.TryParse("{\"a\":", out _), "json: truncated input is rejected");

        // ---- shortcuts
        Expect(Shortcut.VirtualKey("KeyS") == 'S' && Shortcut.VirtualKey("Digit7") == '7' && Shortcut.VirtualKey("Space") == 0x20, "keys: supported codes map");
        Expect(Shortcut.VirtualKey("F5") == null && Shortcut.VirtualKey("KeyÅ") == null, "keys: unsupported codes are refused, not mapped to Space");
        var table = new ChordTable();
        table.Add(new Shortcut { Code = "KeyS" }, 0, "S");
        table.Add(new Shortcut { Code = "KeyS" }, 1, "S again");
        table.Add(new Shortcut { Code = "F5" }, 2, "F5");
        Expect(table.TryGet(new KeyChord('S', false, false, false, false), out var hit) && hit == 0, "chords: first binding wins");
        Expect(table.Duplicates.Count == 1 && table.Unmappable.Count == 1, "chords: duplicate and unmappable reported");
        Expect(!table.TryGet(new KeyChord('S', false, false, true, false), out _), "chords: Shift+S is a different chord");

        // ---- settings.json as app.js writes it
        File.WriteAllText(Path.Combine(support, "settings.json"),
            "{\"shortcut\":{\"code\":\"Space\",\"ctrl\":true,\"alt\":false,\"shift\":false,\"meta\":false},\"transitionFrames\":12," +
            "\"bindings\":[{\"shortcut\":{\"code\":\"KeyD\",\"ctrl\":false,\"alt\":true,\"shift\":false,\"meta\":false},\"command\":{\"type\":\"custom\",\"name\":\"Move Down\",\"id\":\"move-selected-clips-down\",\"moveMode\":\"group\"}}]}");
        var settings = ListenerSettings.Load(out var settingsError);
        Expect(settingsError == "" && settings.TransitionFrames == 12 && settings.StaggerFrames == 5 && settings.Bindings.Count == 1, "settings: parsed with defaults for missing fields");
        Expect(settings.Bindings[0].Shortcut.Display() == "Alt+D" && settings.Palette.Display() == "Ctrl+Space", "settings: shortcuts display Windows-style");
        File.WriteAllText(Path.Combine(support, "settings.json"), "{\"shortcut\":");
        ListenerSettings.Load(out settingsError);
        Expect(settingsError.Length > 0, "settings: a half-written file reports an error instead of empty bindings");

        // ---- queue
        var queue = new PendingCommands<int>(capacity: 2, maxAgeSeconds: 5);
        var t0 = DateTime.UtcNow;
        Expect(queue.Append(1, t0) && queue.Append(2, t0) && !queue.Append(3, t0), "queue: capacity enforced");
        Expect(queue.DrainDiscarded().SequenceEqual(new[] { 3 }), "queue: rejected entry reported");
        Expect(queue.TryTake(t0, out var first) && first == 1, "queue: FIFO order");
        queue.Expire(t0.AddSeconds(6));
        Expect(queue.Count == 0 && queue.DrainDiscarded().SequenceEqual(new[] { 2 }), "queue: expired entry reported, not silently dropped");

        // ---- bridge over real HTTP
        const int port = 27399;
        var discarded = new List<string>();
        var results = new List<string>();
        var catalogs = new List<int>();
        var controls = new List<string>();
        var reloads = 0;
        using var bridge = new CommandBridge(port)
        {
            Health = () => "{\"platform\":\"windows\",\"mode\":\"active\"}",
            CatalogReceived = (catalog, fingerprint) => catalogs.Add(catalog.Count),
            ResultReceived = (seq, ok, message, ms) => results.Add(seq + ":" + ok + ":" + message),
            Discarded = command => discarded.Add(Json.Str(command, "name") ?? ""),
            ReloadSettings = () => reloads++,
            CatalogPayload = () => "[{\"type\":\"custom\",\"name\":\"Live\",\"id\":\"native\"}]",
            SettingsPayload = () => "{\"transitionFrames\":12}",
            SettingsWrite = body => Encoding.UTF8.GetString(body),
            Control = (route, body) => controls.Add(route + ":" + Encoding.UTF8.GetString(body))
        };
        using var http = new HttpClient { BaseAddress = new Uri("http://127.0.0.1:" + port) };
        string Get(string path) => http.GetStringAsync(path).Result;
        HttpResponseMessage Post(string path, string body, string? fingerprint = null)
        {
            var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
            if (fingerprint != null) request.Headers.Add("X-PRFX-Catalog-Fingerprint", fingerprint);
            return http.SendAsync(request).Result;
        }

        Expect(Get("/next?client=engine") == "null", "bridge: empty queue returns null");
        bridge.Enqueue(new Dictionary<string, object?> { ["type"] = "custom", ["name"] = "Alpha", ["seq"] = 1, ["presetUid"] = "u1" });
        bridge.Enqueue(new Dictionary<string, object?> { ["type"] = "custom", ["name"] = "Beta", ["seq"] = 2 });
        Expect(bridge.PendingName() == "Alpha", "bridge: pending name is the oldest");
        var health = Get("/health");
        Expect(health.Contains("\"platform\":\"windows\""), "bridge: /health served");
        var next = (Dictionary<string, object?>)Json.Parse(Get("/next?client=engine"))!;
        Expect(Json.Str(next, "name") == "Alpha" && Json.Str(next, "presetUid") == "u1", "bridge: /next returns oldest with extra fields intact");
        Expect(bridge.QueueHealth().Contains("\"queuedCommands\":1") && bridge.QueueHealth().Contains("\"enginePollAgeMs\":"), "bridge: queue health keys");

        Expect(Post("/runtime", "{\"runtime\":\"uxp\",\"supportedIds\":[\"native\"]}").IsSuccessStatusCode, "bridge: UXP registers exact capability IDs");
        Expect(Get("/catalog-current").Contains("\"name\":\"Live\"") && Get("/settings-current").Contains("\"transitionFrames\":12"), "bridge: UXP reads the live catalog and settings");
        Expect(Post("/settings-write", "{\"transitionFrames\":24}").Content.ReadAsStringAsync().Result.Contains("\"transitionFrames\":24"), "bridge: UXP writes shared settings");
        Expect(Post("/uxp-run", "{\"type\":\"custom\",\"name\":\"Live\",\"id\":\"native\"}").IsSuccessStatusCode && controls.LastOrDefault()?.StartsWith("/run:") == true, "bridge: registered UXP panel can run a catalog command");
        bridge.Enqueue(new Dictionary<string, object?> { ["type"] = "custom", ["name"] = "UXP", ["id"] = "native", ["seq"] = 3 });
        bridge.Enqueue(new Dictionary<string, object?> { ["type"] = "custom", ["name"] = "CEP", ["id"] = "legacy", ["seq"] = 4 });
        var cepFirst = (Dictionary<string, object?>)Json.Parse(Get("/next?client=engine"))!;
        var uxpNext = (Dictionary<string, object?>)Json.Parse(Get("/next?client=uxp"))!;
        var cepNext = (Dictionary<string, object?>)Json.Parse(Get("/next?client=engine"))!;
        Expect(Json.Str(cepFirst, "name") == "Beta" && Json.Str(uxpNext, "name") == "UXP" && Json.Str(cepNext, "name") == "CEP", "bridge: CEP and UXP take only their commands without reordering");
        Expect(bridge.QueueHealth().Contains("\"uxpSupportedCommands\":1") && bridge.QueueHealth().Contains("\"uxpPollAgeMs\":"), "bridge: UXP routing is visible in health");

        var bigCatalog = "[" + string.Join(",", Enumerable.Range(0, 3000).Select(i => "{\"type\":\"effect\",\"name\":\"Effect " + i + " " + new string('x', 200) + "\"}")) + "]";
        var catalogResponse = Post("/catalog", bigCatalog, "fp-test");
        var catalogBody = catalogResponse.Content.ReadAsStringAsync().Result;
        Expect(catalogResponse.IsSuccessStatusCode && catalogs.LastOrDefault() == 3000 && catalogBody.Contains("\"catalogFingerprint\":\"fp-test\""), "bridge: large catalog (" + bigCatalog.Length / 1024 + " KB) assembled across reads");
        var unfingerprinted = Post("/catalog", "[{\"type\":\"effect\",\"name\":\"x\"}]").Content.ReadAsStringAsync().Result;
        Expect(unfingerprinted.Contains("fnv1a32-"), "bridge: fingerprint computed when header missing");
        Expect((int)Post("/catalog", "{not json").StatusCode == 400, "bridge: invalid catalog rejected");
        Expect(Post("/result", "{\"seq\":7,\"ok\":false,\"message\":\"ERROR: no clip\",\"ms\":12}").IsSuccessStatusCode && results.LastOrDefault() == "7:False:ERROR: no clip", "bridge: /result delivered");
        Expect(Post("/reload-settings", "").IsSuccessStatusCode && reloads == 1, "bridge: /reload-settings");
        var options = http.SendAsync(new HttpRequestMessage(HttpMethod.Options, "/catalog")).Result;
        Expect((int)options.StatusCode == 204 && options.Headers.GetValues("Access-Control-Allow-Origin").First() == "*", "bridge: CORS preflight");
        Expect((int)http.GetAsync("/nope").Result.StatusCode == 404, "bridge: unknown route 404");

        var stolen = false;
        try { using var second = new CommandBridge(port); stolen = true; } catch (Exception) { }
        Expect(!stolen, "bridge: a second listener cannot bind the same port");

        bridge.Enqueue(new Dictionary<string, object?> { ["type"] = "custom", ["name"] = "Expires", ["seq"] = 9 });
        // An uncollected command still expires and is reported.
        Thread.Sleep(5200);
        bridge.Sweep();
        Expect(discarded.SequenceEqual(new[] { "Expires" }), "bridge: uncollected command expires after 5s and is reported");

        // ---- Timeline scoping reasons (2026-11-21): the same buckets as the macOS KeyStats
        Expect(KeyStats.ReasonBucket("Last click was outside the Timeline panel") == "outside-timeline", "scope: another panel is outside-timeline");
        Expect(KeyStats.ReasonBucket("Timeline panel could not be located") == "timeline-not-found", "scope: unknown panel is timeline-not-found");
        Expect(KeyStats.ReasonBucket("Text input is focused") == "text-field", "scope: typing is text-field");

        // ---- highlight and nudge settings, same keys and defaults as macOS
        File.WriteAllText(Paths.Settings, "{\"bindings\":[]}");
        var defaults = ListenerSettings.Load(out _);
        Expect(defaults.TimelineHighlight == "off" && defaults.EdieNudges == "on" && defaults.EdieNudgeMinutes == 2, "settings: highlight off, nudges on, 2 min by default");
        File.WriteAllText(Paths.Settings, "{\"timelineHighlight\":\"on\",\"edieNudges\":\"off\",\"edieNudgeMinutes\":0.5,\"bindings\":[]}");
        var chosen = ListenerSettings.Load(out _);
        Expect(chosen.TimelineHighlight == "on" && chosen.EdieNudges == "off" && chosen.EdieNudgeMinutes == 0.5, "settings: highlight, nudges and fractional minutes are read");

        // ---- Edie's nudges (EdieNudges, the macOS logic)
        var n = new EdieNudges { NudgeAfter = 120 };
        Expect(n.Tick(10, true, 1000, null, 0, out _) == null, "nudges: nothing while you're working");
        var still = n.Tick(121, true, 1111, "Pull Group In to Playhead", 1000, out _);
        Expect(still != null && still.Kind == EdieNudges.Kind.StillThere && still.Title == "Still with me?" && still.Detail == "We left off at Pull Group In to Playhead.", "nudges: 'still there' after two quiet minutes, naming the last command");
        Expect(n.Tick(150, true, 1140, null, 0, out _) == null, "nudges: once per quiet stretch");
        n.Tick(0.2, true, 1141, null, 0, out var resumedNow);
        Expect(resumedNow, "nudges: input resuming is noticed");
        Expect(n.Tick(400, false, 1500, null, 0, out _) == null, "nudges: never into an empty room (past the away time)");
        var welcome = n.Tick(0.1, false, 1501, null, 0, out _);
        Expect(welcome == null, "nudges: the welcome waits until Premiere is in front");
        var back = n.Tick(0.3, true, 1503, null, 0, out _);
        // His lines rotate: the second one he's said, so the second welcome.
        Expect(back != null && back.Kind == EdieNudges.Kind.WelcomeBack && back.Title == "Hey, you’re back." && back.Detail == "Ready when you are.", "nudges: 'welcome back' within 4 s of returning, lines rotating");
        var away = new EdieNudges();
        away.Tick(420, false, 0, null, 0, out _);
        var greeting = away.Tick(0.1, true, 1, null, 0, out _);
        Expect(greeting != null && greeting.Title == "Welcome back!" && greeting.Detail == "You were away 7 min.", "nudges: the welcome says how long you were away");
        var late = new EdieNudges();
        late.Tick(400, true, 0, null, 0, out _);
        late.Tick(0.1, false, 1, null, 0, out _);
        Expect(late.Tick(0.1, true, 6, null, 0, out _) == null, "nudges: a welcome not shown within 4 s is dropped");
        Expect(EdieNudges.Span(59) == "1 min" && EdieNudges.Span(3600) == "1 hr" && EdieNudges.Span(5400) == "1 hr 30 min", "nudges: spans read as minutes and hours");
        Expect(EdieNudges.Short(new string('a', 40)).Length == 30 && EdieNudges.Short("Short") == "Short", "nudges: long command names are shortened");


        // ---- Edie's pace on the Timeline highlight (EdiePace, 2026-11-22): human timings, not a metronome.
        {
            var seed = 7UL;
            double Rand() { seed = seed * 6364136223846793005UL + 1442695040888963407UL; return (seed >> 11) / (double)(1UL << 53); }
            var pace = new EdiePace(Rand);
            double t = 1000, end = t + 600;
            var blinks = new System.Collections.Generic.List<(double At, double Shut)>();
            var swings = new System.Collections.Generic.List<(int Swing, double Held)>();
            bool wasBlink = false; int lastSwing = 0; double blinkAt = 0, swingAt = t; var wakes = 0; var shortest = double.MaxValue;
            while (t < end)
            {
                var pose = pace.At(t, true, false);
                if (pose.Blink && !wasBlink) blinkAt = t;
                if (!pose.Blink && wasBlink) blinks.Add((blinkAt, t - blinkAt));
                if (pose.Swing != lastSwing) { swings.Add((lastSwing, t - swingAt)); swingAt = t; lastSwing = pose.Swing; }
                wasBlink = pose.Blink;
                shortest = Math.Min(shortest, pose.Next - t);
                t = pose.Next; wakes++;
            }
            Expect(blinks.Count >= 100 && blinks.Count <= 240, "edie pace: about one blink every 3-6 s (" + blinks.Count + " in 10 min, some twice)");
            Expect(blinks.All(b => b.Shut >= 0.1 && b.Shut <= 0.15 + 1e-9), "edie pace: a blink is shut 0.10-0.15 s");
            var gaps = blinks.Skip(1).Select((b, i) => b.At - blinks[i].At).ToList();
            Expect(gaps.Count(g => g < 0.5) >= 5 && gaps.Where(g => g >= 0.5).All(g => g >= 3.1 && g <= 6.2), "edie pace: blinks 3-6 s apart at random, now and then twice in a row");
            Expect(gaps.Where(g => g >= 0.5).Distinct().Count() > 20, "edie pace: no two waits alike (not every 4 s)");
            var moving = swings.Where(s => s.Swing != 0).ToList();
            Expect(moving.Count >= 40 && moving.All(s => s.Held >= 0.35 - 1e-9 && s.Held <= 0.6 + 1e-9), "edie pace: a leg swing holds out or back 0.35-0.6 s");
            // The first still is his start; after a swing, its last 0.2-0.35 s pass runs into the still.
            var stills = swings.Skip(1).Where(s => s.Swing == 0 && s.Held > 1).Select(s => s.Held).ToList();
            Expect(stills.Count > 20 && stills.All(s => s >= 7 - 1e-9 && s <= 18 + 0.35 + 1e-9) && stills.Max() - stills.Min() > 4, "edie pace: 7-18 s between swings, irregular");
            Expect(wakes < 600 * 1.5, "edie pace: wakes only when his pose changes (" + wakes + " in 10 min)");

            // At his laptop: taps, pauses, a glance up now and then.
            var typing = new EdiePace(Rand);
            t = 5000; end = t + 300;
            var held = new System.Collections.Generic.List<(EdiePace.Hands Hands, double Held)>();
            var last = typing.At(t, true, true).Typing; var since = t;
            while (t < end)
            {
                var pose = typing.At(t, true, true);
                if (pose.Typing != last) { held.Add((last, t - since)); since = t; last = pose.Typing; }
                t = pose.Next;
            }
            var taps = held.Where(h => h.Hands == EdiePace.Hands.Left || h.Hands == EdiePace.Hands.Right).ToList();
            Expect(taps.Count > 200 && taps.All(h => h.Held >= 0.08 - 1e-9 && h.Held <= 0.15 + 1e-9), "edie pace: a tap lifts a hand 0.08-0.15 s (" + taps.Count + " in 5 min)");
            Expect(held.All(h => h.Held >= 0.07 - 1e-9), "edie pace: no typing pose under 70 ms");
            var pauses = held.Where(h => h.Hands == EdiePace.Hands.Down && h.Held >= 0.5).ToList();
            Expect(pauses.Count > 40 && pauses.All(p => p.Held <= 2.0 + 0.13 + 1e-9), "edie pace: pauses of 0.5-2 s between bursts");
            Expect(held.Count(h => h.Hands == EdiePace.Hands.Up) >= 3 && held.Where(h => h.Hands == EdiePace.Hands.Up).All(h => h.Held >= 0.45 - 1e-9 && h.Held <= 1 + 1e-9), "edie pace: glances up 0.45-1 s, now and then");
            var held0 = new EdiePace(Rand).At(9000, false, true);
            Expect(!held0.Blink && held0.Swing == 0 && held0.Typing == EdiePace.Hands.Down && held0.Next == 9001, "edie pace: reduced motion holds him still");
            var beats = EdiePace.TalkBeats(Rand, 1.6);
            Expect(beats.Sum() >= 1.6 && beats.Where((b, i) => i % 2 == 0).All(b => b >= 0.17 && b <= 0.32) && beats.Where((b, i) => i % 2 == 1).All(b => b >= 0.11 && b <= 0.24)
                && EdiePace.TalkMouthOpen(beats, 0) && !EdiePace.TalkMouthOpen(beats, beats[0] + 0.001), "edie pace: talking, mouth open 0.17-0.32 s and shut 0.11-0.24 s in turn");
            var lateAt = new EdiePace(Rand); lateAt.At(100, true, false);
            Expect(lateAt.At(100 + 3600, true, false).Next > 100 + 3600, "edie pace: back after an hour, no racing through what he missed");
        }

        // ---- the palette keeps the front (PaletteFocus). It closed as it opened three times, each breaking every palette
        // command (2026-11-22, the user: "have a safeguard so that won't happen again"). Each past cause is a row here.
        {
            var pt0 = new DateTime(2026, 11, 22, 12, 0, 0, DateTimeKind.Utc);
            DateTime At(int ms) => pt0.AddMilliseconds(ms);
            var f = new PaletteFocus();
            f.BeginOpen();
            Expect(f.OnDeactivate(true) == PaletteFocusAction.Keep, "palette focus: losing the front while opening (Windows reports Premiere as it hands the front over) never closes it");
            f.EndOpen(At(0));
            Expect(f.OnDeactivate(true) == PaletteFocusAction.CheckAgain, "palette focus: losing the front after opening is looked at again, not acted on at once");
            Expect(f.OnRecheck(true, true, false, At(PaletteFocus.RecheckMs)) == PaletteFocusAction.Keep, "palette focus: a blip (the palette or the banner, ours, in front again) keeps it open");
            Expect(f.OnRecheck(true, false, true, At(50)) == PaletteFocusAction.TakeBack, "palette focus: Premiere grabbing the front back 50 ms after opening: the palette takes it back");
            Expect(f.OnRecheck(true, false, true, At(300)) == PaletteFocusAction.TakeBack, "palette focus: and once more");
            Expect(f.OnRecheck(true, false, true, At(400)) == PaletteFocusAction.Close, "palette focus: but not forever (a third grab closes it, so it never fights the user)");
            Expect(f.QuickCloses == 1, "palette focus: that close counts as closing as it opened (paletteQuickCloses on the health page)");

            var g = new PaletteFocus();
            g.BeginOpen(); g.EndOpen(At(0));
            Expect(g.OnRecheck(true, false, true, At(5000)) == PaletteFocusAction.Close && g.QuickCloses == 0, "palette focus: clicking Premiere later closes it, and isn't counted as a failure");
            g.BeginOpen(); g.EndOpen(At(10000));
            Expect(g.OnRecheck(true, false, false, At(10100)) == PaletteFocusAction.Close, "palette focus: another app taking the front closes it at once");
            Expect(g.OnRecheck(false, false, true, At(10200)) == PaletteFocusAction.Keep, "palette focus: an already closed palette does nothing");

            var h = new PaletteFocus();
            for (var i = 0; i < 2; i++) { h.BeginOpen(); h.EndOpen(At(i * 10000)); h.OnRecheck(true, false, false, At(i * 10000 + 200)); }
            Expect(h.Wide && h.Grace == PaletteFocus.WideGraceMs && h.MaxTakeBacks == PaletteFocus.WideTakeBacks, "palette focus: closing as it opened twice in a row, it waits longer from then on");
            h.BeginOpen(); h.EndOpen(At(30000));
            Expect(h.OnRecheck(true, false, true, At(31000)) == PaletteFocusAction.TakeBack, "palette focus: waiting longer, Premiere grabbing it a second after opening is taken back");
            h.OnClosedByUser();
            Expect(!h.Wide, "palette focus: once the user closes it themselves (Esc, a command), it's back to normal");
        }

        try { Directory.Delete(support, true); } catch (Exception) { }
        // ---- the palette's media tabs (PaletteSearch.cs, the port of PRFXPaletteSearch.swift; the same checks as
        // tools/check-palette-search.swift): Video, SFX under 45 s, BGM 45 s or longer.
        {
            var sounds = new List<PaletteMedia>
            {
                new PaletteMedia { Id = "v", Name = "Shot.mov", Bin = "", Kind = "video", Ext = "mov" },
                new PaletteMedia { Id = "s", Name = "Whoosh.wav", Bin = "SFX", Kind = "audio", Ext = "wav", Seconds = 44.6 },
                new PaletteMedia { Id = "b", Name = "Bed.mp3", Bin = "", Kind = "audio", Ext = "mp3", Seconds = 45 },
                new PaletteMedia { Id = "u", Name = "Unknown.wav", Bin = "", Kind = "audio", Ext = "wav" },
            };
            Expect(PaletteSearch.MediaCount(sounds, PaletteCategory.Media) == 4 && PaletteSearch.CategoryOf(sounds[3]) == null, "palette media: Media holds everything; sound with no length is only there");
            Expect(PaletteSearch.MediaCount(sounds, PaletteCategory.Video) == 1, "palette media: Video holds video only");
            Expect(PaletteSearch.MediaCount(sounds, PaletteCategory.Audio) == sounds.Count(m => m.Kind == "audio"), "palette media: the Audio tab holds every sound");
            Expect(PaletteSearch.MediaCount(sounds, PaletteCategory.Sfx) == 1 && PaletteSearch.CategoryOf(sounds[1]) == PaletteCategory.Sfx, "palette media: 44.6 s is SFX");
            Expect(PaletteSearch.MediaCount(sounds, PaletteCategory.Bgm) == 1 && PaletteSearch.CategoryOf(sounds[2]) == PaletteCategory.Bgm, "palette media: 45 s is ambient or BGM");
            Expect(PaletteSearch.MediaRows(sounds, "", false, null, null, PaletteCategory.Sfx).SequenceEqual(new[] { PaletteRow.Section("SFX · under 45 s", 1, "media"), PaletteRow.Media(1, null) }), "palette media: the SFX tab lists its sound");
            Expect(PaletteSearch.MediaRows(sounds, "", false, null, new[] { "b", "s" }, PaletteCategory.Sfx).Take(2).SequenceEqual(new[] { PaletteRow.Section("Recently placed", 1, "recent"), PaletteRow.Media(1, null) }), "palette media: recents are kept to the tab");
            Expect(PaletteSearch.MediaRows(sounds, "shot", false, null, null, PaletteCategory.Bgm).SequenceEqual(new[] { PaletteRow.Note("Nothing in the project is called that.") }), "palette media: a search stays in its tab");
            Expect(PaletteSearch.MediaRows(new[] { sounds[0] }, "", false, null, null, PaletteCategory.Bgm).SequenceEqual(new[] { PaletteRow.Note("This project has no sound 45 seconds or longer.") }), "palette media: an empty tab says so");
            Expect(PaletteSearch.WhereText(sounds[1]) == "44 s  ·  SFX" && PaletteSearch.Duration(0.46) == "0.4 s" && PaletteSearch.Duration(152.3) == "2:32" && PaletteSearch.Duration(3725) == "1:02:05", "palette media: a sound shows its length");
            Expect(PaletteCategories.Next(PaletteCategory.Commands) == PaletteCategory.Media && PaletteCategories.Next(PaletteCategory.Bgm) == PaletteCategory.Sequences && PaletteCategories.Next(PaletteCategory.Sequences) == PaletteCategory.Commands && PaletteCategories.Previous(PaletteCategory.Commands) == PaletteCategory.Sequences, "palette media: Tab goes round the tabs, Shift+Tab back");
            var withSequence = new List<PaletteMedia>(sounds) { new PaletteMedia { Id = "q", Name = "Main edit", Bin = "Sequences", Kind = "sequence", Ext = "" } };
            Expect(PaletteSearch.MediaCount(withSequence, PaletteCategory.Media) == 4 && PaletteSearch.MediaCount(withSequence, PaletteCategory.Sequences) == 1 && PaletteSearch.CategoryOf(withSequence[4]) == PaletteCategory.Sequences, "palette media: sequences have their own tab and are not in Media");
            Expect(PaletteSearch.MediaRows(withSequence, "", false, null, new[] { "q", "s" }, PaletteCategory.Sequences).SequenceEqual(new[] { PaletteRow.Section("Recently opened", 1, "recent"), PaletteRow.Media(4, null), PaletteRow.Section("Sequences", 1, "media"), PaletteRow.Media(4, null) }), "palette media: the Sequences tab lists them, recently opened first");
            Expect(PaletteSearch.MediaRows(sounds, "", false, null, null, PaletteCategory.Sequences).SequenceEqual(new[] { PaletteRow.Note("This project has no sequences.") }), "palette media: an empty Sequences tab says so");
            var decoded = PaletteMediaList.Parse("{\"items\":[{\"id\":\"1\",\"name\":\"a\",\"bin\":\"\",\"kind\":\"audio\",\"ext\":\"wav\",\"seconds\":3.5},{\"id\":\"2\",\"name\":\"b\",\"bin\":\"\",\"kind\":\"video\",\"ext\":\"mov\"}]}");
            Expect(decoded != null && decoded.Items[0].Seconds == 3.5 && decoded.Items[1].Seconds == null, "palette media: seconds is read when sent and optional");
            var decodedPick = PaletteMediaList.Parse("{\"fps\":23.976,\"items\":[{\"id\":\"1\",\"name\":\"a\",\"bin\":\"\",\"kind\":\"video\",\"ext\":\"mov\",\"path\":\"C:\\\\Footage\\\\a.mov\"},{\"id\":\"2\",\"name\":\"b\",\"bin\":\"\",\"kind\":\"video\",\"ext\":\"mov\"}]}");
            Expect(decodedPick != null && decodedPick.Fps == 23.976 && decodedPick.Items[0].Path == "C:\\Footage\\a.mov" && decodedPick.Items[1].Path == null && decoded!.Fps == null, "palette media: path and fps are read when sent and optional");
            Expect(PaletteMediaList.Parse("{\"items\":[{\"id\":\"1\",\"name\":\"a\",\"bin\":\"\",\"kind\":\"video\",\"ext\":\"mov\",\"path\":5}]}") == null && PaletteMediaList.Parse("{\"fps\":\"x\",\"items\":[]}") == null, "palette media: a path or fps of the wrong type fails the list, as Swift's decoder does");
        }

        // ---- the palette's In/Out picker (RangePick.cs, the port of PRFXRangePick.swift; the same checks as
        // tools/check-range-pick.swift, in the same order)
        {
            bool Near(double? a, double b) => a.HasValue && Math.Abs(a.Value - b) < 1e-6;

            // Frame rate
            Expect(RangePick.PickFps(25, 30) == 25, "range pick: the media's own rate wins");
            Expect(RangePick.PickFps(null, 23.976) == 23.976, "range pick: then the sequence's");
            Expect(RangePick.PickFps(0, null) == 30, "range pick: else 30");
            Expect(new RangePick(10, double.NaN).Fps == 30, "range pick: a rate that isn't a number becomes 30");

            // Frames
            var pick = new RangePick(10, 25);
            Expect(pick.FrameCount == 250, "range pick: 10 s at 25 fps is 250 frames");
            Expect(Near(pick.LastFrame, 9.96), "range pick: the last frame starts one frame before the end");
            Expect(Near(pick.Snapped(1.019), 1.0), "range pick: a time inside a frame snaps to its start");
            Expect(Near(pick.Snapped(99), 9.96), "range pick: past the end snaps to the last frame");
            Expect(Near(pick.Snapped(-3), 0), "range pick: before the start snaps to 0");
            Expect(new RangePick(0.01, 25).FrameCount == 1, "range pick: a sliver of media still has one frame");

            // Stepping
            pick.Step(1);
            Expect(Near(pick.Playhead, 0.04), "range pick: → steps one frame");
            pick.Step(10);
            Expect(Near(pick.Playhead, 0.44), "range pick: ⇧→ steps ten");
            pick.Step(-100);
            Expect(Near(pick.Playhead, 0), "range pick: stepping back stops at the start");
            pick.GoToEnd();
            Expect(Near(pick.Playhead, 9.96), "range pick: End goes to the last frame");
            pick.Step(1);
            Expect(Near(pick.Playhead, 9.96), "range pick: stepping forward stops at the last frame");
            var rates = new RangePick(10, 23.976);
            for (var i = 0; i < 1000; i++) rates.Step(1);
            Expect(rates.FrameIndex(rates.Playhead) == 239, "range pick: a thousand single steps at 23.976 land on whole frames, no drift");

            // Marking
            pick = new RangePick(10, 25);
            Expect(pick.PlaceRange == null, "range pick: no marks places the whole clip, as before");
            pick.Seek(2);
            pick.MarkInHere();
            pick.Seek(4);
            pick.MarkOutHere();
            Expect(Near(pick.PlaceRange?.InSeconds, 2) && Near(pick.PlaceRange?.OutSeconds, 4.04), "range pick: Out keeps its frame: the range ends one frame after it");
            Expect(Near(pick.MarkedSeconds, 2.04), "range pick: the marked length counts the Out frame");
            pick.Seek(5);
            pick.MarkInHere();
            Expect(pick.MarkOut == null && Near(pick.MarkIn, 5), "range pick: In after Out clears Out");
            pick.Seek(3);
            pick.MarkOutHere();
            Expect(pick.MarkIn == null && Near(pick.MarkOut, 3), "range pick: Out before In clears In");
            Expect(Near(pick.PlaceRange?.InSeconds, 0) && Near(pick.PlaceRange?.OutSeconds, 3.04), "range pick: only Out: from the start");
            pick.ClearMarks();
            pick.Seek(7);
            pick.MarkInHere();
            Expect(Near(pick.PlaceRange?.InSeconds, 7) && Near(pick.PlaceRange?.OutSeconds, 10), "range pick: only In: to the end of the media");
            pick.Seek(7);
            pick.MarkOutHere();
            Expect(Near(pick.PlaceRange?.OutSeconds, 7.04), "range pick: In and Out on one frame places that one frame");
            pick.ClearIn();
            Expect(pick.MarkIn == null && pick.MarkOut != null, "range pick: Alt+I clears In alone");
            pick.ClearOut();
            Expect(!pick.HasMarks && pick.PlaceRange == null, "range pick: Alt+O clears Out; with neither, the whole clip");

            // Uneven end: the last frame is short
            var uneven = new RangePick(10.01, 25);
            uneven.GoToEnd();
            uneven.MarkOutHere();
            Expect(Near(uneven.PlaceRange?.OutSeconds, 10.01), "range pick: Out on a short last frame ends at the media's end, never past it");
            Expect(uneven.FrameCount == 251, "range pick: a part frame at the end counts as a frame");

            // Going to marks
            pick = new RangePick(10, 25);
            pick.Seek(1); pick.MarkInHere(); pick.Seek(6); pick.MarkOutHere(); pick.Seek(8);
            pick.GoToIn();
            Expect(Near(pick.Playhead, 1), "range pick: Shift+I goes to In");
            pick.GoToOut();
            Expect(Near(pick.Playhead, 6), "range pick: Shift+O goes to Out");
            var bare = new RangePick(10, 25);
            bare.Seek(3);
            bare.GoToIn();
            Expect(Near(bare.Playhead, 3), "range pick: Shift+I with no In stays put");

            // Shuttle
            pick = new RangePick(10, 25);
            pick.ShuttleForward();
            Expect(pick.Rate == 1, "range pick: L plays");
            pick.ShuttleForward(); pick.ShuttleForward(); pick.ShuttleForward(); pick.ShuttleForward();
            Expect(pick.Rate == 8, "range pick: more L doubles up to 8x and stays there");
            pick.ShuttleBackward();
            Expect(pick.Rate == -1, "range pick: J from forward plays back at 1x");
            pick.ShuttleBackward();
            Expect(pick.Rate == -2, "range pick: J again doubles back");
            pick.Stop();
            Expect(pick.Rate == 0, "range pick: K stops");
            pick.TogglePlay();
            Expect(pick.Rate == 1, "range pick: Space plays");
            pick.TogglePlay();
            Expect(pick.Rate == 0, "range pick: Space again stops");
            pick.ShuttleForward();
            pick.Step(1);
            Expect(pick.Rate == 0, "range pick: a frame step stops playback");
            pick.GoToEnd(); pick.ShuttleForward();
            Expect(pick.AtBoundary, "range pick: playing forward at the last frame is at its stop");

            // Remembered marks
            var remembered = new RangePick(10, 25);
            remembered.Restore(2.01, 1, null);
            Expect(Near(remembered.MarkIn, 2) && remembered.MarkOut == null, "range pick: restored marks snap to frames, and an Out before In is dropped");
            Expect(Near(remembered.Playhead, 2), "range pick: a restored pick starts at its In");
            remembered.Restore(null, 50, 3);
            Expect(Near(remembered.MarkOut, 9.96) && Near(remembered.Playhead, 3), "range pick: a remembered Out past a shorter file sits on its last frame");

            // Showing
            Expect(RangePick.Timecode(3723.5, 25) == "01:02:03:12", "range pick: timecode HH:MM:SS:FF");
            Expect(RangePick.Timecode(1, 29.97) == "00:00:00:29", "range pick: 29.97 counts 30 frames a second, non-drop");
            Expect(RangePick.Timecode(0, 30) == "00:00:00:00", "range pick: timecode at the start");
            Expect(RangePick.Clock(65.257) == "1:05.25", "range pick: sound shows M:SS.ss");
            Expect(RangePick.Length(4.24) == "4.2s" && RangePick.Length(65) == "1m 05s", "range pick: short lengths for the footer");
            Expect(Near(pick.Fraction(5), 0.5) && Near(pick.Seconds(0.5), 5), "range pick: scrub bar fractions both ways");
            // Windows-only: a copy kept per media id is a value, so changing the live pick never changes the remembered one.
            var kept = pick;
            pick.Seek(1); pick.MarkInHere();
            Expect(kept != pick && kept.MarkIn == null, "range pick: a remembered copy is its own value");
        }

        Console.WriteLine(failures == 0 ? "\nAll Windows bridge checks passed." : "\n" + failures + " check(s) FAILED.");
        return failures == 0 ? 0 : 1;
    }
}
