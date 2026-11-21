/* PR AI agent tools.
 *
 * Small, composable tools the chat agent can chain (transcribe -> optimise ->
 * save). Every tool says whether it changes the open Premiere project
 * (`mutates`). Read-only tools may write files under the PR AI support folder,
 * never the project.
 *
 * UMD: in the panel it becomes window.PRAIAgentTools; under node it is
 * require()-able so mcp.js can list tools and the test harness can run the
 * file tools with stubbed dependencies.
 */
(function (root, factory) {
  /* CEP exposes CommonJS globals to ordinary <script> tags when Node is
     enabled. Prefer the browser export whenever a real window is present. */
  if (typeof window === "undefined" && typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PRAIAgentTools = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var SERVER_NAME = "prai";

  var WORKFLOW_PRESETS = [
    { id: "auto-captions", label: "Auto captions", needsScript: false,
      description: "Transcribe the whole active sequence with Whisper, split it into readable caption rows and import them as a new caption track." },
    { id: "full-processing", label: "Full Process", needsScript: true,
      description: "Align the attached script's Text rows to the audio, cut the audio into sections and import captions." },
    { id: "auto-cut-textbound", label: "Layout", needsScript: true,
      description: "Lay out the active script's Source File / Cut from Source media row by row, with matching text captions." },
    { id: "audio-text-cuts", label: "Audio + Text", needsScript: true,
      description: "Razor the configured audio track at the script's line boundaries and import word-timed captions." },
    { id: "auto-subtitle-layout", label: "Add text", needsScript: true,
      description: "Import the active script's Text/Overlay cells as captions." },
    { id: "create-new-sequence", label: "New sequence", needsScript: false,
      description: "Create a new empty sequence with the active sequence's settings." }
  ];

  function obj(properties, required) {
    return { type: "object", properties: properties || {}, required: required || [], additionalProperties: false };
  }

  var TOOLS = [
    {
      name: "get_project_context",
      mutates: false,
      description: "Read the open Premiere project: project name and file path, active sequence (name, fps, tracks with their clips), selected timeline clips, and whether Whisper is configured. Call this first when you need to know what is in the edit.",
      inputSchema: obj({
        include_project_items: { type: "boolean", description: "Also list bin items (can be long). Default false." }
      })
    },
    {
      name: "get_active_script",
      mutates: false,
      description: "Read the script or table attached to Edie's composer (empty if none).",
      inputSchema: obj({})
    },
    {
      name: "transcribe_audio_to_srt",
      mutates: false,
      description: "Export the active sequence's audio and transcribe it with Whisper into an SRT file whose times are sequence times. Does NOT change the Premiere project. With no arguments it listens to every audio track across the whole sequence. Returns the SRT path, a word-timing JSON path (pass it to optimize_srt) and a preview. Can take minutes.",
      inputSchema: obj({
        audio_track: { type: "string", description: "Only this track, e.g. \"A1\". Omit for the whole mix." },
        start_seconds: { type: "number", description: "Start of the range in sequence seconds." },
        end_seconds: { type: "number", description: "End of the range in sequence seconds." },
        use_selection: { type: "boolean", description: "Limit the range to the span of the selected timeline clips." },
        optimize: { type: "boolean", description: "Also split into readable caption rows now. Default false: call optimize_srt instead." }
      })
    },
    {
      name: "create_optimized_subtitles",
      mutates: true,
      description: "Create finished subtitles deterministically: transcribe the active sequence audio with Whisper, run Edie's Optimized Text splitter using Whisper word timings, save the optimized SRT next to the Premiere project (or Edie Captions in the Movies folder, Videos on Windows), then import that exact optimized SRT as a caption track unless import_to_timeline is false. Use this for requests to create subtitles/captions and save an SRT. Never substitute Audio + Text, which is a script-driven cutting workflow.",
      inputSchema: obj({
        audio_track: { type: "string", description: "Only this track, e.g. A1. Omit for the whole mix." },
        start_seconds: { type: "number", description: "Start of the range in sequence seconds." },
        end_seconds: { type: "number", description: "End of the range in sequence seconds." },
        use_selection: { type: "boolean", description: "Limit the range to selected timeline clips." },
        import_to_timeline: { type: "boolean", description: "Import the optimized SRT as a new caption track. Default true." },
        destination_folder: { type: "string", description: "Where to save the optimized SRT. Default: next to the .prproj." },
        file_name: { type: "string", description: "Saved SRT name. Default: <sequence> captions.srt." }
      })
    },
    {
      name: "optimize_srt",
      mutates: false,
      description: "Re-split an SRT into short, readable caption rows using Edie's caption settings. Timing follows the word-timing JSON when given, otherwise it is proportional. Writes a NEW file and returns its path; the input is untouched.",
      inputSchema: obj({
        input_path: { type: "string", description: "SRT to optimise." },
        words_json_path: { type: "string", description: "Word timings from transcribe_audio_to_srt (optional)." },
        max_words: { type: "number", description: "Max words per row (1-20). Default: Edie's settings." },
        max_characters: { type: "number", description: "Max characters per row (8-90). Default: Edie's settings." },
        split_mode: { type: "string", enum: ["readability", "punctuation", "even"], description: "How rows are split. Default: Edie's settings." },
        trim_end_punctuation: { type: "boolean", description: "Drop trailing commas/periods on each row. Default: Edie's settings." }
      }, ["input_path"])
    },
    {
      name: "read_srt",
      mutates: false,
      description: "Read an SRT file as numbered rows {index, start, end, text} (seconds). Use it to review or correct the wording.",
      inputSchema: obj({
        path: { type: "string" },
        offset: { type: "number", description: "First row index (1-based). Default 1." },
        limit: { type: "number", description: "Max rows. Default 400." }
      }, ["path"])
    },
    {
      name: "write_srt",
      mutates: false,
      description: "Write a NEW SRT in Edie's working folder. Either give `blocks` [{start,end,text}] in seconds, or `source_path` plus `edits` [{index,text}] to change the wording of some rows while keeping every timing. Returns the new path.",
      inputSchema: obj({
        source_path: { type: "string", description: "SRT to copy timings from when using edits." },
        edits: { type: "array", items: obj({ index: { type: "number" }, text: { type: "string" } }, ["index", "text"]) },
        blocks: { type: "array", items: obj({ start: { type: "number" }, end: { type: "number" }, text: { type: "string" } }, ["start", "end", "text"]) },
        name: { type: "string", description: "File name hint, e.g. \"interview corrected\"." }
      })
    },
    {
      name: "save_srt",
      mutates: false,
      description: "Keep an SRT: copy it to a lasting place. Default folder is the one holding the Premiere project file. Never overwrites: an existing name gets \" (2)\", \" (3)\"... Returns the final path.",
      inputSchema: obj({
        input_path: { type: "string" },
        destination_folder: { type: "string", description: "Folder to save into. Default: next to the .prproj." },
        file_name: { type: "string", description: "File name. Default: \"<sequence> captions.srt\"." }
      }, ["input_path"])
    },
    {
      name: "import_srt_as_captions",
      mutates: true,
      description: "CHANGES THE PROJECT. Import an SRT into the active sequence as a new caption track. Times in files from these tools are already sequence times, so leave start_at_seconds at 0. Only call when the user asked for captions in the timeline.",
      inputSchema: obj({
        input_path: { type: "string" },
        start_at_seconds: { type: "number", description: "Offset added to every caption. Default 0." }
      }, ["input_path"])
    },
    {
      name: "list_presets",
      mutates: false,
      description: "List Edie's workflow presets, what each does and whether it needs an attached script.",
      inputSchema: obj({})
    },
    {
      name: "apply_preset",
      mutates: true,
      description: "CHANGES THE PROJECT. Run one Edie workflow preset from list_presets on the active sequence.",
      inputSchema: obj({
        preset: { type: "string", description: "Preset id from list_presets." }
      }, ["preset"])
    },
    {
      name: "list_legacy_actions",
      mutates: false,
      description: "List Edie's low-level edit actions (markers, trims, moves, deletes, inserts, renames, motion, fades, track mute/lock...) with their fields, for run_legacy_action.",
      inputSchema: obj({})
    },
    {
      name: "run_legacy_action",
      mutates: true,
      description: "CHANGES THE PROJECT. Apply one or more low-level Edie actions ({type, ...fields} from list_legacy_actions) to the active sequence. Applied together; the user can undo them with undo_last.",
      inputSchema: obj({
        actions: { type: "array", items: { type: "object" }, description: "Action objects, e.g. {\"type\":\"addSequenceMarker\",\"name\":\"Intro\",\"seconds\":0}." }
      }, ["actions"])
    },
    {
      name: "undo_last",
      mutates: true,
      description: "CHANGES THE PROJECT. Undo Edie's last apply.",
      inputSchema: obj({})
    }
  ];

  function toolList() {
    return TOOLS.map(function (t) {
      return {
        name: t.name,
        description: (t.mutates ? "" : "Read-only for the Premiere project. ") + t.description,
        inputSchema: t.inputSchema,
        annotations: {
          readOnlyHint: !t.mutates,
          destructiveHint: t.name === "run_legacy_action",
          idempotentHint: false,
          openWorldHint: false
        }
      };
    });
  }

  function toolByName(name) {
    for (var i = 0; i < TOOLS.length; i++) {
      if (TOOLS[i].name === name) {
        return TOOLS[i];
      }
    }
    return null;
  }

  /* ---------- files ---------- */

  function supportDir(os, path, env) {
    if (os.platform() === "win32") {
      var appData = (env && env.APPDATA) || path.join(os.homedir(), "AppData", "Roaming");
      return path.join(appData, "PR FX Palette", "prai");
    }
    return path.join(os.homedir(), "Library", "Application Support", "PR FX Palette", "prai");
  }

  function ensureDir(fs, dir, mode) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: mode || 448 });
    }
    return dir;
  }

  function writeFileAtomic(fs, path, filePath, data, mode) {
    var tmp = path.join(path.dirname(filePath), "." + path.basename(filePath) + "." + Date.now() + "." + Math.floor(Math.random() * 1e9) + ".tmp");
    fs.writeFileSync(tmp, data, mode ? { encoding: "utf8", mode: mode } : "utf8");
    fs.renameSync(tmp, filePath);
    return filePath;
  }

  function safeName(value, fallback) {
    var name = String(value || "").replace(/[\/\\:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").replace(/^[\s.]+|[\s.]+$/g, "");
    return name ? name.slice(0, 120) : fallback;
  }

  /* "name.srt" -> "name (2).srt" ... never an existing path. */
  function uniquePath(fs, path, dir, fileName) {
    var ext = path.extname(fileName) || ".srt";
    var base = fileName.slice(0, fileName.length - path.extname(fileName).length) || "captions";
    var candidate = path.join(dir, base + ext);
    var n = 2;
    while (fs.existsSync(candidate)) {
      candidate = path.join(dir, base + " (" + n + ")" + ext);
      n++;
    }
    return candidate;
  }

  function stamp() {
    var d = new Date();
    function p(n) { return n < 10 ? "0" + n : String(n); }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + "." + p(d.getMinutes()) + "." + p(d.getSeconds());
  }

  function previewBlocks(blocks, count) {
    var lines = [];
    for (var i = 0; i < blocks.length && i < (count || 8); i++) {
      lines.push((i + 1) + ". [" + blocks[i].start.toFixed(2) + "-" + blocks[i].end.toFixed(2) + "] " + String(blocks[i].text).replace(/\s+/g, " "));
    }
    if (blocks.length > lines.length) {
      lines.push("... " + (blocks.length - lines.length) + " more");
    }
    return lines.join("\n");
  }

  function shiftBlocks(blocks, offset) {
    return blocks.map(function (b) {
      return { start: Number(b.start) + offset, end: Number(b.end) + offset, text: b.text };
    });
  }

  /* ---------- handlers ---------- */

  /* deps (panel bridge, or stubs under node):
       nodeRequire, srt: {parseSrtBlocks, buildSrtFromBlocks, optimizedCaptionItemsFromTimedBlocks,
       whisperWordsFromJsonText, captionSettings()}, and for project tools:
       projectContext(includeItems), selectedClips(), activeScript(), whisperReady(),
       transcribe(action), importSrt(contents, startAt), runPreset(id), legacyActions(),
       applyActions(actions), undoLast(), confirm(tool, summary) -> Promise<boolean>. */
  function createHandlers(deps) {
    var nodeRequire = deps.nodeRequire;
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    var os = nodeRequire("os");
    var srt = deps.srt;
    var root = deps.supportDir || supportDir(os, path, nodeRequire("process").env);
    var workDir = function () { return ensureDir(fs, path.join(root, "srt")); };

    function need(fn, label) {
      if (typeof deps[fn] !== "function") {
        throw new Error(label + " is not available outside Edie's Premiere runtime.");
      }
      return deps[fn];
    }

    function readSrtFile(p) {
      if (!p || !fs.existsSync(p)) {
        throw new Error("No SRT file at " + p + ".");
      }
      var blocks = srt.parseSrtBlocks(fs.readFileSync(p, "utf8"));
      if (!blocks.length) {
        throw new Error(p + " has no subtitle rows.");
      }
      return blocks;
    }

    function writeWorkSrt(hint, blocks) {
      var contents = srt.buildSrtFromBlocks(blocks);
      if (!contents.replace(/\s+/g, "")) {
        throw new Error("Nothing to write: every row is empty.");
      }
      var file = uniquePath(fs, path, workDir(), safeName(hint, "captions") + " " + stamp() + ".srt");
      writeFileAtomic(fs, path, file, contents);
      return file;
    }

    function readWords(p) {
      if (!p) {
        return [];
      }
      if (!fs.existsSync(p)) {
        throw new Error("No word-timing file at " + p + ".");
      }
      var parsed = JSON.parse(fs.readFileSync(p, "utf8"));
      if (parsed && parsed.praiWords && parsed.words) {
        return parsed.words;
      }
      return srt.whisperWordsFromJsonText(JSON.stringify(parsed));
    }

    function confirmed(name, summary) {
      if (typeof deps.confirm !== "function") {
        return Promise.resolve(true);
      }
      return Promise.resolve(deps.confirm(name, summary));
    }

    var handlers = {
      get_project_context: function (args) {
        return Promise.resolve(need("projectContext", "Project context")(!!args.include_project_items));
      },

      get_active_script: function () {
        var script = need("activeScript", "The script")() || {};
        var text = String(script.text || "");
        return { name: script.name || "", characters: text.length, text: text.length > 20000 ? text.slice(0, 20000) + "\n... (truncated)" : text };
      },

      transcribe_audio_to_srt: function (args) {
        var action = { type: "transcribeAudioTrackToSrt", skipImport: true, optimizeCaptions: args.optimize === true, suppressUI: true };
        if (args.audio_track) {
          action.audioTrack = String(args.audio_track);
        }
        var rangeReady = Promise.resolve();
        if (args.use_selection) {
          rangeReady = Promise.resolve(need("selectedClips", "Selection")()).then(function (clips) {
            if (!clips || !clips.length) {
              throw new Error("No clips are selected in the Timeline.");
            }
            var start = Infinity;
            var end = -Infinity;
            for (var i = 0; i < clips.length; i++) {
              start = Math.min(start, Number(clips[i].startSeconds));
              end = Math.max(end, Number(clips[i].endSeconds));
            }
            action.startSeconds = start;
            action.endSeconds = end;
          });
        }
        return rangeReady.then(function () {
          if (isFinite(args.start_seconds)) {
            action.startSeconds = Number(args.start_seconds);
          }
          if (isFinite(args.end_seconds)) {
            action.endSeconds = Number(args.end_seconds);
          }
          return need("transcribe", "Transcription")(action);
        }).then(function (result) {
          var offset = Number(result.rangeStart) || 0;
          var blocks = shiftBlocks(srt.parseSrtBlocks(result.contents || ""), offset);
          if (!blocks.length) {
            throw new Error("Whisper heard no speech in that range.");
          }
          var hint = (result.sequenceName || "transcript") + " " + (result.track || "audio");
          var file = writeWorkSrt(hint, blocks);
          var wordsFile = "";
          if (result.jsonPath && fs.existsSync(result.jsonPath)) {
            var words = shiftBlocks(srt.whisperWordsFromJsonText(fs.readFileSync(result.jsonPath, "utf8")), offset);
            if (words.length) {
              wordsFile = file.replace(/\.srt$/i, ".words.json");
              writeFileAtomic(fs, path, wordsFile, JSON.stringify({ praiWords: 1, words: words }));
            }
          }
          return {
            srt_path: file,
            words_json_path: wordsFile,
            subtitle_count: blocks.length,
            audio: result.track || "",
            range_seconds: [offset, Number(result.rangeEnd) || offset],
            times_are: "sequence time (import with start_at_seconds 0)",
            optimized: args.optimize === true,
            preview: previewBlocks(blocks, 8)
          };
        });
      },

      create_optimized_subtitles: function (args) {
        var transcribeArgs = {
          audio_track: args.audio_track,
          start_seconds: args.start_seconds,
          end_seconds: args.end_seconds,
          use_selection: args.use_selection,
          optimize: false
        };
        return Promise.resolve(handlers.transcribe_audio_to_srt(transcribeArgs)).then(function (raw) {
          return Promise.resolve(handlers.optimize_srt({
            input_path: raw.srt_path,
            words_json_path: raw.words_json_path || ""
          })).then(function (optimized) {
            return Promise.resolve(handlers.save_srt({
              input_path: optimized.srt_path,
              destination_folder: args.destination_folder,
              file_name: args.file_name
            })).then(function (saved) {
              if (args.import_to_timeline === false) {
                return {
                  saved_path: saved.saved_path,
                  imported: false,
                  subtitle_count: optimized.rows_after,
                  rows_before: optimized.rows_before,
                  rows_after: optimized.rows_after,
                  timing: optimized.timing,
                  preview: optimized.preview
                };
              }
              return Promise.resolve(handlers.import_srt_as_captions({ input_path: saved.saved_path, start_at_seconds: 0 })).then(function () {
                return {
                  saved_path: saved.saved_path,
                  imported: true,
                  subtitle_count: optimized.rows_after,
                  rows_before: optimized.rows_before,
                  rows_after: optimized.rows_after,
                  timing: optimized.timing,
                  preview: optimized.preview
                };
              });
            });
          });
        });
      },

      optimize_srt: function (args) {
        var blocks = readSrtFile(args.input_path);
        var words = readWords(args.words_json_path);
        var settings = srt.captionSettings ? srt.captionSettings() : { maxWords: 7, maxCharacters: 42, mode: "readability", trimEndPunctuation: true };
        if (isFinite(args.max_words)) {
          settings.maxWords = Math.max(1, Math.min(20, Math.round(args.max_words)));
        }
        if (isFinite(args.max_characters)) {
          settings.maxCharacters = Math.max(8, Math.min(90, Math.round(args.max_characters)));
        }
        if (args.split_mode === "readability" || args.split_mode === "punctuation" || args.split_mode === "even") {
          settings.mode = args.split_mode;
        }
        if (typeof args.trim_end_punctuation === "boolean") {
          settings.trimEndPunctuation = args.trim_end_punctuation;
        }
        var items = srt.optimizedCaptionItemsFromTimedBlocks(blocks, words, settings);
        if (!items.length) {
          throw new Error("Optimising produced no rows.");
        }
        var hint = path.basename(args.input_path).replace(/\.srt$/i, "").replace(/ \d{4}-\d\d-\d\d \d\d\.\d\d\.\d\d( \(\d+\))?$/, "") + " optimized";
        var file = writeWorkSrt(hint, items);
        return {
          srt_path: file,
          rows_before: blocks.length,
          rows_after: items.length,
          timing: words.length ? "word-timed" : "proportional",
          settings: settings,
          preview: previewBlocks(items, 10)
        };
      },

      read_srt: function (args) {
        var blocks = readSrtFile(args.path);
        var offset = Math.max(1, Math.round(Number(args.offset) || 1));
        var limit = Math.max(1, Math.min(2000, Math.round(Number(args.limit) || 400)));
        var rows = [];
        for (var i = offset - 1; i < blocks.length && rows.length < limit; i++) {
          rows.push({ index: i + 1, start: Math.round(blocks[i].start * 1000) / 1000, end: Math.round(blocks[i].end * 1000) / 1000, text: blocks[i].text });
        }
        return { path: args.path, total_rows: blocks.length, rows: rows };
      },

      write_srt: function (args) {
        var blocks;
        if (args.blocks && args.blocks.length) {
          blocks = args.blocks.map(function (b) {
            return { start: Number(b.start), end: Number(b.end), text: String(b.text || "") };
          });
          for (var i = 0; i < blocks.length; i++) {
            if (!isFinite(blocks[i].start) || !isFinite(blocks[i].end) || blocks[i].end < blocks[i].start) {
              throw new Error("Row " + (i + 1) + " has invalid times.");
            }
          }
        } else if (args.source_path) {
          blocks = readSrtFile(args.source_path);
          var edits = args.edits || [];
          for (var e = 0; e < edits.length; e++) {
            var index = Math.round(Number(edits[e].index));
            if (!(index >= 1 && index <= blocks.length)) {
              throw new Error("Edit " + (e + 1) + " points at row " + edits[e].index + ", but the file has " + blocks.length + " rows.");
            }
            blocks[index - 1].text = String(edits[e].text || "");
          }
        } else {
          throw new Error("Give either blocks or source_path with edits.");
        }
        var hint = args.name || (args.source_path ? path.basename(args.source_path).replace(/\.srt$/i, "").replace(/ \d{4}-\d\d-\d\d \d\d\.\d\d\.\d\d( \(\d+\))?$/, "") + " edited" : "captions");
        var file = writeWorkSrt(hint, blocks);
        return { srt_path: file, rows: blocks.filter(function (b) { return String(b.text).replace(/\s+/g, ""); }).length, preview: previewBlocks(blocks, 6) };
      },

      save_srt: function (args) {
        var source = args.input_path;
        readSrtFile(source);
        var folderReady;
        if (args.destination_folder) {
          folderReady = Promise.resolve({ folder: String(args.destination_folder), why: "requested folder" });
        } else {
          folderReady = Promise.resolve(typeof deps.projectContext === "function" ? deps.projectContext(false) : null).then(function (ctx) {
            if (ctx && ctx.project_path) {
              return { folder: path.dirname(ctx.project_path), why: "next to the project file", sequence: ctx.active_sequence && ctx.active_sequence.name };
            }
            // The Mac keeps videos in ~/Movies, Windows in Videos.
            var videos = os.platform() === "win32" ? "Videos" : "Movies";
            return { folder: path.join(os.homedir(), videos, "Edie Captions"), why: "the project has not been saved yet, so ~/" + videos + "/Edie Captions" };
          });
        }
        return folderReady.then(function (target) {
          var folder = target.folder.replace(/^~(?=$|\/)/, os.homedir());
          ensureDir(fs, folder, 493);
          var name = safeName(args.file_name, "");
          if (!name) {
            name = safeName(target.sequence ? target.sequence + " captions" : path.basename(source).replace(/ \d{4}-\d\d-\d\d \d\d\.\d\d\.\d\d( \(\d+\))?(?=\.srt$)/i, ""), "captions");
          }
          if (!/\.srt$/i.test(name)) {
            name += ".srt";
          }
          var dest = uniquePath(fs, path, folder, name);
          var data = fs.readFileSync(source);
          var tmp = path.join(folder, "." + path.basename(dest) + "." + Date.now() + "." + Math.floor(Math.random() * 1e9) + ".tmp");
          fs.writeFileSync(tmp, data, { flag: "wx" });
          if (fs.existsSync(dest)) {
            fs.unlinkSync(tmp);
            throw new Error("Something created " + dest + " while saving; nothing was overwritten. Try again.");
          }
          fs.renameSync(tmp, dest);
          return { saved_path: dest, where: target.why };
        });
      },

      import_srt_as_captions: function (args) {
        var blocks = readSrtFile(args.input_path);
        var startAt = isFinite(args.start_at_seconds) ? Number(args.start_at_seconds) : 0;
        return confirmed("import_srt_as_captions", "Import " + blocks.length + " caption rows from " + path.basename(args.input_path) + " into the active sequence as a new caption track").then(function (ok) {
          if (!ok) {
            throw new Error("The user declined this change. Nothing was imported.");
          }
          return need("importSrt", "Caption import")(fs.readFileSync(args.input_path, "utf8"), startAt);
        });
      },

      list_presets: function () {
        return { presets: WORKFLOW_PRESETS };
      },

      apply_preset: function (args) {
        var preset = null;
        for (var i = 0; i < WORKFLOW_PRESETS.length; i++) {
          if (WORKFLOW_PRESETS[i].id === args.preset) {
            preset = WORKFLOW_PRESETS[i];
          }
        }
        if (!preset) {
          throw new Error("Unknown preset \"" + args.preset + "\". Call list_presets.");
        }
        return confirmed("apply_preset", "Run the \"" + preset.label + "\" workflow on the active sequence").then(function (ok) {
          if (!ok) {
            throw new Error("The user declined this change. Nothing was run.");
          }
          return need("runPreset", "Presets")(preset.id);
        });
      },

      list_legacy_actions: function () {
        return { actions: need("legacyActions", "The action list")() };
      },

      run_legacy_action: function (args) {
        var actions = args.actions || [];
        if (!actions.length) {
          throw new Error("No actions given.");
        }
        for (var i = 0; i < actions.length; i++) {
          if (!actions[i] || typeof actions[i].type !== "string") {
            throw new Error("Action " + (i + 1) + " has no type.");
          }
        }
        var summary = actions.map(function (a) { return a.type; }).join(", ");
        return confirmed("run_legacy_action", "Apply " + actions.length + " edit action(s): " + summary).then(function (ok) {
          if (!ok) {
            throw new Error("The user declined this change. Nothing was applied.");
          }
          return need("applyActions", "Edit actions")(actions);
        });
      },

      undo_last: function () {
        return confirmed("undo_last", "Undo Edie's last apply").then(function (ok) {
          if (!ok) {
            throw new Error("The user declined. Nothing was undone.");
          }
          return need("undoLast", "Undo")();
        });
      }
    };

    return function call(name, args) {
      var tool = toolByName(name);
      if (!tool || !handlers[name]) {
        return Promise.reject(new Error("Unknown tool: " + name));
      }
      try {
        return Promise.resolve(handlers[name](args || {}));
      } catch (err) {
        return Promise.reject(err);
      }
    };
  }

  return {
    SERVER_NAME: SERVER_NAME,
    TOOLS: TOOLS,
    WORKFLOW_PRESETS: WORKFLOW_PRESETS,
    toolList: toolList,
    toolByName: toolByName,
    createHandlers: createHandlers,
    supportDir: supportDir,
    ensureDir: ensureDir,
    writeFileAtomic: writeFileAtomic,
    uniquePath: uniquePath
  };
}));
