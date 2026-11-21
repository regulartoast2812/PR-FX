using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace PrFxShortcutListener
{
    // The localhost bridge CEP talks to. Same port, routes and payloads as the
    // macOS listener (CommandBridge in PRFXShortcutListener.swift), so
    // client/app.js and client/engine.js need no platform branches for it.
    //
    //   GET  /next?client=engine|panel|uxp -> oldest command for that runtime
    //   GET  /health                    -> listener status JSON
    //   POST /catalog                   -> CEP pushes the full command catalog
    //   POST /result                    -> CEP reports how a command went
    //   POST /runtime                   -> UXP advertises the IDs it implements
    //   POST /reload-settings           -> settings.json changed
    //
    // Raw TCP rather than HttpListener: http.sys refuses a non-admin user a
    // 127.0.0.1 prefix, and rejects requests whose Host header does not match
    // the prefix exactly. CEP sends Host: 127.0.0.1:27389.
    internal sealed class CommandBridge : IDisposable
    {
        public const int Port = 27389;
        private const int MaxRequestBytes = 64 * 1024 * 1024;

        private readonly TcpListener listener;
        private readonly object gate = new object();
        private readonly PendingCommands<Dictionary<string, object?>> pending = new PendingCommands<Dictionary<string, object?>>();
        private readonly Dictionary<string, DateTime> lastPollAt = new Dictionary<string, DateTime>();
        private readonly HashSet<string> uxpSupportedIds = new HashSet<string>(StringComparer.Ordinal);
        private static readonly TimeSpan UxpFreshFor = TimeSpan.FromSeconds(2.5);
        private readonly Thread acceptThread;
        private volatile bool running = true;

        public Action<List<object?>, string>? CatalogReceived;
        public Func<string>? Health;
        public Action? ReloadSettings;
        public Action<Dictionary<string, object?>, string>? Delivered;
        public Action<Dictionary<string, object?>>? Discarded;
        public Action<int, bool, string, int?>? ResultReceived;
        public Action<string>? Log;
        public Func<string>? CatalogPayload;
        public Func<string>? SettingsPayload;
        public Func<byte[], string>? SettingsWrite;
        // POST /run and /open-palette, used by the PR FX app. They need the
        // token from bridge-token in an X-PRFX-Token header; the header is not
        // in Access-Control-Allow-Headers, so no web page can send it.
        public string ControlToken = "";
        public Action<string, byte[]>? Control;
        public Func<byte[], string>? Undo;

        // <project folder>\PR FX Exports, created if missing, for the UXP Queue
        // cuts to Media Encoder (UXP may not create folders itself).
        public static string ExportFolder(byte[] body)
        {
            string? projectPath = null;
            if (Json.TryParse(Encoding.UTF8.GetString(body), out var parsed) && parsed is Dictionary<string, object?> request)
                projectPath = Json.Str(request, "projectPath");
            if (string.IsNullOrEmpty(projectPath) || !System.IO.Path.IsPathRooted(projectPath) || !projectPath!.EndsWith(".prproj", StringComparison.OrdinalIgnoreCase))
                return "{\"error\":\"Save the Premiere project first.\"}";
            try
            {
                var folder = System.IO.Path.Combine(System.IO.Path.GetDirectoryName(projectPath) ?? "", "PR FX Exports");
                System.IO.Directory.CreateDirectory(folder);
                return "{\"path\":" + Json.Quote(folder) + "}";
            }
            catch { return "{\"error\":\"Could not create the PR FX Exports folder next to the project.\"}"; }
        }

        public CommandBridge(int port = Port)
        {
            listener = new TcpListener(IPAddress.Loopback, port);
            // Without this, Windows lets a second process bind the same port and
            // steal half the requests. A second listener must fail loudly.
            try { listener.ExclusiveAddressUse = true; } catch (Exception) { }
            listener.Start(64);
            acceptThread = new Thread(AcceptLoop) { IsBackground = true, Name = "PRFX bridge" };
            acceptThread.Start();
        }

        public bool Enqueue(Dictionary<string, object?> command)
        {
            bool accepted;
            List<Dictionary<string, object?>> dropped;
            lock (gate)
            {
                accepted = pending.Append(command, DateTime.UtcNow);
                dropped = pending.DrainDiscarded();
            }
            Report(dropped);
            Log?.Invoke(accepted ? "Queued command: " + Json.Str(command, "name") : "Shortcut queue full; rejected: " + Json.Str(command, "name"));
            return accepted;
        }

        public string PendingName()
        {
            string name = "";
            List<Dictionary<string, object?>> dropped;
            lock (gate)
            {
                pending.Expire(DateTime.UtcNow);
                if (pending.TryPeek(out var first)) name = Json.Str(first, "name") ?? "";
                dropped = pending.DrainDiscarded();
            }
            Report(dropped);
            return name;
        }

        // Fragment appended to the health object, matching the macOS keys.
        public string QueueHealth()
        {
            string body;
            List<Dictionary<string, object?>> dropped;
            lock (gate)
            {
                var now = DateTime.UtcNow;
                pending.Expire(now);
                dropped = pending.DrainDiscarded();
                body = ",\"queuedCommands\":" + pending.Count +
                       ",\"droppedCommands\":" + pending.Dropped +
                       ",\"enginePollAgeMs\":" + PollAge("engine", now) +
                       ",\"panelPollAgeMs\":" + PollAge("panel", now) +
                       ",\"uxpPollAgeMs\":" + PollAge("uxp", now) +
                       ",\"uxpSupportedCommands\":" + uxpSupportedIds.Count;
            }
            Report(dropped);
            return body;
        }

        // Periodic sweep so an expired command is reported even when CEP is not
        // polling at all -- which is exactly the case worth reporting.
        public void Sweep()
        {
            List<Dictionary<string, object?>> dropped;
            lock (gate)
            {
                pending.Expire(DateTime.UtcNow);
                dropped = pending.DrainDiscarded();
            }
            Report(dropped);
        }

        private long PollAge(string client, DateTime now)
        {
            return lastPollAt.TryGetValue(client, out var at) ? (long)(now - at).TotalMilliseconds : -1;
        }

        private void Report(List<Dictionary<string, object?>> dropped)
        {
            foreach (var command in dropped) Discarded?.Invoke(command);
        }

        private void AcceptLoop()
        {
            while (running)
            {
                TcpClient client;
                try { client = listener.AcceptTcpClient(); }
                catch (SocketException) { if (!running) return; continue; }
                catch (ObjectDisposedException) { return; }
                ThreadPool.QueueUserWorkItem(_ => Serve(client));
            }
        }

        private void Serve(TcpClient client)
        {
            using (client)
            {
                try
                {
                    client.ReceiveTimeout = 5000;
                    client.SendTimeout = 5000;
                    var stream = client.GetStream();
                    if (!ReadRequest(stream, out var method, out var target, out var headers, out var body))
                    {
                        Respond(stream, "400 Bad Request", "{\"error\":\"bad request\"}");
                        return;
                    }
                    Route(stream, method, target, headers, body);
                }
                catch (Exception error)
                {
                    Log?.Invoke("Bridge request failed: " + error.Message);
                }
            }
        }

        private static bool ReadRequest(NetworkStream stream, out string method, out string target, out Dictionary<string, string> headers, out byte[] body)
        {
            method = target = "";
            headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            body = new byte[0];
            var buffer = new MemoryStream();
            var chunk = new byte[65536];
            var headerEnd = -1;
            while (headerEnd < 0)
            {
                var read = stream.Read(chunk, 0, chunk.Length);
                if (read <= 0) return false;
                buffer.Write(chunk, 0, read);
                headerEnd = IndexOfHeaderEnd(buffer.GetBuffer(), (int)buffer.Length);
                if (buffer.Length > MaxRequestBytes) return false;
            }
            var raw = buffer.GetBuffer();
            var headerText = Encoding.UTF8.GetString(raw, 0, headerEnd);
            var lines = headerText.Split(new[] { "\r\n" }, StringSplitOptions.None);
            var requestLine = lines[0].Split(' ');
            if (requestLine.Length < 2) return false;
            method = requestLine[0];
            target = requestLine[1];
            for (var i = 1; i < lines.Length; i++)
            {
                var colon = lines[i].IndexOf(':');
                if (colon > 0) headers[lines[i].Substring(0, colon).Trim()] = lines[i].Substring(colon + 1).Trim();
            }
            var length = 0;
            if (headers.TryGetValue("Content-Length", out var lengthText)) int.TryParse(lengthText, out length);
            if (length < 0 || length > MaxRequestBytes) return false;
            var bodyStart = headerEnd + 4;
            // Premiere's catalog is well above a single read. Assemble the
            // declared body before decoding it, or a valid catalog truncates.
            while (buffer.Length < bodyStart + length)
            {
                var read = stream.Read(chunk, 0, chunk.Length);
                if (read <= 0) break;
                buffer.Write(chunk, 0, read);
            }
            raw = buffer.GetBuffer();
            var available = Math.Max(0, Math.Min(length, (int)buffer.Length - bodyStart));
            body = new byte[available];
            Buffer.BlockCopy(raw, bodyStart, body, 0, available);
            return true;
        }

        private static int IndexOfHeaderEnd(byte[] data, int length)
        {
            for (var i = 0; i + 3 < length; i++)
            {
                if (data[i] == '\r' && data[i + 1] == '\n' && data[i + 2] == '\r' && data[i + 3] == '\n') return i;
            }
            return -1;
        }

        private void Route(NetworkStream stream, string method, string target, Dictionary<string, string> headers, byte[] body)
        {
            var question = target.IndexOf('?');
            var path = question >= 0 ? target.Substring(0, question) : target;
            var query = question >= 0 ? target.Substring(question + 1) : "";

            if (method == "OPTIONS")
            {
                Respond(stream, "204 No Content", "");
                return;
            }
            if (method == "GET" && path == "/next")
            {
                var client = query.Contains("client=engine") ? "engine" : query.Contains("client=panel") ? "panel" : query.Contains("client=uxp") ? "uxp" : "legacy";
                Dictionary<string, object?>? command = null;
                List<Dictionary<string, object?>> dropped;
                lock (gate)
                {
                    var now = DateTime.UtcNow;
                    lastPollAt[client] = now;
                    var uxpFresh = lastPollAt.TryGetValue("uxp", out var uxpAt) && now - uxpAt < UxpFreshFor;
                    bool SupportsUxp(Dictionary<string, object?> item)
                    {
                        // Function id, or type:name for effects and transitions (no id).
                        var id = Json.Str(item, "id");
                        var key = !string.IsNullOrEmpty(id) ? id! : (Json.Str(item, "type") ?? "") + ":" + (Json.Str(item, "name") ?? "");
                        return uxpSupportedIds.Contains(key);
                    }
                    if (client == "uxp")
                    {
                        if (pending.TryTake(now, SupportsUxp, out var taken)) command = taken;
                    }
                    else if (uxpFresh)
                    {
                        if (pending.TryTake(now, item => !SupportsUxp(item), out var taken)) command = taken;
                    }
                    else if (pending.TryTake(now, out var taken)) command = taken;
                    dropped = pending.DrainDiscarded();
                }
                Report(dropped);
                if (command != null)
                {
                    Log?.Invoke("Runtime (" + client + ") collected command: " + Json.Str(command, "name"));
                    Delivered?.Invoke(command, client);
                }
                Respond(stream, "200 OK", Json.Serialize(command));
                return;
            }
            if (method == "GET" && path == "/health")
            {
                Respond(stream, "200 OK", Health?.Invoke() ?? "{\"mode\":\"offline\",\"bindings\":0}");
                return;
            }
            if (method == "GET" && path == "/catalog-current")
            {
                Respond(stream, "200 OK", CatalogPayload?.Invoke() ?? "[]");
                return;
            }
            if (method == "GET" && path == "/settings-current")
            {
                Respond(stream, "200 OK", SettingsPayload?.Invoke() ?? "{}");
                return;
            }
            if (method == "POST" && path == "/catalog")
            {
                var text = Encoding.UTF8.GetString(body);
                if (Json.TryParse(text, out var parsed) && parsed is List<object?> catalog)
                {
                    var fingerprint = headers.TryGetValue("X-PRFX-Catalog-Fingerprint", out var header) && header.Length > 0 ? header : Fingerprint(body);
                    CatalogReceived?.Invoke(catalog, fingerprint);
                    Respond(stream, "200 OK", "{\"ok\":true,\"catalogFingerprint\":" + Json.Quote(fingerprint) + ",\"catalogCount\":" + catalog.Count + "}");
                }
                else Respond(stream, "400 Bad Request", "{\"error\":\"invalid catalog\"}");
                return;
            }
            if (method == "POST" && path == "/runtime")
            {
                if (Json.TryParse(Encoding.UTF8.GetString(body), out var parsed) &&
                    parsed is Dictionary<string, object?> registration &&
                    Json.Str(registration, "runtime") == "uxp" &&
                    registration.TryGetValue("supportedIds", out var idsValue) && idsValue is List<object?> ids)
                {
                    lock (gate)
                    {
                        uxpSupportedIds.Clear();
                        foreach (var value in ids) if (value is string id && id.Length > 0) uxpSupportedIds.Add(id);
                        lastPollAt["uxp"] = DateTime.UtcNow;
                    }
                    Respond(stream, "200 OK", "{\"ok\":true,\"supportedCommands\":" + uxpSupportedIds.Count + "}");
                }
                else Respond(stream, "400 Bad Request", "{\"error\":\"invalid runtime registration\"}");
                return;
            }
            if (method == "POST" && path == "/uxp-run")
            {
                var origin = headers.TryGetValue("Origin", out var value) ? value : "";
                if (origin.Length > 0 && origin != "null" && !origin.StartsWith("uxp://", StringComparison.OrdinalIgnoreCase) && !origin.StartsWith("file://", StringComparison.OrdinalIgnoreCase))
                {
                    Respond(stream, "403 Forbidden", "{\"error\":\"UXP origin required\"}");
                    return;
                }
                bool fresh;
                lock (gate) fresh = lastPollAt.TryGetValue("uxp", out var at) && DateTime.UtcNow - at < UxpFreshFor;
                if (!fresh)
                {
                    Respond(stream, "409 Conflict", "{\"error\":\"UXP runtime is not registered\"}");
                    return;
                }
                Control?.Invoke("/run", body);
                Respond(stream, "200 OK", "{\"ok\":true}");
                return;
            }
            if (method == "POST" && path == "/settings-write")
            {
                var origin = headers.TryGetValue("Origin", out var value) ? value : "";
                if (origin.Length > 0 && origin != "null" && !origin.StartsWith("uxp://", StringComparison.OrdinalIgnoreCase) && !origin.StartsWith("file://", StringComparison.OrdinalIgnoreCase))
                {
                    Respond(stream, "403 Forbidden", "{\"error\":\"UXP origin required\"}");
                    return;
                }
                var response = SettingsWrite?.Invoke(body) ?? "{\"error\":\"listener unavailable\"}";
                Respond(stream, response.StartsWith("{\"error\"") ? "400 Bad Request" : "200 OK", response);
                return;
            }
            if (method == "POST" && (path == "/uxp-open-palette" || path == "/uxp-reveal" || path == "/uxp-scan-folder" || path == "/uxp-export-folder" || path == "/uxp-undo"))
            {
                // The Edie UXP panel has no Node or shell: the listener opens the
                // palette, reveals log files and lists synced folders for it.
                var origin = headers.TryGetValue("Origin", out var value) ? value : "";
                if (origin.Length > 0 && origin != "null" && !origin.StartsWith("uxp://", StringComparison.OrdinalIgnoreCase) && !origin.StartsWith("file://", StringComparison.OrdinalIgnoreCase))
                {
                    Respond(stream, "403 Forbidden", "{\"error\":\"UXP origin required\"}");
                    return;
                }
                if (path == "/uxp-export-folder")
                {
                    var folder = ExportFolder(body);
                    Respond(stream, folder.StartsWith("{\"error\"") ? "400 Bad Request" : "200 OK", folder);
                }
                else if (path == "/uxp-undo")
                {
                    // UXP has no undo call: the listener presses Premiere's own.
                    var undone = Undo?.Invoke(body) ?? "{\"error\":\"listener unavailable\"}";
                    Respond(stream, undone.StartsWith("{\"error\"") ? "409 Conflict" : "200 OK", undone);
                }
                else if (path == "/uxp-scan-folder")
                {
                    var scanned = ScanSyncFolder(body);
                    Respond(stream, scanned.StartsWith("{\"error\"") ? "400 Bad Request" : "200 OK", scanned);
                }
                else if (path == "/uxp-reveal") Respond(stream, "200 OK", RevealLogFile(body));
                else
                {
                    Control?.Invoke("/open-palette", body);
                    Respond(stream, "200 OK", "{\"ok\":true}");
                }
                return;
            }
            if (method == "POST" && path == "/result")
            {
                if (Json.TryParse(Encoding.UTF8.GetString(body), out var parsed) && parsed is Dictionary<string, object?> result && Json.Int(result, "seq") is int seq)
                {
                    ResultReceived?.Invoke(seq, Json.Bool(result, "ok"), Json.Str(result, "message") ?? "", Json.Int(result, "ms"));
                    Respond(stream, "200 OK", "{\"ok\":true}");
                }
                else Respond(stream, "400 Bad Request", "{\"error\":\"invalid result\"}");
                return;
            }
            if (method == "POST" && (path == "/run" || path == "/open-palette"))
            {
                if (ControlToken.Length == 0 || !headers.TryGetValue("X-PRFX-Token", out var token) || token != ControlToken)
                {
                    Respond(stream, "403 Forbidden", "{\"error\":\"bad token\"}");
                    return;
                }
                Control?.Invoke(path, body);
                Respond(stream, "200 OK", "{\"ok\":true}");
                return;
            }
            if (method == "POST" && path == "/reload-settings")
            {
                ReloadSettings?.Invoke();
                Respond(stream, "200 OK", "{\"ok\":true}");
                return;
            }
            Respond(stream, "404 Not Found", "{\"error\":\"not found\"}");
        }

        public static string Fingerprint(byte[] data)
        {
            uint hash = 2166136261;
            foreach (var b in data)
            {
                hash ^= b;
                hash = unchecked(hash * 16777619);
            }
            return "fnv1a32-" + hash.ToString("x8") + "-" + data.Length;
        }

        // Opens one of Edie's own log files for the UXP panel. Only these known
        // files, never a path from the request.
        private static string RevealLogFile(byte[] body)
        {
            var which = Json.TryParse(Encoding.UTF8.GetString(body), out var parsed) && parsed is Dictionary<string, object?> request ? Json.Str(request, "which") ?? "" : "";
            string? target = which == "failures" ? Path.Combine(Paths.SupportDir, "failure-log.jsonl")
                : which == "journal" ? Paths.KeyJournal
                : which == "listenerLog" ? Paths.ListenerLog : null;
            if (target == null) return "{\"ok\":false,\"message\":\"Unknown log.\"}";
            if (!File.Exists(target)) return "{\"ok\":false,\"message\":\"Nothing logged yet.\"}";
            try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(target) { UseShellExecute = true }); }
            catch (Exception error) { return "{\"ok\":false,\"message\":" + Json.Quote(error.Message) + "}"; }
            return "{\"ok\":true}";
        }

        private static readonly HashSet<string> SyncMedia = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            ".3g2", ".3gp", ".aac", ".aif", ".aiff", ".avi", ".bwf", ".cr2", ".dng", ".gif", ".heic", ".jpeg", ".jpg", ".m4a", ".m4v", ".mkv", ".mov", ".mp3", ".mp4",
            ".mpeg", ".mpg", ".mxf", ".png", ".psd", ".r3d", ".tga", ".tif", ".tiff", ".wav", ".webm"
        };

        // Media files under a synced folder, for the UXP panel's Sync now. Same
        // rules as the macOS listener: hidden files and links skipped, media
        // extensions only; stamp (size:mtime ms) tells the panel what changed.
        private static string ScanSyncFolder(byte[] body)
        {
            var root = Json.TryParse(Encoding.UTF8.GetString(body), out var parsed) && parsed is Dictionary<string, object?> request ? Json.Str(request, "path") ?? "" : "";
            if (root.Length == 0) return "{\"error\":\"A folder path is required.\"}";
            root = Path.GetFullPath(root).TrimEnd('\\', '/');
            if (!Directory.Exists(root)) return "{\"error\":\"This folder is no longer there.\"}";
            const int limit = 20000;
            var files = new List<object?>();
            var truncated = false;
            var pendingDirs = new Stack<string>();
            pendingDirs.Push(root);
            while (pendingDirs.Count > 0 && !truncated)
            {
                var directory = pendingDirs.Pop();
                FileSystemInfo[] entries;
                try { entries = new DirectoryInfo(directory).GetFileSystemInfos(); }
                catch (Exception) { continue; }
                foreach (var entry in entries)
                {
                    if (entry.Name.StartsWith(".") || (entry.Attributes & (FileAttributes.Hidden | FileAttributes.ReparsePoint)) != 0) continue;
                    if (entry is DirectoryInfo) { pendingDirs.Push(entry.FullName); continue; }
                    if (!(entry is FileInfo file) || !SyncMedia.Contains(file.Extension)) continue;
                    if (files.Count >= limit) { truncated = true; break; }
                    var modified = (long)Math.Floor((file.LastWriteTimeUtc - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds);
                    files.Add(new Dictionary<string, object?>
                    {
                        ["path"] = file.FullName,
                        ["relativePath"] = file.FullName.Substring(root.Length + 1).Replace('\\', '/'),
                        ["stamp"] = file.Length + ":" + modified
                    });
                }
            }
            return Json.Serialize(new Dictionary<string, object?> { ["files"] = files, ["truncated"] = truncated });
        }

        private static void Respond(NetworkStream stream, string status, string body)
        {
            var payload = Encoding.UTF8.GetBytes(body);
            var header = "HTTP/1.1 " + status + "\r\n" +
                         "Content-Type: application/json\r\n" +
                         "Access-Control-Allow-Origin: *\r\n" +
                         "Access-Control-Allow-Headers: Content-Type, X-PRFX-Catalog-Fingerprint\r\n" +
                         "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
                         "Cache-Control: no-store\r\n" +
                         "Content-Length: " + payload.Length + "\r\n" +
                         "Connection: close\r\n\r\n";
            var headerBytes = Encoding.ASCII.GetBytes(header);
            stream.Write(headerBytes, 0, headerBytes.Length);
            if (payload.Length > 0) stream.Write(payload, 0, payload.Length);
            stream.Flush();
        }

        public void Dispose()
        {
            running = false;
            try { listener.Stop(); } catch (Exception) { }
        }
    }
}
