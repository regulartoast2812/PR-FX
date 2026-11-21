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

        try { Directory.Delete(support, true); } catch (Exception) { }
        Console.WriteLine(failures == 0 ? "\nAll Windows bridge checks passed." : "\n" + failures + " check(s) FAILED.");
        return failures == 0 ? 0 : 1;
    }
}
