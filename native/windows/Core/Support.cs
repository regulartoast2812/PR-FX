using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;

namespace PrFxShortcutListener
{
    // Every file the Windows listener touches. Shared with CEP (app.js,
    // engine.js) and the host (host.jsx), which use the same folders:
    //   %APPDATA%\PR FX Palette\settings.json   written by the CEP panel
    //   %APPDATA%\PR FX Palette\catalog.json    cached command catalog
    //   %APPDATA%\PR FX Palette\Logs\           every PR FX log on Windows
    internal static class Paths
    {
        public static string SupportDir
        {
            get
            {
                var overridden = Environment.GetEnvironmentVariable("PRFX_SUPPORT_DIR");
                if (!string.IsNullOrEmpty(overridden)) return overridden!;
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "PR FX Palette");
            }
        }

        public static string LogsDir => Path.Combine(SupportDir, "Logs");
        public static string Settings => Path.Combine(SupportDir, "settings.json");
        public static string Catalog => Path.Combine(SupportDir, "catalog.json");
        public static string PaletteFrame => Path.Combine(SupportDir, "palette-frame.txt");
        public static string CaretCalibration => Path.Combine(SupportDir, "caret-calibrated.txt");
        public static string ListenerLog => Path.Combine(LogsDir, "PR FX Shortcut Listener.log");
        public static string BridgeToken => Path.Combine(SupportDir, "bridge-token");
        public static string KeyJournal => Path.Combine(LogsDir, "PR FX Key Journal.tsv");

        public static void Ensure(string directory)
        {
            try { Directory.CreateDirectory(directory); } catch (Exception) { }
        }
    }

    internal static class Log
    {
        private static readonly object Gate = new object();

        public static void Write(string message)
        {
            var line = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture) + " " + message + Environment.NewLine;
            ThreadPool.QueueUserWorkItem(_ =>
            {
                lock (Gate)
                {
                    try
                    {
                        Paths.Ensure(Paths.LogsDir);
                        var file = new FileInfo(Paths.ListenerLog);
                        if (file.Exists && file.Length > 2000000)
                        {
                            var rotated = Paths.ListenerLog + ".1";
                            if (File.Exists(rotated)) File.Delete(rotated);
                            File.Move(Paths.ListenerLog, rotated);
                        }
                        File.AppendAllText(Paths.ListenerLog, line, Encoding.UTF8);
                    }
                    catch (Exception) { }
                }
            });
        }
    }

    // One line per keypress event, tab-separated, same columns as the macOS
    // journal so tools/key-report.sh reads either.
    internal static class KeyJournal
    {
        private static readonly object Gate = new object();

        // event: fired | passed | delivered | ok | failed | expired | rejected
        public static void Record(string kind, int? seq, string key, string command, string detail = "")
        {
            var stamp = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture);
            var fields = new[] { stamp, kind, seq.HasValue ? seq.Value.ToString(CultureInfo.InvariantCulture) : "", key, command, detail }
                .Select(value => (value ?? "").Replace('\t', ' ').Replace('\n', ' ').Replace('\r', ' '));
            var line = string.Join("\t", fields) + "\n";
            ThreadPool.QueueUserWorkItem(_ =>
            {
                lock (Gate)
                {
                    try
                    {
                        Paths.Ensure(Paths.LogsDir);
                        var file = new FileInfo(Paths.KeyJournal);
                        if (file.Exists && file.Length > 5000000)
                        {
                            var rotated = Path.Combine(Paths.LogsDir, "PR FX Key Journal.1.tsv");
                            if (File.Exists(rotated)) File.Delete(rotated);
                            File.Move(Paths.KeyJournal, rotated);
                            file.Refresh();
                        }
                        if (!file.Exists) File.WriteAllText(Paths.KeyJournal, "time\tevent\tseq\tkey\tcommand\tdetail\n", new UTF8Encoding(false));
                        File.AppendAllText(Paths.KeyJournal, line, new UTF8Encoding(false));
                    }
                    catch (Exception) { }
                }
            });
        }
    }

    // Counts for this listener session, reported through /health so the CEP
    // panel can show a live success rate.
    internal sealed class KeyStats
    {
        public int Fired, Passed, Delivered, Ok, Failed, Expired;
        private readonly SortedDictionary<string, int> passedReasons = new SortedDictionary<string, int>(StringComparer.Ordinal);

        public void RecordPassed(string reason)
        {
            Passed++;
            var bucket = ReasonBucket(reason);
            passedReasons[bucket] = passedReasons.TryGetValue(bucket, out var count) ? count + 1 : 1;
        }

        public static string ReasonBucket(string reason)
        {
            if (reason.StartsWith("Text input", StringComparison.Ordinal)) return "text-field";
            if (reason.StartsWith("Premiere menu", StringComparison.Ordinal)) return "menu-open";
            if (reason.StartsWith("Last click was outside", StringComparison.Ordinal)) return "outside-timeline";
            if (reason.StartsWith("Timeline panel could not", StringComparison.Ordinal)) return "timeline-not-found";
            if (reason.StartsWith("Command bridge", StringComparison.Ordinal)) return "bridge-down";
            return "other";
        }

        public string ToJson()
        {
            var reasons = string.Join(",", passedReasons.Select(pair => Json.Quote(pair.Key) + ":" + pair.Value));
            return "{\"fired\":" + Fired + ",\"passed\":" + Passed + ",\"delivered\":" + Delivered + ",\"ok\":" + Ok +
                   ",\"failed\":" + Failed + ",\"expired\":" + Expired + ",\"passedReasons\":{" + reasons + "}}";
        }
    }
}
