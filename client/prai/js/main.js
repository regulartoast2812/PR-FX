(function () {
  "use strict";

  var cs = new CSInterface();
  var state = {};
  var lastProjectContextError = "";
  var pendingActions = { actions: [] };
  var undoStack = [];
  var chatHistory = [];
  var imageAttachments = [];
  var isAgentRunning = false;
  var agentCancelRequested = false;
  var activeAgentChild = null;
  var activeAgentRunId = 0;
  var requestStartedAt = 0;
  var requestTimerId = null;
  var scriptValidationStartedAt = 0;
  var scriptValidationTimerId = null;
  var activeUserRequest = "";
  var requestRunLabel = "Ready to send";
  var statusLogEntries = [];
  var comfyModelProgressTimer = null;
  var selectedRemoveClip = null;
  var removePreviewScrubTimer = null;
  var sheetDraggedRowIndex = null;
  var sheetDraggedColumnIndex = null;
  var sheetContextRowIndex = null;
  var sheetContextColumnIndex = null;
  var sheetSelection = null;
  var sheetCellDragAnchor = null;
  var sheetPointerDownCell = null;
  var sheetPointerDownX = 0;
  var sheetPointerDownY = 0;
  var sheetPointerDragged = false;
  var sheetActiveRowIndex = 0;
  var sheetActiveColumnIndex = 0;
  var sheetSelectionAnchorRow = 0;
  var sheetSelectionAnchorColumn = 0;
  var sheetEditMode = false;
  var sheetEditingCell = null;
  var sheetEditOriginalText = "";
  var sheetEditUndoCaptured = false;
  var sheetLastRowIndex = null;
  var sheetLastColumnIndex = null;
  var sheetUndoStack = [];
  var sheetRedoStack = [];
  var scriptDocuments = [{ id: "script-1", name: "Script 1", html: "" }];
  var activeScriptId = "script-1";
  var selectedScriptId = "";
  var scriptProjects = [{ id: "project-1", name: "Product Project", activeScriptId: activeScriptId, selectedScriptId: selectedScriptId, scripts: scriptDocuments }];
  var activeScriptProjectId = "project-1";
  var scriptTabClickTimer = null;
  var scriptEditorSnapshot = null;
  var scriptDocumentsStorageKey = "pr-ai-script-documents";
  var targetSequenceStorageKey = "pr-ai-target-sequence-id";
  var targetSequenceId = "";
  var editGuideStorageKey = "pr-ai-edit-guide";
  var textTempFolderStorageKey = "pr-ai-text-temp-folder";
  var xmlOutputFolderStorageKey = "pr-ai-xml-output-folder";
  var xmlAfterCreateActionStorageKey = "pr-ai-xml-after-create-action";
  var includeComponentsStorageKey = "pr-ai-include-components";
  var ffmpegPathStorageKey = "pr-ai-ffmpeg-path";
  var whisperCommandStorageKey = "pr-ai-whisper-command";
  var whisperModelStorageKey = "pr-ai-whisper-model";
  var whisperDeviceStorageKey = "pr-ai-whisper-device";
  var defaultAudioTrackStorageKey = "pr-ai-default-audio-track";
  var audioHeadPadStorageKey = "pr-ai-audio-head-pad";
  var audioTailPadStorageKey = "pr-ai-audio-tail-pad";
  var captionMaxWordsStorageKey = "pr-ai-caption-max-words";
  var captionMaxCharsStorageKey = "pr-ai-caption-max-chars";
  var captionSplitModeStorageKey = "pr-ai-caption-split-mode";
  var captionTrimEndPunctuationStorageKey = "pr-ai-caption-trim-end-punctuation";
  var defaultCaptionMaxWords = 6;
  var defaultCaptionMaxChars = 34;
  var defaultCaptionSplitMode = "readability";
  var defaultScriptSplitText = true;
  var aiClaudeModelStorageKey = "pr-ai-claude-model";
  var aiClaudeModelUpgradeStorageKey = "pr-ai-claude-model-upgraded-to";
  var defaultAiClaudeModel = "claude-opus-5";
  var aiCodexModelStorageKey = "pr-ai-codex-model";
  var aiClaudeModeStorageKey = "pr-ai-claude-mode";
  var aiCodexModeStorageKey = "pr-ai-codex-mode";
  var comfyPathStorageKey = "pr-ai-comfy-path";
  var comfyPythonStorageKey = "pr-ai-comfy-python";
  var comfyServerUrlStorageKey = "pr-ai-comfy-server-url";
  var comfyWorkflowStorageKey = "pr-ai-comfy-workflow";
  var comfyWorkflowPathStorageKey = "pr-ai-comfy-workflow-path";
  var comfyImportModeStorageKey = "pr-ai-comfy-import-mode";
  var comfyOutputModeStorageKey = "pr-ai-comfy-output-mode";
  var comfyOutputFolderNameStorageKey = "pr-ai-comfy-output-folder-name";
  var comfyPositivePromptStorageKey = "pr-ai-comfy-positive-prompt";
  var comfyNegativePromptStorageKey = "pr-ai-comfy-negative-prompt";
  var comfyMaskStorageKey = "pr-ai-comfy-mask";
  var removeFrameStorageKey = "pr-ai-remove-frame";
  var removeTimingStorageKey = "pr-ai-remove-timing";
  var guideUpgradeText = [
    "",
    "Efficiency guide:",
    "When rebuilding an assembly from scratch, prefer the fewest timeline operations.",
    "If the new edit starts at 0 and replaces old footage, use overwriteClipRange for the new assembly instead of deleting the old footage first.",
    "After inserting/overwriting the new assembly, delete only leftover clips that start after the final new edit end.",
    "When linked video/audio is reliable, operate on V1 with linked:true and do not separately delete matching A1 clips.",
    "If a clean rebuild is requested and preserving the current sequence is not required, create a new sequence and assemble there instead of clearing the old one clip by clip.",
    "Use clearTrack or deleteTrackRange for bulk cleanup instead of emitting many deleteClip actions.",
    "",
    "Token efficiency guide:",
    "Batch all tracks for one video in one request, for example V1, V2, and V3 in the same message.",
    "For a new video, start fresh instead of carrying old chat context.",
    "Skip summary tables unless explicitly requested; output concise prose plus JSON only.",
    "For assembly tasks, do not rely on clip component properties; use project item IDs/names and source in/out times."
  ].join("\n");
  var defaultEditGuide = [
    "Edit like a Premiere timeline assistant.",
    "Prefer one complete ordered action plan over asking follow-up questions when the request gives enough timing or visual/script context.",
    "Use clipName plus targetStartSeconds for timeline clip actions when possible.",
    "For cleanup/removal, keep the useful takes and remove only clearly specified unwanted sections. If the request says remove unnecessary footage but gives no criteria, use obvious low-information sections from the provided script/image/context and explain assumptions briefly.",
    "For batch deletes, work from later timeline times toward earlier times on each track to avoid shifting targets.",
    "Return exactly one JSON object with all actions needed for the request.",
    guideUpgradeText
  ].join("\n");
  var styledTextCapsule = {
    id: "text-xml-two-style-graphic",
    name: "Text XML two-style saved Premiere template",
    workflow: "Create a styled Premiere XML file from the saved Source Text blob. Replacements must be the same byte length for now.",
    sequence: {
      width: 1920,
      height: 1080,
      timebase: 50,
      clipEndFrame: 114
    },
    globalPreviewValues: {
      fontFamily: "KitRounded-ExtraBold",
      fontSize: 30,
      areaTypeWidth: 900,
      areaTypeHeight: 180,
      textAlign: "center",
      strokeOrientation: "outer",
      strokeWidth: 2
    },
    styleSpans: [
      {
        text: "Best Selling",
        sourceSpans: ["Best Selling"],
        styleName: "yellowGradient",
        description: "Yellow gradient text treatment from the original first line.",
        font: "KitRounded-ExtraBold",
        fill: "yellow gradient stored in encoded blob",
        decodedValues: {
          confidence: "partial",
          textByteOffset: 808,
          byteLength: 12,
          likelyStyleOffset: 568,
          observedFields: {
            fontSizeLikeFloat: 186.6667,
            rangeStart: 0,
            rangeLength: 12,
            fillColorBytes: "00 18 18 18",
            gradientStopsLikeFloats: [1, 0.5, 0.5, 1, 0.5]
          }
        },
        previewValues: {
          sizeAdjust: 0,
          fillType: "gradient",
          fillColor: "#ffd735",
          fillColor2: "#dd9300",
          strokeColor: "#4d3200",
          strokeAdjust: 0,
          fillOverStroke: true,
          shadow: true
        }
      },
      {
        text: "pants",
        sourceSpans: ["pants", "in 2026"],
        styleName: "defaultWhite",
        description: "White default text treatment shared by the remaining source spans.",
        font: "KitRounded-ExtraBold",
        fill: "default white stored in encoded blob",
        decodedValues: {
          confidence: "partial",
          textByteOffset: 474,
          byteLength: 5,
          likelyStyleOffset: 408,
          observedFields: {
            fontSizeLikeFloat: 168.9454,
            rangeStart: 13,
            rangeLength: 6,
            fillColorBytes: "00 18 18 18"
          }
        },
        previewValues: {
          sizeAdjust: 0,
          fillType: "solid",
          fillColor: "#f7f8fb",
          fillColor2: "#f7f8fb",
          strokeColor: "#161616",
          strokeAdjust: 0,
          fillOverStroke: true,
          shadow: true
        }
      }
    ],
    testedReplacement: [
      { from: "Best Selling", to: "Second Layer", byteLength: 12 },
      { from: "pants", to: "style", byteLength: 5 },
      { from: "in 2026", to: "in 2027", byteLength: 7 }
    ]
  };
  var styledTextCapsules = [styledTextCapsule, {
    id: "text-xml-five-run-switching",
    name: "Text XML five-run switching Premiere template",
    workflow: "Copy the five-run Source Text component structure from Text style PR.xml for A/B/A/B/A word-by-word switching. Same-byte replacements only until the run-vector builder is implemented.",
    sequence: {
      width: 1920,
      height: 1080,
      timebase: 50,
      clipEndFrame: 250
    },
    globalPreviewValues: {
      fontFamily: "KitRounded-ExtraBold",
      fontSize: 85,
      areaTypeWidth: 900,
      areaTypeHeight: 180,
      textAlign: "center",
      strokeOrientation: "outer",
      strokeWidth: 2
    },
    styleSpans: [
      {
        text: "one ",
        sourceSpans: ["one ", " three ", " give"],
        styleName: "switchA",
        description: "First alternating style from the five-run example. Used by runs 0, 2, and 4.",
        font: "KitRounded-ExtraBold",
        decodedValues: {
          confidence: "component-map",
          runVectorOffset: 248,
          runObjectOffsets: [868, 532, 272],
          textByteOffsets: [1184, 724, 440],
          byteLengths: [4, 7, 5],
          styleObjectOffsets: [936, 544, 284]
        },
        previewValues: {
          sizeAdjust: 0,
          fillType: "gradient",
          fillColor: "#ffd735",
          fillColor2: "#dd9300",
          strokeColor: "#4d3200",
          strokeAdjust: 0,
          fillOverStroke: true,
          shadow: true
        }
      },
      {
        text: "two",
        sourceSpans: ["two", "four"],
        styleName: "switchB",
        description: "Second alternating style from the five-run example. Used by runs 1 and 3.",
        font: "KitRounded-ExtraBold",
        decodedValues: {
          confidence: "component-map",
          runVectorOffset: 248,
          runObjectOffsets: [732, 448],
          textByteOffsets: [856, 516],
          byteLengths: [3, 4],
          styleObjectOffsets: [800, 460]
        },
        previewValues: {
          sizeAdjust: 0,
          fillType: "solid",
          fillColor: "#f7f8fb",
          fillColor2: "#f7f8fb",
          strokeColor: "#161616",
          strokeAdjust: 0,
          fillOverStroke: true,
          shadow: true
        }
      }
    ],
    testedReplacement: [
      { from: "one ", to: "", byteLength: 4 },
      { from: "two", to: "", byteLength: 3 },
      { from: " three ", to: "", byteLength: 7 },
      { from: "four", to: "", byteLength: 4 },
      { from: " give", to: "", byteLength: 5 }
    ],
    runComponents: [
      { from: "one ", byteLength: 4, styleName: "switchA", runObjectOffset: 868, styleObjectOffset: 936, textByteOffset: 1184 },
      { from: "two", byteLength: 3, styleName: "switchB", runObjectOffset: 732, styleObjectOffset: 800, textByteOffset: 856 },
      { from: " three ", byteLength: 7, styleName: "switchA", runObjectOffset: 532, styleObjectOffset: 544, textByteOffset: 724 },
      { from: "four", byteLength: 4, styleName: "switchB", runObjectOffset: 448, styleObjectOffset: 460, textByteOffset: 516 },
      { from: " give", byteLength: 5, styleName: "switchA", runObjectOffset: 272, styleObjectOffset: 284, textByteOffset: 440 }
    ]
  }];
  var workflowMapNodes = [
    {
      id: "capture",
      title: "1. Capture",
      subtitle: "Premiere XML capsule",
      x: 90,
      y: 78,
      w: 156,
      h: 70,
      detail: "Export or keep a known-good Premiere XML text clip. This is the source of truth for hidden Premiere styling.",
      guide: "Start from the saved text-xml-two-style-graphic capsule, not from invented text properties."
    },
    {
      id: "decode",
      title: "2. Decode",
      subtitle: "Offsets and spans",
      x: 336,
      y: 62,
      w: 156,
      h: 70,
      detail: "Decode the Source Text blob enough to identify text byte offsets, span lengths, font name, and candidate style blocks.",
      guide: "Use decodedValues as partial evidence only; do not treat unvalidated blob fields as final Premiere style controls."
    },
    {
      id: "preview",
      title: "3. Preview",
      subtitle: "Editable style values",
      x: 590,
      y: 78,
      w: 168,
      h: 70,
      detail: "Use previewValues for visible choices: size, fill, stroke, gradient, and fill-over-stroke. This is the agent-facing style language.",
      guide: "Reference previewValues when asking the agent for a styled graphic. Keep fillOverStroke true unless explicitly testing."
    },
    {
      id: "prompt",
      title: "4. Prompt",
      subtitle: "Same-byte replacements",
      x: 106,
      y: 260,
      w: 176,
      h: 74,
      detail: "Replace text only with strings that match the original byte length until variable-length blob editing is implemented.",
      guide: "For createStyledTextXml, clone a saved templateId. Use text-xml-two-style-graphic for 3 spans or text-xml-five-run-switching for A/B/A/B/A word components. Same-byte replacements are required per captured run. For multiple text frames, use the frames array in one createStyledTextXml action, not duplicateClip. If a frame's text does not fit and the user still needs XML output, ask for a matching template/capsule or same-length wording. Do not set suggestedName/name for XML files; the host enforces YYYY-MM-DD-HH-mm - AutoEdit - Function.xml."
    },
    {
      id: "xml",
      title: "5. Build XML",
      subtitle: "Clone encoded blob",
      x: 360,
      y: 286,
      w: 166,
      h: 74,
      detail: "The host clones the encoded blob, swaps same-length text bytes, wraps it in xmeml, and writes the importable XML.",
      guide: "Use createStyledTextXml only; never hand-write XML with writeTempTextFile. The host can emit multiple XML clipitems from action.frames, writes to the XML export folder setting, enforces the AutoEdit filename, and follows the XML action setting. Component editing is only a timeline workaround and does not create an XML file."
    },
    {
      id: "validate",
      title: "6. Validate",
      subtitle: "Import and diff loop",
      x: 612,
      y: 260,
      w: 176,
      h: 74,
      detail: "To turn preview settings into real XML style mutation, export one-property-at-a-time test clips and diff their blobs.",
      guide: "Validate size, fill, stroke width, and fill-over-stroke with separate Premiere exports before writing those values into the binary blob."
    }
  ];
  var workflowMapEdges = [
    ["capture", "decode"],
    ["decode", "preview"],
    ["preview", "prompt"],
    ["prompt", "xml"],
    ["xml", "validate"],
    ["validate", "decode"]
  ];
  var workflowMapDefinitions = {
    xml: {
      title: "XML Style Workflow Map",
      guideTitle: "XML style workflow guide",
      nodes: workflowMapNodes,
      edges: workflowMapEdges
    },
    autocut: {
      title: "Autocut Workflow Map",
      guideTitle: "Autocut workflow guide",
      nodes: [
        { id: "readTimeline", title: "1. Read Timeline", subtitle: "Use placed clips", x: 92, y: 84, w: 176, h: 72, detail: "Start from clips already given in the active timeline. Treat their order, names, and visible ranges as the source pool.", guide: "For autocut, use timeline clips first; do not invent source media." },
        { id: "selectKeeps", title: "2. Select Keeps", subtitle: "Find usable moments", x: 344, y: 62, w: 176, h: 72, detail: "Identify strong sections, remove dead air or unwanted ranges, and preserve useful takes.", guide: "When criteria are vague, remove only obvious low-information sections and explain assumptions briefly." },
        { id: "assemble", title: "3. Assemble", subtitle: "Fewest operations", x: 606, y: 84, w: 176, h: 72, detail: "Prefer bulk range operations and ordered assembly actions over many tiny edits.", guide: "Use assembleFromScript, overwriteClipRange, clearTrack, or deleteTrackRange when they fit." },
        { id: "sync", title: "4. Sync Tracks", subtitle: "Linked video/audio", x: 126, y: 278, w: 176, h: 72, detail: "Keep linked video and audio together unless the user asks for separate audio work.", guide: "Use linked:true when removing or assembling matching video/audio." },
        { id: "polish", title: "5. Polish", subtitle: "Markers, trims, levels", x: 376, y: 302, w: 176, h: 72, detail: "Add markers, trims, enable states, and gain changes after the structure is set.", guide: "Make cleanup and polish actions after the main edit order is stable." },
        { id: "verify", title: "6. Verify", subtitle: "Refresh context", x: 628, y: 278, w: 176, h: 72, detail: "Refresh the project context after applying actions and inspect failures or changed clip positions.", guide: "After autocut actions, refresh before emitting follow-up edits." }
      ],
      edges: [["readTimeline", "selectKeeps"], ["selectKeeps", "assemble"], ["assemble", "sync"], ["sync", "polish"], ["polish", "verify"], ["verify", "readTimeline"]]
    },
    text: {
      title: "Text Workflow Map",
      guideTitle: "Text workflow guide",
      nodes: [
        { id: "choosePath", title: "1. Choose Path", subtitle: "Text, Subtitles, XML", x: 96, y: 74, w: 178, h: 72, detail: "Default text insertion uses the caption/SRT path. Graphic, MOGRT, XML, and SVG paths are explicit opt-in workflows.", guide: "For insert text, add text, text overlay, subtitle, caption, or SRT requests, use importSrtFile/importCaptionFile with inline SRT contents and createCaptionTrack:false. Do not create a graphic layer unless the user explicitly asks for XML, MOGRT/template, Essential Graphics, or a graphics clip/property edit." },
        { id: "style", title: "2. Style", subtitle: "Preview values", x: 354, y: 58, w: 168, h: 72, detail: "Use the Styles panel settings for font, global size, fill, stroke, alignment, and fill-over-stroke.", guide: "Keep fillOverStroke true unless explicitly testing a different stroke stack." },
        { id: "content", title: "3. Content", subtitle: "Text and byte rules", x: 610, y: 78, w: 176, h: 72, detail: "For styled XML, match source byte lengths per frame until variable-length blob editing is implemented.", guide: "Use same-byte replacements for XML source spans. Split multi-line XML requests into createStyledTextXml.frames when each frame can fit the saved spans." },
        { id: "write", title: "4. Write/Insert", subtitle: "Host action", x: 132, y: 276, w: 176, h: 72, detail: "Emit the right supported host action: importSrtFile/importCaptionFile for inserted text and subtitles, or the explicit XML/MOGRT/graphics path only when requested.", guide: "Pick one clear text path and emit the fewest actions. For script tables, time Overlay Text captions from Cut from Source row durations, including rows with no overlay as elapsed timeline time. For multiple fixed-capsule XML frames, use one createStyledTextXml action with frames only when the request explicitly asks for XML/graphics." },
        { id: "import", title: "5. Import", subtitle: "Premiere result", x: 384, y: 304, w: 176, h: 72, detail: "Import generated XML/text files into Premiere. Styled XML defaults to the XML folder beside the project file.", guide: "Use the project-adjacent XML folder for styled XML unless an output folder is explicitly requested." },
        { id: "inspect", title: "6. Inspect", subtitle: "Properties/style", x: 636, y: 276, w: 176, h: 72, detail: "Inspect the imported graphic and update the style capsule when new values are proven.", guide: "Only promote decoded style fields after validation in Premiere." }
      ],
      edges: [["choosePath", "style"], ["style", "content"], ["content", "write"], ["write", "import"], ["import", "inspect"], ["inspect", "style"]]
    }
  };
  workflowMapDefinitions.functions = {
    title: "PR AI Function Logic Map",
    guideTitle: "PR AI function logic guide",
    nodes: [
      { id: "script", title: "Script", subtitle: "Rows, roles, folders", x: 64, y: 80, w: 174, h: 70, detail: "Selected script/project provides Text/Overlay, Source File, Cut from Source, notes, and merge-cell grouping.", guide: "Validate roles first. Text, Source, and Cut columns drive every row workflow." },
      { id: "quick", title: "Prompt Intent", subtitle: "Detect workflow", x: 348, y: 58, w: 180, h: 70, detail: "Concrete prompts select Full Process, Layout, Audio + Text, New Sequence, or custom supported actions. Shortcut buttons remain optional.", guide: "The prompt is sufficient to run an edit. Use a shortcut button only when you want to force a known workflow; New Sequence can combine with another workflow." },
      { id: "settings", title: "Settings", subtitle: "Tracks, AI, padding", x: 632, y: 80, w: 184, h: 70, detail: "Settings provide target sequence, AI provider/model/mode, audio track, and head/tail padding.", guide: "Full Process and Audio + Text depend on configured audio track and Whisper command." },
      { id: "resolve", title: "Resolve", subtitle: "Sources + cuts", x: 92, y: 262, w: 180, h: 74, detail: "Source labels are matched to Premiere project items; cut text becomes source in/out ranges.", guide: "Numbers like 18 can match unique file tokens like H18.mp4. Single seconds like giay 11 become 11.0-12.0." },
      { id: "build", title: "Build Actions", subtitle: "Local or host plan", x: 360, y: 292, w: 180, h: 74, detail: "The panel either emits one local action or asks the agent for supported host actions.", guide: "Prefer one local workflow action for Full Process; use insertClipRange/importSrtFile for Layout." },
      { id: "apply", title: "Apply", subtitle: "Premiere timeline", x: 642, y: 262, w: 180, h: 74, detail: "Host applies inserts, deletes, captions, audio splits, and refreshes context.", guide: "Failures should surface clearly; refresh context after timeline changes." }
    ],
    edges: [["script", "quick"], ["quick", "settings"], ["script", "resolve"], ["settings", "build"], ["resolve", "build"], ["build", "apply"], ["apply", "script"]]
  };
  workflowMapDefinitions.fullProcess = {
    title: "Full Process Logic Map",
    guideTitle: "Full Process logic guide",
    nodes: [
      { id: "rows", title: "1. Rows", subtitle: "Text + media groups", x: 70, y: 76, w: 176, h: 72, detail: "Read selected script rows, preserving line-down text and merged media cells.", guide: "Subtitle rows always follow script lines. Media groups can span multiple rows when source/cut cells are merged or repeated." },
      { id: "whisper", title: "2. Whisper", subtitle: "Word timing", x: 352, y: 54, w: 176, h: 72, detail: "Export temporary analysis audio and align script rows to word timings.", guide: "The temp WAV is only for analysis; it must not be imported into the project bin." },
      { id: "windows", title: "3. Windows", subtitle: "Audio vs media", x: 632, y: 76, w: 176, h: 72, detail: "Each row/group duration is the longer of aligned audio/subtitle duration or media cut duration.", guide: "Subtitle duration equals audio, not expanded footage. Overall row spacing can expand for longer footage." },
      { id: "media", title: "4. Media", subtitle: "V1 source ranges", x: 96, y: 278, w: 176, h: 72, detail: "Place Source File/Cut ranges sequentially on one video track.", guide: "Use projectItemId/sourcePath when possible. Single-second cuts use full selected second." },
      { id: "audio", title: "5. Audio", subtitle: "Preserved in place", x: 364, y: 304, w: 176, h: 72, detail: "Razor and move the existing configured-track clips without clearing or replacing them.", guide: "Head/tail padding comes from Audio settings. Analysis WAVs stay temporary and are never imported; source timeline audio is never bulk-deleted." },
      { id: "captions", title: "6. Captions", subtitle: "Optimized chunks", x: 632, y: 278, w: 176, h: 72, detail: "Import readable subtitle chunks inside each aligned audio row.", guide: "Original Text controls audio cuts; Optimized Text controls caption subdivision." }
    ],
    edges: [["rows", "whisper"], ["whisper", "windows"], ["windows", "media"], ["windows", "audio"], ["audio", "captions"], ["media", "captions"]]
  };
  workflowMapDefinitions.layout = {
    title: "Layout Logic Map",
    guideTitle: "Layout logic guide",
    nodes: [
      { id: "script", title: "1. Script", subtitle: "Source/Cut/Text", x: 84, y: 76, w: 176, h: 72, detail: "Use selected script rows only.", guide: "No Whisper. No audio rebuild. Text and sources come from the selected script." },
      { id: "parse", title: "2. Parse Cuts", subtitle: "Flexible groups", x: 354, y: 56, w: 176, h: 72, detail: "Convert ranges, decimal commas, annotations, and one or more single-second selections into source in/out.", guide: "Pair meaningful Cut lines with Source lines in order. Ignore annotation-only lines; multiple selections on one Cut line use the same Source line." },
      { id: "resolve", title: "3. Resolve Media", subtitle: "Project items", x: 628, y: 76, w: 176, h: 72, detail: "Match source labels to project items and paths.", guide: "Plain numeric labels can match unique filename number tokens." },
      { id: "place", title: "4. Place Footage", subtitle: "V1 row order", x: 166, y: 286, w: 176, h: 72, detail: "Insert source ranges sequentially using cut durations.", guide: "Blank text rows still consume source duration." },
      { id: "caption", title: "5. Place Text", subtitle: "Timed captions", x: 516, y: 286, w: 176, h: 72, detail: "Import captions from Text/Overlay cells timed by source ranges.", guide: "One caption per text row, no audio timing." }
    ],
    edges: [["script", "parse"], ["parse", "resolve"], ["resolve", "place"], ["parse", "caption"], ["place", "caption"]]
  };
  workflowMapDefinitions.audioText = {
    title: "Audio + Text Logic Map",
    guideTitle: "Audio + Text logic guide",
    nodes: [
      { id: "script", title: "1. Script Lines", subtitle: "Provided text", x: 86, y: 82, w: 176, h: 72, detail: "Use Text/Overlay lines only, preserving line-down rows.", guide: "Exclude source, cut, and notes cells." },
      { id: "audio", title: "2. Audio Track", subtitle: "Configured A track", x: 354, y: 58, w: 176, h: 72, detail: "Export configured track for Whisper alignment.", guide: "This mode splits only the configured audio track." },
      { id: "align", title: "3. Align Words", subtitle: "WhisperX timings", x: 626, y: 82, w: 176, h: 72, detail: "Match provided script words to detected words.", guide: "Use word order/word counts when Whisper text is imperfect." },
      { id: "split", title: "4. Split Audio", subtitle: "Cut before lines", x: 202, y: 292, w: 176, h: 72, detail: "Razor audio at line starts with lead padding.", guide: "Cuts should be slightly before spoken line starts, not mid-word." },
      { id: "caption", title: "5. Captions", subtitle: "Optimized chunks", x: 516, y: 292, w: 176, h: 72, detail: "Create smaller subtitle chunks inside each script line's audio section.", guide: "Optimized captions must never add audio cuts." }
    ],
    edges: [["script", "align"], ["audio", "align"], ["align", "split"], ["split", "caption"]]
  };
  workflowMapDefinitions.script = {
    title: "Script + Project Folder Logic Map",
    guideTitle: "Script and project folder logic guide",
    nodes: [
      { id: "folder", title: "Folders", subtitle: "Project bins", x: 88, y: 78, w: 176, h: 72, detail: "Project folders hold separate script sets.", guide: "Folder panel shows all projects and script counts." },
      { id: "tabs", title: "Scripts", subtitle: "Tabs + selection", x: 354, y: 58, w: 176, h: 72, detail: "Script tabs can be selected for prompt context and opened for editing.", guide: "Selected scripts feed agent workflows." },
      { id: "sheet", title: "Sheet", subtitle: "Rows/columns/roles", x: 626, y: 78, w: 176, h: 72, detail: "Sheet cells carry text, source, cut, notes, and skip roles.", guide: "Merged source/cut cells define multi-row media groups." },
      { id: "validate", title: "Validate", subtitle: "Find issues", x: 202, y: 292, w: 176, h: 72, detail: "Validation checks missing sources, unparsed cut ranges, and ambiguous rows.", guide: "Fix highlighted cells before Full Process/Layout when possible." },
      { id: "cache", title: "Cache", subtitle: "Ready actions", x: 516, y: 292, w: 176, h: 72, detail: "Validated scripts can cache timeline actions for quick apply.", guide: "Refresh project context after applying." }
    ],
    edges: [["folder", "tabs"], ["tabs", "sheet"], ["sheet", "validate"], ["validate", "cache"], ["cache", "tabs"]]
  };
  var selectedWorkflowNodeId = "script";
  var currentWorkflowMapId = "functions";

  var els = {
    status: document.getElementById("status"),
    statusLog: document.getElementById("statusLog"),
    provider: document.getElementById("provider"),
    targetSequence: document.getElementById("targetSequence"),
    stylesBtn: document.getElementById("stylesBtn"),
    styleBrowserBtn: document.getElementById("styleBrowserBtn"),
    styleBrowserOverlay: document.getElementById("styleBrowserOverlay"),
    closeStyleBrowserBtn: document.getElementById("closeStyleBrowserBtn"),
    refreshStyleBrowserBtn: document.getElementById("refreshStyleBrowserBtn"),
    nativeStyleSummary: document.getElementById("nativeStyleSummary"),
    nativeStyleList: document.getElementById("nativeStyleList"),
    nativeStyleStatus: document.getElementById("nativeStyleStatus"),
    workflowMapBtn: document.getElementById("workflowMapBtn"),
    workflowMapOverlay: document.getElementById("workflowMapOverlay"),
    closeWorkflowMapBtn: document.getElementById("closeWorkflowMapBtn"),
    workflowMapSelect: document.getElementById("workflowMapSelect"),
    workflowMapCanvas: document.getElementById("workflowMapCanvas"),
    workflowMapDetails: document.getElementById("workflowMapDetails"),
    insertWorkflowGuideBtn: document.getElementById("insertWorkflowGuideBtn"),
    workflowMapStatus: document.getElementById("workflowMapStatus"),
    app: document.querySelector(".app"),
    agentPanel: document.getElementById("agentPanel"),
	    stylesOverlay: document.getElementById("stylesOverlay"),
    closeStylesBtn: document.getElementById("closeStylesBtn"),
    styleTemplateInfo: document.getElementById("styleTemplateInfo"),
    styleGlobalControls: document.getElementById("styleGlobalControls"),
    stylePreviewList: document.getElementById("stylePreviewList"),
    addStyleBtn: document.getElementById("addStyleBtn"),
    insertStylePromptBtn: document.getElementById("insertStylePromptBtn"),
    stylesStatus: document.getElementById("stylesStatus"),
    captionsBtn: document.getElementById("captionsBtn"),
    captionOverlay: document.getElementById("captionOverlay"),
    captionText: document.getElementById("captionText"),
    captionStart: document.getElementById("captionStart"),
    captionDuration: document.getElementById("captionDuration"),
    captionGap: document.getElementById("captionGap"),
    captionCreateTrack: document.getElementById("captionCreateTrack"),
    captionShowImportDialog: document.getElementById("captionShowImportDialog"),
    closeCaptionBtn: document.getElementById("closeCaptionBtn"),
    importCaptionsBtn: document.getElementById("importCaptionsBtn"),
    clearCaptionsBtn: document.getElementById("clearCaptionsBtn"),
    captionStatus: document.getElementById("captionStatus"),
    settingsBtn: document.getElementById("settingsBtn"),
    settingsOverlay: document.getElementById("settingsOverlay"),
    textTempFolder: document.getElementById("textTempFolder"),
    xmlOutputFolder: document.getElementById("xmlOutputFolder"),
    browseXmlFolderBtn: document.getElementById("browseXmlFolderBtn"),
    resetXmlFolderBtn: document.getElementById("resetXmlFolderBtn"),
    xmlAfterCreateAction: document.getElementById("xmlAfterCreateAction"),
    includeComponents: document.getElementById("includeComponents"),
    aiTestProvider: document.getElementById("aiTestProvider"),
    claudeModelSelect: document.getElementById("claudeModelSelect"),
    claudeModeSelect: document.getElementById("claudeModeSelect"),
    codexModelSelect: document.getElementById("codexModelSelect"),
    codexModeSelect: document.getElementById("codexModeSelect"),
    claudeAgentMenu: document.getElementById("claudeAgentMenu"),
    claudeAgentMenuLabel: document.getElementById("claudeAgentMenuLabel"),
    claudeAgentModelItems: document.getElementById("claudeAgentModelItems"),
    claudeAgentModeItems: document.getElementById("claudeAgentModeItems"),
    codexAgentMenu: document.getElementById("codexAgentMenu"),
    codexAgentMenuLabel: document.getElementById("codexAgentMenuLabel"),
    codexAgentModelItems: document.getElementById("codexAgentModelItems"),
    codexAgentModeItems: document.getElementById("codexAgentModeItems"),
    detectAiBtn: document.getElementById("detectAiBtn"),
    refreshAiModelsBtn: document.getElementById("refreshAiModelsBtn"),
    testAiBtn: document.getElementById("testAiBtn"),
    testClaudeBtn: document.getElementById("testClaudeBtn"),
    testCodexBtn: document.getElementById("testCodexBtn"),
    aiDetectStage: document.getElementById("aiDetectStage"),
    aiDetectState: document.getElementById("aiDetectState"),
    aiDetectLog: document.getElementById("aiDetectLog"),
    claudeTestStage: document.getElementById("claudeTestStage"),
    claudeTestState: document.getElementById("claudeTestState"),
    claudeTestLog: document.getElementById("claudeTestLog"),
    codexTestStage: document.getElementById("codexTestStage"),
    codexTestState: document.getElementById("codexTestState"),
    codexTestLog: document.getElementById("codexTestLog"),
    ffmpegPath: document.getElementById("ffmpegPath"),
    whisperCommand: document.getElementById("whisperCommand"),
    whisperModel: document.getElementById("whisperModel"),
    whisperDevice: document.getElementById("whisperDevice"),
    defaultAudioTrack: document.getElementById("defaultAudioTrack"),
    audioHeadPad: document.getElementById("audioHeadPad"),
    audioTailPad: document.getElementById("audioTailPad"),
    captionMaxWords: document.getElementById("captionMaxWords"),
    captionMaxChars: document.getElementById("captionMaxChars"),
    captionSplitMode: document.getElementById("captionSplitMode"),
    captionTrimEndPunctuation: document.getElementById("captionTrimEndPunctuation"),
    detectWhisperBtn: document.getElementById("detectWhisperBtn"),
    testWhisperBtn: document.getElementById("testWhisperBtn"),
    installFfmpegBtn: document.getElementById("installFfmpegBtn"),
    installWhisperBtn: document.getElementById("installWhisperBtn"),
    testWhisperModelBtn: document.getElementById("testWhisperModelBtn"),
    downloadWhisperModelBtn: document.getElementById("downloadWhisperModelBtn"),
    generateAudioCaptionsBtn: document.getElementById("generateAudioCaptionsBtn"),
    generateAudioCaptionsQuickBtn: document.getElementById("generateAudioCaptionsQuickBtn"),
    ffmpegInstallStage: document.getElementById("ffmpegInstallStage"),
    ffmpegInstallState: document.getElementById("ffmpegInstallState"),
    ffmpegInstallLog: document.getElementById("ffmpegInstallLog"),
    whisperInstallStage: document.getElementById("whisperInstallStage"),
    whisperInstallState: document.getElementById("whisperInstallState"),
    whisperInstallLog: document.getElementById("whisperInstallLog"),
    modelInstallStage: document.getElementById("modelInstallStage"),
    modelInstallState: document.getElementById("modelInstallState"),
    modelInstallLog: document.getElementById("modelInstallLog"),
    browseTextFolderBtn: document.getElementById("browseTextFolderBtn"),
    resetTextFolderBtn: document.getElementById("resetTextFolderBtn"),
    closeSettingsBtn: document.getElementById("closeSettingsBtn"),
    settingsStatus: document.getElementById("settingsStatus"),
    editGuideBtn: document.getElementById("editGuideBtn"),
    editGuideOverlay: document.getElementById("editGuideOverlay"),
    closeEditGuideBtn: document.getElementById("closeEditGuideBtn"),
    prompt: document.getElementById("prompt"),
    scriptProjectSelect: document.getElementById("scriptProjectSelect"),
    scriptProjectSettingsBtn: document.getElementById("scriptProjectSettingsBtn"),
    scriptProjectOverlay: document.getElementById("scriptProjectOverlay"),
    closeScriptProjectBtn: document.getElementById("closeScriptProjectBtn"),
    addScriptProjectPanelBtn: document.getElementById("addScriptProjectPanelBtn"),
    scriptProjectList: document.getElementById("scriptProjectList"),
    scriptProjectCount: document.getElementById("scriptProjectCount"),
    scriptProjectNameInput: document.getElementById("scriptProjectNameInput"),
    renameScriptProjectBtn: document.getElementById("renameScriptProjectBtn"),
    deleteScriptProjectBtn: document.getElementById("deleteScriptProjectBtn"),
    scriptTabs: document.getElementById("scriptTabs"),
    scriptEditorOverlay: document.getElementById("scriptEditorOverlay"),
    closeScriptEditorBtn: document.getElementById("closeScriptEditorBtn"),
    cancelScriptEditorBtn: document.getElementById("cancelScriptEditorBtn"),
    scriptValidationOverlay: document.getElementById("scriptValidationOverlay"),
    closeScriptValidationBtn: document.getElementById("closeScriptValidationBtn"),
    scriptValidationBody: document.getElementById("scriptValidationBody"),
    scriptNameInput: document.getElementById("scriptNameInput"),
    scriptValidationPrompt: document.getElementById("scriptValidationPrompt"),
    addScriptBtn: document.getElementById("addScriptBtn"),
    importScriptCsvBtn: document.getElementById("importScriptCsvBtn"),
    renameScriptBtn: document.getElementById("renameScriptBtn"),
    duplicateScriptBtn: document.getElementById("duplicateScriptBtn"),
    validateScriptBtn: document.getElementById("validateScriptBtn"),
    validateScriptAiBtn: document.getElementById("validateScriptAiBtn"),
    splitScriptTextBtn: document.getElementById("splitScriptTextBtn"),
    scriptMentionMenu: document.getElementById("scriptMentionMenu"),
    promptHighlight: document.getElementById("promptHighlight"),
    scriptSplitTextToggle: document.getElementById("scriptSplitTextToggle"),
    scriptNotesTrackToggle: document.getElementById("scriptNotesTrackToggle"),
    scriptWorkspaceState: document.getElementById("scriptWorkspaceState"),
    scriptWorkspaceStatus: document.getElementById("scriptWorkspaceStatus"),
    scriptWorkspacePercent: document.getElementById("scriptWorkspacePercent"),
    scriptValidationTimer: document.getElementById("scriptValidationTimer"),
    scriptValidationProgressFill: document.getElementById("scriptValidationProgressFill"),
    applyValidatedScriptBtn: document.getElementById("applyValidatedScriptBtn"),
    clearScriptBtn: document.getElementById("clearScriptBtn"),
    deleteScriptBtn: document.getElementById("deleteScriptBtn"),
    scriptInput: document.getElementById("scriptInput"),
    sheetColumnRail: document.getElementById("sheetColumnRail"),
    sheetRowRail: document.getElementById("sheetRowRail"),
    sheetContextMenu: document.getElementById("sheetContextMenu"),
    insertSheetRowAboveBtn: document.getElementById("insertSheetRowAboveBtn"),
    insertSheetRowBelowBtn: document.getElementById("insertSheetRowBelowBtn"),
    deleteSheetRowBtn: document.getElementById("deleteSheetRowBtn"),
    insertSheetColumnLeftBtn: document.getElementById("insertSheetColumnLeftBtn"),
    insertSheetColumnRightBtn: document.getElementById("insertSheetColumnRightBtn"),
    deleteSheetColumnBtn: document.getElementById("deleteSheetColumnBtn"),
    addSheetRowBtn: document.getElementById("addSheetRowBtn"),
    addSheetColumnBtn: document.getElementById("addSheetColumnBtn"),
    sheetSelectionSummary: document.getElementById("sheetSelectionSummary"),
    undoSheetBtn: document.getElementById("undoSheetBtn"),
    redoSheetBtn: document.getElementById("redoSheetBtn"),
    sheetColumnRole: document.getElementById("sheetColumnRole"),
    clearSheetBtn: document.getElementById("clearSheetBtn"),
    runStatus: document.getElementById("runStatus"),
    runState: document.getElementById("runState"),
    sendBtn: document.getElementById("sendBtn"),
    composerModelSelect: document.getElementById("composerModelSelect"),
    composerModeSelect: document.getElementById("composerModeSelect"),
    editGuide: document.getElementById("editGuide"),
    attachments: document.getElementById("attachments"),
    attachBtn: document.getElementById("attachBtn"),
    imageInput: document.getElementById("imageInput"),
    chatLog: document.getElementById("chatLog"),
    diagnoseBtn: document.getElementById("diagnoseBtn"),
    undoBtn: document.getElementById("undoBtn"),
    maxBtn: document.getElementById("maxBtn"),
    refreshBtn: document.getElementById("refreshBtn")
  };

  var supportedActions = [
    { type: "addSequenceMarker", fields: "name, comment, seconds" },
    { type: "setSequenceInOut", fields: "inSeconds, outSeconds" },
    { type: "clearSequenceInOut", fields: "" },
    { type: "trimClip", fields: "trackType video|audio, trackIndex, clipIndex or clipName, startSeconds optional, endSeconds optional, inPointSeconds optional, outPointSeconds optional" },
    { type: "moveClip", fields: "trackType video|audio, trackIndex, clipIndex or clipName, startSeconds" },
    { type: "deleteClip", fields: "trackType video|audio, trackIndex, clipIndex or clipName, ripple true|false" },
    { type: "clearTrack", fields: "trackType video|audio|both, trackIndex optional for video/audio, videoTrackIndex optional, audioTrackIndex optional, ripple true|false, linked true|false" },
    { type: "deleteTrackRange", fields: "trackType video|audio|both, trackIndex optional for video/audio, videoTrackIndex optional, audioTrackIndex optional, startSeconds optional, endSeconds optional, mode startWithin|overlap, ripple true|false, linked true|false" },
    { type: "rippleTrimClip", fields: "trackType video|audio, trackIndex, clipIndex or clipName, startSeconds optional, endSeconds optional" },
    { type: "setClipEnabled", fields: "trackType video|audio, trackIndex, clipIndex or clipName, enabled true|false" },
    { type: "setAudioGain", fields: "trackIndex, clipIndex or clipName, gainDb" },
    { type: "insertProjectItem", fields: "projectItemId or projectItemName or sourcePath, trackType video|audio, trackIndex, seconds, inPointSeconds optional, outPointSeconds optional, linked optional" },
    { type: "insertClipRange", fields: "projectItemId or projectItemName or sourcePath, trackType video|audio, trackIndex, seconds, inPointSeconds, outPointSeconds, sourceRangeMode optional absolute|offset, linked optional" },
    { type: "overwriteClipRange", fields: "projectItemId or projectItemName or sourcePath, trackType video|audio, trackIndex, seconds, inPointSeconds, outPointSeconds, sourceRangeMode optional absolute|offset, linked optional" },
    { type: "assembleFromScript", fields: "trackType optional default video, trackIndex, startSeconds, overwrite optional default true, linked optional, skipMissing/skipInvalid/continueOnError optional, preserveSkippedGaps optional default true, clips [{ projectItemId or projectItemName/source/sourceName/sourcePath, in or inPointSeconds, out or outPointSeconds, sourceRangeMode optional offset|timecode default offset }]. Script cut values are source-relative offsets. Use timecode mode only when values are actual embedded source timecodes." },
    { type: "splitClip", fields: "trackType video|audio, trackIndex, clipIndex or clipName, seconds, linked optional" },
    { type: "splitTrackAtTimes", fields: "trackType video|audio, trackIndex, times array of sequence seconds; uses Premiere QE razor to add in-place cuts on clips crossing each boundary, skipping boundaries already on clip edges; method:\"rebuild\" is legacy and should not be used for audio text cuts" },
    { type: "duplicateClip", fields: "trackType video|audio, trackIndex, clipIndex or clipName, seconds optional, offsetSeconds optional" },
    { type: "slipClip", fields: "trackType video|audio, trackIndex, clipIndex or clipName, deltaSeconds or inPointSeconds/outPointSeconds" },
    { type: "slideClip", fields: "trackType video|audio, trackIndex, clipIndex or clipName, deltaSeconds" },
    { type: "setClipDuration", fields: "trackType video|audio, trackIndex, clipIndex or clipName, durationSeconds" },
    { type: "replaceClipRange", fields: "trackType video|audio, trackIndex, clipIndex or clipName, projectItemId or projectItemName or sourcePath, inPointSeconds optional, outPointSeconds optional" },
    { type: "writeTempTextFile", fields: "extension txt|srt|csv|json|xml, contents, suggestedName optional, tempFolder optional" },
    { type: "createStyledTextXml", fields: "templateId optional: text-xml-two-style-graphic default or text-xml-five-run-switching for A/B/A/B/A word style switching; replacements object or [{from,to}], frames optional array of XML text frames each with replacements/startFrame/startSeconds/durationFrames/effectName/clipName/templateId, stackFrames optional true to layer all frames at the same start, sequenceName optional, effectName optional, durationFrames optional, functionName Text|Cut|Both optional default Text, afterCreateAction import|openFolder|open optional, outputFolder optional, tempFolder optional override; host enforces filename YYYY-MM-DD-HH-mm - AutoEdit - Function.xml; each frame still uses same-byte replacements inside the saved Source Text blob" },
    { type: "createStyledTextSvg", fields: "lines array of strings, runs, or line objects with runs; each run supports text, fill/color, stroke, strokeWidth, bold/fontWeight, italic/fontStyle, opacity; width/height optional default 1920x1080, x/y, fontFamily/font, fontSize/size, lineHeight, align left|center|right, fillOverStroke optional, functionName Text|Cut|Both optional default Text, afterCreateAction import|openFolder|open optional, outputFolder optional, insertInTimeline optional, seconds/startSeconds optional, trackIndex/videoTrackIndex optional; supports unlimited style switches and text length but imports as SVG media, not editable Essential Graphics text" },
    { type: "importTextFile", fields: "filePath optional, contents optional, extension optional, suggestedName optional, cleanupAfterImport optional, tempFolder optional" },
    { type: "importMediaFile", fields: "filePath, insertInTimeline optional false, trackType optional video, trackIndex/videoTrackIndex optional, seconds/startSeconds optional, overwrite optional false" },
    { type: "importSrtFile", fields: "filePath optional, contents optional, startAtTime optional, offsetSeconds optional, cleanupAfterImport optional, tempFolder optional, createCaptionTrack optional false by default, suppressUI optional true by default" },
    { type: "importCaptionFile", fields: "filePath optional, contents optional, startAtTime optional, offsetSeconds optional, captionFormat optional, cleanupAfterImport optional, tempFolder optional, createCaptionTrack optional false by default, suppressUI optional true by default" },
    { type: "transcribeAudioTrackToSrt", fields: "audioTrack optional A1/A2/etc or trackIndex zero-based, startSeconds optional, endSeconds optional, scriptText optional, useProvidedText optional false, optimizeCaptions optional true by default; createCaptionTrack optional true by default, suppressUI optional true by default; panel-local action that exports audio with ffmpeg, runs Whisper/WhisperX, then imports the generated SRT. No script is needed at all; use this for a plain 'caption/subtitle this audio' request with nothing else selected. Unless a specific track is named (audioTrack/track/trackIndex), it listens to the whole sequence like Premiere's own built-in transcription: every audio track with usable clips is mixed together, spanning from the earliest to the latest clip across all of them. Name a track explicitly to transcribe only that one. When useProvidedText is true, panel keeps detected timing but replaces generated words with scriptText lines. When no script is involved, optimizeCaptions (on by default) re-splits Whisper's own sentence-length blocks into short, readability-based caption rows using the same splitter and Settings as Optimized Text, timed from Whisper's own word-level output when available; set it false to keep Whisper's raw segment boundaries." },
    { type: "cutAudioAndTimeSubtitles", fields: "audioTrack optional A1/A2/etc or trackIndex zero-based, startSeconds optional, endSeconds optional, scriptText required unless selected Script/table input is selected, useProvidedText true by default, preserveScriptLines optional true by default, alignSubtitlesToAudioCuts optional true by default, createCaptionTrack optional true by default, suppressUI optional true by default, cutLeadSeconds optional default from Head padding setting 0.25, silenceLeadSeconds optional default to the same head padding, minSilenceGapSeconds optional default 0.08, minCutSpacingSeconds optional default 0.06; panel-local action for testing/manual edit prep only: it razors the configured audio track in place and imports captions, never assembles or moves footage. Original Text lines define audio cuts. When the selected script has Optimized Text, its chunks become word-timed captions inside those unchanged audio sections. When the selected script has a Notes column and the panel's Notes-track toggle is on (default on), a second caption track is added with each row's note as one full, unsplit block at that row's same timing - a reference-only track meant to be deleted by hand before export (Premiere's scripting API cannot remove a caption track, so reruns add another one rather than replacing it)." },
    { type: "fullProcessScriptRows", fields: "audioTrack optional A1/A2/etc or trackIndex zero-based, videoTrackIndex optional default 0, startSeconds optional default to the first configured-track clip, audioHeadPadSeconds optional default from settings 0.25, audioTailPadSeconds optional default from settings 0.25, scriptText optional; panel-local full workflow for selected Script/table input. It aligns original Text rows to audio, uses Whisper only for internal cut boundaries, preserves the complete provided audio from track start through track end, razors and moves the existing clips without changing their duration/source in/out, retains the imported SRT project item, and subdivides only captions using Optimized Text. When the selected script has a Notes column and the panel's Notes-track toggle is on (default on), a second caption track is added with each row's note as one full, unsplit block at that row's same timing - a reference-only track meant to be deleted by hand before export (Premiere's scripting API cannot remove a caption track, so reruns add another one rather than replacing it)." },
    { type: "checkFilePath", fields: "filePath, tempFolder optional; returns resolved path, exists, parent folder, and temp folder diagnostics" },
    { type: "deleteTempFile", fields: "filePath, tempFolder optional; only files inside configured/default PR AI temp folder are allowed" },
    { type: "createBin", fields: "name, parentPath optional" },
    { type: "renameBin", fields: "from, to" },
    { type: "moveProjectItemToBin", fields: "projectItemId or projectItemName or sourcePath, binName or binPath" },
    { type: "setProjectItemLabel", fields: "projectItemId or projectItemName or sourcePath, labelIndex" },
    { type: "setProjectItemInOut", fields: "projectItemId or projectItemName or sourcePath, inPointSeconds optional, outPointSeconds optional" },
    { type: "createSequence", fields: "name, presetPath optional, clear optional default true; without presetPath the host clones the active sequence settings and clears the clone so Premiere does not ask for a sequence template" },
    { type: "renameSequence", fields: "name or sequenceName, to" },
    { type: "setTrackMute", fields: "trackType audio, trackIndex, muted true|false" },
    { type: "setTrackVisibility", fields: "trackType video, trackIndex, visible true|false" },
    { type: "setTrackLock", fields: "trackType video|audio, trackIndex, locked true|false" },
    { type: "addClipMarker", fields: "trackType video|audio, trackIndex, clipIndex or clipName, seconds, name optional, comment optional" },
    { type: "setClipMotion", fields: "trackType video, trackIndex, clipIndex or clipName, scale optional, position [x,y] optional, rotation optional, opacity optional" },
    { type: "fadeClip", fields: "trackType video|audio, trackIndex, clipIndex or clipName, fadeInSeconds optional, fadeOutSeconds optional; best-effort keyframes" },
    { type: "applyEffectPreset", fields: "presetPath, trackType, trackIndex, clipIndex or clipName; may require Premiere preset support" },
    { type: "insertMogrt", fields: "mogrtPath or templatePath, seconds, videoTrackIndex optional, audioTrackIndex optional, textValues optional object, propertyValues optional object" },
    { type: "setGraphicText", fields: "trackType video, trackIndex, clipIndex or clipName, text optional, propertyName optional, values optional object" },
    { type: "setGraphicProperty", fields: "trackType video, trackIndex, clipIndex or clipName, componentName optional, propertyName, value; Mask Feather is linked by default, so one feather value writes both underlying X/Y dimensions. Use linked:false or unlinkFeather:true only when the user explicitly asks for separate feather axes." },
    { type: "listGraphicProperties", fields: "trackType video, trackIndex, clipIndex or clipName" },
    { type: "exportFrame", fields: "seconds, outputPath" },
    { type: "queueExport", fields: "outputPath, presetPath optional, inSeconds optional, outSeconds optional; requires Adobe Media Encoder" },
    { type: "removeSequenceMarker", fields: "name optional, seconds optional" },
    { type: "renameProjectItem", fields: "from, to" }
  ];

  function setStatus(text, isError) {
    var value = String(text || "");
    if (els.status) {
      els.status.textContent = value;
      els.status.className = isError ? "error" : "";
    }
    if (els.statusLog && value) {
      var stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      statusLogEntries.push(stamp + "  " + (isError ? "ERROR  " : "") + value);
      if (statusLogEntries.length > 120) {
        statusLogEntries = statusLogEntries.slice(statusLogEntries.length - 120);
      }
      els.statusLog.textContent = statusLogEntries.join("\n");
      els.statusLog.scrollTop = els.statusLog.scrollHeight;
    }
  }

  function formatDuration(ms) {
    var seconds = Math.max(0, Number(ms || 0) / 1000);
    if (seconds < 60) {
      return seconds.toFixed(1) + "s";
    }
    var minutes = Math.floor(seconds / 60);
    var remainder = Math.floor(seconds % 60);
    return minutes + "m " + (remainder < 10 ? "0" + remainder : remainder) + "s";
  }

  function renderRunStatus(mode, label) {
    els.runStatus.className = "run-status is-" + mode;
    els.runState.textContent = label;
    els.runStatus.setAttribute("aria-busy", mode === "running" ? "true" : "false");
    if (els.sendBtn) {
      var isRunning = mode === "running";
      els.sendBtn.className = "icon-button send-button" + (isRunning ? " is-cancel" : "");
      els.sendBtn.setAttribute("aria-label", isRunning ? "Cancel response" : "Send");
      els.sendBtn.setAttribute("title", isRunning ? "Cancel response" : "Send");
      els.sendBtn.setAttribute("aria-pressed", isRunning ? "true" : "false");
    }
  }

  function startRequestTimer(label) {
    stopRequestTimer(false);
    requestRunLabel = label || "Waiting for reply";
    requestStartedAt = Date.now();
    renderRunStatus("running", requestRunLabel);
    requestTimerId = window.setInterval(function () {
      renderRunStatus("running", requestRunLabel);
    }, 100);
  }

  function setRunPhase(label) {
    requestRunLabel = label;
    if (requestStartedAt) {
      renderRunStatus("running", requestRunLabel);
    }
  }

  function stopRequestTimer(saveDuration, mode, label) {
    if (requestTimerId) {
      window.clearInterval(requestTimerId);
      requestTimerId = null;
    }
    requestStartedAt = 0;
    requestRunLabel = label || "Ready to send";
    renderRunStatus(mode || "ready", requestRunLabel);
  }

  function responseCreditText() {
    if (!requestStartedAt) {
      return "";
    }
    var ms = Date.now() - requestStartedAt;
    var fiveHoursMs = 5 * 60 * 60 * 1000;
    return formatDuration(ms) + " · " + ((ms / fiveHoursMs) * 100).toFixed(1) + "% of 5h";
  }

  function loadEditGuide() {
    var saved = "";
    try {
      saved = window.localStorage.getItem(editGuideStorageKey) || "";
    } catch (err) {
    }
    if (saved && saved.indexOf("Efficiency guide:") === -1) {
      saved += guideUpgradeText;
    }
    els.editGuide.value = saved || defaultEditGuide;
    saveEditGuide();
  }

  function saveEditGuide() {
    try {
      window.localStorage.setItem(editGuideStorageKey, els.editGuide.value);
    } catch (err) {
    }
  }

  // Creative Assist and the Premiere runtime share media-tool settings through
  // PR FX Palette/settings.json. localStorage remains a compatibility copy for
  // older installs, but every run reads this file so changes apply immediately.
  function sharedSettingsPath() {
    var nodeRequire = getNodeRequire();
    if (!nodeRequire) return "";
    var path = nodeRequire("path"), os = nodeRequire("os"), proc = nodeRequire("process");
    return proc.platform === "win32"
      ? path.join(proc.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "PR FX Palette", "settings.json")
      : path.join(os.homedir(), "Library", "Application Support", "PR FX Palette", "settings.json");
  }

  function readSharedMediaSettings() {
    var nodeRequire = getNodeRequire(), file = sharedSettingsPath();
    if (!nodeRequire || !file) return {};
    try { var value = JSON.parse(nodeRequire("fs").readFileSync(file, "utf8")); return value && typeof value === "object" ? value : {}; }
    catch (_) { return {}; }
  }

  function writeSharedMediaSettings(patch) {
    var nodeRequire = getNodeRequire(), file = sharedSettingsPath();
    if (!nodeRequire || !file) return;
    try {
      var fs = nodeRequire("fs"), path = nodeRequire("path"), proc = nodeRequire("process"), current = readSharedMediaSettings();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      var temp = file + "." + proc.pid + ".tmp";
      fs.writeFileSync(temp, JSON.stringify(Object.assign({}, current, patch)), "utf8");
      fs.renameSync(temp, file);
    } catch (_) {}
  }

  function getEditGuide() {
    return String(els.editGuide.value || "").replace(/^\s+|\s+$/g, "");
  }

  function loadTargetSequenceSetting() {
    try {
      targetSequenceId = window.localStorage.getItem(targetSequenceStorageKey) || "";
    } catch (err) {
      targetSequenceId = "";
    }
    if (els.targetSequence) {
      els.targetSequence.value = targetSequenceId;
    }
  }

  function saveTargetSequenceSetting() {
    targetSequenceId = els.targetSequence ? (els.targetSequence.value || "") : "";
    try {
      window.localStorage.setItem(targetSequenceStorageKey, targetSequenceId);
    } catch (err) {
    }
    setStatus(targetSequenceId ? "Target sequence locked." : "Target follows active sequence.");
  }

  function loadSettings() {
    var sharedMedia = readSharedMediaSettings();
    try {
      els.textTempFolder.value = window.localStorage.getItem(textTempFolderStorageKey) || "";
      els.xmlOutputFolder.value = window.localStorage.getItem(xmlOutputFolderStorageKey) || "";
      els.xmlAfterCreateAction.value = window.localStorage.getItem(xmlAfterCreateActionStorageKey) || "import";
      els.includeComponents.checked = window.localStorage.getItem(includeComponentsStorageKey) === "true";
      if (els.ffmpegPath) {
        els.ffmpegPath.value = sharedMedia.ffmpegPath != null ? String(sharedMedia.ffmpegPath) : window.localStorage.getItem(ffmpegPathStorageKey) || "";
      }
      if (els.whisperCommand) {
        els.whisperCommand.value = sharedMedia.whisperCommand != null ? String(sharedMedia.whisperCommand) : window.localStorage.getItem(whisperCommandStorageKey) || "";
        if (isPlaceholderWhisperCommand(els.whisperCommand.value)) {
          els.whisperCommand.value = "";
          try {
            window.localStorage.setItem(whisperCommandStorageKey, "");
          } catch (placeholderErr) {
          }
        }
      }
      if (els.whisperModel) {
        els.whisperModel.value = sharedMedia.whisperModel != null ? String(sharedMedia.whisperModel) : window.localStorage.getItem(whisperModelStorageKey) || "large-v3-turbo";
        if (!els.whisperModel.value) {
          els.whisperModel.value = "large-v3-turbo";
        }
      }
      if (els.whisperDevice) {
        els.whisperDevice.value = sharedMedia.whisperDevice != null ? String(sharedMedia.whisperDevice) : window.localStorage.getItem(whisperDeviceStorageKey) || "auto";
      }
      if (els.defaultAudioTrack) {
        els.defaultAudioTrack.value = sharedMedia.defaultAudioTrack != null ? String(sharedMedia.defaultAudioTrack) : window.localStorage.getItem(defaultAudioTrackStorageKey) || "A1";
      }
      if (els.audioHeadPad) {
        els.audioHeadPad.value = sharedMedia.audioHeadPad != null ? String(sharedMedia.audioHeadPad) : window.localStorage.getItem(audioHeadPadStorageKey) || "0.25";
      }
      if (els.audioTailPad) {
        els.audioTailPad.value = sharedMedia.audioTailPad != null ? String(sharedMedia.audioTailPad) : window.localStorage.getItem(audioTailPadStorageKey) || "0.25";
      }
      if (els.captionMaxWords) {
        els.captionMaxWords.value = sharedMedia.captionMaxWords != null ? String(sharedMedia.captionMaxWords) : window.localStorage.getItem(captionMaxWordsStorageKey) || String(defaultCaptionMaxWords);
      }
      if (els.captionMaxChars) {
        els.captionMaxChars.value = sharedMedia.captionMaxChars != null ? String(sharedMedia.captionMaxChars) : window.localStorage.getItem(captionMaxCharsStorageKey) || String(defaultCaptionMaxChars);
      }
      if (els.captionSplitMode) {
        els.captionSplitMode.value = sharedMedia.captionSplitMode != null ? String(sharedMedia.captionSplitMode) : window.localStorage.getItem(captionSplitModeStorageKey) || defaultCaptionSplitMode;
      }
      if (els.captionTrimEndPunctuation) {
        var storedCaptionTrim = sharedMedia.captionTrimEndPunctuation != null ? String(!!sharedMedia.captionTrimEndPunctuation) : window.localStorage.getItem(captionTrimEndPunctuationStorageKey);
        els.captionTrimEndPunctuation.checked = storedCaptionTrim === null ? true : storedCaptionTrim === "true";
      }
      upgradeStoredClaudeModel();
      syncAiSettingsControls();
      if (els.comfyPath) {
        els.comfyPath.value = window.localStorage.getItem(comfyPathStorageKey) || "";
      }
      if (els.comfyPython) {
        els.comfyPython.value = window.localStorage.getItem(comfyPythonStorageKey) || "";
      }
      if (els.comfyServerUrl) {
        els.comfyServerUrl.value = window.localStorage.getItem(comfyServerUrlStorageKey) || "http://127.0.0.1:8188";
      }
      if (els.comfyWorkflow) {
        els.comfyWorkflow.value = window.localStorage.getItem(comfyWorkflowStorageKey) || "ltx-inpaint";
      }
      if (els.comfyWorkflowPath) {
        els.comfyWorkflowPath.value = window.localStorage.getItem(comfyWorkflowPathStorageKey) || defaultComfyWorkflowPath();
      }
      if (els.comfyImportMode) {
        els.comfyImportMode.value = window.localStorage.getItem(comfyImportModeStorageKey) || "overlay";
      }
      if (els.comfyOutputMode) {
        els.comfyOutputMode.value = window.localStorage.getItem(comfyOutputModeStorageKey) || "project";
      }
      if (els.comfyOutputFolderName) {
        els.comfyOutputFolderName.value = window.localStorage.getItem(comfyOutputFolderNameStorageKey) || "Processed Output";
      }
      if (els.comfyPositivePrompt) {
        els.comfyPositivePrompt.value = window.localStorage.getItem(comfyPositivePromptStorageKey) || els.comfyPositivePrompt.value;
      }
      if (els.comfyNegativePrompt) {
        els.comfyNegativePrompt.value = window.localStorage.getItem(comfyNegativePromptStorageKey) || els.comfyNegativePrompt.value;
      }
      try {
        var mask = JSON.parse(window.localStorage.getItem(comfyMaskStorageKey) || "{}");
        if (els.comfyMaskX && mask.x !== undefined) els.comfyMaskX.value = mask.x;
        if (els.comfyMaskY && mask.y !== undefined) els.comfyMaskY.value = mask.y;
        if (els.comfyMaskW && mask.w !== undefined) els.comfyMaskW.value = mask.w;
        if (els.comfyMaskH && mask.h !== undefined) els.comfyMaskH.value = mask.h;
      } catch (maskErr) {
      }
      try {
        var frame = JSON.parse(window.localStorage.getItem(removeFrameStorageKey) || "{}");
        if (els.removeFrameW && frame.w !== undefined) els.removeFrameW.value = frame.w;
        if (els.removeFrameH && frame.h !== undefined) els.removeFrameH.value = frame.h;
      } catch (frameErr) {
      }
      try {
        var timing = JSON.parse(window.localStorage.getItem(removeTimingStorageKey) || "{}");
        if (els.removeStartOffset && timing.start !== undefined) els.removeStartOffset.value = timing.start;
        if (els.removeEndOffset && timing.end !== undefined) els.removeEndOffset.value = timing.end;
        if (els.removeChunkMode && timing.chunk) els.removeChunkMode.value = timing.chunk;
      } catch (timingErr) {
      }
    } catch (err) {
      els.textTempFolder.value = "";
      els.xmlOutputFolder.value = "";
      els.xmlAfterCreateAction.value = "import";
      els.includeComponents.checked = false;
      if (els.ffmpegPath) {
        els.ffmpegPath.value = "";
      }
      if (els.whisperCommand) {
        els.whisperCommand.value = "";
      }
      if (els.whisperModel) {
        els.whisperModel.value = "large-v3-turbo";
      }
      if (els.whisperDevice) {
        els.whisperDevice.value = "auto";
      }
      if (els.defaultAudioTrack) {
        els.defaultAudioTrack.value = "A1";
      }
      if (els.audioHeadPad) {
        els.audioHeadPad.value = "0.25";
      }
      if (els.audioTailPad) {
        els.audioTailPad.value = "0.25";
      }
      if (els.captionMaxWords) {
        els.captionMaxWords.value = String(defaultCaptionMaxWords);
      }
      if (els.captionMaxChars) {
        els.captionMaxChars.value = String(defaultCaptionMaxChars);
      }
      if (els.captionSplitMode) {
        els.captionSplitMode.value = defaultCaptionSplitMode;
      }
      if (els.captionTrimEndPunctuation) {
        els.captionTrimEndPunctuation.checked = true;
      }
      if (els.comfyPath) {
        els.comfyPath.value = "";
      }
      if (els.comfyPython) {
        els.comfyPython.value = "";
      }
      if (els.comfyServerUrl) {
        els.comfyServerUrl.value = "http://127.0.0.1:8188";
      }
      if (els.comfyWorkflow) {
        els.comfyWorkflow.value = "ltx-inpaint";
      }
      if (els.comfyWorkflowPath) {
        els.comfyWorkflowPath.value = defaultComfyWorkflowPath();
      }
      if (els.comfyImportMode) {
        els.comfyImportMode.value = "overlay";
      }
      if (els.comfyOutputMode) {
        els.comfyOutputMode.value = "project";
      }
      if (els.comfyOutputFolderName) {
        els.comfyOutputFolderName.value = "Processed Output";
      }
      if (els.removeFrameW) {
        els.removeFrameW.value = "720";
        els.removeFrameH.value = "1280";
      }
      if (els.removeStartOffset) {
        els.removeStartOffset.value = "0";
        els.removeEndOffset.value = "0";
      }
    }
  }

  function saveSettings() {
    try {
      if (els.whisperCommand && isPlaceholderWhisperCommand(els.whisperCommand.value)) {
        els.whisperCommand.value = "";
      }
      window.localStorage.setItem(textTempFolderStorageKey, els.textTempFolder.value);
      window.localStorage.setItem(xmlOutputFolderStorageKey, els.xmlOutputFolder.value);
      window.localStorage.setItem(xmlAfterCreateActionStorageKey, els.xmlAfterCreateAction.value);
      window.localStorage.setItem(includeComponentsStorageKey, els.includeComponents.checked ? "true" : "false");
      window.localStorage.setItem(ffmpegPathStorageKey, els.ffmpegPath ? els.ffmpegPath.value : "");
      window.localStorage.setItem(whisperCommandStorageKey, els.whisperCommand && !isPlaceholderWhisperCommand(els.whisperCommand.value) ? els.whisperCommand.value : "");
      window.localStorage.setItem(whisperModelStorageKey, els.whisperModel ? els.whisperModel.value : "large-v3-turbo");
      window.localStorage.setItem(whisperDeviceStorageKey, els.whisperDevice ? els.whisperDevice.value : "auto");
      window.localStorage.setItem(defaultAudioTrackStorageKey, els.defaultAudioTrack ? els.defaultAudioTrack.value : "A1");
      window.localStorage.setItem(audioHeadPadStorageKey, els.audioHeadPad ? els.audioHeadPad.value : "0.25");
      window.localStorage.setItem(audioTailPadStorageKey, els.audioTailPad ? els.audioTailPad.value : "0.25");
      window.localStorage.setItem(captionMaxWordsStorageKey, els.captionMaxWords ? els.captionMaxWords.value : String(defaultCaptionMaxWords));
      window.localStorage.setItem(captionMaxCharsStorageKey, els.captionMaxChars ? els.captionMaxChars.value : String(defaultCaptionMaxChars));
      window.localStorage.setItem(captionSplitModeStorageKey, els.captionSplitMode ? els.captionSplitMode.value : defaultCaptionSplitMode);
      window.localStorage.setItem(captionTrimEndPunctuationStorageKey, !els.captionTrimEndPunctuation || els.captionTrimEndPunctuation.checked ? "true" : "false");
      writeSharedMediaSettings({
        ffmpegPath: els.ffmpegPath ? els.ffmpegPath.value : "", whisperCommand: els.whisperCommand ? els.whisperCommand.value : "",
        whisperModel: els.whisperModel ? els.whisperModel.value : "large-v3-turbo", whisperDevice: els.whisperDevice ? els.whisperDevice.value : "auto",
        defaultAudioTrack: els.defaultAudioTrack ? els.defaultAudioTrack.value : "A1",
        audioHeadPad: Number(els.audioHeadPad ? els.audioHeadPad.value : 0.25), audioTailPad: Number(els.audioTailPad ? els.audioTailPad.value : 0.25),
        captionMaxWords: Number(els.captionMaxWords ? els.captionMaxWords.value : defaultCaptionMaxWords),
        captionMaxChars: Number(els.captionMaxChars ? els.captionMaxChars.value : defaultCaptionMaxChars),
        captionSplitMode: els.captionSplitMode ? els.captionSplitMode.value : defaultCaptionSplitMode,
        captionTrimEndPunctuation: !els.captionTrimEndPunctuation || els.captionTrimEndPunctuation.checked
      });
      window.localStorage.setItem(aiClaudeModelStorageKey, els.claudeModelSelect ? els.claudeModelSelect.value : "");
      window.localStorage.setItem(aiCodexModelStorageKey, els.codexModelSelect ? els.codexModelSelect.value : "");
      window.localStorage.setItem(aiClaudeModeStorageKey, els.claudeModeSelect ? els.claudeModeSelect.value : "");
      window.localStorage.setItem(aiCodexModeStorageKey, els.codexModeSelect ? els.codexModeSelect.value : "");
      window.localStorage.setItem(comfyPathStorageKey, els.comfyPath ? els.comfyPath.value : "");
      window.localStorage.setItem(comfyPythonStorageKey, els.comfyPython ? els.comfyPython.value : "");
      window.localStorage.setItem(comfyServerUrlStorageKey, els.comfyServerUrl ? els.comfyServerUrl.value : "http://127.0.0.1:8188");
      window.localStorage.setItem(comfyWorkflowStorageKey, els.comfyWorkflow ? els.comfyWorkflow.value : "ltx-inpaint");
      window.localStorage.setItem(comfyWorkflowPathStorageKey, els.comfyWorkflowPath ? els.comfyWorkflowPath.value : defaultComfyWorkflowPath());
      window.localStorage.setItem(comfyImportModeStorageKey, els.comfyImportMode ? els.comfyImportMode.value : "overlay");
      window.localStorage.setItem(comfyOutputModeStorageKey, els.comfyOutputMode ? els.comfyOutputMode.value : "project");
      window.localStorage.setItem(comfyOutputFolderNameStorageKey, els.comfyOutputFolderName ? els.comfyOutputFolderName.value : "Processed Output");
      window.localStorage.setItem(comfyPositivePromptStorageKey, els.comfyPositivePrompt ? els.comfyPositivePrompt.value : "");
      window.localStorage.setItem(comfyNegativePromptStorageKey, els.comfyNegativePrompt ? els.comfyNegativePrompt.value : "");
      window.localStorage.setItem(comfyMaskStorageKey, JSON.stringify({
        x: els.comfyMaskX ? els.comfyMaskX.value : 0,
        y: els.comfyMaskY ? els.comfyMaskY.value : 0,
        w: els.comfyMaskW ? els.comfyMaskW.value : 1920,
        h: els.comfyMaskH ? els.comfyMaskH.value : 220
      }));
      window.localStorage.setItem(removeFrameStorageKey, JSON.stringify({
        w: els.removeFrameW ? els.removeFrameW.value : 720,
        h: els.removeFrameH ? els.removeFrameH.value : 1280
      }));
      window.localStorage.setItem(removeTimingStorageKey, JSON.stringify({
        start: els.removeStartOffset ? els.removeStartOffset.value : 0,
        end: els.removeEndOffset ? els.removeEndOffset.value : 0,
        chunk: els.removeChunkMode ? els.removeChunkMode.value : "selected"
      }));
    } catch (err) {
    }
    setSettingsStatus("Settings saved.");
  }

  function getTextTempFolder() {
    return String(els.textTempFolder.value || "").replace(/^\s+|\s+$/g, "");
  }

  function getXmlOutputFolder() {
    return String(els.xmlOutputFolder.value || "").replace(/^\s+|\s+$/g, "");
  }

  function getXmlAfterCreateAction() {
    return String(els.xmlAfterCreateAction.value || "import");
  }

  function shouldIncludeComponents() {
    return els.includeComponents && els.includeComponents.checked;
  }

  function getFfmpegCommand() {
    var shared = readSharedMediaSettings();
    return String(shared.ffmpegPath || (els.ffmpegPath && els.ffmpegPath.value) || "ffmpeg").replace(/^\s+|\s+$/g, "") || "ffmpeg";
  }

  function resolveFfmpegShell() {
    return [
      "FFMPEG_CMD=" + shellQuote(getFfmpegCommand()),
      "FFMPEG=\"\"",
      "if command -v \"$FFMPEG_CMD\" >/dev/null 2>&1; then FFMPEG=$(command -v \"$FFMPEG_CMD\"); fi",
      "if [ -z \"$FFMPEG\" ] && [ -x \"$FFMPEG_CMD\" ]; then FFMPEG=\"$FFMPEG_CMD\"; fi",
      "if [ -z \"$FFMPEG\" ]; then",
      "  for C in ffmpeg /opt/homebrew/bin/ffmpeg /usr/local/bin/ffmpeg; do",
      "    if command -v \"$C\" >/dev/null 2>&1; then FFMPEG=$(command -v \"$C\"); break; fi",
      "    if [ -x \"$C\" ]; then FFMPEG=\"$C\"; break; fi",
      "  done",
      "fi",
      "if [ -z \"$FFMPEG\" ]; then",
      "  echo 'ffmpeg not found. Click Install ffmpeg, run Detect, or paste the ffmpeg path.' >&2",
      "  exit 127",
      "fi",
      // WhisperX decodes audio by running "ffmpeg" itself: put the one found here on its PATH too.
      "PATH=\"$(dirname \"$FFMPEG\"):$PATH\"; export PATH"
    ].join("\n");
  }

  function getWhisperCommand() {
    var shared = readSharedMediaSettings();
    var command = String(shared.whisperCommand || (els.whisperCommand && els.whisperCommand.value) || "").replace(/^\s+|\s+$/g, "");
    if (isPlaceholderWhisperCommand(command)) {
      return "";
    }
    return command || detectInstalledWhisperCommand();
  }

  function isPlaceholderWhisperCommand(command) {
    command = String(command || "");
    return !command || command.indexOf("/path/to/align_script.py") !== -1 || command.indexOf("path/to/align_script.py") !== -1;
  }

  function detectInstalledWhisperCommand() {
    var nodeRequire = getNodeRequire();
    if (!nodeRequire) {
      return "";
    }
    try {
      var fs = nodeRequire("fs");
      var path = nodeRequire("path");
      var home = nodeRequire("os").homedir();
      var versions = ["3.13", "3.12", "3.11", "3.10", "3.9", "3.8"];
      var candidates = [
        path.join(home, ".local/bin/whisperx"),
        path.join(home, ".local/bin/whisper"),
        "/opt/homebrew/bin/whisperx",
        "/opt/homebrew/bin/whisper",
        "/usr/local/bin/whisperx",
        "/usr/local/bin/whisper"
      ];
      for (var v = 0; v < versions.length; v++) {
        candidates.push(path.join(home, "Library/Python/" + versions[v] + "/bin/whisperx"));
        candidates.push(path.join(home, "Library/Python/" + versions[v] + "/bin/whisper"));
      }
      for (var i = 0; i < candidates.length; i++) {
        try {
          if (fs.existsSync(candidates[i])) {
            fs.accessSync(candidates[i], fs.constants ? fs.constants.X_OK : 1);
            return candidates[i];
          }
        } catch (accessErr) {
        }
      }
    } catch (err) {
    }
    return "";
  }

  function getWhisperSettings() {
    var shared = readSharedMediaSettings();
    return {
      ffmpeg: getFfmpegCommand(),
      command: getWhisperCommand(),
      model: String(shared.whisperModel || (els.whisperModel && els.whisperModel.value) || "large-v3-turbo"),
      device: String(shared.whisperDevice || (els.whisperDevice && els.whisperDevice.value) || "auto"),
      // The spoken language (2026-11-22): left to itself WhisperX guesses from the first 30 s, and took the user's
      // Vietnamese and English for Chinese. "auto" keeps the guess. Set on WhisperX's card in Creative Assist.
      language: String(shared.whisperLanguage || "auto"),
      audioTrack: String(shared.defaultAudioTrack || (els.defaultAudioTrack && els.defaultAudioTrack.value) || "A1").replace(/^\s+|\s+$/g, "") || "A1",
      audioHeadPadSeconds: Math.max(0, finiteNumber(shared.audioHeadPad != null ? shared.audioHeadPad : els.audioHeadPad && els.audioHeadPad.value !== "" ? els.audioHeadPad.value : 0.25, 0.25)),
      audioTailPadSeconds: Math.max(0, finiteNumber(shared.audioTailPad != null ? shared.audioTailPad : els.audioTailPad && els.audioTailPad.value !== "" ? els.audioTailPad.value : 0.25, 0.25))
    };
  }

  function providerForAiSettings() {
    var selected = selectedAiTestProvider ? selectedAiTestProvider() : (els.provider && els.provider.value ? els.provider.value : "claude");
    return selected === "codex" ? "codex" : "claude";
  }

  function aiModelStorageKey(provider) {
    return provider === "codex" ? aiCodexModelStorageKey : aiClaudeModelStorageKey;
  }

  function aiModeStorageKey(provider) {
    return provider === "codex" ? aiCodexModeStorageKey : aiClaudeModeStorageKey;
  }

  function defaultAiModelSuggestions(provider) {
    if (provider === "codex") {
      return [];
    }
    return [defaultAiClaudeModel, "claude-sonnet-5", "claude-haiku-4-5"];
  }

  function defaultAiModelValue(provider) {
    return provider === "codex" ? "" : defaultAiClaudeModel;
  }

  /* A stored model from an earlier session outranks the default, so changing the
     default alone leaves existing panels on whatever they last saved. Move them
     onto Opus 5 once, recorded by marker, so a later manual pick is never
     overridden on the next launch. */
  function upgradeStoredClaudeModel() {
    try {
      if (window.localStorage.getItem(aiClaudeModelUpgradeStorageKey) === defaultAiClaudeModel) {
        return false;
      }
      window.localStorage.setItem(aiClaudeModelStorageKey, defaultAiClaudeModel);
      window.localStorage.setItem(aiClaudeModelUpgradeStorageKey, defaultAiClaudeModel);
      return true;
    } catch (err) {
      return false;
    }
  }

  function defaultAiModeOptions(provider) {
    if (provider === "codex") {
      return [{ value: "", label: "Default" }];
    }
    return [
      { value: "", label: "Default" },
      { value: "effort:low", label: "Effort: low" },
      { value: "effort:medium", label: "Effort: medium" },
      { value: "effort:high", label: "Effort: high" },
      { value: "effort:xhigh", label: "Effort: xhigh" },
      { value: "effort:max", label: "Effort: max" }
    ];
  }

  function setAiModelSuggestions(provider, suggestions) {
    var select = provider === "codex" ? els.codexModelSelect : els.claudeModelSelect;
    if (!select) {
      return;
    }
    var stored = window.localStorage.getItem(aiModelStorageKey(provider));
    var selected = stored === null ? defaultAiModelValue(provider) : String(stored || "");
    var seen = {};
    var values = [];
    var all = [selected].concat(suggestions || []).concat(defaultAiModelSuggestions(provider));
    for (var i = 0; i < all.length; i++) {
      var value = String(all[i] || "").replace(/^\s+|\s+$/g, "");
      if (value && !seen[value]) {
        seen[value] = true;
        values.push(value);
      }
    }
    select.innerHTML = "";
    var defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = provider === "codex" ? "Default from Codex" : "Default from Claude";
    select.appendChild(defaultOption);
    for (var v = 0; v < values.length; v++) {
      var option = document.createElement("option");
      option.value = values[v];
      option.textContent = values[v];
      select.appendChild(option);
    }
    select.value = selected;
    if (select.value !== selected) {
      select.value = "";
    }
    renderAgentMenu(provider);
    syncComposerAiControls();
  }

  function setAiModeOptions(provider, detectedOptions) {
    var select = provider === "codex" ? els.codexModeSelect : els.claudeModeSelect;
    if (!select) {
      return;
    }
    var selected = window.localStorage.getItem(aiModeStorageKey(provider)) || "";
    var options = detectedOptions && detectedOptions.length ? detectedOptions : defaultAiModeOptions(provider);
    select.innerHTML = "";
    for (var i = 0; i < options.length; i++) {
      var option = document.createElement("option");
      option.value = options[i].value;
      option.textContent = options[i].label;
      select.appendChild(option);
    }
    select.value = selected;
    if (select.value !== selected) {
      select.value = "";
    }
    renderAgentMenu(provider);
    syncComposerAiControls();
  }

  function selectedOptionText(select, fallback) {
    if (!select || select.selectedIndex < 0 || !select.options[select.selectedIndex]) {
      return fallback || "";
    }
    return String(select.options[select.selectedIndex].textContent || fallback || "");
  }

  function agentChoiceLabel(provider, option, kind) {
    var value = String(option && option.value || "");
    var text = String(option && option.textContent || "");
    if (kind === "mode") {
      if (!value) return provider === "claude" ? "Default effort" : "Default mode";
      var mode = text.replace(/^Effort:\s*/i, "");
      var effortNames = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Maximum" };
      return provider === "claude" && effortNames[mode.toLowerCase()] ? effortNames[mode.toLowerCase()] : mode;
    }
    if (!value) return provider === "claude" ? "Claude default" : "Codex default";
    var friendlyClaude = {
      "claude-opus-5": "Opus 5 (newest)",
      "claude-sonnet-5": "Sonnet 5 (newest)",
      "claude-haiku-4-5": "Haiku 4.5 (newest)"
    };
    return provider === "claude" && friendlyClaude[value] ? friendlyClaude[value] : text;
  }

  function renderAgentMenu(provider) {
    provider = provider === "codex" ? "codex" : "claude";
    var modelSelect = provider === "codex" ? els.codexModelSelect : els.claudeModelSelect;
    var modeSelect = provider === "codex" ? els.codexModeSelect : els.claudeModeSelect;
    var menu = provider === "codex" ? els.codexAgentMenu : els.claudeAgentMenu;
    var label = provider === "codex" ? els.codexAgentMenuLabel : els.claudeAgentMenuLabel;
    var modelItems = provider === "codex" ? els.codexAgentModelItems : els.claudeAgentModelItems;
    var modeItems = provider === "codex" ? els.codexAgentModeItems : els.claudeAgentModeItems;
    if (!modelSelect || !modeSelect || !menu || !label || !modelItems || !modeItems) {
      return;
    }

    var modelOption = modelSelect.options[modelSelect.selectedIndex];
    var modeOption = modeSelect.options[modeSelect.selectedIndex];
    var modelText = modelOption ? agentChoiceLabel(provider, modelOption, "model") : selectedOptionText(modelSelect, "Choose a model");
    var modeText = modeOption ? agentChoiceLabel(provider, modeOption, "mode") : selectedOptionText(modeSelect, "Default");
    label.textContent = modelText + (modeSelect.value ? " · " + modeText : "");
    label.title = label.textContent;

    function fill(container, select, kind) {
      container.innerHTML = "";
      for (var i = 0; i < select.options.length; i++) {
        (function (option) {
          var button = document.createElement("button");
          button.type = "button";
          button.className = "agent-menu-item" + (select.value === option.value ? " is-selected" : "");
          button.setAttribute("role", "menuitemradio");
          button.setAttribute("aria-checked", select.value === option.value ? "true" : "false");
          button.setAttribute("data-agent-choice", kind);
          var text = document.createElement("span");
          text.textContent = agentChoiceLabel(provider, option, kind);
          var check = document.createElement("span");
          check.className = "agent-menu-check";
          check.setAttribute("aria-hidden", "true");
          check.textContent = "✓";
          button.appendChild(text);
          button.appendChild(check);
          button.addEventListener("click", function () {
            select.value = option.value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
            menu.removeAttribute("open");
            renderAgentMenu(provider);
          });
          container.appendChild(button);
        })(select.options[i]);
      }
    }
    fill(modelItems, modelSelect, "model");
    fill(modeItems, modeSelect, "mode");
  }

  function syncAiSettingsControls() {
    setAiModelSuggestions("claude", []);
    setAiModeOptions("claude", null);
    setAiModelSuggestions("codex", []);
    setAiModeOptions("codex", null);
    syncComposerAiControls();
  }

  function copySelectOptions(from, to) {
    if (!from || !to) {
      return;
    }
    to.innerHTML = "";
    for (var i = 0; i < from.options.length; i++) {
      var source = from.options[i];
      var option = document.createElement("option");
      option.value = source.value;
      option.textContent = source.textContent;
      to.appendChild(option);
    }
    to.value = from.value || "";
    if (to.value !== (from.value || "")) {
      to.value = "";
    }
  }

  function syncComposerAiControls() {
    var provider = els.provider && els.provider.value === "codex" ? "codex" : "claude";
    copySelectOptions(provider === "codex" ? els.codexModelSelect : els.claudeModelSelect, els.composerModelSelect);
    copySelectOptions(provider === "codex" ? els.codexModeSelect : els.claudeModeSelect, els.composerModeSelect);
  }

  function applyComposerAiModel() {
    var provider = els.provider && els.provider.value === "codex" ? "codex" : "claude";
    var target = provider === "codex" ? els.codexModelSelect : els.claudeModelSelect;
    if (target && els.composerModelSelect) {
      target.value = els.composerModelSelect.value || "";
      saveSettings();
      renderAgentMenu(provider);
    }
  }

  function applyComposerAiMode() {
    var provider = els.provider && els.provider.value === "codex" ? "codex" : "claude";
    var target = provider === "codex" ? els.codexModeSelect : els.claudeModeSelect;
    if (target && els.composerModeSelect) {
      target.value = els.composerModeSelect.value || "";
      saveSettings();
      renderAgentMenu(provider);
    }
  }

  function getAiModel(provider) {
    provider = provider === "codex" ? "codex" : "claude";
    var select = provider === "codex" ? els.codexModelSelect : els.claudeModelSelect;
    if (select) {
      return String(select.value || "").replace(/^\s+|\s+$/g, "");
    }
    return String(window.localStorage.getItem(aiModelStorageKey(provider)) || "").replace(/^\s+|\s+$/g, "");
  }

  function getAiMode(provider) {
    provider = provider === "codex" ? "codex" : "claude";
    var select = provider === "codex" ? els.codexModeSelect : els.claudeModeSelect;
    if (select) {
      return String(select.value || "");
    }
    return String(window.localStorage.getItem(aiModeStorageKey(provider)) || "");
  }

  function getComfySettings() {
    return {
      path: String(els.comfyPath && els.comfyPath.value ? els.comfyPath.value : "").replace(/^\s+|\s+$/g, ""),
      python: String(els.comfyPython && els.comfyPython.value ? els.comfyPython.value : "").replace(/^\s+|\s+$/g, ""),
      serverUrl: String(els.comfyServerUrl && els.comfyServerUrl.value ? els.comfyServerUrl.value : "http://127.0.0.1:8188").replace(/^\s+|\s+$/g, "") || "http://127.0.0.1:8188",
      workflowPath: String(els.comfyWorkflowPath && els.comfyWorkflowPath.value ? els.comfyWorkflowPath.value : "").replace(/^\s+|\s+$/g, ""),
      workflow: String(els.comfyWorkflow && els.comfyWorkflow.value ? els.comfyWorkflow.value : "ltx-inpaint"),
      importMode: String(els.comfyImportMode && els.comfyImportMode.value ? els.comfyImportMode.value : "overlay"),
      outputMode: String(els.comfyOutputMode && els.comfyOutputMode.value ? els.comfyOutputMode.value : "project"),
      outputFolderName: String(els.comfyOutputFolderName && els.comfyOutputFolderName.value ? els.comfyOutputFolderName.value : "Processed Output").replace(/^\s+|\s+$/g, "") || "Processed Output",
      positivePrompt: String(els.comfyPositivePrompt && els.comfyPositivePrompt.value ? els.comfyPositivePrompt.value : ""),
      negativePrompt: String(els.comfyNegativePrompt && els.comfyNegativePrompt.value ? els.comfyNegativePrompt.value : ""),
      frame: {
        w: Math.max(1, Number(els.removeFrameW && els.removeFrameW.value ? els.removeFrameW.value : 720)),
        h: Math.max(1, Number(els.removeFrameH && els.removeFrameH.value ? els.removeFrameH.value : 1280))
      },
      timing: {
        startOffset: Math.max(0, Number(els.removeStartOffset && els.removeStartOffset.value ? els.removeStartOffset.value : 0)),
        endOffset: Math.max(0, Number(els.removeEndOffset && els.removeEndOffset.value ? els.removeEndOffset.value : 0)),
        chunkMode: String(els.removeChunkMode && els.removeChunkMode.value ? els.removeChunkMode.value : "selected")
      },
      mask: {
        x: Number(els.comfyMaskX && els.comfyMaskX.value ? els.comfyMaskX.value : 0),
        y: Number(els.comfyMaskY && els.comfyMaskY.value ? els.comfyMaskY.value : 0),
        w: Number(els.comfyMaskW && els.comfyMaskW.value ? els.comfyMaskW.value : 1920),
        h: Number(els.comfyMaskH && els.comfyMaskH.value ? els.comfyMaskH.value : 220)
      }
    };
  }

  function defaultComfyWorkflowPath() {
    return "";
  }

  function clampNumber(value, min, max) {
    var num = Number(value);
    if (!isFinite(num)) {
      num = min;
    }
    return Math.max(min, Math.min(max, num));
  }

  function getRemoveFrameSize() {
    return {
      w: Math.max(1, Number(els.removeFrameW && els.removeFrameW.value ? els.removeFrameW.value : 720)),
      h: Math.max(1, Number(els.removeFrameH && els.removeFrameH.value ? els.removeFrameH.value : 1280))
    };
  }

  function setMainTab(tabName) {
    if (els.agentPanel) {
      els.agentPanel.hidden = false;
    }
  }

  function syncRemoveMaskFromInputs() {
    if (!els.removeFrame || !els.removeMaskBox) {
      return;
    }
    var frame = getRemoveFrameSize();
    var mask = {
      x: clampNumber(els.comfyMaskX ? els.comfyMaskX.value : 0, 0, frame.w),
      y: clampNumber(els.comfyMaskY ? els.comfyMaskY.value : 0, 0, frame.h),
      w: clampNumber(els.comfyMaskW ? els.comfyMaskW.value : frame.w, 1, frame.w),
      h: clampNumber(els.comfyMaskH ? els.comfyMaskH.value : 160, 1, frame.h)
    };
    if (mask.x + mask.w > frame.w) {
      mask.x = Math.max(0, frame.w - mask.w);
    }
    if (mask.y + mask.h > frame.h) {
      mask.y = Math.max(0, frame.h - mask.h);
    }
    els.removeFrame.style.aspectRatio = frame.w + " / " + frame.h;
    els.removeMaskBox.style.left = (mask.x / frame.w * 100) + "%";
    els.removeMaskBox.style.top = (mask.y / frame.h * 100) + "%";
    els.removeMaskBox.style.width = (mask.w / frame.w * 100) + "%";
    els.removeMaskBox.style.height = (mask.h / frame.h * 100) + "%";
    if (els.comfyMaskX) {
      els.comfyMaskX.value = Math.round(mask.x);
      els.comfyMaskY.value = Math.round(mask.y);
      els.comfyMaskW.value = Math.round(mask.w);
      els.comfyMaskH.value = Math.round(mask.h);
    }
  }

  function setRemoveMaskValues(mask) {
    if (!els.comfyMaskX) {
      return;
    }
    els.comfyMaskX.value = Math.round(mask.x);
    els.comfyMaskY.value = Math.round(mask.y);
    els.comfyMaskW.value = Math.round(mask.w);
    els.comfyMaskH.value = Math.round(mask.h);
    syncRemoveMaskFromInputs();
    saveSettings();
  }

  function fitRemoveMaskForText() {
    var frame = getRemoveFrameSize();
    setRemoveMaskValues({
      x: Math.round(frame.w * 0.08),
      y: Math.round(frame.h * 0.76),
      w: Math.round(frame.w * 0.84),
      h: Math.round(frame.h * 0.14)
    });
  }

  function bindRemoveMaskEditor() {
    if (!els.removeFrame || !els.removeMaskBox) {
      return;
    }
    var drag = null;
    function eventPoint(event) {
      var rect = els.removeFrame.getBoundingClientRect();
      var frame = getRemoveFrameSize();
      return {
        x: (event.clientX - rect.left) / Math.max(1, rect.width) * frame.w,
        y: (event.clientY - rect.top) / Math.max(1, rect.height) * frame.h
      };
    }
    function currentMask() {
      var frame = getRemoveFrameSize();
      return {
        x: clampNumber(els.comfyMaskX.value, 0, frame.w),
        y: clampNumber(els.comfyMaskY.value, 0, frame.h),
        w: clampNumber(els.comfyMaskW.value, 1, frame.w),
        h: clampNumber(els.comfyMaskH.value, 1, frame.h)
      };
    }
    els.removeMaskBox.addEventListener("mousedown", function (event) {
      event.preventDefault();
      event.stopPropagation();
      var handle = "";
      if (event.target && event.target.className) {
        handle = String(event.target.className);
      }
      drag = {
        mode: handle.indexOf("remove-mask-handle") >= 0 ? handle : "move",
        start: eventPoint(event),
        mask: currentMask()
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
    els.removeFrame.addEventListener("mousedown", function (event) {
      if (event.target !== els.removeFrame && event.target.className !== "remove-safe-grid") {
        return;
      }
      event.preventDefault();
      var frame = getRemoveFrameSize();
      var pt = eventPoint(event);
      var mask = currentMask();
      setRemoveMaskValues({
        x: clampNumber(pt.x - mask.w / 2, 0, frame.w - mask.w),
        y: clampNumber(pt.y - mask.h / 2, 0, frame.h - mask.h),
        w: mask.w,
        h: mask.h
      });
    });
    function onMove(event) {
      if (!drag) {
        return;
      }
      event.preventDefault();
      var frame = getRemoveFrameSize();
      var pt = eventPoint(event);
      var dx = pt.x - drag.start.x;
      var dy = pt.y - drag.start.y;
      var mask = {
        x: drag.mask.x,
        y: drag.mask.y,
        w: drag.mask.w,
        h: drag.mask.h
      };
      if (drag.mode === "move") {
        mask.x = clampNumber(drag.mask.x + dx, 0, frame.w - drag.mask.w);
        mask.y = clampNumber(drag.mask.y + dy, 0, frame.h - drag.mask.h);
      } else {
        if (drag.mode.indexOf("remove-mask-nw") >= 0 || drag.mode.indexOf("remove-mask-sw") >= 0) {
          mask.x = clampNumber(drag.mask.x + dx, 0, drag.mask.x + drag.mask.w - 1);
          mask.w = drag.mask.w + (drag.mask.x - mask.x);
        }
        if (drag.mode.indexOf("remove-mask-ne") >= 0 || drag.mode.indexOf("remove-mask-se") >= 0) {
          mask.w = clampNumber(drag.mask.w + dx, 1, frame.w - drag.mask.x);
        }
        if (drag.mode.indexOf("remove-mask-nw") >= 0 || drag.mode.indexOf("remove-mask-ne") >= 0) {
          mask.y = clampNumber(drag.mask.y + dy, 0, drag.mask.y + drag.mask.h - 1);
          mask.h = drag.mask.h + (drag.mask.y - mask.y);
        }
        if (drag.mode.indexOf("remove-mask-sw") >= 0 || drag.mode.indexOf("remove-mask-se") >= 0) {
          mask.h = clampNumber(drag.mask.h + dy, 1, frame.h - drag.mask.y);
        }
      }
      setRemoveMaskValues(mask);
    }
    function onUp() {
      drag = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
  }

  function localFileUrl(filePath) {
    return "file://" + encodeURI(String(filePath || "")).replace(/#/g, "%23").replace(/\?/g, "%3F");
  }

  function setRemoveFrameSize(width, height) {
    if (!els.removeFrameW || !els.removeFrameH) {
      return;
    }
    els.removeFrameW.value = Math.max(1, Math.round(Number(width || 720)));
    els.removeFrameH.value = Math.max(1, Math.round(Number(height || 1280)));
    syncRemoveMaskFromInputs();
    saveSettings();
  }

  function removeClipDuration(clip) {
    if (!clip) {
      return 0;
    }
    return Math.max(0, Number(clip.endSeconds || 0) - Number(clip.startSeconds || 0));
  }

  function updateRemoveScrubUi(clip, offset) {
    var duration = removeClipDuration(clip);
    var scrubOffset = clampNumber(offset, 0, Math.max(0, duration));
    if (els.removeScrub) {
      els.removeScrub.max = String(Math.max(0.05, duration));
      els.removeScrub.value = String(scrubOffset);
    }
    if (els.removeScrubLabel) {
      els.removeScrubLabel.textContent = "+" + scrubOffset.toFixed(2) + "s / " + duration.toFixed(2) + "s";
    }
    if (els.removeClipLabel) {
      els.removeClipLabel.textContent = clip ? (clip.name || "Selected clip") : "No clip loaded";
    }
  }

  function loadRemovePreviewFrame(clip, scrubOffset) {
    var nodeRequire = getNodeRequire();
    if (!nodeRequire) {
      setSettingsStatus("Node.js is not available in this CEP panel.", true);
      return Promise.reject(new Error("Node.js is not available in this CEP panel."));
    }
    var fs = nodeRequire("fs");
    var os = nodeRequire("os");
    var path = nodeRequire("path");
    if (!clip || !clip.sourcePath) {
      return Promise.reject(new Error("Select one video clip in the timeline first."));
    }
    var duration = removeClipDuration(clip);
    var offset = clampNumber(scrubOffset, 0, Math.max(0, duration));
    var tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "PR_AI_Remove_Preview_"));
    var previewPath = path.join(tempDir, "preview.jpg");
    var sourceIn = Math.max(0, Number(clip.inPointSeconds || 0) + offset);
    var command = [
      "set -e",
      resolveFfmpegShell(),
      "echo 'Selected: " + clip.name.replace(/'/g, "") + "'",
      "echo 'Timeline range: " + Number(clip.startSeconds || 0).toFixed(3) + "-" + Number(clip.endSeconds || 0).toFixed(3) + "s'",
      "echo 'Source preview time: " + sourceIn.toFixed(3) + "s'",
      "\"$FFMPEG\" -hide_banner -loglevel error -y -ss " + shellQuote(sourceIn.toFixed(3)) + " -i " + shellQuote(clip.sourcePath) + " -frames:v 1 -q:v 2 " + shellQuote(previewPath),
      "SIZE=$(\"$FFMPEG\" -hide_banner -i " + shellQuote(previewPath) + " 2>&1 | sed -n 's/.*, \\([0-9][0-9]*x[0-9][0-9]*\\).*/\\1/p' | head -1)",
      "echo preview_size=$SIZE"
    ].join("\n");
    updateRemoveScrubUi(clip, offset);
    return runShellStreaming(command, {
      onData: function (text) {
        appendInstallStageLog("comfyRender", text);
      }
    }).then(function (output) {
      var match = String(output || "").match(/preview_size=([0-9]+)x([0-9]+)/);
      if (match) {
        setRemoveFrameSize(Number(match[1]), Number(match[2]));
      }
      if (els.removePreviewImage) {
        els.removePreviewImage.src = localFileUrl(previewPath) + "?t=" + new Date().getTime();
        if (els.removeFrame && els.removeFrame.className.indexOf("has-preview") < 0) {
          els.removeFrame.className += " has-preview";
        }
      }
      return previewPath;
    });
  }

  function loadSelectedRemoveClipPreview() {
    setMainTab("remove");
    setInstallStage("comfyRender", "running", "Loading selected clip preview...\n");
    setSettingsStatus("Loading selected clip preview...");
    evalHost("prAI_getSelectedTimelineClips").then(function (result) {
      if (!result.ok) {
        throw new Error(result.error || "Could not read selected timeline clip.");
      }
      var clips = result.data && result.data.clips ? result.data.clips : [];
      if (!clips.length) {
        throw new Error("Select one video clip in the timeline first.");
      }
      var clip = clips[0];
      if (!clip.sourcePath) {
        throw new Error("Selected clip has no source media path.");
      }
      selectedRemoveClip = clip;
      var duration = removeClipDuration(clip);
      var offset = clampNumber(els.removeScrub ? els.removeScrub.value : getComfySettings().timing.startOffset, 0, duration);
      if (offset <= 0 && els.removeStartOffset) {
        offset = clampNumber(els.removeStartOffset.value, 0, duration);
      }
      updateRemoveScrubUi(clip, offset);
      return loadRemovePreviewFrame(clip, offset).then(function () {
        setInstallStage("comfyRender", "done", (els.comfyRenderLog.textContent || "") + "\nPreview loaded.");
        setSettingsStatus("Selected clip preview loaded.");
      });
    }).catch(function (err) {
      var message = String(err && err.message ? err.message : err);
      setInstallStage("comfyRender", "error", (els.comfyRenderLog.textContent || "") + "\n" + message);
      setSettingsStatus(message, true);
    });
  }

  function scrubRemovePreview() {
    if (!selectedRemoveClip || !els.removeScrub) {
      updateRemoveScrubUi(selectedRemoveClip, 0);
      return;
    }
    var offset = clampNumber(els.removeScrub.value, 0, removeClipDuration(selectedRemoveClip));
    updateRemoveScrubUi(selectedRemoveClip, offset);
    if (removePreviewScrubTimer) {
      clearTimeout(removePreviewScrubTimer);
    }
    removePreviewScrubTimer = window.setTimeout(function () {
      setInstallStage("comfyRender", "running", "Loading preview at +" + offset.toFixed(2) + "s...\n");
      loadRemovePreviewFrame(selectedRemoveClip, offset).then(function () {
        setInstallStage("comfyRender", "done", (els.comfyRenderLog.textContent || "") + "\nPreview loaded at +" + offset.toFixed(2) + "s.");
      }).catch(function (err) {
        var message = String(err && err.message ? err.message : err);
        setInstallStage("comfyRender", "error", (els.comfyRenderLog.textContent || "") + "\n" + message);
        setSettingsStatus(message, true);
      });
    }, 180);
  }

  function comfyUserRoot() {
    var nodeRequire = getNodeRequire();
    var settings = getComfySettings();
    if (settings.path && /\/Documents\/ComfyUI(?:\/|$)/.test(settings.path)) {
      return settings.path.replace(/\/+$/, "");
    }
    return (nodeRequire ? nodeRequire("path").join(nodeRequire("os").homedir(), "Documents", "ComfyUI") : "");
  }

  function resolveComfyOutputFolderForContext(sourcePath) {
    var nodeRequire = getNodeRequire();
    if (!nodeRequire) {
      return "";
    }
    var path = nodeRequire("path");
    var settings = getComfySettings();
    var folderName = settings.outputFolderName || "Processed Output";
    if (settings.outputMode === "source" && sourcePath) {
      return path.join(path.dirname(sourcePath), folderName);
    }
    if (state && state.projectPath) {
      return path.join(path.dirname(state.projectPath), folderName);
    }
    if (sourcePath) {
      return path.join(path.dirname(sourcePath), folderName);
    }
    return path.join(nodeRequire("os").homedir(), "Documents", folderName);
  }

  function defaultComfyPathShell() {
    return "\"$HOME/PR_AI_ComfyUI/ComfyUI\"";
  }

  function comfyPortFromUrl(url) {
    var match = String(url || "").match(/:(\d+)(?:\/|$)/);
    return match ? Number(match[1]) : 8188;
  }

  function isWhisperxCommand(command) {
    return /\bwhisperx\b/i.test(String(command || ""));
  }

  // " --language xx" for WhisperX when a language is set, else nothing (it guesses).
  function whisperLanguageArg(settings) {
    var lang = String(settings && settings.language || "auto").replace(/[^a-z-]/gi, "");
    return lang && lang !== "auto" ? " --language " + shellQuote(lang) : "";
  }

  function whisperDeviceForCli(device) {
    device = String(device || "auto");
    return device === "auto" ? "cpu" : device;
  }

  function whisperComputeTypeForCli(device) {
    device = String(device || "auto");
    return device === "cuda" ? "float16" : "int8";
  }

  function openSettings() {
    els.settingsOverlay.hidden = false;
    var activePanel = document.querySelector(".settings-tab-panel.is-active");
    var focusTarget = activePanel ? activePanel.querySelector("input, select, button, textarea") : els.textTempFolder;
    if (focusTarget) {
      focusTarget.focus();
    }
  }

  function closeSettings() {
    els.settingsOverlay.hidden = true;
  }

  function openScriptProjectOverlay() {
    renderScriptProjects();
    if (!els.scriptProjectOverlay) {
      return;
    }
    els.scriptProjectOverlay.hidden = false;
    if (els.scriptProjectSettingsBtn) {
      els.scriptProjectSettingsBtn.setAttribute("aria-expanded", "true");
    }
    if (els.scriptProjectNameInput) {
      els.scriptProjectNameInput.focus();
      els.scriptProjectNameInput.select();
    }
  }

  function closeScriptProjectOverlay() {
    if (els.scriptProjectOverlay) {
      els.scriptProjectOverlay.hidden = true;
    }
    if (els.scriptProjectSettingsBtn) {
      els.scriptProjectSettingsBtn.setAttribute("aria-expanded", "false");
    }
  }

  function setSettingsTab(tabName) {
    var tabs = document.querySelectorAll(".settings-tab");
    var panels = document.querySelectorAll(".settings-tab-panel");
    for (var i = 0; i < tabs.length; i++) {
      var isActive = tabs[i].getAttribute("data-settings-tab") === tabName;
      tabs[i].setAttribute("aria-selected", isActive ? "true" : "false");
      tabs[i].className = isActive ? "settings-tab is-active" : "settings-tab";
    }
    for (var p = 0; p < panels.length; p++) {
      var panelActive = panels[p].getAttribute("data-settings-panel") === tabName;
      panels[p].hidden = !panelActive;
      panels[p].className = panelActive ? "settings-tab-panel is-active" : "settings-tab-panel";
    }
  }

  function openEditGuideOverlay() {
    els.editGuideOverlay.hidden = false;
    els.editGuide.focus();
  }

  function closeEditGuideOverlay() {
    saveEditGuide();
    els.editGuideOverlay.hidden = true;
  }

  function setSettingsStatus(text, isError) {
    els.settingsStatus.textContent = text;
    els.settingsStatus.className = isError ? "error" : "";
  }

  function workflowNodeById(id) {
    var map = activeWorkflowMap();
    for (var i = 0; i < map.nodes.length; i++) {
      if (map.nodes[i].id === id) {
        return map.nodes[i];
      }
    }
    return map.nodes[0];
  }

  function activeWorkflowMap() {
    return workflowMapDefinitions[currentWorkflowMapId] || workflowMapDefinitions.xml;
  }

  function drawWorkflowMap() {
    var canvas = els.workflowMapCanvas;
    var ctx = canvas.getContext("2d");
    var map = activeWorkflowMap();
    var scaleX = canvas.width / 900;
    var scaleY = canvas.height / 520;
    els.workflowMapSelect.value = currentWorkflowMapId;
    document.getElementById("workflowMapTitle").textContent = map.title;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(scaleX, scaleY);

    drawWorkflowBackground(ctx);
    for (var i = 0; i < map.edges.length; i++) {
      drawWorkflowEdge(ctx, workflowNodeById(map.edges[i][0]), workflowNodeById(map.edges[i][1]));
    }
    for (var j = 0; j < map.nodes.length; j++) {
      drawWorkflowNode(ctx, map.nodes[j], map.nodes[j].id === selectedWorkflowNodeId);
    }

    ctx.restore();
    renderWorkflowDetails();
  }

  function drawWorkflowBackground(ctx) {
    ctx.fillStyle = "#17181b";
    ctx.fillRect(0, 0, 900, 520);
    ctx.strokeStyle = "rgba(98, 196, 182, 0.14)";
    ctx.lineWidth = 1;
    for (var x = 36; x < 900; x += 72) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 40, 520);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255, 215, 53, 0.08)";
    ctx.beginPath();
    ctx.arc(716, 96, 70, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(140, 180, 255, 0.08)";
    ctx.beginPath();
    ctx.arc(160, 328, 86, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawWorkflowEdge(ctx, from, to) {
    var start = workflowNodeAnchor(from, to);
    var end = workflowNodeAnchor(to, from);
    var midX = (start.x + end.x) / 2;
    ctx.strokeStyle = "rgba(140, 180, 255, 0.74)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.bezierCurveTo(midX, start.y, midX, end.y, end.x, end.y);
    ctx.stroke();
    drawArrowHead(ctx, start, end);
  }

  function workflowNodeAnchor(node, other) {
    var cx = node.x + node.w / 2;
    var cy = node.y + node.h / 2;
    var ocx = other.x + other.w / 2;
    var ocy = other.y + other.h / 2;
    if (Math.abs(ocx - cx) > Math.abs(ocy - cy)) {
      return { x: ocx > cx ? node.x + node.w : node.x, y: cy };
    }
    return { x: cx, y: ocy > cy ? node.y + node.h : node.y };
  }

  function drawArrowHead(ctx, start, end) {
    var angle = Math.atan2(end.y - start.y, end.x - start.x);
    var size = 8;
    ctx.fillStyle = "rgba(140, 180, 255, 0.9)";
    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - size * Math.cos(angle - Math.PI / 6), end.y - size * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(end.x - size * Math.cos(angle + Math.PI / 6), end.y - size * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  function drawWorkflowNode(ctx, node, selected) {
    ctx.save();
    ctx.shadowColor = selected ? "rgba(98, 196, 182, 0.45)" : "rgba(0, 0, 0, 0.26)";
    ctx.shadowBlur = selected ? 18 : 8;
    ctx.shadowOffsetY = 4;
    roundRect(ctx, node.x, node.y, node.w, node.h, 10);
    ctx.fillStyle = selected ? "#263c3a" : "#24262b";
    ctx.fill();
    ctx.restore();

    roundRect(ctx, node.x, node.y, node.w, node.h, 10);
    ctx.strokeStyle = selected ? "#62c4b6" : "#44474f";
    ctx.lineWidth = selected ? 2 : 1;
    ctx.stroke();

    ctx.fillStyle = selected ? "#f0f0f0" : "#d7dce5";
    ctx.font = "700 15px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.fillText(node.title, node.x + 12, node.y + 28);
    ctx.fillStyle = selected ? "#b8fff3" : "#a7adb8";
    ctx.font = "12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.fillText(node.subtitle, node.x + 12, node.y + 50);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function renderWorkflowDetails() {
    var node = workflowNodeById(selectedWorkflowNodeId);
    clearElement(els.workflowMapDetails);
    var title = document.createElement("strong");
    title.textContent = node.title + " - " + node.subtitle;
    var detail = document.createElement("span");
    detail.textContent = node.detail;
    var guide = document.createElement("span");
    guide.textContent = "Guide: " + node.guide;
    els.workflowMapDetails.appendChild(title);
    els.workflowMapDetails.appendChild(detail);
    els.workflowMapDetails.appendChild(guide);
    els.workflowMapStatus.textContent = "Selected: " + node.title;
  }

  function workflowMapNodeAt(event) {
    var map = activeWorkflowMap();
    var rect = els.workflowMapCanvas.getBoundingClientRect();
    var x = (event.clientX - rect.left) * (900 / rect.width);
    var y = (event.clientY - rect.top) * (520 / rect.height);
    for (var i = map.nodes.length - 1; i >= 0; i--) {
      var node = map.nodes[i];
      if (x >= node.x && x <= node.x + node.w && y >= node.y && y <= node.y + node.h) {
        return node;
      }
    }
    return null;
  }

  function openWorkflowMap() {
    els.workflowMapOverlay.hidden = false;
    els.closeWorkflowMapBtn.focus();
    selectedWorkflowNodeId = activeWorkflowMap().nodes[0].id;
    window.setTimeout(drawWorkflowMap, 0);
  }

  function closeWorkflowMap() {
    els.workflowMapOverlay.hidden = true;
  }

  function insertWorkflowGuide() {
    var map = activeWorkflowMap();
    var lines = [
      map.guideTitle + ":"
    ];
    for (var i = 0; i < map.nodes.length; i++) {
      lines.push("- " + map.nodes[i].title + ": " + map.nodes[i].guide);
    }
    var current = els.prompt.value.replace(/^\s+|\s+$/g, "");
    els.prompt.value = current ? current + "\n\n" + lines.join("\n") : lines.join("\n");
    renderPromptHighlight();
    els.prompt.focus();
    closeWorkflowMap();
    setStatus("Workflow guide inserted.");
  }

  function byteLength(value) {
    var text = String(value || "");
    if (window.TextEncoder) {
      return new TextEncoder().encode(text).length;
    }
    return unescape(encodeURIComponent(text)).length;
  }

  function clearElement(element) {
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }

  function selectStyledTextCapsule(templateId) {
    for (var i = 0; i < styledTextCapsules.length; i++) {
      if (styledTextCapsules[i].id === templateId) {
        styledTextCapsule = styledTextCapsules[i];
        if (!els.stylesOverlay.hidden) {
          renderStyleBrowser();
        }
        setStatus("Style template selected: " + styledTextCapsule.id);
        return;
      }
    }
  }

  function openNativeStyleBrowserOverlay() {
    els.styleBrowserOverlay.hidden = false;
    els.closeStyleBrowserBtn.focus();
    refreshNativeStyleBrowser();
  }

  function closeNativeStyleBrowserOverlay() {
    els.styleBrowserOverlay.hidden = true;
  }

  function refreshNativeStyleBrowser() {
    clearElement(els.nativeStyleSummary);
    clearElement(els.nativeStyleList);
    els.nativeStyleStatus.textContent = "Loading Premiere native style info...";
    evalHost("prAI_listNativeTextStyles").then(function (result) {
      if (!result.ok) {
        els.nativeStyleStatus.textContent = result.error || "Could not load Premiere style info.";
        setStatus(els.nativeStyleStatus.textContent, true);
        return;
      }
      renderNativeStyleBrowser(result.data || {});
    });
  }

  function renderNativeStyleBrowser(data) {
    var groups = data.groups || [{ id: "all", name: "Styles", styles: data.styles || [] }];
    var totalStyles = 0;
    var summaryLines = [
      "Project: " + (data.projectName || "(unknown)"),
      "Sequence: " + (data.sequenceName || "(no active sequence)"),
      "Source: Local Styles + Open Projects",
      data.note || ""
    ];
    clearElement(els.nativeStyleSummary);
    clearElement(els.nativeStyleList);
    for (var i = 0; i < summaryLines.length; i++) {
      if (!summaryLines[i]) {
        continue;
      }
      var line = document.createElement("span");
      line.textContent = summaryLines[i];
      els.nativeStyleSummary.appendChild(line);
    }
    for (var g = 0; g < groups.length; g++) {
      totalStyles += renderNativeStyleGroup(groups[g]);
    }
    if (!totalStyles) {
      renderEmptyNativeStyleCard("No local/open-project text styles were exposed. Save a style in Premiere, keep that project open, then refresh.");
    }
    els.nativeStyleStatus.textContent = "Loaded " + totalStyles + " style record" + (totalStyles === 1 ? "." : "s.");
  }

  function renderNativeStyleGroup(group) {
    var styles = group.styles || [];
    var section = document.createElement("section");
    section.className = "native-style-section";
    var heading = document.createElement("div");
    heading.className = "native-style-section-header";
    var title = document.createElement("strong");
    title.textContent = group.name || "Styles";
    var count = document.createElement("span");
    count.textContent = styles.length + " item" + (styles.length === 1 ? "" : "s");
    heading.appendChild(title);
    heading.appendChild(count);
    section.appendChild(heading);

    var grid = document.createElement("div");
    grid.className = "native-style-grid";
    if (!styles.length) {
      grid.appendChild(createEmptyNativeStyleCard(group.id === "local" ? "No local text style files found in Adobe profile folders." : "No open-project style records found."));
    } else {
      for (var i = 0; i < styles.length; i++) {
        grid.appendChild(createNativeStyleCard(styles[i]));
      }
    }
    section.appendChild(grid);
    els.nativeStyleList.appendChild(section);
    return styles.length;
  }

  function createEmptyNativeStyleCard(message) {
    var empty = document.createElement("div");
    empty.className = "native-style-card native-style-empty";
    empty.textContent = message;
    return empty;
  }

  function renderEmptyNativeStyleCard(message) {
    els.nativeStyleList.appendChild(createEmptyNativeStyleCard(message));
  }

  function createNativeStyleCard(style) {
    var card = document.createElement("article");
    card.className = "native-style-card";

    var title = document.createElement("div");
    title.className = "native-style-title";
    var name = document.createElement("strong");
    name.textContent = style.name || "Premiere Style";
    var source = document.createElement("span");
    source.textContent = style.source || style.kind || "Premiere";
    title.appendChild(name);
    title.appendChild(source);

    var canvas = createNativeStyleSampleCanvas(style.sampleText || "Ag", style.previewValues || {});

    var meta = document.createElement("div");
    meta.className = "native-style-meta";
    meta.textContent = nativeStyleMeta(style);

    var actions = document.createElement("div");
    actions.className = "native-style-actions";
    var apply = document.createElement("button");
    apply.type = "button";
    apply.textContent = "Apply";
    apply.addEventListener("click", function () {
      useNativeStyle(style, "apply");
    });
    var withoutFont = document.createElement("button");
    withoutFont.type = "button";
    withoutFont.textContent = "No Font";
    withoutFont.title = "Apply style without font";
    withoutFont.addEventListener("click", function () {
      useNativeStyle(style, "withoutFont");
    });
    var link = document.createElement("button");
    link.type = "button";
    link.textContent = "Link";
    link.title = "Set as linked style";
    link.addEventListener("click", function () {
      useNativeStyle(style, "link");
    });
    var inspect = document.createElement("button");
    inspect.type = "button";
    inspect.textContent = "Inspect";
    inspect.addEventListener("click", function () {
      insertNativeStyleInfo(style);
    });
    actions.appendChild(apply);
    actions.appendChild(withoutFont);
    actions.appendChild(link);
    actions.appendChild(inspect);

    card.appendChild(title);
    card.appendChild(canvas);
    card.appendChild(meta);
    card.appendChild(actions);
    return card;
  }

  function createNativeStyleSampleCanvas(text, values) {
    var canvas = createStyleSampleCanvas(text);
    canvas.width = 220;
    canvas.height = 150;
    canvas.setAttribute("data-sample-text", text);
    applyPreviewStyle(canvas, values);
    return canvas;
  }

  function nativeStyleMeta(style) {
    var parts = [];
    if (style.clipName) {
      parts.push("clip " + style.clipName);
    }
    if (style.trackIndex !== undefined) {
      parts.push("V" + (Number(style.trackIndex) + 1));
    }
    if (style.propertyCount !== undefined) {
      parts.push(style.propertyCount + " properties");
    }
    if (style.useCount && style.useCount > 1) {
      parts.push("used " + style.useCount + " times");
    }
    if (style.path) {
      parts.push(style.path);
    }
    return parts.join(". ") || "Style-related Premiere record.";
  }

  function useNativeStyle(style, mode) {
    var modeText = mode === "withoutFont" ? "Apply style without font" : (mode === "link" ? "Set as linked style" : "Apply style");
    var lines = [
      modeText + " using Premiere native style \"" + (style.name || "Premiere Style") + "\" for the selected text range.",
      "Source: " + (style.source || style.kind || "Premiere style browser") + ".",
      "If applying to an existing Graphic clip, inspect/list graphic properties first and use setGraphicProperty/setGraphicText only when the host exposes editable properties.",
      "Do not use SVG."
    ];
    var current = els.prompt.value.replace(/^\s+|\s+$/g, "");
    els.prompt.value = current ? current + "\n\n" + lines.join("\n") : lines.join("\n");
    renderPromptHighlight();
    els.prompt.focus();
    els.nativeStyleStatus.textContent = "Inserted native style instruction.";
    setStatus("Native style instruction inserted.");
  }

  function insertNativeStyleInfo(style) {
    var text = [
      "Premiere native style info:",
      JSON.stringify(style, null, 2)
    ].join("\n");
    var current = els.prompt.value.replace(/^\s+|\s+$/g, "");
    els.prompt.value = current ? current + "\n\n" + text : text;
    renderPromptHighlight();
    els.prompt.focus();
    els.nativeStyleStatus.textContent = "Inserted native style inspection data.";
  }

  function renderStyleBrowser() {
    var capsule = styledTextCapsule;
    clearElement(els.styleTemplateInfo);
    clearElement(els.styleGlobalControls);
    clearElement(els.stylePreviewList);

    var templateLabel = document.createElement("label");
    templateLabel.textContent = "Template";
    var templateSelect = document.createElement("select");
    for (var t = 0; t < styledTextCapsules.length; t++) {
      var option = document.createElement("option");
      option.value = styledTextCapsules[t].id;
      option.textContent = styledTextCapsules[t].name;
      option.selected = styledTextCapsules[t].id === capsule.id;
      templateSelect.appendChild(option);
    }
    templateSelect.addEventListener("change", function () {
      selectStyledTextCapsule(templateSelect.value);
    });
    templateLabel.appendChild(templateSelect);
    els.styleTemplateInfo.appendChild(templateLabel);

    var title = document.createElement("strong");
    title.textContent = capsule.name;
    els.styleTemplateInfo.appendChild(title);

    var id = document.createElement("span");
    id.textContent = "Template: " + capsule.id;
    els.styleTemplateInfo.appendChild(id);

    var size = document.createElement("span");
    size.textContent = "Canvas: " + capsule.sequence.width + "x" + capsule.sequence.height + " | " + capsule.sequence.clipEndFrame + " frames at " + capsule.sequence.timebase + " fps";
    els.styleTemplateInfo.appendChild(size);

    var note = document.createElement("span");
    note.textContent = capsule.workflow || "Decoded values are partial: preview settings are editable references for the agent; binary XML write-back still needs offset validation.";
    els.styleTemplateInfo.appendChild(note);
    buildGlobalStyleControls();

    for (var i = 0; i < capsule.styleSpans.length; i++) {
      var span = capsule.styleSpans[i];
      var card = document.createElement("article");
      card.className = "style-card";

      var header = document.createElement("div");
      header.className = "style-card-header";

      var cardTitle = document.createElement("div");
      cardTitle.className = "style-card-title";

      var name = document.createElement("strong");
      name.textContent = span.styleName;
      cardTitle.appendChild(name);

      var source = document.createElement("span");
      source.textContent = "Source spans: " + (span.sourceSpans || [span.text]).join(", ");
      cardTitle.appendChild(source);

      var badge = document.createElement("span");
      badge.className = "style-byte-badge";
      badge.textContent = styleByteLabel(span);

      header.appendChild(cardTitle);
      header.appendChild(badge);

      var editControls = buildStyleIdentityControls(span, cardTitle, badge);

      var sample = document.createElement("div");
      sample.className = "style-sample";
      applySampleArea(sample);
      var sampleCanvas = createStyleSampleCanvas(span.text);
      applyPreviewStyle(sampleCanvas, span.previewValues);
      sample.appendChild(sampleCanvas);

      var meta = document.createElement("div");
      meta.className = "style-meta";
      meta.textContent = styleMetaText(span);

      var controls = buildStyleControls(span, sampleCanvas, meta);

      card.appendChild(header);
      card.appendChild(editControls);
      card.appendChild(sample);
      card.appendChild(meta);
      card.appendChild(controls);
      els.stylePreviewList.appendChild(card);
    }
  }

  function styleByteLabel(span) {
    var spans = span.sourceSpans || [span.text];
    var lengths = [];
    for (var i = 0; i < spans.length; i++) {
      lengths.push(byteLength(spans[i]));
    }
    return lengths.join("/") + " bytes";
  }

  function buildStyleIdentityControls(span, cardTitle, badge) {
    var controls = document.createElement("div");
    var title = cardTitle.querySelector("strong");
    var source = cardTitle.querySelector("span");
    controls.className = "style-identity-controls";

    addStyleTextControl(controls, "Name", span.styleName, function (value) {
      span.styleName = value || "unnamedStyle";
      title.textContent = span.styleName;
    });
    addStyleTextControl(controls, "Preview text", span.text, function (value) {
      span.text = value || "Sample";
      var canvas = controls.parentNode ? controls.parentNode.querySelector(".style-sample-canvas") : null;
      if (canvas) {
        canvas.setAttribute("data-sample-text", span.text);
        applyPreviewStyle(canvas, span.previewValues);
      }
    });
    addStyleTextControl(controls, "Source spans", (span.sourceSpans || [span.text]).join(", "), function (value) {
      span.sourceSpans = parseSourceSpans(value || span.text);
      source.textContent = "Source spans: " + span.sourceSpans.join(", ");
      badge.textContent = styleByteLabel(span);
    });

    var remove = document.createElement("button");
    remove.type = "button";
    remove.className = "style-remove-btn";
    remove.textContent = "Delete";
    remove.disabled = styledTextCapsule.styleSpans.length <= 1;
    remove.addEventListener("click", function () {
      removeStyle(span);
    });
    controls.appendChild(remove);
    return controls;
  }

  function parseSourceSpans(value) {
    var parts = String(value || "").split(",");
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var text = parts[i].replace(/^\s+|\s+$/g, "");
      if (text) {
        out.push(text);
      }
    }
    return out.length ? out : ["Sample"];
  }

  function addStyle() {
    var index = styledTextCapsule.styleSpans.length + 1;
    styledTextCapsule.styleSpans.push({
      text: "New Style",
      sourceSpans: ["New Style"],
      styleName: "customStyle" + index,
      description: "Custom preview style. Not mapped to a proven Premiere XML blob span yet.",
      font: styledTextCapsule.globalPreviewValues.fontFamily || "KitRounded-ExtraBold",
      fill: "custom preview fill",
      decodedValues: {
        confidence: "preview-only",
        textByteOffset: "?",
        byteLength: byteLength("New Style"),
        likelyStyleOffset: "?",
        observedFields: {}
      },
      previewValues: {
        sizeAdjust: 0,
        fillType: "solid",
        fillColor: "#f7f8fb",
        fillColor2: "#f7f8fb",
        strokeColor: "#161616",
        strokeAdjust: 0,
        fillOverStroke: true,
        shadow: true
      }
    });
    renderStyleBrowser();
    setStatus("Style added.");
  }

  function removeStyle(span) {
    if (styledTextCapsule.styleSpans.length <= 1) {
      setStatus("At least one style is required.", true);
      return;
    }
    for (var i = 0; i < styledTextCapsule.styleSpans.length; i++) {
      if (styledTextCapsule.styleSpans[i] === span) {
        styledTextCapsule.styleSpans.splice(i, 1);
        break;
      }
    }
    renderStyleBrowser();
    setStatus("Style removed.");
  }

  function buildGlobalStyleControls() {
    var values = styledTextCapsule.globalPreviewValues;
    addStyleSelectControl(els.styleGlobalControls, "Font", values.fontFamily, ["KitRounded-ExtraBold", "Arial Rounded MT Bold", "Arial", "Helvetica", "Impact"], function (value) {
      values.fontFamily = value;
      redrawStylePreviews();
    });
    addStyleNumberControl(els.styleGlobalControls, "Global size", values.fontSize, 8, 120, function (value) {
      values.fontSize = value;
      redrawStylePreviews();
    });
    addStyleNumberControl(els.styleGlobalControls, "Area width", values.areaTypeWidth, 80, 1920, function (value) {
      values.areaTypeWidth = value;
      redrawStylePreviews();
    });
    addStyleNumberControl(els.styleGlobalControls, "Area height", values.areaTypeHeight, 40, 1080, function (value) {
      values.areaTypeHeight = value;
      redrawStylePreviews();
    });
    addStyleSelectControl(els.styleGlobalControls, "Align", values.textAlign, ["left", "center", "right"], function (value) {
      values.textAlign = value;
      redrawStylePreviews();
    });
    addStyleSelectControl(els.styleGlobalControls, "Stroke orientation", values.strokeOrientation, ["outer", "center", "inner"], function (value) {
      values.strokeOrientation = value;
      redrawStylePreviews();
    });
    addStyleNumberControl(els.styleGlobalControls, "Stroke px", values.strokeWidth, 0, 24, function (value) {
      values.strokeWidth = value;
      redrawStylePreviews();
    });
  }

  function redrawStylePreviews() {
    var cards = els.stylePreviewList.querySelectorAll(".style-card");
    for (var i = 0; i < styledTextCapsule.styleSpans.length; i++) {
      var span = styledTextCapsule.styleSpans[i];
      var card = cards[i];
      if (!card) {
        continue;
      }
      var sample = card.querySelector(".style-sample");
      var canvas = card.querySelector(".style-sample-canvas");
      var meta = card.querySelector(".style-meta");
      if (sample) {
        applySampleArea(sample);
      }
      if (canvas) {
        applyPreviewStyle(canvas, span.previewValues);
      }
      if (meta) {
        meta.textContent = styleMetaText(span);
      }
    }
  }

  function applySampleArea(element) {
    var global = styledTextCapsule.globalPreviewValues || {};
    element.style.minHeight = Math.max(48, Math.min(84, Number(global.areaTypeHeight || 180) / 3.2)) + "px";
    element.style.justifyContent = global.textAlign === "left" ? "flex-start" : (global.textAlign === "right" ? "flex-end" : "center");
    element.style.textAlign = global.textAlign || "center";
  }

  function createStyleSampleCanvas(text) {
    var canvas = document.createElement("canvas");
    canvas.className = "style-sample-canvas";
    canvas.width = 760;
    canvas.height = 150;
    canvas.setAttribute("data-sample-text", text);
    return canvas;
  }

  function applyPreviewStyle(canvas, values) {
    values = values || {};
    if (canvas && canvas.getContext) {
      drawStyleSampleCanvas(canvas, String(canvas.getAttribute("data-sample-text") || ""), values);
      return;
    }
  }

  function drawStyleSampleCanvas(canvas, text, values) {
    var global = styledTextCapsule.globalPreviewValues || {};
    var ctx = canvas.getContext("2d");
    var width = canvas.width;
    var height = canvas.height;
    var strokeWidth = Math.max(0, Number(global.strokeWidth || 0) + Number(values.strokeAdjust || 0));
    var strokeColor = values.strokeColor || "transparent";
    var strokeOrientation = global.strokeOrientation || "outer";
    var fontFamily = global.fontFamily || "KitRounded-ExtraBold";
    var fontSize = Math.max(1, Number(global.fontSize || 28) + Number(values.sizeAdjust || 0));
    var textAlign = global.textAlign || "center";
    var metrics;
    var x;
    var y;
    var gradient;

    drawCanvasGrid(ctx, width, height);
    ctx.save();
    ctx.font = "800 " + fontSize + "px " + fontFamily + ", Arial Rounded MT Bold, Arial, sans-serif";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.textAlign = textAlign;
    metrics = ctx.measureText(text);
    x = textAlign === "left" ? 42 : (textAlign === "right" ? width - 42 : width / 2);
    y = height / 2;

    if (values.shadow) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
      ctx.fillText(text, x, y + 4);
    }

    if (strokeWidth > 0) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeOrientation === "inner" ? Math.max(1, strokeWidth) : Math.max(1, strokeWidth * 2);
      ctx.strokeText(text, x, y);
    }

    if (values.fillType === "gradient") {
      gradient = ctx.createLinearGradient(0, y - fontSize * 0.55, 0, y + fontSize * 0.55);
      gradient.addColorStop(0, values.fillColor || "#ffd735");
      gradient.addColorStop(0.56, "#ffd982");
      gradient.addColorStop(1, values.fillColor2 || values.fillColor || "#dd9300");
      ctx.fillStyle = gradient;
    } else {
      ctx.fillStyle = values.fillColor || "#f7f8fb";
    }
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function drawCanvasGrid(ctx, width, height) {
    ctx.fillStyle = "#d8dce3";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(80, 86, 98, 0.22)";
    ctx.lineWidth = 1;
    for (var x = 0; x <= width; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (var y = 0; y <= height; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  function styleMetaText(span) {
    var values = span.previewValues || {};
    var global = styledTextCapsule.globalPreviewValues || {};
    var decoded = span.decodedValues || {};
    var observed = decoded.observedFields || {};
    return [
      span.description,
      "font " + (global.fontFamily || span.font),
      "global size " + (global.fontSize || "?"),
      "style adjust " + (values.sizeAdjust || 0),
      "fill " + (values.fillType || "solid") + " " + (values.fillColor || ""),
      "stroke " + Math.max(0, Number(global.strokeWidth || 0) + Number(values.strokeAdjust || 0)) + "px " + (values.strokeColor || ""),
      "stroke adjust " + (values.strokeAdjust || 0),
      "stroke orientation " + (global.strokeOrientation || "outer"),
      "fill over stroke " + (values.fillOverStroke !== false ? "on" : "off"),
      "blob text @" + decoded.textByteOffset,
      "style block @" + decoded.likelyStyleOffset,
      "font-size-like float " + (observed.fontSizeLikeFloat || "?")
    ].join(". ") + ".";
  }

  function buildStyleControls(span, sampleText, meta) {
    var values = span.previewValues || {};
    var controls = document.createElement("div");
    controls.className = "style-controls";

    addStyleNumberControl(controls, "Size adjust", values.sizeAdjust, -60, 60, function (value) {
      values.sizeAdjust = value;
      applyPreviewStyle(sampleText, values);
      meta.textContent = styleMetaText(span);
    });
    addStyleColorControl(controls, "Fill", values.fillColor, function (value) {
      values.fillColor = value;
      applyPreviewStyle(sampleText, values);
      meta.textContent = styleMetaText(span);
    });
    addStyleColorControl(controls, "Fill 2", values.fillColor2, function (value) {
      values.fillColor2 = value;
      applyPreviewStyle(sampleText, values);
      meta.textContent = styleMetaText(span);
    });
    addStyleColorControl(controls, "Stroke", values.strokeColor, function (value) {
      values.strokeColor = value;
      applyPreviewStyle(sampleText, values);
      meta.textContent = styleMetaText(span);
    });
    addStyleNumberControl(controls, "Stroke adjust", values.strokeAdjust, -12, 12, function (value) {
      values.strokeAdjust = value;
      applyPreviewStyle(sampleText, values);
      meta.textContent = styleMetaText(span);
    });
    addStyleCheckboxControl(controls, "Fill over stroke", values.fillOverStroke !== false, function (value) {
      values.fillOverStroke = value;
      applyPreviewStyle(sampleText, values);
      meta.textContent = styleMetaText(span);
    });
    addStyleSelectControl(controls, "Fill type", values.fillType, ["solid", "gradient"], function (value) {
      values.fillType = value;
      applyPreviewStyle(sampleText, values);
      meta.textContent = styleMetaText(span);
    });

    return controls;
  }

  function addStyleNumberControl(parent, labelText, value, min, max, onChange) {
    var label = document.createElement("label");
    label.textContent = labelText;
    var input = document.createElement("input");
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.step = "1";
    input.value = String(value || 0);
    input.addEventListener("input", function () {
      onChange(Number(input.value || 0));
    });
    label.appendChild(input);
    parent.appendChild(label);
  }

  function addStyleColorControl(parent, labelText, value, onChange) {
    var label = document.createElement("label");
    label.textContent = labelText;
    var wrap = document.createElement("div");
    wrap.className = "style-color-control";
    var input = document.createElement("input");
    input.type = "text";
    input.value = value || "#ffffff";
    input.spellcheck = false;
    input.addEventListener("input", function () {
      if (/^#[0-9a-f]{6}$/i.test(input.value)) {
        onChange(input.value);
      }
    });
    var pick = document.createElement("button");
    pick.type = "button";
    pick.className = "style-color-pick";
    pick.title = "Pick color";
    pick.style.backgroundColor = value || "#ffffff";
    pick.addEventListener("click", function () {
      pickNativeColor(input.value, function (hex) {
        input.value = hex;
        pick.style.backgroundColor = hex;
        onChange(hex);
      });
    });
    wrap.appendChild(pick);
    wrap.appendChild(input);
    label.appendChild(wrap);
    parent.appendChild(label);
  }

  function pickNativeColor(currentHex, onPick) {
    evalHost("prAI_pickColor", { color: currentHex || "#ffffff" }).then(function (result) {
      if (result.ok && result.data && result.data.hex) {
        onPick(result.data.hex);
      } else {
        setStatus(result.error || "Native color picker unavailable.", true);
      }
    });
  }

  function addStyleTextControl(parent, labelText, value, onChange) {
    var label = document.createElement("label");
    label.textContent = labelText;
    var input = document.createElement("input");
    input.type = "text";
    input.value = value || "";
    input.spellcheck = false;
    input.addEventListener("input", function () {
      onChange(input.value);
    });
    label.appendChild(input);
    parent.appendChild(label);
  }

  function addStyleCheckboxControl(parent, labelText, value, onChange) {
    var label = document.createElement("label");
    label.className = "style-checkbox-control";
    var input = document.createElement("input");
    input.type = "checkbox";
    input.checked = value === true;
    input.addEventListener("change", function () {
      onChange(input.checked === true);
    });
    label.appendChild(input);
    label.appendChild(document.createTextNode(labelText));
    parent.appendChild(label);
  }

  function addStyleSelectControl(parent, labelText, value, options, onChange) {
    var label = document.createElement("label");
    label.textContent = labelText;
    var input = document.createElement("select");
    for (var i = 0; i < options.length; i++) {
      var option = document.createElement("option");
      option.value = options[i];
      option.textContent = options[i];
      input.appendChild(option);
    }
    input.value = value || options[0];
    input.addEventListener("change", function () {
      onChange(input.value);
    });
    label.appendChild(input);
    parent.appendChild(label);
  }

  function openStylesOverlay() {
    renderStyleBrowser();
    els.stylesOverlay.hidden = false;
    els.closeStylesBtn.focus();
    els.stylesStatus.textContent = "Previewing saved styled XML capsule.";
    els.stylesStatus.className = "";
  }

  function closeStylesOverlay() {
    els.stylesOverlay.hidden = true;
  }

  function insertStylePrompt() {
    var replacements = styledTextCapsule.testedReplacement;
    var lines = [
      "Create a styled XML text graphic with templateId \"" + styledTextCapsule.id + "\".",
      "Use createStyledTextXml only. Do not hand-write XML or use writeTempTextFile for styled XML.",
      "XML export folder setting: " + (getXmlOutputFolder() || "(default project folder/XML)") + ".",
      "XML action when done setting: " + getXmlAfterCreateAction() + ".",
      "XML filename is enforced by the host: YYYY-MM-DD-HH-mm - AutoEdit - Function.xml. Do not provide suggestedName or name for createStyledTextXml; set functionName to Text, Cut, or Both.",
      "For multiple XML text frames, use createStyledTextXml.frames in one action. Do not use duplicateClip for XML text frame creation.",
      "Use same-byte-length replacements for these source spans:"
    ];
    for (var i = 0; i < replacements.length; i++) {
      lines.push("- " + replacements[i].from + " (" + replacements[i].byteLength + " bytes) -> ");
    }
    if (styledTextCapsule.runComponents && styledTextCapsule.runComponents.length) {
      lines.push("");
      lines.push("Run components to copy from this template:");
      for (var r = 0; r < styledTextCapsule.runComponents.length; r++) {
        var component = styledTextCapsule.runComponents[r];
        lines.push("- " + component.from + " (" + component.byteLength + " bytes) uses " + component.styleName + "; runObject @" + component.runObjectOffset + "; styleObject @" + component.styleObjectOffset + "; text @" + component.textByteOffset);
      }
      lines.push("Preserve leading/trailing spaces in these source strings.");
    }
    lines.push("");
    lines.push("Global preview settings:");
    lines.push(JSON.stringify(styledTextCapsule.globalPreviewValues));
    lines.push("");
    lines.push("Style preview settings to reference:");
    for (var j = 0; j < styledTextCapsule.styleSpans.length; j++) {
      lines.push("- " + styledTextCapsule.styleSpans[j].styleName + " for \"" + (styledTextCapsule.styleSpans[j].sourceSpans || [styledTextCapsule.styleSpans[j].text]).join(", ") + "\": " + JSON.stringify(styledTextCapsule.styleSpans[j].previewValues));
    }
    lines.push("");
    if (styledTextCapsule.id === "text-xml-five-run-switching") {
      lines.push("Default style mapping for this template: switchA = runs 0/2/4; switchB = runs 1/3. Use it for A/B/A/B/A word switching.");
    } else {
      lines.push("Default style mapping: normal text = defaultWhite; bold/emphasis text = yellowGradient. Do not ask to confirm this default unless the user requests a different mapping or the script markup is genuinely ambiguous.");
    }
    lines.push("If the user only asks whether styled XML creation is ready, answer readiness/status only; do not ask for replacement strings until a specific XML creation request is made.");
    lines.push("Each frame can carry its own replacements/startFrame/startSeconds/durationFrames/effectName/clipName. Set stackFrames:true only when the XML frames should layer at the same start time.");
    lines.push("If a requested text frame does not match the fixed source span byte lengths, createStyledTextXml cannot create that frame until a matching XML capsule/template exists; component editing is only a timeline workaround.");
    var current = els.prompt.value.replace(/^\s+|\s+$/g, "");
    els.prompt.value = current ? current + "\n\n" + lines.join("\n") : lines.join("\n");
    renderPromptHighlight();
    els.prompt.focus();
    closeStylesOverlay();
    setStatus("Styled XML prompt inserted.");
  }

  function openCaptionOverlay() {
    els.captionOverlay.hidden = false;
    els.captionText.focus();
    setCaptionStatus("Uses the text file folder from Settings: " + (getTextTempFolder() || "default PR AI temp folder"));
  }

  function closeCaptionOverlay() {
    els.captionOverlay.hidden = true;
  }

  function setCaptionStatus(text, isError) {
    els.captionStatus.textContent = text;
    els.captionStatus.className = isError ? "error" : "";
  }

  function pad2(value) {
    value = Number(value);
    return value < 10 ? "0" + value : String(value);
  }

  function secondsToSrtTime(seconds) {
    var totalMs = Math.max(0, Math.round(Number(seconds || 0) * 1000));
    var ms = totalMs % 1000;
    var totalSeconds = Math.floor(totalMs / 1000);
    var s = totalSeconds % 60;
    var totalMinutes = Math.floor(totalSeconds / 60);
    var m = totalMinutes % 60;
    var h = Math.floor(totalMinutes / 60);
    var msText = ms < 10 ? "00" + ms : (ms < 100 ? "0" + ms : String(ms));
    return pad2(h) + ":" + pad2(m) + ":" + pad2(s) + "," + msText;
  }

  function looksLikeSrt(text) {
    return /\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/.test(text);
  }

  function srtTimeToSeconds(value) {
    var match = String(value || "").match(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/);
    if (!match) {
      return 0;
    }
    var ms = String(match[4]);
    while (ms.length < 3) {
      ms += "0";
    }
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(ms.slice(0, 3)) / 1000;
  }

  function parseSrtBlocks(contents) {
    var text = String(contents || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    var chunks = text.split(/\n{2,}/);
    var blocks = [];
    for (var i = 0; i < chunks.length; i++) {
      var lines = chunks[i].split(/\n/);
      var timingIndex = -1;
      for (var j = 0; j < lines.length; j++) {
        if (/-->/.test(lines[j])) {
          timingIndex = j;
          break;
        }
      }
      if (timingIndex < 0) {
        continue;
      }
      var timing = lines[timingIndex].split(/-->/);
      if (timing.length < 2) {
        continue;
      }
      var blockText = [];
      for (var t = timingIndex + 1; t < lines.length; t++) {
        if (lines[t].replace(/^\s+|\s+$/g, "")) {
          blockText.push(lines[t]);
        }
      }
      blocks.push({
        start: srtTimeToSeconds(timing[0]),
        end: srtTimeToSeconds(timing[1]),
        text: blockText.join("\n")
      });
    }
    return blocks;
  }

  function buildSrtFromBlocks(blocks) {
    var lines = [];
    for (var i = 0; i < blocks.length; i++) {
      if (!blocks[i] || !String(blocks[i].text || "").replace(/\s+/g, "")) {
        continue;
      }
      var blockText = String(blocks[i].text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").replace(/^\s+|\s+$/g, "");
      lines.push(String(lines.length / 4 + 1));
      lines.push(secondsToSrtTime(blocks[i].start) + " --> " + secondsToSrtTime(Math.max(blocks[i].start + 0.05, blocks[i].end)));
      lines.push(blockText);
      lines.push("");
    }
    return lines.join("\r\n");
  }

  function scriptLinesFromText(text) {
    var rows = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split(/\n/);
    var lines = [];
    for (var i = 0; i < rows.length; i++) {
      var line = rows[i].replace(/^\s+|\s+$/g, "");
      if (line && !/^\(?none\)?$/i.test(line) && !/^-+$/.test(line)) {
        lines.push(line);
      }
    }
    return lines;
  }

  function alignmentTokens(text) {
    var raw = String(text || "").toLowerCase()
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9\u00c0-\u1ef9]+/g, " ")
      .replace(/^\s+|\s+$/g, "");
    if (!raw) {
      return [];
    }
    return raw.split(/\s+/);
  }

  function tokenMap(tokens) {
    var map = {};
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i]) {
        map[tokens[i]] = (map[tokens[i]] || 0) + 1;
      }
    }
    return map;
  }

  function tokenOverlapScore(lineTokens, spanTokens) {
    if (!lineTokens.length || !spanTokens.length) {
      return 0;
    }
    var lineMap = tokenMap(lineTokens);
    var spanMap = tokenMap(spanTokens);
    var overlap = 0;
    for (var key in lineMap) {
      if (lineMap.hasOwnProperty(key) && spanMap[key]) {
        overlap += Math.min(lineMap[key], spanMap[key]);
      }
    }
    var lineCoverage = overlap / lineTokens.length;
    var spanCoverage = overlap / spanTokens.length;
    var lengthPenalty = Math.abs(spanTokens.length - lineTokens.length) / Math.max(1, lineTokens.length + spanTokens.length);
    return overlap + lineCoverage + spanCoverage - lengthPenalty;
  }

  function detectedSpanTokens(detected, startIndex, endIndex) {
    var tokens = [];
    for (var i = startIndex; i <= endIndex && i < detected.length; i++) {
      var blockTokens = detected[i]._tokens || [];
      for (var t = 0; t < blockTokens.length; t++) {
        tokens.push(blockTokens[t]);
      }
    }
    return tokens;
  }

  function mapProvidedLinesToDetectedBlocks(detected, lines) {
    var mapped = [];
    var cursor = 0;
    var maxSpanBlocks = 16;
    for (var i = 0; i < lines.length; i++) {
      var remainingLines = lines.length - i - 1;
      var lastAllowedStart = Math.max(cursor, detected.length - remainingLines - 1);
      var lineTokens = alignmentTokens(lines[i]);
      var best = null;
      var bestScore = -999999;
      for (var start = cursor; start <= lastAllowedStart && start < detected.length; start++) {
        var maxEnd = Math.min(detected.length - remainingLines - 1, start + maxSpanBlocks - 1);
        for (var end = start; end <= maxEnd; end++) {
          var spanTokens = detectedSpanTokens(detected, start, end);
          var score = tokenOverlapScore(lineTokens, spanTokens);
          if (score > bestScore) {
            bestScore = score;
            best = { startIndex: start, endIndex: end, score: score };
          }
        }
      }
      if (!best || best.score <= 0) {
        var fallbackStart = Math.floor(i * detected.length / lines.length);
        var fallbackEnd = Math.max(fallbackStart, Math.ceil((i + 1) * detected.length / lines.length) - 1);
        best = {
          startIndex: Math.max(cursor, Math.min(detected.length - 1, fallbackStart)),
          endIndex: Math.max(cursor, Math.min(detected.length - 1, fallbackEnd)),
          score: 0
        };
      }
      if (best.endIndex < best.startIndex) {
        best.endIndex = best.startIndex;
      }
      mapped.push({
        start: detected[best.startIndex].start,
        end: detected[Math.min(detected.length - 1, best.endIndex)].end,
        text: lines[i],
        matchScore: best.score,
        detectedStartIndex: best.startIndex,
        detectedEndIndex: best.endIndex
      });
      cursor = Math.max(best.endIndex + 1, cursor + 1);
      if (cursor >= detected.length && i < lines.length - 1) {
        cursor = detected.length - 1;
      }
    }
    return mapped;
  }

  function retimeProvidedTextToDetectedSrt(detectedSrt, providedText) {
    var detected = parseSrtBlocks(detectedSrt);
    var lines = scriptLinesFromText(providedText);
    if (!detected.length || !lines.length) {
      return detectedSrt;
    }
    for (var b = 0; b < detected.length; b++) {
      detected[b]._tokens = alignmentTokens(detected[b].text);
    }
    if (lines.length === detected.length) {
      for (var i = 0; i < detected.length; i++) {
        detected[i].text = lines[i];
      }
      return buildSrtFromBlocks(detected);
    }

    var mapped = [];
    if (lines.length < detected.length) {
      mapped = mapProvidedLinesToDetectedBlocks(detected, lines);
      return buildSrtFromBlocks(mapped);
    }

    var totalStart = detected[0].start;
    var totalEnd = detected[detected.length - 1].end;
    var totalDuration = Math.max(0.1, totalEnd - totalStart);
    for (var more = 0; more < lines.length; more++) {
      var itemStart = totalStart + totalDuration * more / lines.length;
      var itemEnd = totalStart + totalDuration * (more + 1) / lines.length;
      mapped.push({ start: itemStart, end: itemEnd, text: lines[more] });
    }
    return buildSrtFromBlocks(mapped);
  }

  function wordCountForScriptLine(line) {
    return Math.max(1, alignmentTokens(line).length);
  }

  function proportionalWordBoundary(cumulativeCount, totalCount, detectedWordCount) {
    if (totalCount <= 0 || detectedWordCount <= 0) {
      return 0;
    }
    return Math.round(cumulativeCount / totalCount * detectedWordCount);
  }

  function editDistanceSmall(a, b) {
    a = String(a || "");
    b = String(b || "");
    if (a === b) {
      return 0;
    }
    if (!a.length) {
      return b.length;
    }
    if (!b.length) {
      return a.length;
    }
    var previous = [];
    var current = [];
    for (var j = 0; j <= b.length; j++) {
      previous[j] = j;
    }
    for (var i = 1; i <= a.length; i++) {
      current[0] = i;
      for (var c = 1; c <= b.length; c++) {
        var cost = a.charAt(i - 1) === b.charAt(c - 1) ? 0 : 1;
        current[c] = Math.min(previous[c] + 1, current[c - 1] + 1, previous[c - 1] + cost);
      }
      var tmp = previous;
      previous = current;
      current = tmp;
    }
    return previous[b.length];
  }

  function tokenSimilarity(a, b) {
    a = String(a || "");
    b = String(b || "");
    if (!a || !b) {
      return 0;
    }
    if (a === b) {
      return 1;
    }
    if ((a.length >= 4 || b.length >= 4) && (a.indexOf(b) !== -1 || b.indexOf(a) !== -1)) {
      return Math.min(a.length, b.length) / Math.max(a.length, b.length);
    }
    var maxLen = Math.max(a.length, b.length);
    if (maxLen <= 2) {
      return 0;
    }
    return 1 - (editDistanceSmall(a, b) / maxLen);
  }

  function scriptTokenRecords(lines) {
    var records = [];
    for (var i = 0; i < lines.length; i++) {
      var tokens = alignmentTokens(lines[i]);
      for (var t = 0; t < tokens.length; t++) {
        records.push({ token: tokens[t], lineIndex: i, tokenInLine: t });
      }
    }
    return records;
  }

  function whisperTokenRecords(words) {
    var records = [];
    for (var i = 0; i < words.length; i++) {
      var tokens = alignmentTokens(words[i].text);
      for (var t = 0; t < tokens.length; t++) {
        records.push({ token: tokens[t], wordIndex: i });
      }
    }
    return records;
  }

  function fillMissingWordMap(wordMap, scriptTokens, detectedTokens, words) {
    var n = scriptTokens.length;
    var m = detectedTokens.length;
    var anchors = [];
    for (var i = 0; i < n; i++) {
      if (wordMap[i] !== null && wordMap[i] !== undefined && isFinite(wordMap[i])) {
        anchors.push({ scriptIndex: i, wordIndex: wordMap[i] });
      }
    }
    for (var s = 0; s < n; s++) {
      if (wordMap[s] !== null && wordMap[s] !== undefined && isFinite(wordMap[s])) {
        continue;
      }
      var prev = null;
      var next = null;
      for (var p = anchors.length - 1; p >= 0; p--) {
        if (anchors[p].scriptIndex < s) {
          prev = anchors[p];
          break;
        }
      }
      for (var q = 0; q < anchors.length; q++) {
        if (anchors[q].scriptIndex > s) {
          next = anchors[q];
          break;
        }
      }
      if (prev && next && next.scriptIndex > prev.scriptIndex) {
        var ratio = (s - prev.scriptIndex) / (next.scriptIndex - prev.scriptIndex);
        wordMap[s] = Math.round(prev.wordIndex + ratio * (next.wordIndex - prev.wordIndex));
      } else if (prev) {
        wordMap[s] = prev.wordIndex + (s - prev.scriptIndex);
      } else if (next) {
        wordMap[s] = next.wordIndex - (next.scriptIndex - s);
      } else {
        wordMap[s] = Math.round(s / Math.max(1, n - 1) * Math.max(0, words.length - 1));
      }
      wordMap[s] = Math.max(0, Math.min(words.length - 1, wordMap[s]));
    }
    for (var k = 1; k < n; k++) {
      if (wordMap[k] < wordMap[k - 1]) {
        wordMap[k] = wordMap[k - 1];
      }
    }
    return wordMap;
  }

  function lineBlocksFromWhisperWordAlignment(words, providedText) {
    var lines = scriptLinesFromText(providedText);
    if (!words || !words.length || !lines.length) {
      return [];
    }
    var scriptTokens = scriptTokenRecords(lines);
    var detectedTokens = whisperTokenRecords(words);
    if (!scriptTokens.length || !detectedTokens.length) {
      return [];
    }
    var n = scriptTokens.length;
    var m = detectedTokens.length;
    if (n > 1600 || m > 1600) {
      return [];
    }
    var dp = [];
    var step = [];
    for (var i = 0; i <= n; i++) {
      dp[i] = [];
      step[i] = [];
      for (var j = 0; j <= m; j++) {
        dp[i][j] = 0;
        step[i][j] = "";
      }
    }
    var deleteCost = 1.05;
    var insertCost = 0.85;
    for (var di = 1; di <= n; di++) {
      dp[di][0] = dp[di - 1][0] + deleteCost;
      step[di][0] = "D";
    }
    for (var ij = 1; ij <= m; ij++) {
      dp[0][ij] = dp[0][ij - 1] + insertCost;
      step[0][ij] = "I";
    }
    for (var si = 1; si <= n; si++) {
      for (var dj = 1; dj <= m; dj++) {
        var sim = tokenSimilarity(scriptTokens[si - 1].token, detectedTokens[dj - 1].token);
        var subCost = sim >= 0.98 ? 0.02 : (sim >= 0.82 ? 0.25 : (sim >= 0.68 ? 0.55 : 1.25));
        var best = dp[si - 1][dj - 1] + subCost;
        var bestStep = "M";
        var del = dp[si - 1][dj] + deleteCost;
        if (del < best) {
          best = del;
          bestStep = "D";
        }
        var ins = dp[si][dj - 1] + insertCost;
        if (ins < best) {
          best = ins;
          bestStep = "I";
        }
        dp[si][dj] = best;
        step[si][dj] = bestStep;
      }
    }
    var wordMap = [];
    for (var wm = 0; wm < n; wm++) {
      wordMap[wm] = null;
    }
    var matches = 0;
    var strongMatches = 0;
    var ai = n;
    var bj = m;
    while (ai > 0 || bj > 0) {
      var st = step[ai][bj];
      if (st === "M") {
        var score = tokenSimilarity(scriptTokens[ai - 1].token, detectedTokens[bj - 1].token);
        if (score >= 0.68) {
          wordMap[ai - 1] = detectedTokens[bj - 1].wordIndex;
          matches++;
          if (score >= 0.82) {
            strongMatches++;
          }
        }
        ai--;
        bj--;
      } else if (st === "D") {
        ai--;
      } else {
        bj--;
      }
    }
    if (matches / Math.max(1, n) < 0.25 && strongMatches < Math.min(4, n)) {
      return [];
    }
    wordMap = fillMissingWordMap(wordMap, scriptTokens, detectedTokens, words);
    var lineStarts = [];
    var lineEnds = [];
    for (var lt = 0; lt < n; lt++) {
      var lineIndex = scriptTokens[lt].lineIndex;
      if (lineStarts[lineIndex] === undefined) {
        lineStarts[lineIndex] = lt;
      }
      lineEnds[lineIndex] = lt;
    }
    var blocks = [];
    var cursor = 0;
    for (var line = 0; line < lines.length; line++) {
      if (lineStarts[line] === undefined) {
        continue;
      }
      var startIndex = wordMap[lineStarts[line]];
      var nextStartIndex = line + 1 < lines.length && lineStarts[line + 1] !== undefined ? wordMap[lineStarts[line + 1]] : null;
      startIndex = Math.max(cursor, Math.min(words.length - 1, startIndex));
      var endIndex = nextStartIndex !== null && nextStartIndex > startIndex ? nextStartIndex - 1 : wordMap[lineEnds[line]];
      endIndex = Math.max(startIndex, Math.min(words.length - 1, endIndex));
      blocks.push({
        start: words[startIndex].start,
        end: words[endIndex].end,
        text: lines[line],
        wordStartIndex: startIndex,
        wordEndIndex: endIndex,
        alignmentMethod: "tokenSequence",
        matchedTokenCount: matches,
        scriptTokenCount: n
      });
      cursor = Math.max(endIndex + 1, startIndex + 1);
      if (cursor >= words.length && line < lines.length - 1) {
        cursor = words.length - 1;
      }
    }
    return blocks.length === lines.length ? blocks : [];
  }

  function lineBlocksFromWhisperWordCounts(words, providedText) {
    var lines = scriptLinesFromText(providedText);
    if (!words || !words.length || !lines.length) {
      return [];
    }
    var counts = [];
    var total = 0;
    for (var i = 0; i < lines.length; i++) {
      var count = wordCountForScriptLine(lines[i]);
      counts.push(count);
      total += count;
    }
    if (!total) {
      return [];
    }

    var blocks = [];
    var cursor = 0;
    var cumulative = 0;
    for (var l = 0; l < lines.length; l++) {
      cumulative += counts[l];
      var endExclusive = l === lines.length - 1 ? words.length : proportionalWordBoundary(cumulative, total, words.length);
      var remainingLines = lines.length - l - 1;
      var minEnd = cursor + (words.length - cursor > remainingLines ? 1 : 0);
      var maxEnd = Math.max(minEnd, words.length - remainingLines);
      endExclusive = Math.max(minEnd, Math.min(maxEnd, endExclusive));
      if (endExclusive <= cursor && cursor < words.length) {
        endExclusive = cursor + 1;
      }
      var startIndex = Math.min(words.length - 1, cursor);
      var endIndex = Math.max(startIndex, Math.min(words.length - 1, endExclusive - 1));
      blocks.push({
        start: words[startIndex].start,
        end: words[endIndex].end,
        text: lines[l],
        wordStartIndex: startIndex,
        wordEndIndex: endIndex,
        scriptWordCount: counts[l],
        detectedWordCount: endIndex - startIndex + 1
      });
      cursor = endExclusive;
      if (cursor >= words.length && l < lines.length - 1) {
        cursor = words.length - 1;
      }
    }
    return blocks;
  }

  function lineBlocksFromWhisperWords(words, providedText) {
    var aligned = lineBlocksFromWhisperWordAlignment(words, providedText);
    if (aligned.length) {
      return aligned;
    }
    return lineBlocksFromWhisperWordCounts(words, providedText);
  }

  function retimeProvidedTextWithWhisperJson(jsonText, providedText) {
    try {
      var words = whisperWordsFromJsonText(jsonText);
      var blocks = lineBlocksFromWhisperWords(words, providedText);
      if (!blocks.length) {
        return "";
      }
      return buildSrtFromBlocks(blocks);
    } catch (err) {
      return "";
    }
  }

  function enforceProvidedLineSrt(contents, providedText) {
    var lines = scriptLinesFromText(providedText);
    var blocks = parseSrtBlocks(contents);
    if (!lines.length || !blocks.length) {
      return contents;
    }
    var rebuilt = [];
    var count = Math.min(lines.length, blocks.length);
    for (var i = 0; i < count; i++) {
      rebuilt.push({
        start: blocks[i].start,
        end: blocks[i].end,
        text: lines[i]
      });
    }
    if (lines.length > blocks.length) {
      var lastEnd = blocks[blocks.length - 1].end;
      var fallbackDuration = 2;
      for (var l = blocks.length; l < lines.length; l++) {
        rebuilt.push({
          start: lastEnd,
          end: lastEnd + fallbackDuration,
          text: lines[l]
        });
        lastEnd += fallbackDuration;
      }
    }
    return buildSrtFromBlocks(rebuilt);
  }

  function finiteNumber(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function audioTextBoundarySeconds(previousItem, currentItem, action) {
    var currentStart = finiteNumber(currentItem && currentItem.start, null);
    if (currentStart === null) {
      return null;
    }
    var previousEnd = finiteNumber(previousItem && previousItem.end, null);
    var configuredHeadPad = getWhisperSettings().audioHeadPadSeconds;
    var lead = Math.max(0, finiteNumber(action.cutLeadSeconds !== undefined ? action.cutLeadSeconds : action.boundaryLeadSeconds, configuredHeadPad !== undefined ? configuredHeadPad : 0.25));
    var gapMin = Math.max(0, finiteNumber(action.minSilenceGapSeconds, 0.08));
    var silenceLead = Math.max(0, finiteNumber(action.silenceLeadSeconds, lead));
    if (previousEnd !== null && currentStart > previousEnd + gapMin) {
      return Math.max(previousEnd + 0.01, currentStart - Math.min(lead, silenceLead));
    }
    return Math.max(0, currentStart - lead);
  }

  function audioTextSplitTimesFromItems(splitItems, rangeStart, action) {
    return audioTextSplitPlanFromItems(splitItems, rangeStart, action).times;
  }

  function audioTextSplitPlanFromItems(splitItems, rangeStart, action) {
    var times = [];
    var localStarts = [];
    var minSpacing = Math.max(0.02, finiteNumber(action.minCutSpacingSeconds, 0.06));
    var includeFirst = action.cutFirstLineStart === true;
    if (splitItems && splitItems.length) {
      localStarts[0] = action.alignFirstSubtitleToRangeStart === false ? finiteNumber(splitItems[0].start, 0) : 0;
    }
    for (var i = 0; i < splitItems.length; i++) {
      if (i === 0 && !includeFirst) {
        continue;
      }
      var localTime = i === 0 ? finiteNumber(splitItems[i].start, null) : audioTextBoundarySeconds(splitItems[i - 1], splitItems[i], action);
      if (localTime === null || localTime <= 0.02) {
        continue;
      }
      var sequenceTime = Number(rangeStart || 0) + localTime;
      if (i > 0 && localStarts[i - 1] !== undefined && localTime < localStarts[i - 1] + minSpacing) {
        localTime = localStarts[i - 1] + minSpacing;
        sequenceTime = Number(rangeStart || 0) + localTime;
      }
      times.push(sequenceTime);
      localStarts[i] = localTime;
    }
    return { times: times, localStarts: localStarts };
  }

  function snapAudioSplitPlanToClipEdges(splitPlan, sourceClips, rangeStart, action) {
    if (!splitPlan || !splitPlan.localStarts) {
      return splitPlan;
    }
    var minFragment = Math.max(0.04, finiteNumber(action.minAudioFragmentSeconds, 0.12));
    var snappedTimes = [];
    for (var i = 1; i < splitPlan.localStarts.length; i++) {
      if (splitPlan.localStarts[i] === undefined) {
        continue;
      }
      var sequenceTime = Number(rangeStart || 0) + Number(splitPlan.localStarts[i]);
      for (var c = 0; c < (sourceClips || []).length; c++) {
        var clipStart = Number(sourceClips[c].startSeconds || 0);
        var clipEnd = Number(sourceClips[c].endSeconds || clipStart);
        if (sequenceTime < clipStart - minFragment || sequenceTime > clipEnd + minFragment) {
          continue;
        }
        if (Math.abs(sequenceTime - clipStart) < minFragment) {
          sequenceTime = clipStart;
        } else if (Math.abs(clipEnd - sequenceTime) < minFragment) {
          sequenceTime = clipEnd;
        }
        break;
      }
      var localTime = Math.max(0, sequenceTime - Number(rangeStart || 0));
      if (i > 0 && splitPlan.localStarts[i - 1] !== undefined) {
        localTime = Math.max(localTime, Number(splitPlan.localStarts[i - 1]) + minFragment);
        sequenceTime = Number(rangeStart || 0) + localTime;
      }
      var rangeDuration = finiteNumber(action.audioRangeDurationSeconds, null);
      if (rangeDuration !== null) {
        localTime = Math.min(Math.max(0, rangeDuration - minFragment), localTime);
        sequenceTime = Number(rangeStart || 0) + localTime;
      }
      splitPlan.localStarts[i] = localTime;
      if (!snappedTimes.length || Math.abs(sequenceTime - snappedTimes[snappedTimes.length - 1]) > 0.01) {
        snappedTimes.push(sequenceTime);
      }
    }
    splitPlan.times = snappedTimes;
    return splitPlan;
  }

  function alignSrtBlocksToAudioSplitPlan(blocks, splitPlan, action) {
    if (!blocks || !blocks.length || !splitPlan || !splitPlan.localStarts) {
      return blocks || [];
    }
    var aligned = [];
    var minDuration = Math.max(0.05, finiteNumber(action.minSubtitleDurationSeconds, 0.12));
    for (var i = 0; i < blocks.length; i++) {
      var originalStart = finiteNumber(blocks[i].start, i ? aligned[i - 1].end : 0);
      var start = splitPlan.localStarts[i] !== undefined ? finiteNumber(splitPlan.localStarts[i], originalStart) : originalStart;
      if (i > 0 && start < aligned[i - 1].start + minDuration) {
        start = aligned[i - 1].start + minDuration;
      }
      var originalEnd = finiteNumber(blocks[i].end, start + 2);
      var nextStart = splitPlan.localStarts[i + 1] !== undefined ? finiteNumber(splitPlan.localStarts[i + 1], null) : null;
      var rangeDuration = finiteNumber(action.audioRangeDurationSeconds, null);
      var end = nextStart !== null && nextStart > start + minDuration ? nextStart : (rangeDuration !== null ? rangeDuration : Math.max(start + minDuration, originalEnd));
      if (rangeDuration !== null) {
        end = Math.min(rangeDuration, end);
      }
      aligned.push({
        start: start,
        end: end,
        text: blocks[i].text
      });
    }
    return aligned;
  }

  function buildSrtFromPlainText(text) {
    var start = Number(els.captionStart.value || 0);
    var duration = Math.max(0.1, Number(els.captionDuration.value || 3));
    var gap = Math.max(0, Number(els.captionGap.value || 0));
    var lines = String(text || "").split(/\r?\n/);
    var blocks = [];
    var cursor = Math.max(0, start);

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/^\s+|\s+$/g, "");
      if (!line) {
        continue;
      }
      blocks.push(String(blocks.length + 1));
      blocks.push(secondsToSrtTime(cursor) + " --> " + secondsToSrtTime(cursor + duration));
      blocks.push(line);
      blocks.push("");
      cursor += duration + gap;
    }

    return blocks.join("\r\n");
  }

  function captionPayloadFromUi() {
    var text = String(els.captionText.value || "").replace(/^\s+|\s+$/g, "");
    if (!text) {
      throw new Error("Caption text is empty.");
    }
    var contents = looksLikeSrt(text) ? text : buildSrtFromPlainText(text);
    var payload = {
      actions: [{
        type: "importSrtFile",
        contents: contents,
        startAtTime: Number(els.captionStart.value || 0),
        createCaptionTrack: els.captionCreateTrack.checked === true,
        suppressUI: els.captionShowImportDialog.checked !== true,
        cleanupAfterImport: false,
        removeProjectItemAfterCaptionTrack: false,
        source: "captionOverlay"
      }]
    };
    return attachTextTempFolder(payload);
  }

  function importCaptionsFromOverlay() {
    var payload;
    try {
      payload = captionPayloadFromUi();
    } catch (err) {
      setCaptionStatus(String(err && err.message ? err.message : err), true);
      return;
    }

    els.importCaptionsBtn.disabled = true;
    setCaptionStatus("Importing captions...");
    setStatus("Importing captions...");
    evalHost("prAI_applyActions", attachTargetSequence(payload)).then(function (result) {
      els.importCaptionsBtn.disabled = false;
      if (!result.ok) {
        var error = result.error || "Caption import failed.";
        setCaptionStatus(error, true);
        appendMessage("system", error);
        setStatus("Caption import failed.", true);
        return;
      }
      appendMessage("system", "Caption import result:\n" + JSON.stringify(result.data, null, 2));
      setCaptionStatus("Captions imported.");
      setStatus("Captions imported.");
      refreshProject();
    });
  }

  function browseTextFolder() {
    setSettingsStatus("Opening folder browser...");
    evalHost("prAI_selectTextFolder").then(function (result) {
      if (!result.ok) {
        setSettingsStatus(result.error || "Could not select folder.", true);
        return;
      }
      if (!result.data || !result.data.folderPath) {
        setSettingsStatus("Folder selection cancelled.");
        return;
      }
      els.textTempFolder.value = result.data.folderPath;
      saveSettings();
      setSettingsStatus("Text file folder selected.");
    });
  }

  function browseXmlFolder() {
    setSettingsStatus("Opening XML folder browser...");
    evalHost("prAI_selectTextFolder").then(function (result) {
      if (!result.ok) {
        setSettingsStatus(result.error || "Could not select folder.", true);
        return;
      }
      if (!result.data || !result.data.folderPath) {
        setSettingsStatus("Folder selection cancelled.");
        return;
      }
      els.xmlOutputFolder.value = result.data.folderPath;
      saveSettings();
      setSettingsStatus("XML export folder selected.");
    });
  }

  function detectWhisperTools() {
    setInstallStage("ffmpeg", "running", "Detecting ffmpeg...\n");
    setInstallStage("whisper", "running", "Detecting Whisper/Python...\n");
    setSettingsStatus("Detecting ffmpeg and Whisper tools...");
    var command = [
      "set +e",
      "FFMPEG=\"\"",
      "for C in " + shellQuote(getFfmpegCommand()) + " ffmpeg /opt/homebrew/bin/ffmpeg /usr/local/bin/ffmpeg; do",
      "  if command -v \"$C\" >/dev/null 2>&1; then FFMPEG=$(command -v \"$C\"); break; fi",
      "  if [ -x \"$C\" ]; then FFMPEG=\"$C\"; break; fi",
      "done",
      "WHISPER=\"\"",
      "for C in whisperx whisper faster-whisper \"$HOME/.local/bin/whisperx\" \"$HOME/.local/bin/whisper\" \"$HOME/Library/Python/3.13/bin/whisperx\" \"$HOME/Library/Python/3.13/bin/whisper\" \"$HOME/Library/Python/3.12/bin/whisperx\" \"$HOME/Library/Python/3.12/bin/whisper\" \"$HOME/Library/Python/3.11/bin/whisperx\" \"$HOME/Library/Python/3.11/bin/whisper\" \"$HOME/Library/Python/3.10/bin/whisperx\" \"$HOME/Library/Python/3.10/bin/whisper\" \"$HOME/Library/Python/3.9/bin/whisperx\" \"$HOME/Library/Python/3.9/bin/whisper\" /opt/homebrew/bin/whisperx /opt/homebrew/bin/whisper /usr/local/bin/whisperx /usr/local/bin/whisper; do",
      "  if command -v \"$C\" >/dev/null 2>&1; then WHISPER=$(command -v \"$C\"); break; fi",
      "  if [ -x \"$C\" ]; then WHISPER=\"$C\"; break; fi",
      "done",
      "PYTHON=\"\"",
      "for C in python3 python; do",
      "  if command -v \"$C\" >/dev/null 2>&1; then PYTHON=$(command -v \"$C\"); break; fi",
      "done",
      "echo \"ffmpeg=$FFMPEG\"",
      "echo \"whisper=$WHISPER\"",
      "echo \"python=$PYTHON\"",
      "if [ -n \"$FFMPEG\" ]; then \"$FFMPEG\" -version 2>/dev/null | head -n 1; fi",
      "if [ -n \"$WHISPER\" ]; then \"$WHISPER\" --help >/dev/null 2>&1; echo \"whisper_cli_ok=$?\"; fi"
    ].join("\n");
    runShell(command).then(function (output) {
      var ffmpegMatch = output.match(/^ffmpeg=(.+)$/m);
      var whisperMatch = output.match(/^whisper=(.+)$/m);
      var pythonMatch = output.match(/^python=(.+)$/m);
      if (ffmpegMatch && ffmpegMatch[1]) {
        els.ffmpegPath.value = ffmpegMatch[1];
        setInstallStage("ffmpeg", "done", "ffmpeg found:\n" + ffmpegMatch[1]);
      } else {
        setInstallStage("ffmpeg", "error", "ffmpeg not found. Install it or paste a path.");
      }
      if (!getWhisperCommand()) {
        if (whisperMatch && whisperMatch[1]) {
          els.whisperCommand.value = whisperMatch[1];
        }
      }
      if (whisperMatch && whisperMatch[1]) {
        setInstallStage("whisper", "done", "Whisper CLI found:\n" + whisperMatch[1]);
      } else if (pythonMatch && pythonMatch[1]) {
        setInstallStage("whisper", "Idle", "Python found:\n" + pythonMatch[1] + "\nSet or install a Whisper align command.");
      } else {
        setInstallStage("whisper", "error", "No Whisper command or Python found.");
      }
      saveSettings();
      setSettingsStatus(output.replace(/\n/g, " | ") || "Detection finished.");
    }).catch(function (err) {
      var message = String(err && err.message ? err.message : err);
      setInstallStage("ffmpeg", "error", message);
      setInstallStage("whisper", "error", message);
      setSettingsStatus(String(err && err.message ? err.message : err), true);
    });
  }

  function testWhisperTools() {
    var settings = getWhisperSettings();
    setInstallStage("whisper", "running", "Testing Whisper command...\n");
    if (!settings.command) {
      setInstallStage("whisper", "error", "No Whisper align command configured.");
      setSettingsStatus("Install WhisperX or enter a real Whisper align command first.", true);
      return;
    }
    setSettingsStatus("Testing Whisper alignment command...");
    var command = [
      "set -e",
      "echo whisper:",
      settings.command + " --help 2>&1 | head -n 4",
      "echo model=" + shellQuote(settings.model),
      "echo device=" + shellQuote(settings.device),
      "echo audioTrack=" + shellQuote(settings.audioTrack)
    ].join("\n");
    runShell(command).then(function (output) {
      setInstallStage("whisper", "done", "Whisper command active:\n" + settings.command + "\n" + output);
      setSettingsStatus(output.replace(/\n/g, " | "));
    }).catch(function (err) {
      var message = String(err && err.message ? err.message : err);
      setInstallStage("whisper", "error", "Test failed. Check Whisper command:\n" + settings.command + "\n" + message);
      setSettingsStatus(String(err && err.message ? err.message : err), true);
    });
  }

  function installFfmpegTool() {
    setInstallStage("ffmpeg", "running", "Stage 1: checking Homebrew...\n");
    setSettingsStatus("Installing ffmpeg with Homebrew...");
    var command = [
      "set -e",
      "echo 'Checking Homebrew...'",
      "if ! command -v brew >/dev/null 2>&1; then",
      "  echo 'Homebrew is required to install ffmpeg automatically. Install Homebrew or paste an ffmpeg path.' >&2",
      "  exit 127",
      "fi",
      "echo 'Installing ffmpeg. If Homebrew asks for a password, run this in Terminal instead: brew install ffmpeg'",
      "brew install ffmpeg",
      "echo 'Detecting ffmpeg path...'",
      "command -v ffmpeg"
    ].join("\n");
    runShellStreaming(command, {
      onData: function (text) {
        appendInstallStageLog("ffmpeg", text);
      }
    }).then(function (output) {
      var lines = output.split(/\n+/);
      var detected = lines[lines.length - 1] || "";
      if (detected) {
        els.ffmpegPath.value = detected;
      }
      saveSettings();
      setInstallStage("ffmpeg", "done", (els.ffmpegInstallLog.textContent || "") + "\nffmpeg installed: " + (detected || "available"));
      setSettingsStatus("ffmpeg installed: " + (detected || "available"));
    }).catch(function (err) {
      setInstallStage("ffmpeg", "error", (els.ffmpegInstallLog.textContent || "") + "\n" + String(err && err.message ? err.message : err) + "\nIf this needs a password, run in Terminal: brew install ffmpeg");
      setSettingsStatus(String(err && err.message ? err.message : err), true);
    });
  }

  function installWhisperTool() {
    setInstallStage("whisper", "running", "Stage 2: installing WhisperX with pip...\n");
    setSettingsStatus("Installing WhisperX with pip...");
    var command = [
      "set -e",
      "echo 'Finding Python...'",
      "PYTHON=\"\"",
      "for C in python3 python; do",
      "  if command -v \"$C\" >/dev/null 2>&1; then PYTHON=$(command -v \"$C\"); break; fi",
      "done",
      "if [ -z \"$PYTHON\" ]; then echo 'python3 is required to install WhisperX.' >&2; exit 127; fi",
      "echo \"Using $PYTHON\"",
      "echo 'Upgrading pip for the current user...'",
      "\"$PYTHON\" -m pip install --user --upgrade pip",
      "echo 'Installing WhisperX for the current user...'",
      "\"$PYTHON\" -m pip install --user --upgrade whisperx",
      "echo \"$PYTHON -m whisperx\""
    ].join("\n");
    runShellStreaming(command, {
      onData: function (text) {
        appendInstallStageLog("whisper", text);
      }
    }).then(function (output) {
      var lines = output.split(/\n+/);
      var commandLine = lines[lines.length - 1] || "";
      if (commandLine) {
        els.whisperCommand.value = commandLine;
      }
      saveSettings();
      setInstallStage("whisper", "done", (els.whisperInstallLog.textContent || "") + "\nWhisperX command: " + (commandLine || getWhisperCommand()));
      setSettingsStatus("WhisperX installed. Command: " + (commandLine || getWhisperCommand()));
    }).catch(function (err) {
      setInstallStage("whisper", "error", (els.whisperInstallLog.textContent || "") + "\n" + String(err && err.message ? err.message : err));
      setSettingsStatus(String(err && err.message ? err.message : err), true);
    });
  }

  function downloadWhisperModel() {
    var settings = getWhisperSettings();
    if (!settings.command) {
      setInstallStage("model", "error", "No Whisper command configured.");
      setSettingsStatus("Install WhisperX or enter a real Whisper command first.", true);
      return;
    }
    setInstallStage("model", "running", "Stage 3: downloading/warming model " + settings.model + "...\n");
    setSettingsStatus("Downloading/warming Whisper model " + settings.model + "...");
    var warmupCommand = isWhisperxCommand(settings.command) ? [
      settings.command,
      "--model " + shellQuote(settings.model) + whisperLanguageArg(settings),
      "--device " + shellQuote(whisperDeviceForCli(settings.device)),
      "--compute_type " + shellQuote(whisperComputeTypeForCli(settings.device)),
      "--vad_method silero",
      "--output_dir \"$TMPDIR\"",
      "--output_format srt",
      "\"$AUDIO\""
    ].join(" ") : [
      settings.command,
      "--audio \"$AUDIO\"",
      "--text \"$TEXT\"",
      "--out \"$TMPDIR/out.srt\"",
      "--model " + shellQuote(settings.model),
      "--device " + shellQuote(settings.device)
    ].join(" ");
    var command = [
      "set -e",
      "echo 'Checking ffmpeg...'",
      resolveFfmpegShell(),
      "echo \"ffmpeg=$FFMPEG\"",
      "echo 'Creating temporary silent audio...'",
      "TMPDIR=$(mktemp -d)",
      "trap 'rm -rf \"$TMPDIR\"' EXIT",
      "AUDIO=\"$TMPDIR/silence.wav\"",
      "TEXT=\"$TMPDIR/text.txt\"",
      "\"$FFMPEG\" -y -f lavfi -i anullsrc=r=16000:cl=mono -t 1 \"$AUDIO\"",
      "printf 'test\\n' > \"$TEXT\"",
      "echo 'Running model warmup. First run may take a while while files download...'",
      warmupCommand,
      "echo model_ready=" + shellQuote(settings.model)
    ].join("\n");
    runShellStreaming(command, {
      onData: function (text) {
        appendInstallStageLog("model", text);
      }
    }).then(function (output) {
      setInstallStage("model", "done", (els.modelInstallLog.textContent || "") + "\nModel ready: " + settings.model);
      setSettingsStatus(output.replace(/\n/g, " | ") || ("Model ready: " + settings.model));
    }).catch(function (err) {
      setInstallStage("model", "error", (els.modelInstallLog.textContent || "") + "\n" + String(err && err.message ? err.message : err));
      setSettingsStatus(String(err && err.message ? err.message : err), true);
    });
  }

  /* The only path to readability-split captions used to run through a script
     row by row, so it needed one even for pure "just transcribe this audio"
     requests. This generates captions directly from the configured audio
     track - no script, no agent call - and runs every caption row through the
     same optimized-text splitter, timed from Whisper's own output. */
  function setAudioCaptionButtonsBusy(busy) {
    if (els.generateAudioCaptionsBtn) {
      els.generateAudioCaptionsBtn.disabled = busy;
    }
    if (els.generateAudioCaptionsQuickBtn) {
      els.generateAudioCaptionsQuickBtn.disabled = busy;
      els.generateAudioCaptionsQuickBtn.classList.toggle("is-busy", busy);
    }
  }

  /* Reachable from the main screen (the quick-action row) as well as Settings
     > Audio, since the Settings button alone turned out to be easy to miss -
     this needs no script, no overlay, and no typed prompt to find or use. */
  function generateCaptionsFromAudioOnly() {
    var settings = getWhisperSettings();
    if (!settings.command) {
      setInstallStage("model", "error", "No Whisper command configured.");
      setSettingsStatus("Install WhisperX or enter a real Whisper command first.", true);
      setStatus("Captions need Whisper configured first - open Settings > Audio.", true);
      return;
    }
    setAudioCaptionButtonsBusy(true);
    setInstallStage("model", "running", "Generating optimized captions from the whole sequence (every audio track with clips)...\n");
    setSettingsStatus("Generating captions from audio...");
    setStatus("Generating captions from the whole sequence...");
    runLocalAudioSubtitleAction({
      type: "transcribeAudioTrackToSrt",
      optimizeCaptions: true,
      createCaptionTrack: true,
      allowCaptionTrackCreate: true,
      suppressUI: true
    }).then(function (result) {
      var message = "Added " + (result.subtitleCount || 0) + " caption row(s) from " + (result.track || "audio") + ".";
      setSettingsStatus(message);
      setStatus(message);
    }).catch(function (err) {
      var message = String(err && err.message ? err.message : err);
      setInstallStage("model", "error", (els.modelInstallLog.textContent || "") + "\nCaption generation failed:\n" + message);
      setSettingsStatus(message, true);
      setStatus(message, true);
    }).then(function () {
      setAudioCaptionButtonsBusy(false);
    });
  }

  function testWhisperModel() {
    var settings = getWhisperSettings();
    if (!settings.command) {
      setInstallStage("model", "error", "No Whisper command configured.");
      setSettingsStatus("Install WhisperX or enter a real Whisper command first.", true);
      return;
    }
    setInstallStage("model", "running", "Testing model availability: " + settings.model + "...\n");
    setSettingsStatus("Testing Whisper model " + settings.model + "...");
    var command = [
      "set -e",
      "echo 'Checking ffmpeg...'",
      resolveFfmpegShell(),
      "TMPDIR=$(mktemp -d)",
      "trap 'rm -rf \"$TMPDIR\"' EXIT",
      "AUDIO=\"$TMPDIR/silence.wav\"",
      "\"$FFMPEG\" -y -f lavfi -i anullsrc=r=16000:cl=mono -t 0.25 \"$AUDIO\" >/dev/null 2>&1",
      "echo 'Checking model load...'",
      isWhisperxCommand(settings.command)
        ? settings.command + " --model " + shellQuote(settings.model) + whisperLanguageArg(settings) + " --device " + shellQuote(whisperDeviceForCli(settings.device)) + " --compute_type " + shellQuote(whisperComputeTypeForCli(settings.device)) + " --vad_method silero --output_dir \"$TMPDIR\" --output_format srt \"$AUDIO\" >/dev/null"
        : settings.command + " --model " + shellQuote(settings.model) + " --device " + shellQuote(settings.device) + " \"$AUDIO\" >/dev/null",
      "echo model_available=" + shellQuote(settings.model)
    ].join("\n");
    runShellStreaming(command, {
      onData: function (text) {
        appendInstallStageLog("model", text);
      }
    }).then(function (output) {
      setInstallStage("model", "done", (els.modelInstallLog.textContent || "") + "\nModel available: " + settings.model);
      setSettingsStatus(output.replace(/\n/g, " | ") || ("Model available: " + settings.model));
    }).catch(function (err) {
      setInstallStage("model", "error", (els.modelInstallLog.textContent || "") + "\nModel is not available or could not load:\n" + String(err && err.message ? err.message : err));
      setSettingsStatus(String(err && err.message ? err.message : err), true);
    });
  }

  function detectComfyTools() {
    setInstallStage("comfy", "running", "Detecting ComfyUI folder...\n");
    setInstallStage("comfyServer", "running", "Testing ComfyUI server...\n");
    setSettingsStatus("Detecting ComfyUI...");
    var settings = getComfySettings();
    var command = [
      "set +e",
      "COMFY=\"\"",
      "if [ -n " + shellQuote(settings.path) + " ] && [ -d " + shellQuote(settings.path) + " ]; then COMFY=" + shellQuote(settings.path) + "; fi",
      "if [ -n \"$COMFY\" ] && [ ! -f \"$COMFY/main.py\" ] && [ -f \"$COMFY/user/comfyui_8000.log\" ]; then",
      "  LOG_PATH=$(grep -m 1 'ComfyUI Path:' \"$COMFY/user/comfyui_8000.log\" | sed 's/^.*ComfyUI Path: //')",
      "  if [ -n \"$LOG_PATH\" ] && [ -f \"$LOG_PATH/main.py\" ]; then COMFY=\"$LOG_PATH\"; fi",
      "fi",
      "if [ -z \"$COMFY\" ]; then",
      "  for D in \"/Applications/ComfyUI.app/Contents/Resources/ComfyUI\" \"$HOME/PR_AI_ComfyUI/ComfyUI\" \"$HOME/ComfyUI\" \"$HOME/AI/ComfyUI\" \"$HOME/Documents/ComfyUI\" \"$HOME/Downloads/ComfyUI\"; do",
      "    if [ -f \"$D/main.py\" ]; then COMFY=\"$D\"; break; fi",
      "  done",
      "fi",
      "PY=\"\"",
      "if [ -n \"$COMFY\" ] && [ -x \"$COMFY/venv/bin/python\" ]; then PY=\"$COMFY/venv/bin/python\"; fi",
      "if [ -z \"$PY\" ] && [ -x \"$HOME/Documents/ComfyUI/.venv/bin/python\" ]; then PY=\"$HOME/Documents/ComfyUI/.venv/bin/python\"; fi",
      "if [ -z \"$PY\" ] && [ -n " + shellQuote(settings.path) + " ] && [ -x " + shellQuote(settings.path + "/.venv/bin/python") + " ]; then PY=" + shellQuote(settings.path + "/.venv/bin/python") + "; fi",
      "if [ -z \"$PY\" ]; then for C in python3 python; do if command -v \"$C\" >/dev/null 2>&1; then PY=$(command -v \"$C\"); break; fi; done; fi",
      "echo \"comfy=$COMFY\"",
      "echo \"python=$PY\"",
      "URL=" + shellQuote(settings.serverUrl.replace(/\/+$/, "")),
      "if [ -f \"$HOME/Documents/ComfyUI/user/comfyui_8000.log\" ] && grep -q 'http://127.0.0.1:8000' \"$HOME/Documents/ComfyUI/user/comfyui_8000.log\"; then URL=\"http://127.0.0.1:8000\"; fi",
      "echo \"url=$URL\"",
      "curl -fsS --max-time 2 \"$URL/system_stats\" >/tmp/pr_ai_comfy_stats.json 2>/tmp/pr_ai_comfy_curl.err",
      "echo \"server_ok=$?\"",
      "cat /tmp/pr_ai_comfy_curl.err 2>/dev/null"
    ].join("\n");
    runShell(command).then(function (output) {
      var comfyMatch = output.match(/^comfy=(.*)$/m);
      var pythonMatch = output.match(/^python=(.*)$/m);
      var urlMatch = output.match(/^url=(.*)$/m);
      var serverMatch = output.match(/^server_ok=(\d+)/m);
      if (comfyMatch && comfyMatch[1]) {
        els.comfyPath.value = comfyMatch[1];
        setInstallStage("comfy", "done", "ComfyUI folder found:\n" + comfyMatch[1] + (pythonMatch && pythonMatch[1] ? "\npython=" + pythonMatch[1] : ""));
      } else {
        setInstallStage("comfy", "error", "ComfyUI folder not found. Install it or paste a path.");
      }
      if (pythonMatch && pythonMatch[1] && !getComfySettings().python) {
        els.comfyPython.value = pythonMatch[1];
      }
      if (urlMatch && urlMatch[1]) {
        els.comfyServerUrl.value = urlMatch[1];
      }
      if (serverMatch && Number(serverMatch[1]) === 0) {
        setInstallStage("comfyServer", "done", "ComfyUI server responded:\n" + (urlMatch && urlMatch[1] ? urlMatch[1] : settings.serverUrl));
      } else {
        setInstallStage("comfyServer", "Idle", "Server not responding yet. Click Start or launch ComfyUI manually.");
      }
      saveSettings();
      setSettingsStatus(output.replace(/\n/g, " | ") || "ComfyUI detection finished.");
    }).catch(function (err) {
      var message = String(err && err.message ? err.message : err);
      setInstallStage("comfy", "error", message);
      setInstallStage("comfyServer", "error", message);
      setSettingsStatus(message, true);
    });
  }

  function installComfyTool() {
    var settings = getComfySettings();
    var installRoot = settings.path ? settings.path.replace(/\/ComfyUI\/?$/, "") : "$HOME/PR_AI_ComfyUI";
    setInstallStage("comfy", "running", "Installing ComfyUI...\n");
    setSettingsStatus("Installing ComfyUI. This can take a while.");
    var command = [
      "set -e",
      "ROOT=" + shellQuote(installRoot),
      "if [ \"$ROOT\" = '$HOME/PR_AI_ComfyUI' ]; then ROOT=\"$HOME/PR_AI_ComfyUI\"; fi",
      "echo \"Install root: $ROOT\"",
      "mkdir -p \"$ROOT\"",
      "cd \"$ROOT\"",
      "if [ ! -d ComfyUI ]; then",
      "  echo 'Cloning ComfyUI...'",
      "  git clone https://github.com/comfyanonymous/ComfyUI.git",
      "else",
      "  echo 'ComfyUI folder exists. Pulling latest changes...'",
      "  cd ComfyUI",
      "  git pull --ff-only || true",
      "  cd ..",
      "fi",
      "cd ComfyUI",
      "PY=\"\"",
      "for C in python3 python; do if command -v \"$C\" >/dev/null 2>&1; then PY=$(command -v \"$C\"); break; fi; done",
      "if [ -z \"$PY\" ]; then echo 'python3 is required for ComfyUI.' >&2; exit 127; fi",
      "echo \"Using $PY\"",
      "if [ ! -d venv ]; then \"$PY\" -m venv venv; fi",
      "./venv/bin/python -m pip install --upgrade pip",
      "./venv/bin/python -m pip install -r requirements.txt",
      "echo \"comfy_path=$(pwd)\"",
      "echo \"comfy_python=$(pwd)/venv/bin/python\""
    ].join("\n");
    runShellStreaming(command, {
      onData: function (text) {
        appendInstallStageLog("comfy", text);
      }
    }).then(function (output) {
      var pathMatch = output.match(/^comfy_path=(.+)$/m);
      var pythonMatch = output.match(/^comfy_python=(.+)$/m);
      if (pathMatch && pathMatch[1]) {
        els.comfyPath.value = pathMatch[1];
      }
      if (pythonMatch && pythonMatch[1]) {
        els.comfyPython.value = pythonMatch[1];
      }
      saveSettings();
      setInstallStage("comfy", "done", (els.comfyInstallLog.textContent || "") + "\nComfyUI installed: " + (pathMatch && pathMatch[1] ? pathMatch[1] : getComfySettings().path));
      setSettingsStatus("ComfyUI installed. Start the server next.");
    }).catch(function (err) {
      var message = String(err && err.message ? err.message : err);
      setInstallStage("comfy", "error", (els.comfyInstallLog.textContent || "") + "\n" + message);
      setSettingsStatus(message, true);
    });
  }

  function startComfyServer() {
    var settings = getComfySettings();
    if (!settings.path) {
      setInstallStage("comfyServer", "error", "ComfyUI folder is empty. Detect, install, or paste a folder first.");
      setSettingsStatus("ComfyUI folder is empty.", true);
      return;
    }
    var port = comfyPortFromUrl(settings.serverUrl);
    var pythonExpr = settings.python ? shellQuote(settings.python) : "\"$COMFY/venv/bin/python\"";
    setInstallStage("comfyServer", "running", "Starting ComfyUI server...\n");
    setSettingsStatus("Starting ComfyUI server...");
    var command = [
      "set -e",
      "COMFY=" + shellQuote(settings.path),
      "if [ ! -d \"$COMFY\" ]; then echo 'ComfyUI folder does not exist: '$COMFY >&2; exit 1; fi",
      "USER_COMFY=\"$COMFY\"",
      "if [ ! -f \"$COMFY/main.py\" ] && [ -f \"$COMFY/user/comfyui_8000.log\" ]; then",
      "  LOG_PATH=$(grep -m 1 'ComfyUI Path:' \"$COMFY/user/comfyui_8000.log\" | sed 's/^.*ComfyUI Path: //')",
      "  if [ -n \"$LOG_PATH\" ] && [ -f \"$LOG_PATH/main.py\" ]; then COMFY=\"$LOG_PATH\"; fi",
      "fi",
      "if [ ! -f \"$COMFY/main.py\" ] && [ -f \"/Applications/ComfyUI.app/Contents/Resources/ComfyUI/main.py\" ]; then COMFY=\"/Applications/ComfyUI.app/Contents/Resources/ComfyUI\"; fi",
      "LOG_DIR=\"$USER_COMFY\"",
      "if [ \"$COMFY\" = \"/Applications/ComfyUI.app/Contents/Resources/ComfyUI\" ] && [ -d \"$HOME/Documents/ComfyUI\" ]; then LOG_DIR=\"$HOME/Documents/ComfyUI\"; fi",
      "mkdir -p \"$LOG_DIR\"",
      "if [ \"$COMFY\" = \"/Applications/ComfyUI.app/Contents/Resources/ComfyUI\" ]; then",
      "  echo 'Launching ComfyUI desktop app so it uses the writable user directory...'",
      "  open -a ComfyUI", // mac-only: inside the /Applications/ComfyUI.app branch, never true on Windows
      "  for I in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do",
      "    if curl -fsS --max-time 2 " + shellQuote(settings.serverUrl.replace(/\/+$/, "") + "/system_stats") + " >/dev/null 2>&1; then echo server_ready=" + shellQuote(settings.serverUrl) + "; exit 0; fi",
      "    if curl -fsS --max-time 2 http://127.0.0.1:8000/system_stats >/dev/null 2>&1; then echo server_ready=http://127.0.0.1:8000; exit 0; fi",
      "    sleep 2",
      "  done",
      "  echo 'ComfyUI.app launched but did not answer yet. Check the app window or click Test after it finishes loading.' >&2",
      "  tail -n 80 \"$HOME/Documents/ComfyUI/user/comfyui_8000.log\" >&2 || true",
      "  exit 7",
      "fi",
      "if [ ! -f \"$COMFY/main.py\" ]; then",
      "  if [ -d \"/Applications/ComfyUI.app\" ]; then",
      "    echo 'Configured folder is ComfyUI user data, not the app source. Opening ComfyUI.app instead...'",
      "    open -a ComfyUI", // mac-only: inside the /Applications/ComfyUI.app branch, never true on Windows
      "    sleep 8",
      "    curl -fsS --max-time 3 " + shellQuote(settings.serverUrl.replace(/\/+$/, "") + "/system_stats") + " >/dev/null || curl -fsS --max-time 3 http://127.0.0.1:8000/system_stats >/dev/null",
      "    echo server_ready=ComfyUI.app",
      "    exit 0",
      "  fi",
      "  echo 'No ComfyUI main.py found. Paste the ComfyUI source folder or install ComfyUI.' >&2",
      "  exit 1",
      "fi",
      "PY=" + pythonExpr,
      "if [ ! -x \"$PY\" ] && [ -x \"$USER_COMFY/.venv/bin/python\" ]; then PY=\"$USER_COMFY/.venv/bin/python\"; fi",
      "if [ ! -x \"$PY\" ] && [ -x \"$HOME/Documents/ComfyUI/.venv/bin/python\" ]; then PY=\"$HOME/Documents/ComfyUI/.venv/bin/python\"; fi",
      "if [ ! -x \"$PY\" ]; then PY=$(command -v python3 || command -v python || true); fi",
      "if [ -z \"$PY\" ]; then echo 'No Python found for ComfyUI.' >&2; exit 127; fi",
      "PY_OK=0",
      "if [ -x \"$PY\" ]; then \"$PY\" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1 && PY_OK=1; fi",
      "if [ \"$PY_OK\" != \"1\" ] && [ -x \"$USER_COMFY/.venv/bin/python\" ]; then PY=\"$USER_COMFY/.venv/bin/python\"; fi",
      "if [ \"$PY_OK\" != \"1\" ] && [ -x \"$HOME/Documents/ComfyUI/.venv/bin/python\" ]; then PY=\"$HOME/Documents/ComfyUI/.venv/bin/python\"; fi",
      "\"$PY\" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1 || { echo 'ComfyUI requires Python 3.10+. Set Python command to the ComfyUI .venv python, usually ~/Documents/ComfyUI/.venv/bin/python.' >&2; exit 1; }",
      "echo \"python=$PY\"",
      "LOG=\"$LOG_DIR/pr_ai_comfy_server.log\"",
      "cd \"$COMFY\"",
      "nohup \"$PY\" main.py --listen 127.0.0.1 --port " + shellQuote(String(port)) + " > \"$LOG\" 2>&1 &",
      "PID=$!",
      "echo \"pid=$PID\"",
      "echo \"log=$LOG\"",
      "for I in 1 2 3 4 5 6 7 8 9 10 11 12; do",
      "  if curl -fsS --max-time 2 " + shellQuote(settings.serverUrl.replace(/\/+$/, "") + "/system_stats") + " >/dev/null 2>&1; then echo server_ready=" + shellQuote(settings.serverUrl) + "; exit 0; fi",
      "  if curl -fsS --max-time 2 http://127.0.0.1:8000/system_stats >/dev/null 2>&1; then echo server_ready=http://127.0.0.1:8000; exit 0; fi",
      "  sleep 2",
      "done",
      "echo 'ComfyUI did not answer yet. Recent log:' >&2",
      "tail -n 80 \"$LOG\" >&2 || true",
      "exit 7"
    ].join("\n");
    runShellStreaming(command, {
      onData: function (text) {
        appendInstallStageLog("comfyServer", text);
      }
    }).then(function (output) {
      setInstallStage("comfyServer", "done", (els.comfyServerLog.textContent || "") + "\n" + output);
      setSettingsStatus("ComfyUI server ready: " + settings.serverUrl);
    }).catch(function (err) {
      var message = String(err && err.message ? err.message : err);
      setInstallStage("comfyServer", "error", (els.comfyServerLog.textContent || "") + "\n" + message + "\nIf startup is still loading models, wait and click Test.");
      setSettingsStatus(message, true);
    });
  }

  function testComfyServer() {
    var settings = getComfySettings();
    setInstallStage("comfyServer", "running", "Testing ComfyUI server...\n");
    setSettingsStatus("Testing ComfyUI server...");
    var command = [
      "set -e",
      "echo url=" + shellQuote(settings.serverUrl),
      "curl -fsS --max-time 5 " + shellQuote(settings.serverUrl.replace(/\/+$/, "") + "/system_stats")
    ].join("\n");
    runShellStreaming(command, {
      onData: function (text) {
        appendInstallStageLog("comfyServer", text);
      }
    }).then(function (output) {
      setInstallStage("comfyServer", "done", "ComfyUI server active:\n" + tailText(output, 1400));
      setSettingsStatus("ComfyUI server active.");
    }).catch(function (err) {
      var message = String(err && err.message ? err.message : err);
      setInstallStage("comfyServer", "error", message);
      setSettingsStatus(message, true);
    });
  }

  function comfyModelFiles() {
    var root = comfyUserRoot();
    var nodeRequire = getNodeRequire();
    var path = nodeRequire ? nodeRequire("path") : null;
    if (!path || !root) {
      return [];
    }
    return [
      {
        label: "Wan VACE 14B diffusion",
        sizeHint: "very large, about 28 GB",
        minBytes: 10000000000,
        path: path.join(root, "models", "diffusion_models", "wan2.1_vace_14B_fp16.safetensors"),
        url: "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_vace_14B_fp16.safetensors"
      },
      {
        label: "Wan CausVid LoRA",
        sizeHint: "large, about 1 GB",
        minBytes: 100000000,
        path: path.join(root, "models", "loras", "Wan21_CausVid_14B_T2V_lora_rank32.safetensors"),
        url: "https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Wan21_CausVid_14B_T2V_lora_rank32.safetensors"
      },
      {
        label: "UMT5 text encoder",
        sizeHint: "large, several GB",
        minBytes: 1000000000,
        path: path.join(root, "models", "text_encoders", "umt5_xxl_fp8_e4m3fn_scaled.safetensors"),
        url: "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors?download=true"
      },
      {
        label: "Wan 2.1 VAE",
        sizeHint: "medium, hundreds of MB",
        minBytes: 100000000,
        path: path.join(root, "models", "vae", "wan_2.1_vae.safetensors"),
        url: "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors"
      }
    ];
  }

  function formatBytes(bytes) {
    var value = Number(bytes || 0);
    var units = ["B", "KB", "MB", "GB", "TB"];
    var index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index++;
    }
    return (index === 0 ? String(Math.round(value)) : value.toFixed(value >= 10 ? 1 : 2)) + " " + units[index];
  }

  function modelFileSize(fs, filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return 0;
      }
      return fs.statSync(filePath).size || 0;
    } catch (err) {
      return 0;
    }
  }

	  function comfyModelStatusText(files) {
    var nodeRequire = getNodeRequire();
    if (!nodeRequire) {
      return "Node.js is unavailable; cannot inspect ComfyUI model files.";
    }
    var fs = nodeRequire("fs");
    var lines = [];
    for (var i = 0; i < files.length; i++) {
      var size = modelFileSize(fs, files[i].path);
      var complete = size >= Number(files[i].minBytes || 1);
      var state = complete ? "OK  " : (size > 0 ? "PART" : "MISS");
      lines.push(state + " " + files[i].label + " (" + files[i].sizeHint + ")\n" + formatBytes(size) + " at " + files[i].path);
    }
	    return lines.join("\n\n");
	  }

  function comfyWanRiskText(files) {
    var nodeRequire = getNodeRequire();
    if (!nodeRequire || !files || !files.length) {
      return "";
    }
    var fs = nodeRequire("fs");
    for (var i = 0; i < files.length; i++) {
      if (/diffusion/i.test(files[i].label) && /14B.*fp16|fp16.*14B/i.test(files[i].path || "")) {
        var size = modelFileSize(fs, files[i].path);
        if (size > 25000000000) {
          return "Warning: this is the 14B fp16 Wan VACE model (" + formatBytes(size) + "). On Apple MPS with 36 GB shared memory it can fail during sampling. PR AI now uses a 384px, 9-frame, 4-step Apple-safe test profile. Larger demos usually run on NVIDIA/CUDA or smaller/quantized models with supported kernels.";
        }
      }
    }
    return "";
  }

  function comfyModelProgressPercent(files) {
    var nodeRequire = getNodeRequire();
    if (!nodeRequire || !files.length) {
      return 0;
    }
    var fs = nodeRequire("fs");
    var current = 0;
    var target = 0;
    for (var i = 0; i < files.length; i++) {
      current += Math.min(modelFileSize(fs, files[i].path), Number(files[i].minBytes || 0));
      target += Number(files[i].minBytes || 0);
    }
    if (!target) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round(current * 1000 / target) / 10));
  }

  function setInstallStageProgress(stage, percent) {
    var stageEl = null;
    if (stage === "comfyModel") {
      stageEl = els.comfyModelStage;
    } else if (stage === "comfyRender") {
      stageEl = els.comfyRenderStage;
    }
    if (!stageEl) {
      return;
    }
    var bar = stageEl.querySelector(".install-progress span");
    if (!bar) {
      return;
    }
    stageEl.className += stageEl.className.indexOf("has-progress") < 0 ? " has-progress" : "";
    bar.style.width = Math.max(0, Math.min(100, Number(percent || 0))) + "%";
  }

  function clearInstallStageProgress(stage) {
    var stageEl = stage === "comfyModel" ? els.comfyModelStage : (stage === "comfyRender" ? els.comfyRenderStage : null);
    if (!stageEl) {
      return;
    }
    var bar = stageEl.querySelector(".install-progress span");
    stageEl.className = stageEl.className.replace(/\s?has-progress/g, "");
    if (bar) {
      bar.style.width = "";
    }
  }

  function stopComfyModelProgress() {
    if (comfyModelProgressTimer) {
      clearInterval(comfyModelProgressTimer);
      comfyModelProgressTimer = null;
    }
  }

  function startComfyModelProgress(files) {
    stopComfyModelProgress();
    setInstallStage("comfyModel", "running", "Starting model download...\n\n" + comfyModelStatusText(files));
    setInstallStageProgress("comfyModel", comfyModelProgressPercent(files));
    comfyModelProgressTimer = setInterval(function () {
      var percent = comfyModelProgressPercent(files);
      setInstallStage("comfyModel", "running", "Downloading Wan VACE model assets... " + percent + "%\n\n" + comfyModelStatusText(files) + "\n\nDownload is active if the PART sizes are increasing. These files are large and can take a long time.");
      setInstallStageProgress("comfyModel", percent);
    }, 2000);
  }

  function testComfyModels() {
    try {
      stopComfyModelProgress();
      setInstallStage("comfyModel", "running", "Checking Wan VACE model files...\n");
      setSettingsStatus("Checking ComfyUI model files...");
      var files = comfyModelFiles();
      var nodeRequire = getNodeRequire();
      if (!nodeRequire || !files.length) {
        setInstallStage("comfyModel", "error", "Node.js is unavailable or the ComfyUI model folder could not be resolved.");
        return;
      }
      var fs = nodeRequire("fs");
      var missing = [];
      for (var i = 0; i < files.length; i++) {
        if (modelFileSize(fs, files[i].path) < Number(files[i].minBytes || 1)) {
          missing.push(files[i]);
        }
	      }
	      clearInstallStageProgress("comfyModel");
	      var risk = comfyWanRiskText(files);
	      setInstallStage("comfyModel", missing.length ? "error" : "done", comfyModelStatusText(files) + (risk ? "\n\n" + risk : ""));
	      setSettingsStatus(missing.length ? (missing.length + " ComfyUI model file(s) missing or partial.") : (risk ? "Wan VACE model found, but fp16 14B may crash on this Mac." : "ComfyUI Wan VACE models found."), missing.length > 0 || !!risk);
    } catch (err) {
      var message = String(err && err.message ? err.message : err);
      setInstallStage("comfyModel", "error", message);
      setSettingsStatus(message, true);
    }
  }

  function downloadComfyModels() {
    try {
      setInstallStage("comfyModel", "running", "Preparing Wan VACE model download...\n");
      setSettingsStatus("Preparing Wan VACE model download...");
      var files = comfyModelFiles();
      var nodeRequire = getNodeRequire();
      if (!files.length) {
        setInstallStage("comfyModel", "error", "Could not resolve ComfyUI model folder.");
        setSettingsStatus("Could not resolve ComfyUI model folder.", true);
        return;
      }
      if (!nodeRequire) {
        setInstallStage("comfyModel", "error", "Node.js is unavailable; cannot download ComfyUI model files.");
        setSettingsStatus("Node.js is unavailable.", true);
        return;
      }
      var path = nodeRequire("path");
      var lines = [
        "set -e",
        "echo 'Downloading Wan VACE model assets. These are large files; curl will resume partial downloads.'"
      ];
      for (var i = 0; i < files.length; i++) {
        lines.push("mkdir -p " + shellQuote(path.dirname(files[i].path)));
        lines.push("SIZE=$({ wc -c < " + shellQuote(files[i].path) + "; } 2>/dev/null | tr -d ' '); [ -n \"$SIZE\" ] || SIZE=0");
        lines.push("echo 'Checking " + files[i].label.replace(/'/g, "") + " (" + files[i].sizeHint.replace(/'/g, "") + ")...'");
        lines.push("if [ \"$SIZE\" -ge " + String(files[i].minBytes) + " ]; then echo 'Already present: " + files[i].path.replace(/'/g, "") + "'; else echo 'Downloading/resuming to " + files[i].path.replace(/'/g, "") + "'; curl -L --fail --connect-timeout 20 --progress-bar -C - -o " + shellQuote(files[i].path) + " " + shellQuote(files[i].url) + "; fi");
      }
      lines.push("echo 'Wan VACE model assets ready.'");
      startComfyModelProgress(files);
      setSettingsStatus("Downloading Wan VACE model assets...");
      runShellStreaming(lines.join("\n"), {
        onData: function (text) {
          appendInstallStageLog("comfyModel", text);
        }
      }).then(function () {
        stopComfyModelProgress();
        clearInstallStageProgress("comfyModel");
        setInstallStage("comfyModel", "done", comfyModelStatusText(files) + "\n\nWan VACE model assets ready.");
        setSettingsStatus("Wan VACE model assets ready.");
      }).catch(function (err) {
        stopComfyModelProgress();
        clearInstallStageProgress("comfyModel");
        var message = String(err && err.message ? err.message : err);
        setInstallStage("comfyModel", "error", comfyModelStatusText(files) + "\n\n" + message);
        setSettingsStatus(message, true);
      });
    } catch (err) {
      stopComfyModelProgress();
      clearInstallStageProgress("comfyModel");
      var message = String(err && err.message ? err.message : err);
      setInstallStage("comfyModel", "error", message);
      setSettingsStatus(message, true);
    }
  }

  function replaceWorkflowPlaceholders(value, vars) {
    if (typeof value === "string") {
      return value.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, function (_, key) {
        return vars[key] !== undefined ? String(vars[key]) : "{{" + key + "}}";
      });
    }
    if (value && Object.prototype.toString.call(value) === "[object Array]") {
      for (var i = 0; i < value.length; i++) {
        value[i] = replaceWorkflowPlaceholders(value[i], vars);
      }
      return value;
    }
    if (value && typeof value === "object") {
      for (var k in value) {
        if (Object.prototype.hasOwnProperty.call(value, k)) {
          value[k] = replaceWorkflowPlaceholders(value[k], vars);
        }
      }
    }
    return value;
  }

  function comfyRenderFrameCount(durationSeconds, fps) {
    var raw = Math.max(1, Math.ceil(Number(durationSeconds || 0.1) * Number(fps || 12)));
    var frameCount = Math.ceil((raw - 1) / 4) * 4 + 1;
    return Math.max(9, Math.min(121, frameCount));
  }

  function saneFrameRate(value) {
    var fps = Number(value || 0);
    if (!isFinite(fps) || fps < 1 || fps > 120) {
      return 30;
    }
    return Math.round(fps * 1000) / 1000;
  }

  function extensionRootPath(nodeRequire) {
    var path = nodeRequire("path");
    try {
      if (window.__adobe_cep__ && window.__adobe_cep__.getSystemPath && window.SystemPath) {
        return window.__adobe_cep__.getSystemPath(window.SystemPath.EXTENSION);
      }
    } catch (_) {}
    try {
      var pathname = decodeURIComponent(String(window.location.pathname || ""));
      // Windows: location.pathname is "/C:/Users/...". Left as is, path.join made it "\C:\Users\...", and
      // ExtendScript's $.evalFile could not load jsx/prai/host.jsx from that, so every project read failed (seen
      // as "No active sequence audio tracks" with audio on A1, 2026-11-21). The Mac's "/Users/..." is untouched.
      pathname = pathname.replace(/^\/(?=[A-Za-z]:)/, "");
      return path.dirname(pathname);
    } catch (_) {}
    return "/Library/Application Support/Adobe/CEP/extensions/PR FX/client/prai";
  }

  /* PR FX port: PR AI's UI lives in PR FX/client/prai, its ExtendScript in
     PR FX/jsx/prai/host.jsx. extensionRootPath() is the client/prai folder. */
  function praiHostJsxPath(nodeRequire) {
    var path = nodeRequire("path");
    return path.join(extensionRootPath(nodeRequire), "..", "..", "jsx", "prai", "host.jsx");
  }

  function normalizeComfyWanWorkflow(workflow, options) {
    if (!workflow || typeof workflow !== "object") {
      return workflow;
    }
    options = options || {};
    var frameCount = Number(options.frameCount || 0);
    var renderSize = Number(options.renderSize || 384);
    var steps = Number(options.steps || 4);
    for (var nodeId in workflow) {
      if (!Object.prototype.hasOwnProperty.call(workflow, nodeId)) {
        continue;
      }
      var node = workflow[nodeId];
      if (!node || typeof node !== "object") {
        continue;
      }
      node.inputs = node.inputs || {};
      if (node.class_type === "CLIPLoader") {
        if (!node.inputs.clip_name && node.inputs.type && /\.safetensors$/i.test(String(node.inputs.type))) {
          node.inputs.clip_name = node.inputs.type;
          node.inputs.type = "wan";
        }
        if (node.inputs.device && node.inputs.device !== "default" && node.inputs.device !== "cpu") {
          node.inputs.device = "default";
        }
      }
      if (node.class_type === "UNETLoader") {
        if (!node.inputs.unet_name && node.inputs.weight_dtype && /\.safetensors$/i.test(String(node.inputs.weight_dtype))) {
          node.inputs.unet_name = node.inputs.weight_dtype;
          node.inputs.weight_dtype = "default";
        } else if (node.inputs.unet_name) {
          node.inputs.weight_dtype = "default";
        }
      }
      if (node.class_type === "LoraLoaderModelOnly") {
        if (!node.inputs.lora_name && node.inputs.strength_model && /\.safetensors$/i.test(String(node.inputs.strength_model))) {
          node.inputs.lora_name = node.inputs.strength_model;
          node.inputs.strength_model = 1;
        }
      }
      if (node.class_type === "VAELoader" && !node.inputs.vae_name) {
        node.inputs.vae_name = "wan_2.1_vae.safetensors";
      }
      if (node.class_type === "KSampler") {
        if (String(node.inputs.steps || "").toLowerCase() === "randomize") {
          node.inputs.steps = steps;
        }
        node.inputs.steps = Math.max(4, Math.min(12, Number(node.inputs.steps || steps)));
        node.inputs.cfg = Math.max(1, Math.min(4, Number(node.inputs.cfg || 3)));
        if (typeof node.inputs.sampler_name === "number") {
          node.inputs.sampler_name = "uni_pc";
        }
        if (node.inputs.scheduler === "uni_pc") {
          node.inputs.scheduler = "simple";
        }
        if (node.inputs.denoise === "simple") {
          node.inputs.denoise = 1;
        }
      }
      if (frameCount > 0 && node.class_type === "WanVaceToVideo") {
        node.inputs.width = renderSize;
        node.inputs.height = renderSize;
        node.inputs.length = frameCount;
        node.inputs.batch_size = frameCount;
      }
      if (frameCount > 0 && node.class_type === "ImageFromBatch" && node.inputs.length && Number(node.inputs.length) > 1) {
        node.inputs.length = frameCount;
      }
    }
    return workflow;
  }

  function newestVideoFile(nodeRequire, folders, sinceMs, nameHint) {
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    var best = null;
    var safeHint = nameHint ? String(nameHint) : "";
    function scanFolder(folder, depth) {
      if (!folder || !fs.existsSync(folder) || depth > 3) {
        return;
      }
      var files = [];
      try {
        files = fs.readdirSync(folder);
      } catch (_) {
        return;
      }
      for (var i = 0; i < files.length; i++) {
        var filePath = path.join(folder, files[i]);
        var stat = null;
        try {
          stat = fs.statSync(filePath);
        } catch (_) {
          continue;
        }
        if (stat.isDirectory()) {
          scanFolder(filePath, depth + 1);
          continue;
        }
        if (!/\.(mp4|mov|mkv|webm)$/i.test(files[i])) {
          continue;
        }
        if (safeHint && filePath.indexOf(safeHint) < 0) {
          continue;
        }
        if (stat.mtime.getTime() < sinceMs - 1000) {
          continue;
        }
        if (!best || stat.mtime.getTime() > best.mtime) {
          best = { path: filePath, mtime: stat.mtime.getTime() };
        }
      }
    }
    for (var f = 0; f < folders.length; f++) {
      scanFolder(folders[f], 0);
    }
    return best ? best.path : "";
  }

  function secondsLabel(ms) {
    var total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    var minutes = Math.floor(total / 60);
    var seconds = total % 60;
    return minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
  }

  function getComfyQueuePosition(queue, promptId) {
    if (!queue || !promptId) {
      return "";
    }
    var groups = [
      { name: "running", items: queue.queue_running || [] },
      { name: "pending", items: queue.queue_pending || [] }
    ];
    for (var g = 0; g < groups.length; g++) {
      for (var i = 0; i < groups[g].items.length; i++) {
        var item = groups[g].items[i];
        if (item && item[1] === promptId) {
          return groups[g].name === "running" ? "running" : "queued " + (i + 1) + "/" + groups[g].items.length;
        }
      }
    }
    return "";
  }

  function getComfyHistoryItem(history) {
    var keys = history && typeof history === "object" ? Object.keys(history) : [];
    return keys.length ? history[keys[0]] : null;
  }

  function getComfyHistoryError(history) {
    var item = getComfyHistoryItem(history);
    var status = item && item.status ? item.status : null;
	    if (!status) {
	      return "";
	    }
	    var messages = status.messages || [];
	    for (var i = 0; i < messages.length; i++) {
	      var msg = messages[i];
	      if (msg && msg[0] === "execution_error") {
	        var detail = msg[1] || {};
	        return detail.exception_message || detail.exception_type || "ComfyUI execution_error";
	      }
	    }
	    if (status.status_str && String(status.status_str).toLowerCase().indexOf("error") >= 0) {
	      return status.status_str;
	    }
	    return "";
	  }

  function isComfyHistoryDone(history) {
    var item = getComfyHistoryItem(history);
    return !!(item && item.status && item.status.completed);
  }

  function resolveComfyHistoryVideo(nodeRequire, history, folders, nameHint) {
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    var item = getComfyHistoryItem(history);
    var outputs = item && item.outputs ? item.outputs : {};
    for (var nodeId in outputs) {
      if (!Object.prototype.hasOwnProperty.call(outputs, nodeId)) {
        continue;
      }
      var output = outputs[nodeId] || {};
      var candidates = output.videos || output.gifs || output.files || [];
      for (var i = 0; i < candidates.length; i++) {
        var file = candidates[i] || {};
        var filename = file.filename || file.name || "";
        if (!filename || !/\.(mp4|mov|mkv|webm)$/i.test(filename)) {
          continue;
        }
        if (nameHint && filename.indexOf(nameHint) < 0) {
          continue;
        }
        for (var f = 0; f < folders.length; f++) {
          var candidatePath = path.join(folders[f], file.subfolder || "", filename);
          if (fs.existsSync(candidatePath)) {
            return candidatePath;
          }
        }
      }
    }
    return "";
  }

  function nodeJsonRequest(nodeRequire, method, targetUrl, payload, timeoutMs) {
    return new Promise(function (resolve, reject) {
      try {
        var urlModule = nodeRequire("url");
        var parsed = urlModule.parse(targetUrl);
        var client = nodeRequire(parsed.protocol === "https:" ? "https" : "http");
        var NodeBuffer = nodeRequire("buffer").Buffer;
        var body = payload !== undefined ? JSON.stringify(payload) : "";
        var headers = {
          "Accept": "application/json",
          "User-Agent": "PR-AI-CEP"
        };
        if (body) {
          headers["Content-Type"] = "application/json";
          headers["Content-Length"] = NodeBuffer.byteLength(body);
        }
        var req = client.request({
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.path,
          method: method,
          headers: headers
        }, function (res) {
          var chunks = [];
          res.on("data", function (chunk) {
            chunks.push(chunk);
          });
          res.on("end", function () {
            var text = NodeBuffer.concat(chunks).toString("utf8");
            if (res.statusCode < 200 || res.statusCode >= 300) {
              reject(new Error("HTTP " + res.statusCode + (text ? "\n" + text : "")));
              return;
            }
            try {
              resolve(text ? JSON.parse(text) : {});
            } catch (err) {
              reject(new Error("Invalid JSON response from ComfyUI:\n" + text));
            }
          });
        });
        req.on("error", reject);
        req.setTimeout(timeoutMs || 30000, function () {
          req.destroy(new Error("ComfyUI request timed out."));
        });
        if (body) {
          req.write(body);
        }
        req.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  function submitComfyPrompt(nodeRequire, serverUrl, prompt) {
    return nodeJsonRequest(nodeRequire, "POST", serverUrl.replace(/\/+$/, "") + "/prompt", {
      prompt: prompt,
      client_id: "pr-ai-cep"
    }, 30000).catch(function (err) {
      throw new Error("ComfyUI prompt submit failed: " + String(err && err.message ? err.message : err));
    });
  }

	  function waitForComfyOutput(nodeRequire, folders, sinceMs, promptId, serverUrl, outputPrefix) {
    var attempts = 0;
    var lastLogAt = 0;
    var statusMisses = 0;
    function poll() {
      attempts++;
      var elapsed = Date.now() - sinceMs;
      var output = newestVideoFile(nodeRequire, folders, sinceMs, outputPrefix);
      if (output) {
        return Promise.resolve(output);
      }
      if (attempts > 900) {
        throw new Error("ComfyUI render did not produce a video file in the expected output folder.");
      }
      if (promptId) {
        var baseUrl = serverUrl.replace(/\/+$/, "");
        return Promise.all([
          nodeJsonRequest(nodeRequire, "GET", baseUrl + "/history/" + encodeURIComponent(promptId), undefined, 5000).catch(function () { return null; }),
          nodeJsonRequest(nodeRequire, "GET", baseUrl + "/queue", undefined, 5000).catch(function () { return null; }),
          nodeJsonRequest(nodeRequire, "GET", baseUrl + "/progress", undefined, 5000).catch(function () { return null; })
        ]).then(function (results) {
          var history = results[0];
          var queue = results[1];
          var progress = results[2];
          if (!history && !queue) {
            statusMisses++;
            if (els.comfyRenderState) {
              els.comfyRenderState.textContent = "Server not responding " + secondsLabel(elapsed);
            }
            if (Date.now() - lastLogAt > 6000) {
              lastLogAt = Date.now();
              appendInstallStageLog("comfyRender", "Status: ComfyUI server not responding, elapsed " + secondsLabel(elapsed) + "\n");
            }
            if (statusMisses >= 5) {
              throw new Error("ComfyUI stopped responding after the prompt was submitted. Restart ComfyUI, then test the server before rendering again.");
            }
            return new Promise(function (resolve) {
              window.setTimeout(function () {
                resolve(poll());
              }, 2000);
            });
          }
          statusMisses = 0;
          var historyOutput = resolveComfyHistoryVideo(nodeRequire, history, folders, outputPrefix);
          if (historyOutput) {
            return historyOutput;
          }
          var error = getComfyHistoryError(history);
          if (error) {
            throw new Error("ComfyUI render failed: " + error);
          }
          var percent = null;
          if (progress && progress.max && progress.value !== undefined) {
            percent = Math.min(95, Math.max(5, Math.round(Number(progress.value) * 100 / Number(progress.max))));
          }
          var queueText = getComfyQueuePosition(queue, promptId);
          var nodeText = progress && progress.node ? "node " + progress.node : "";
          var doneText = isComfyHistoryDone(history) ? "complete; locating file" : (queueText || nodeText || "rendering");
          if (percent !== null) {
            setInstallStageProgress("comfyRender", percent);
          } else if (isComfyHistoryDone(history)) {
            setInstallStageProgress("comfyRender", 95);
          } else {
            clearInstallStageProgress("comfyRender");
          }
          if (els.comfyRenderState) {
            els.comfyRenderState.textContent = (percent !== null ? Math.round(percent) + "% " : "") + doneText + " " + secondsLabel(elapsed);
          }
          if (Date.now() - lastLogAt > 10000 || isComfyHistoryDone(history)) {
            lastLogAt = Date.now();
            appendInstallStageLog("comfyRender", "Status: " + doneText + ", elapsed " + secondsLabel(elapsed) + (percent !== null ? ", " + Math.round(percent) + "%" : "") + "\n");
          }
          if (isComfyHistoryDone(history)) {
            var lateOutput = newestVideoFile(nodeRequire, folders, sinceMs, outputPrefix);
            if (lateOutput) {
              return lateOutput;
            }
          }
          return new Promise(function (resolve) {
            window.setTimeout(function () {
              resolve(poll());
            }, 2000);
          });
        });
      }
      return new Promise(function (resolve) {
        window.setTimeout(function () {
          resolve(poll());
        }, 2000);
      });
    }
	    return poll();
	  }

  function textCoverPixelCandidate(r, g, b) {
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var brightNeutral = max > 176 && (max - min) < 62;
    var yellow = r > 150 && g > 118 && b < 125 && (r - b) > 45;
    var cyanOrGreen = g > 150 && max > 170 && (max - min) > 45;
    return brightNeutral || yellow || cyanOrGreen;
  }

  function detectTextCoverBox(buffer, width, height, frameIndex) {
    var stride = width * height * 3;
    var start = frameIndex * stride;
    var cell = 3;
    var gridW = Math.ceil(width / cell);
    var gridH = Math.ceil(height / cell);
    var mask = new Uint8Array(gridW * gridH);
    var yStart = Math.floor(height * 0.55);
    var yEnd = Math.floor(height * 0.95);
    for (var y = yStart; y < yEnd; y += cell) {
      for (var x = 0; x < width; x += cell) {
        var hits = 0;
        for (var yy = 0; yy < cell && y + yy < height; yy++) {
          for (var xx = 0; xx < cell && x + xx < width; xx++) {
            var idx = start + ((y + yy) * width + (x + xx)) * 3;
            if (textCoverPixelCandidate(buffer[idx], buffer[idx + 1], buffer[idx + 2])) {
              hits++;
            }
          }
        }
        if (hits >= 2) {
          mask[Math.floor(y / cell) * gridW + Math.floor(x / cell)] = 1;
        }
      }
    }

    var dilated = new Uint8Array(mask.length);
    for (var gy = 0; gy < gridH; gy++) {
      for (var gx = 0; gx < gridW; gx++) {
        if (!mask[gy * gridW + gx]) {
          continue;
        }
        for (var dy = -2; dy <= 2; dy++) {
          for (var dx = -3; dx <= 3; dx++) {
            var nx = gx + dx;
            var ny = gy + dy;
            if (nx >= 0 && ny >= 0 && nx < gridW && ny < gridH) {
              dilated[ny * gridW + nx] = 1;
            }
          }
        }
      }
    }

    var seen = new Uint8Array(dilated.length);
    var best = null;
    for (var sy = 0; sy < gridH; sy++) {
      for (var sx = 0; sx < gridW; sx++) {
        var startCell = sy * gridW + sx;
        if (!dilated[startCell] || seen[startCell]) {
          continue;
        }
        var queue = [startCell];
        seen[startCell] = 1;
        var qi = 0;
        var minX = sx;
        var maxX = sx;
        var minY = sy;
        var maxY = sy;
        var count = 0;
        while (qi < queue.length) {
          var current = queue[qi++];
          var cy = Math.floor(current / gridW);
          var cx = current - cy * gridW;
          count++;
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;
          var neighbors = [current - 1, current + 1, current - gridW, current + gridW];
          for (var n = 0; n < neighbors.length; n++) {
            var ni = neighbors[n];
            if (ni < 0 || ni >= dilated.length || seen[ni] || !dilated[ni]) {
              continue;
            }
            var nxCell = ni % gridW;
            if ((n === 0 && nxCell === gridW - 1) || (n === 1 && nxCell === 0)) {
              continue;
            }
            seen[ni] = 1;
            queue.push(ni);
          }
        }
        var boxW = (maxX - minX + 1) * cell;
        var boxH = (maxY - minY + 1) * cell;
        var area = boxW * boxH;
        var lowerBias = (minY * cell) > height * 0.35;
        if (boxW < width * 0.12 || boxH < height * 0.018 || boxH > height * 0.35 || area < 450 || !lowerBias) {
          continue;
        }
        var score = count * (boxW / Math.max(1, boxH));
        if (!best || score > best.score) {
          best = {
            x: Math.max(0, minX * cell - 12),
            y: Math.max(0, minY * cell - 10),
            w: Math.min(width, boxW + 24),
            h: Math.min(height, boxH + 20),
            score: score
          };
        }
      }
    }
    return best;
  }

  function mergeTextCoverDetections(detections, sampleFps, duration) {
    var segments = [];
    for (var i = 0; i < detections.length; i++) {
      var det = detections[i];
      if (!det) {
        continue;
      }
      var start = Math.max(0, det.time - 0.08);
      var end = Math.min(duration, det.time + (1 / sampleFps) + 0.12);
      var last = segments.length ? segments[segments.length - 1] : null;
      if (last && start <= last.end + 0.35) {
        last.end = Math.max(last.end, end);
        last.x = Math.min(last.x, det.box.x);
        last.y = Math.min(last.y, det.box.y);
        var right = Math.max(last.x + last.w, det.box.x + det.box.w);
        var bottom = Math.max(last.y + last.h, det.box.y + det.box.h);
        last.w = right - last.x;
        last.h = bottom - last.y;
      } else {
        segments.push({ start: start, end: end, x: det.box.x, y: det.box.y, w: det.box.w, h: det.box.h });
      }
    }
    return segments.filter(function (seg) {
      return seg.end - seg.start >= 0.12;
    });
  }

  function lowerThirdCoverSegment(width, height, duration) {
    return {
      start: 0,
      end: duration,
      x: width * 0.12,
      y: height * 0.66,
      w: width * 0.76,
      h: height * 0.22
    };
  }

  function visionBoxesToDetections(items, sampleFps) {
    var detections = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var boxes = item.boxes || [];
      if (!boxes.length) {
        continue;
      }
      var frameH = Number(item.height || 0);
      var minX = Infinity;
      var minY = Infinity;
      var maxX = 0;
      var maxY = 0;
      var textCount = 0;
      for (var b = 0; b < boxes.length; b++) {
        var box = boxes[b] || {};
        if (!box.w || !box.h) {
          continue;
        }
        var centerY = Number(box.y || 0) + Number(box.h || 0) / 2;
        if (frameH && centerY < frameH * 0.55) {
          continue;
        }
        minX = Math.min(minX, Number(box.x || 0));
        minY = Math.min(minY, Number(box.y || 0));
        maxX = Math.max(maxX, Number(box.x || 0) + Number(box.w || 0));
        maxY = Math.max(maxY, Number(box.y || 0) + Number(box.h || 0));
        textCount++;
      }
      if (!textCount || !isFinite(minX) || !isFinite(minY)) {
        continue;
      }
      var padX = Math.max(24, (maxX - minX) * 0.32);
      var padY = Math.max(18, (maxY - minY) * 0.90);
      detections.push({
        time: i / sampleFps,
        box: {
          x: Math.max(0, minX - padX),
          y: Math.max(0, minY - padY),
          w: (maxX - minX) + padX * 2,
          h: (maxY - minY) + padY * 2,
          score: textCount * 1000
        }
      });
    }
    return detections;
  }

  function coverPngCommand(width, height, rect, outputPath) {
    var x = Math.max(0, Math.round(rect.x));
    var y = Math.max(0, Math.round(rect.y));
    var w = Math.max(1, Math.min(width - x, Math.round(rect.w)));
    var h = Math.max(1, Math.min(height - y, Math.round(rect.h)));
    var filter = "color=c=white:s=" + w + "x" + h + ",format=rgb24,drawbox=x=0:y=0:w=" + w + ":h=" + h + ":color=red:t=5";
    return "\"$FFMPEG\" -hide_banner -loglevel error -y -f lavfi -i " + shellQuote(filter) + " -frames:v 1 -update 1 " + shellQuote(outputPath);
  }

  function runTextCoverDetectionOnSelectedClip() {
    var nodeRequire = getNodeRequire();
    if (!nodeRequire) {
      setSettingsStatus("Node.js is not available in this CEP panel.", true);
      return;
    }
    var fs = nodeRequire("fs");
    var os = nodeRequire("os");
    var path = nodeRequire("path");
    setInstallStage("comfyRender", "running", "Detecting text-like popups from selected clip...\n");
    clearInstallStageProgress("comfyRender");
    setSettingsStatus("Detecting text covers...");
    evalHost("prAI_getSelectedTimelineClips").then(function (result) {
      if (!result.ok) {
        throw new Error(result.error || "Could not read selected timeline clip.");
      }
      var clips = result.data && result.data.clips ? result.data.clips : [];
      if (!clips.length) {
        throw new Error("Select one video clip in the timeline first.");
      }
      var clip = clips[0];
      if (!clip.sourcePath) {
        throw new Error("Selected clip has no source media path.");
      }
      var settings = getComfySettings();
      var clipDuration = Math.max(0.1, Number(clip.endSeconds || 0) - Number(clip.startSeconds || 0));
      var startOffset = Math.min(clipDuration - 0.05, Math.max(0, Number(settings.timing.startOffset || 0)));
      var endOffset = Number(settings.timing.endOffset || 0);
      if (!isFinite(endOffset) || endOffset <= startOffset) {
        endOffset = clipDuration;
      }
      endOffset = Math.min(clipDuration, Math.max(startOffset + 0.05, endOffset));
      var duration = Math.max(0.1, endOffset - startOffset);
      var sourceIn = Math.max(0, Number(clip.inPointSeconds || 0) + startOffset);
      var tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "PR_AI_Text_Covers_"));
      var rawPath = path.join(tempDir, "sample.rgb");
      var frameDir = path.join(tempDir, "frames");
      var boxesPath = path.join(tempDir, "vision_boxes.json");
      var visionScript = path.join(extensionRootPath(nodeRequire), "scripts", "vision_text_boxes.swift");
      var sampleFps = Math.min(4, Math.max(2, Math.round(saneFrameRate(clip.sequenceFps || (result.data && result.data.sequenceFps) || 30) / 12)));
      var detectW = 360;
      var command = [
        "set -e",
        resolveFfmpegShell(),
        "mkdir -p " + shellQuote(frameDir),
        "SIZE=$(\"$FFMPEG\" -hide_banner -i " + shellQuote(clip.sourcePath) + " 2>&1 | sed -n 's/.*, \\([0-9][0-9]*x[0-9][0-9]*\\).*/\\1/p' | head -1)",
        "W=${SIZE%x*}; H=${SIZE#*x}; [ -n \"$W\" ] || W=720; [ -n \"$H\" ] || H=1280",
        "DW=" + String(detectW),
        "DH=$(( H * DW / W )); [ $((DH % 2)) -eq 0 ] || DH=$((DH + 1))",
        "echo video_size=${W}x${H}",
        "echo detect_size=${DW}x${DH}",
        "\"$FFMPEG\" -hide_banner -loglevel error -y -ss " + shellQuote(sourceIn.toFixed(3)) + " -t " + shellQuote(duration.toFixed(3)) + " -i " + shellQuote(clip.sourcePath) + " -an -vf \"fps=" + sampleFps + ",scale=${DW}:${DH}\" -pix_fmt rgb24 -f rawvideo " + shellQuote(rawPath),
        "\"$FFMPEG\" -hide_banner -loglevel error -y -ss " + shellQuote(sourceIn.toFixed(3)) + " -t " + shellQuote(duration.toFixed(3)) + " -i " + shellQuote(clip.sourcePath) + " -an -vf \"fps=" + sampleFps + ",scale=${DW}:${DH}\" -q:v 2 " + shellQuote(path.join(frameDir, "frame_%04d.jpg")),
        "if command -v swift >/dev/null 2>&1 && [ -f " + shellQuote(visionScript) + " ]; then",
        "  CLANG_MODULE_CACHE_PATH=/private/tmp/pr-ai-clang-cache swift " + shellQuote(visionScript) + " " + shellQuote(frameDir) + "/*.jpg > " + shellQuote(boxesPath) + " || echo '[]' > " + shellQuote(boxesPath),
        "else",
        "  echo '[]' > " + shellQuote(boxesPath),
        "fi"
      ].join("\n");
      appendInstallStageLog("comfyRender", "Selected: " + clip.name + "\nRange: +" + startOffset.toFixed(2) + "s to +" + endOffset.toFixed(2) + "s\nSampling: " + sampleFps + " fps for Apple Vision OCR text boxes, then heuristic fallback\n");
      return runShellStreaming(command, {
        onData: function (text) {
          appendInstallStageLog("comfyRender", text);
        }
      }).then(function (output) {
        var videoMatch = String(output || "").match(/video_size=([0-9]+)x([0-9]+)/);
        var detectMatch = String(output || "").match(/detect_size=([0-9]+)x([0-9]+)/);
        var videoW = videoMatch ? Number(videoMatch[1]) : Number(settings.frame.w || 720);
        var videoH = videoMatch ? Number(videoMatch[2]) : Number(settings.frame.h || 1280);
        var width = detectMatch ? Number(detectMatch[1]) : detectW;
        var height = detectMatch ? Number(detectMatch[2]) : Math.round(videoH * detectW / Math.max(1, videoW));
        var raw = fs.readFileSync(rawPath);
        var frameBytes = width * height * 3;
        var frameCount = Math.floor(raw.length / frameBytes);
        var detections = [];
        var visionDetections = [];
        try {
          if (fs.existsSync(boxesPath)) {
            visionDetections = visionBoxesToDetections(JSON.parse(fs.readFileSync(boxesPath, "utf8") || "[]"), sampleFps);
          }
        } catch (visionErr) {
          appendInstallStageLog("comfyRender", "Vision OCR parse failed: " + String(visionErr && visionErr.message ? visionErr.message : visionErr) + "\n");
        }
        for (var i = 0; i < frameCount; i++) {
          var box = detectTextCoverBox(raw, width, height, i);
          if (box) {
            detections.push({ time: i / sampleFps, box: box });
          }
        }
        if (visionDetections.length) {
          detections = visionDetections;
          appendInstallStageLog("comfyRender", "Apple Vision OCR detected text on " + visionDetections.length + " sampled frame(s).\n");
        } else {
          appendInstallStageLog("comfyRender", "Apple Vision OCR found no text boxes; using pixel heuristic/fallback.\n");
        }
        var segments = mergeTextCoverDetections(detections, sampleFps, duration);
        if (!segments.length) {
          segments = [lowerThirdCoverSegment(width, height, duration)];
          appendInstallStageLog("comfyRender", "No lower-caption OCR region found. Falling back to a lower-third caption cover for the selected range.\n");
        }
        var actions = [];
        var coverCommands = [
          "set -e",
          resolveFfmpegShell()
        ];
        var scaleX = videoW / width;
        var scaleY = videoH / height;
        for (var s = 0; s < segments.length; s++) {
          var seg = segments[s];
          var rect = {
            x: seg.x * scaleX,
            y: seg.y * scaleY,
            w: seg.w * scaleX,
            h: seg.h * scaleY
          };
          var pngPath = path.join(tempDir, "cover_" + String(s + 1) + ".jpg");
          coverCommands.push(coverPngCommand(videoW, videoH, rect, pngPath));
          appendInstallStageLog("comfyRender", "Cover " + (s + 1) + ": +" + (startOffset + seg.start).toFixed(2) + "s to +" + (startOffset + seg.end).toFixed(2) + "s, x=" + Math.round(rect.x) + " y=" + Math.round(rect.y) + " w=" + Math.round(rect.w) + " h=" + Math.round(rect.h) + "\n");
          actions.push({
            type: "importMediaFile",
            filePath: pngPath,
            insertInTimeline: true,
            trackType: "video",
            trackIndex: Number(clip.trackIndex || 0) + 1,
            seconds: Number(clip.startSeconds || 0) + startOffset + seg.start,
            inPointSeconds: 0,
            outPointSeconds: Math.max(0.12, seg.end - seg.start),
            suppressUI: true
          });
          actions.push({
            type: "setClipMotion",
            trackType: "video",
            trackIndex: Number(clip.trackIndex || 0) + 1,
            seconds: Number(clip.startSeconds || 0) + startOffset + seg.start,
            position: [Math.round(rect.x + rect.w / 2), Math.round(rect.y + rect.h / 2)],
            scale: 100
          });
        }
        appendInstallStageLog("comfyRender", "Detected " + segments.length + " cover segment(s) from " + frameCount + " sampled frame(s).\nCreating opaque white JPG covers...\n");
        return runShellStreaming(coverCommands.join("\n"), {
          onData: function (text) {
            appendInstallStageLog("comfyRender", text);
          }
        }).then(function () {
          appendInstallStageLog("comfyRender", "Importing JPG covers...\n");
          return evalHost("prAI_applyActions", attachTargetSequence({ actions: actions })).then(function (applyResult) {
            if (!applyResult.ok) {
              throw new Error(applyResult.error || "Could not import detected cover images.");
            }
            setInstallStage("comfyRender", "done", (els.comfyRenderLog.textContent || "") + "\nDone: inserted " + actions.length + " JPG cover image(s).");
            setSettingsStatus("Detected and inserted JPG text cover images.");
            return refreshProject();
          });
        });
      });
    }).catch(function (err) {
      var message = String(err && err.message ? err.message : err);
      setInstallStage("comfyRender", "error", (els.comfyRenderLog.textContent || "") + "\n" + message);
      setSettingsStatus(message, true);
    });
  }

  function runComfyInpaintOnSelectedClip() {
    var nodeRequire = getNodeRequire();
    if (!nodeRequire) {
      setSettingsStatus("Node.js is not available in this CEP panel.", true);
      return;
    }
    var fs = nodeRequire("fs");
    var os = nodeRequire("os");
    var path = nodeRequire("path");
    var settings = getComfySettings();
    if (!settings.workflowPath || !fs.existsSync(settings.workflowPath)) {
      setInstallStage("comfyRender", "error", "Workflow JSON path is empty or missing. Export an API workflow JSON from ComfyUI and add placeholders.");
      setSettingsStatus("Workflow JSON path is missing.", true);
      return;
	    }
	    setInstallStage("comfyRender", "running", "Reading selected timeline clip...\n");
	    clearInstallStageProgress("comfyRender");
    setSettingsStatus("Preparing selected clip for ComfyUI...");
    evalHost("prAI_getSelectedTimelineClips").then(function (result) {
      if (!result.ok) {
        throw new Error(result.error || "Could not read selected timeline clip.");
      }
      var clips = result.data && result.data.clips ? result.data.clips : [];
      if (!clips.length) {
        throw new Error("Select one video clip in the timeline first.");
      }
      var clip = clips[0];
      if (!clip.sourcePath) {
        throw new Error("Selected clip has no source media path.");
      }
      var outputDir = resolveComfyOutputFolderForContext(clip.sourcePath);
      var tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "PR_AI_Comfy_Inpaint_"));
      var inputVideo = path.join(tempDir, "input.mp4");
      var maskVideo = path.join(tempDir, "mask.mp4");
      var workflowFile = path.join(tempDir, "workflow.json");
      var startedAt = Date.now();
      var clipDuration = Math.max(0.1, Number(clip.endSeconds || 0) - Number(clip.startSeconds || 0));
      var renderStartOffset = Math.min(clipDuration - 0.05, Math.max(0, Number(settings.timing.startOffset || 0)));
      var renderEndOffset = Number(settings.timing.endOffset || 0);
      if (!isFinite(renderEndOffset) || renderEndOffset <= renderStartOffset) {
        renderEndOffset = clipDuration;
      }
	      renderEndOffset = Math.min(clipDuration, Math.max(renderStartOffset + 0.05, renderEndOffset));
	      var duration = Math.max(0.1, renderEndOffset - renderStartOffset);
		      var renderFps = saneFrameRate(clip.sequenceFps || (result.data && result.data.sequenceFps) || 30);
		      var renderSize = 384;
	      var renderFrames = comfyRenderFrameCount(duration, renderFps);
	      var sourceIn = Math.max(0, Number(clip.inPointSeconds || 0) + renderStartOffset);
	      var command = [
	        "set -e",
	        resolveFfmpegShell(),
	        "mkdir -p " + shellQuote(outputDir),
	        "echo 'Exporting selected source segment...'",
	        "\"$FFMPEG\" -hide_banner -loglevel error -y -ss " + shellQuote(sourceIn.toFixed(3)) + " -t " + shellQuote(duration.toFixed(3)) + " -i " + shellQuote(clip.sourcePath) + " -an -r " + shellQuote(String(renderFps)) + " -frames:v " + shellQuote(String(renderFrames)) + " -c:v libx264 -pix_fmt yuv420p " + shellQuote(inputVideo),
        "SIZE=$(\"$FFMPEG\" -hide_banner -i " + shellQuote(inputVideo) + " 2>&1 | sed -n 's/.*, \\([0-9][0-9]*x[0-9][0-9]*\\).*/\\1/p' | head -1)",
        "W=${SIZE%x*}; H=${SIZE#*x}; [ -n \"$W\" ] || W=1920; [ -n \"$H\" ] || H=1080",
        "echo \"video_size=$W x $H\"",
        "MASK_X=$(( " + Math.round(settings.mask.x) + " * W / " + Math.round(settings.frame.w) + " ))",
        "MASK_Y=$(( " + Math.round(settings.mask.y) + " * H / " + Math.round(settings.frame.h) + " ))",
        "MASK_W=$(( " + Math.round(settings.mask.w) + " * W / " + Math.round(settings.frame.w) + " ))",
        "MASK_H=$(( " + Math.round(settings.mask.h) + " * H / " + Math.round(settings.frame.h) + " ))",
        "[ \"$MASK_W\" -gt 0 ] || MASK_W=1; [ \"$MASK_H\" -gt 0 ] || MASK_H=1",
        "echo \"mask=$MASK_X,$MASK_Y ${MASK_W}x${MASK_H}\"",
        "echo 'Creating rectangle mask...'",
	        "\"$FFMPEG\" -hide_banner -loglevel error -y -f lavfi -i color=black:s=${W}x${H}:r=" + shellQuote(String(renderFps)) + " -frames:v " + shellQuote(String(renderFrames)) + " -vf \"drawbox=x=${MASK_X}:y=${MASK_Y}:w=${MASK_W}:h=${MASK_H}:color=white:t=fill\" -c:v libx264 -pix_fmt yuv420p " + shellQuote(maskVideo)
	      ].join("\n");
		      appendInstallStageLog("comfyRender", "Selected: " + clip.name + "\nRange: +" + renderStartOffset.toFixed(2) + "s to +" + renderEndOffset.toFixed(2) + "s\nRender profile: " + renderFrames + " frames @ " + renderFps + " fps, " + renderSize + "px, Apple MPS-safe dtype\nOutput: " + outputDir + "\n");
      return runShellStreaming(command, {
        onData: function (text) {
          appendInstallStageLog("comfyRender", text);
        }
      }).then(function () {
        var workflow = JSON.parse(fs.readFileSync(settings.workflowPath, "utf8"));
		        workflow = normalizeComfyWanWorkflow(workflow, { frameCount: renderFrames, renderSize: renderSize, steps: 4 });
        var outputPrefix = "PR_AI_inpaint_" + new Date().getTime();
        workflow = replaceWorkflowPlaceholders(workflow, {
          input_video: inputVideo,
          mask_video: maskVideo,
          output_dir: outputDir,
          output_prefix: outputPrefix,
          positive_prompt: settings.positivePrompt,
          negative_prompt: settings.negativePrompt
	        });
	        fs.writeFileSync(workflowFile, JSON.stringify(workflow, null, 2), "utf8");
	        var risk = comfyWanRiskText(comfyModelFiles());
	        appendInstallStageLog("comfyRender", "Workflow: " + settings.workflowPath + "\n" + (risk ? risk + "\n" : "") + "Submitting workflow to ComfyUI...\n");
        return submitComfyPrompt(nodeRequire, settings.serverUrl, workflow).then(function (submitResult) {
          var promptId = submitResult && submitResult.prompt_id ? submitResult.prompt_id : "";
          appendInstallStageLog("comfyRender", "prompt_id=" + promptId + "\nRendering in ComfyUI. Progress will update from queue, node, history, and output-folder checks.\n");
          var folders = [outputDir];
          if (settings.path) {
            folders.push(path.join(settings.path, "output"));
          }
          folders.push(path.join(os.homedir(), "Documents", "ComfyUI", "output"));
          return waitForComfyOutput(nodeRequire, folders, startedAt, promptId, settings.serverUrl, outputPrefix);
        });
      }).then(function (videoPath) {
        clearInstallStageProgress("comfyRender");
        appendInstallStageLog("comfyRender", "Importing result:\n" + videoPath + "\n");
        return evalHost("prAI_applyActions", attachTargetSequence({
          actions: [{
            type: "importMediaFile",
            filePath: videoPath,
            insertInTimeline: settings.importMode !== "importOnly",
            trackType: "video",
            trackIndex: Number(clip.trackIndex || 0) + 1,
            seconds: Number(clip.startSeconds || 0) + renderStartOffset,
            suppressUI: true
          }]
        })).then(function (importResult) {
          if (!importResult.ok) {
            throw new Error(importResult.error || "Could not import ComfyUI result.");
          }
          setInstallStage("comfyRender", "done", (els.comfyRenderLog.textContent || "") + "\nDone:\n" + videoPath);
          setSettingsStatus("ComfyUI inpaint imported.");
          return refreshProject();
        });
      });
    }).catch(function (err) {
      clearInstallStageProgress("comfyRender");
      var message = String(err && err.message ? err.message : err);
      setInstallStage("comfyRender", "error", (els.comfyRenderLog.textContent || "") + "\n" + message);
      setSettingsStatus(message, true);
    });
  }

  /* The program a WhisperX command line starts: '"C:\...\whisperx.exe"', '/Users/x/env/bin/whisperx', or "" when it
     isn't a path that exists (a bare "whisperx" found on PATH). */
  function whisperCommandProgram(command, nodeRequire) {
    var fs = nodeRequire("fs");
    var text = String(command || "").replace(/^\s+|\s+$/g, "");
    var quoted = /^(["'])(.*?)\1/.exec(text);
    var program = quoted ? quoted[2] : (fs.existsSync(text) ? text : text.split(/\s+/)[0]);
    try {
      return program && fs.statSync(program).isFile() ? program : "";
    } catch (_) {
      return "";
    }
  }

  /* WhisperX's own Python, which has faster-whisper: beside its command in the environment Creative Assist makes
     (whisperx-env/Scripts/python.exe on Windows, whisperx-env/bin/python on the Mac), else the one its launcher
     script names on its first line (pip, pipx, Homebrew). "" when none is found. */
  function whisperxPythonPath(command, nodeRequire) {
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    var program = whisperCommandProgram(command, nodeRequire);
    if (!program) {
      return "";
    }
    var names = isWindowsPlatform() ? ["python.exe"] : ["python3", "python"];
    for (var i = 0; i < names.length; i++) {
      var beside = path.join(path.dirname(program), names[i]);
      if (fs.existsSync(beside)) {
        return beside;
      }
    }
    try {
      var fd = fs.openSync(program, "r");
      var buffer = nodeRequire("buffer").Buffer.alloc(512);
      var read = fs.readSync(fd, buffer, 0, 512, 0);
      fs.closeSync(fd);
      var head = buffer.slice(0, read).toString("utf8");
      // "#!/path/python", or pip's form for paths with spaces: "#!/bin/sh" then exec '/path with space/python'.
      var named = /^#!\s*(\S*python[\w.]*)\s*$/m.exec(head) || /exec'?\s+['"]([^'"]*python[\w.]*)['"]/.exec(head);
      if (named && fs.existsSync(named[1])) {
        return named[1];
      }
    } catch (_) {}
    return "";
  }

  // PR FX's transcription script (client/prai/scripts/prfx_transcribe.py), or "" if it's missing.
  function prfxTranscribeScriptPath(nodeRequire) {
    var file = nodeRequire("path").join(extensionRootPath(nodeRequire), "scripts", "prfx_transcribe.py");
    return nodeRequire("fs").existsSync(file) ? file : "";
  }

  /* Languages whose default WhisperX alignment model gives noise. Vietnamese's (nguyenvulebinh/wav2vec2-base-vi-vlsp2020)
     needs model code WhisperX doesn't load: the user's sentence of 9 s came back squeezed into 2 s (2026-11-22). Only
     used when WhisperX runs on its own (its Python not found); then Whisper's segment times are kept instead. */
  var whisperxBrokenAlignLanguages = { vi: true };

  function buildWhisperAlignCommand(audioPath, textPath, outputPath) {
    var settings = getWhisperSettings();
    if (!settings.command) {
      throw new Error("Whisper align command is not configured.");
    }
    if (isWhisperxCommand(settings.command)) {
      var nodeRequire = getNodeRequire();
      var python = nodeRequire ? whisperxPythonPath(settings.command, nodeRequire) : "";
      var script = nodeRequire ? prfxTranscribeScriptPath(nodeRequire) : "";
      if (python && script) {
        // Whisper over the whole file, no voice gate, its own word times (see the script for why).
        return [
          shellQuote(python),
          shellQuote(script),
          "--audio " + shellQuote(audioPath),
          "--output_dir " + shellQuote(outputPath),
          "--model " + shellQuote(settings.model),
          "--language " + shellQuote(String(settings.language || "auto").replace(/[^a-z-]/gi, "") || "auto"),
          "--device " + shellQuote(whisperDeviceForCli(settings.device)),
          "--compute_type " + shellQuote(whisperComputeTypeForCli(settings.device))
        ].join(" ");
      }
      var language = String(settings.language || "").toLowerCase();
      return [
        settings.command,
        "--model " + shellQuote(settings.model) + whisperLanguageArg(settings),
        "--device " + shellQuote(whisperDeviceForCli(settings.device)),
        "--compute_type " + shellQuote(whisperComputeTypeForCli(settings.device)),
        "--vad_method silero",
        whisperxBrokenAlignLanguages[language] ? "--no_align" : "",
        "--output_dir " + shellQuote(outputPath),
        "--output_format all",
        shellQuote(audioPath)
      ].filter(Boolean).join(" ");
    }
    return [
      settings.command,
      "--audio " + shellQuote(audioPath),
      "--text " + shellQuote(textPath),
      "--out " + shellQuote(outputPath),
      "--model " + shellQuote(settings.model),
      "--device " + shellQuote(settings.device)
    ].join(" ");
  }

  function isLocalAudioSubtitleAction(action) {
    return action && (
      action.type === "transcribeAudioTrackToSrt" ||
      action.type === "cutAudioAndTimeSubtitles" ||
      action.type === "alignAudioTrackToScript" ||
      action.type === "detectAudioTrackSubtitles"
    );
  }

  function normalizeAudioTrackIndex(value, fallback) {
    if (typeof value === "string") {
      var match = value.match(/A\s*(\d+)/i);
      if (match) {
        return Math.max(0, Number(match[1]) - 1);
      }
    }
    var numeric = Number(value);
    if (isFinite(numeric)) {
      return Math.max(0, numeric);
    }
    if (fallback !== undefined && fallback !== value) {
      return normalizeAudioTrackIndex(fallback, 0);
    }
    return 0;
  }

  function ffmpegConcatPath(filePath) {
    return "file '" + String(filePath).replace(/'/g, "'\\''") + "'";
  }

  function writeTextFile(nodeRequire, filePath, contents) {
    nodeRequire("fs").writeFileSync(filePath, String(contents || ""), "utf8");
  }

  function findGeneratedSrt(nodeRequire, outputDir) {
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    var entries = fs.readdirSync(outputDir);
    var candidates = [];
    for (var i = 0; i < entries.length; i++) {
      if (/\.srt$/i.test(entries[i])) {
        var filePath = path.join(outputDir, entries[i]);
        var stat = fs.statSync(filePath);
        candidates.push({ path: filePath, mtime: stat.mtime.getTime() });
      }
    }
    candidates.sort(function (a, b) {
      return b.mtime - a.mtime;
    });
    if (!candidates.length) {
      throw new Error("Whisper finished, but no .srt file was created in " + outputDir + ".");
    }
    return candidates[0].path;
  }

  function findGeneratedJson(nodeRequire, outputDir, skipName) {
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    var entries = fs.readdirSync(outputDir);
    var candidates = [];
    for (var i = 0; i < entries.length; i++) {
      if (/\.json$/i.test(entries[i]) && entries[i] !== skipName) {
        var filePath = path.join(outputDir, entries[i]);
        var stat = fs.statSync(filePath);
        candidates.push({ path: filePath, mtime: stat.mtime.getTime() });
      }
    }
    candidates.sort(function (a, b) {
      return b.mtime - a.mtime;
    });
    return candidates.length ? candidates[0].path : "";
  }

  /* Whisper's JSON minus the lines it made up and any noise word timing (js/whisper-clean.js), written beside it as
     cleaned.json and cleaned.srt, which every caption step reads from then on. Returns their paths, the SRT text and
     what was dropped, or null when there is no JSON to clean (a custom align command). */
  function cleanWhisperOutputFiles(nodeRequire, outputDir, log) {
    var cleaner = window.prfxWhisperClean;
    var jsonPath = findGeneratedJson(nodeRequire, outputDir, "cleaned.json");
    if (!cleaner || !jsonPath) {
      return null;
    }
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    var payload;
    try {
      payload = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    } catch (_) {
      return null;
    }
    var cleaned = cleaner.cleanTranscript(payload);
    var result = {
      jsonPath: path.join(outputDir, "cleaned.json"),
      srtPath: path.join(outputDir, "cleaned.srt"),
      contents: buildSrtFromBlocks(cleaned.segments),
      kept: cleaned.segments.length,
      dropped: cleaned.dropped,
      wordTiming: cleaned.wordTiming
    };
    fs.writeFileSync(result.jsonPath, JSON.stringify({
      segments: cleaned.segments,
      language: payload.language,
      engine: payload.engine || "whisperx",
      wordTiming: cleaned.wordTiming,
      dropped: cleaned.dropped
    }), "utf8");
    fs.writeFileSync(result.srtPath, result.contents, "utf8");
    if (log) {
      var lines = ["Kept " + result.kept + " line(s) Whisper heard; dropped " + cleaned.dropped.length + " it made up."];
      for (var d = 0; d < cleaned.dropped.length; d++) {
        var item = cleaned.dropped[d];
        lines.push("  dropped " + (isFinite(item.start) ? item.start.toFixed(2) + "s" : "?") + " \"" + item.text + "\" (" + item.reason + ")");
      }
      if (cleaned.wordTiming === "broken-alignment") {
        lines.push("WhisperX's word alignment was noise; captions use Whisper's line times.");
      }
      log(lines.join("\n") + "\n");
    }
    return result;
  }

  function whisperWordsFromJsonText(jsonText) {
    var payload = JSON.parse(String(jsonText || "{}"));
    var words = [];

    function pushWord(item) {
      if (!item) {
        return;
      }
      var start = Number(item.start);
      var end = Number(item.end);
      if (!isFinite(start) || !isFinite(end) || end <= start) {
        return;
      }
      var text = String(item.word || item.text || "").replace(/^\s+|\s+$/g, "");
      words.push({ start: start, end: end, text: text });
    }

    if (payload.word_segments && payload.word_segments.length) {
      for (var w = 0; w < payload.word_segments.length; w++) {
        pushWord(payload.word_segments[w]);
      }
    }
    var segments = payload.segments || [];
    for (var s = 0; s < segments.length; s++) {
      var segmentWords = segments[s] && segments[s].words ? segments[s].words : [];
      for (var i = 0; i < segmentWords.length; i++) {
        pushWord(segmentWords[i]);
      }
    }
    words.sort(function (a, b) {
      return a.start - b.start;
    });
    var deduped = [];
    for (var d = 0; d < words.length; d++) {
      var previous = deduped.length ? deduped[deduped.length - 1] : null;
      if (previous && Math.abs(previous.start - words[d].start) < 0.001 && Math.abs(previous.end - words[d].end) < 0.001) {
        continue;
      }
      deduped.push(words[d]);
    }
    return deduped;
  }

  /* Whether this request named a track at all. An explicit track always wins
     ("unless I say otherwise"); with none given, a plain transcribe/caption
     request listens to the whole sequence - every audio track mixed together,
     like Premiere's own built-in transcription - rather than silently
     defaulting to just the one track configured in Settings. */
  function audioExportTrackWasRequested(action) {
    return action.audioTrack !== undefined || action.track !== undefined || action.trackIndex !== undefined;
  }

  function buildAudioTrackExport(action) {
    var nodeRequire = getNodeRequire();
    if (!nodeRequire) {
      throw new Error("Node.js is not available in this CEP panel. Check manifest CEFCommandLine.");
    }
    if (!state || !state.activeSequence || !state.activeSequence.audioTracks) {
      throw new Error(lastProjectContextError
        ? "Could not read the Premiere project: " + lastProjectContextError
        : "No active sequence audio tracks are available. Refresh the project and try again.");
    }
    if (action.type === "transcribeAudioTrackToSrt" && action.allTracks !== false && !audioExportTrackWasRequested(action)) {
      return buildSequenceAudioExport(action, nodeRequire);
    }

    var fs = nodeRequire("fs");
    var os = nodeRequire("os");
    var path = nodeRequire("path");
    var defaultTrack = getWhisperSettings().audioTrack || "A1";
    var trackIndex = normalizeAudioTrackIndex(action.audioTrack !== undefined ? action.audioTrack : action.track, action.trackIndex !== undefined ? action.trackIndex : defaultTrack);
    if (action.trackIndex !== undefined && action.audioTrack === undefined && action.track === undefined) {
      trackIndex = normalizeAudioTrackIndex(action.trackIndex, 0);
    }
    var track = state.activeSequence.audioTracks[trackIndex];
    if (!track) {
      throw new Error("Audio track A" + (trackIndex + 1) + " was not found in the active sequence.");
    }

    var sourceClips = [];
    for (var i = 0; i < (track.clips || []).length; i++) {
      var clip = track.clips[i];
      if (!clip || clip.disabled || !clip.sourcePath) {
        continue;
      }
      var clipStart = Number(clip.startSeconds || 0);
      var clipEnd = Number(clip.endSeconds || (clipStart + Number(clip.durationSeconds || 0)));
      if (clipEnd > clipStart) {
        sourceClips.push(clip);
      }
    }
    if (!sourceClips.length) {
      throw new Error("Audio track A" + (trackIndex + 1) + " has no usable source clips.");
    }
    sourceClips.sort(function (a, b) {
      return Number(a.startSeconds || 0) - Number(b.startSeconds || 0);
    });

    var firstStart = Number(sourceClips[0].startSeconds || 0);
    var lastEnd = Number(sourceClips[sourceClips.length - 1].endSeconds || firstStart);
    var rangeStart = isFinite(Number(action.startSeconds)) ? Number(action.startSeconds) : firstStart;
    var rangeEnd = isFinite(Number(action.endSeconds)) ? Number(action.endSeconds) : lastEnd;
    if (rangeEnd <= rangeStart) {
      throw new Error("Audio subtitle range is empty. Check startSeconds/endSeconds.");
    }

    var tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "PR_AI_Whisper_"));
    var concatPath = path.join(tempDir, "concat.txt");
    function cleanExportBaseName(value) {
      var name = String(value || "").replace(/\.(mp4|mov|m4v|avi|mxf|wav|mp3)$/i, "").replace(/^\s+|\s+$/g, "");
      name = name.replace(/[\/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
      if (!name || /^track$/i.test(name) || /^segment[_ -]?\d+/i.test(name)) {
        return "";
      }
      return name.substring(0, 90);
    }
    function audioExportBaseName() {
      for (var n = 0; n < sourceClips.length; n++) {
        var clipName = cleanExportBaseName(sourceClips[n].projectItemName || sourceClips[n].name || "");
        if (clipName) {
          return clipName;
        }
        var sourcePath = String(sourceClips[n].sourcePath || "");
        var fileName = sourcePath ? path.basename(sourcePath) : "";
        clipName = cleanExportBaseName(fileName);
        if (clipName) {
          return clipName;
        }
      }
      return cleanExportBaseName(state.activeSequence && state.activeSequence.name ? state.activeSequence.name + " VO" : "PR AI VO") || "PR AI VO";
    }
    var outputBaseName = audioExportBaseName();
    var outputPath = path.join(tempDir, outputBaseName + ".wav");
    var commands = [
      "set -e",
      "echo 'Checking ffmpeg...'",
      resolveFfmpegShell(),
      "echo \"ffmpeg=$FFMPEG\""
    ];
    var concatLines = [];
    var cursor = rangeStart;
    var segmentIndex = 0;

    function addSilence(duration) {
      if (duration <= 0.02) {
        return;
      }
      var segmentPath = path.join(tempDir, "segment_" + segmentIndex + "_silence.wav");
      segmentIndex++;
      commands.push("\"$FFMPEG\" -hide_banner -loglevel error -y -f lavfi -i anullsrc=r=16000:cl=mono -t " + shellQuote(duration.toFixed(3)) + " " + shellQuote(segmentPath));
      concatLines.push(ffmpegConcatPath(segmentPath));
    }

    for (var c = 0; c < sourceClips.length; c++) {
      var item = sourceClips[c];
      var start = Number(item.startSeconds || 0);
      var end = Number(item.endSeconds || start);
      if (end <= rangeStart || start >= rangeEnd) {
        continue;
      }
      var segmentTimelineStart = Math.max(start, rangeStart);
      var segmentTimelineEnd = Math.min(end, rangeEnd);
      var duration = segmentTimelineEnd - segmentTimelineStart;
      if (duration <= 0.02) {
        continue;
      }
      addSilence(segmentTimelineStart - cursor);
      var sourceIn = Number(item.inPointSeconds || 0) + Math.max(0, segmentTimelineStart - start);
      var clipPath = path.join(tempDir, "segment_" + segmentIndex + "_clip.wav");
      segmentIndex++;
      commands.push("echo 'Extracting " + String(item.name || "clip").replace(/'/g, "") + "...'");
      commands.push("\"$FFMPEG\" -hide_banner -loglevel error -y -ss " + shellQuote(sourceIn.toFixed(3)) + " -t " + shellQuote(duration.toFixed(3)) + " -i " + shellQuote(item.sourcePath) + " -vn -ac 1 -ar 16000 -acodec pcm_s16le " + shellQuote(clipPath));
      concatLines.push(ffmpegConcatPath(clipPath));
      cursor = segmentTimelineEnd;
    }

    if (!concatLines.length) {
      throw new Error("No audio clips overlap the requested subtitle range.");
    }
    writeTextFile(nodeRequire, concatPath, concatLines.join("\n") + "\n");
    commands.push("echo 'Joining audio segments...'");
    commands.push("\"$FFMPEG\" -hide_banner -loglevel error -y -f concat -safe 0 -i " + shellQuote(concatPath) + " -c copy " + shellQuote(outputPath));
    commands.push("echo audio_export=" + shellQuote(outputPath));

    return {
      command: commands.join("\n"),
      tempDir: tempDir,
      audioPath: outputPath,
      rangeStart: rangeStart,
      rangeEnd: rangeEnd,
      trackIndex: trackIndex,
      clipCount: concatLines.length,
      sourceClips: sourceClips
    };
  }

  /* One audio track's own clips laid out at their timeline positions across
     [rangeStart, rangeEnd], silence filling any gap - the same approach
     buildAudioTrackExport uses for a single track, factored out so several
     tracks can each build their own strip before being mixed into one file. */
  function buildTrackStripCommands(nodeRequire, tempDir, track, trackLabel, rangeStart, rangeEnd) {
    var path = nodeRequire("path");
    var sourceClips = [];
    for (var i = 0; i < (track.clips || []).length; i++) {
      var clip = track.clips[i];
      if (!clip || clip.disabled || !clip.sourcePath) {
        continue;
      }
      var clipStart = Number(clip.startSeconds || 0);
      var clipEnd = Number(clip.endSeconds || (clipStart + Number(clip.durationSeconds || 0)));
      if (clipEnd > rangeStart && clipStart < rangeEnd && clipEnd > clipStart) {
        sourceClips.push(clip);
      }
    }
    if (!sourceClips.length) {
      return null;
    }
    sourceClips.sort(function (a, b) {
      return Number(a.startSeconds || 0) - Number(b.startSeconds || 0);
    });
    var commands = [];
    var concatLines = [];
    var cursor = rangeStart;
    var segmentIndex = 0;
    function addSilence(duration) {
      if (duration <= 0.02) {
        return;
      }
      var segmentPath = path.join(tempDir, trackLabel + "_seg" + segmentIndex + "_silence.wav");
      segmentIndex++;
      commands.push("\"$FFMPEG\" -hide_banner -loglevel error -y -f lavfi -i anullsrc=r=16000:cl=mono -t " + shellQuote(duration.toFixed(3)) + " " + shellQuote(segmentPath));
      concatLines.push(ffmpegConcatPath(segmentPath));
    }
    for (var c = 0; c < sourceClips.length; c++) {
      var item = sourceClips[c];
      var start = Number(item.startSeconds || 0);
      var end = Number(item.endSeconds || start);
      if (end <= rangeStart || start >= rangeEnd) {
        continue;
      }
      var segmentTimelineStart = Math.max(start, rangeStart);
      var segmentTimelineEnd = Math.min(end, rangeEnd);
      var duration = segmentTimelineEnd - segmentTimelineStart;
      if (duration <= 0.02) {
        continue;
      }
      addSilence(segmentTimelineStart - cursor);
      var sourceIn = Number(item.inPointSeconds || 0) + Math.max(0, segmentTimelineStart - start);
      var clipPath = path.join(tempDir, trackLabel + "_seg" + segmentIndex + "_clip.wav");
      segmentIndex++;
      commands.push("echo 'Extracting " + trackLabel + ": " + String(item.name || "clip").replace(/'/g, "") + "...'");
      commands.push("\"$FFMPEG\" -hide_banner -loglevel error -y -ss " + shellQuote(sourceIn.toFixed(3)) + " -t " + shellQuote(duration.toFixed(3)) + " -i " + shellQuote(item.sourcePath) + " -vn -ac 1 -ar 16000 -acodec pcm_s16le " + shellQuote(clipPath));
      concatLines.push(ffmpegConcatPath(clipPath));
      cursor = segmentTimelineEnd;
    }
    if (!concatLines.length) {
      return null;
    }
    return { commands: commands, concatLines: concatLines, sourceClips: sourceClips };
  }

  /* Listens to the whole sequence, like Premiere's own built-in transcription:
     every audio track that has usable clips is extracted as its own strip
     spanning the sequence's full audible range, then mixed into one file for
     Whisper. Used only when no specific track was requested. */
  function buildSequenceAudioExport(action, nodeRequire) {
    var fs = nodeRequire("fs");
    var os = nodeRequire("os");
    var path = nodeRequire("path");
    var tracks = state.activeSequence.audioTracks || [];
    var candidateTracks = [];
    for (var t = 0; t < tracks.length; t++) {
      var track = tracks[t];
      if (!track || !(track.clips || []).length) {
        continue;
      }
      var usable = false;
      var firstStart = Infinity;
      var lastEnd = -Infinity;
      for (var i = 0; i < track.clips.length; i++) {
        var clip = track.clips[i];
        if (!clip || clip.disabled || !clip.sourcePath) {
          continue;
        }
        var clipStart = Number(clip.startSeconds || 0);
        var clipEnd = Number(clip.endSeconds || (clipStart + Number(clip.durationSeconds || 0)));
        if (clipEnd > clipStart) {
          usable = true;
          firstStart = Math.min(firstStart, clipStart);
          lastEnd = Math.max(lastEnd, clipEnd);
        }
      }
      if (usable) {
        candidateTracks.push({ index: t, track: track, firstStart: firstStart, lastEnd: lastEnd });
      }
    }
    if (!candidateTracks.length) {
      throw new Error("The active sequence has no usable audio clips on any track.");
    }

    var overallStart = Infinity;
    var overallEnd = -Infinity;
    for (var ct = 0; ct < candidateTracks.length; ct++) {
      overallStart = Math.min(overallStart, candidateTracks[ct].firstStart);
      overallEnd = Math.max(overallEnd, candidateTracks[ct].lastEnd);
    }
    var rangeStart = isFinite(Number(action.startSeconds)) ? Number(action.startSeconds) : overallStart;
    var rangeEnd = isFinite(Number(action.endSeconds)) ? Number(action.endSeconds) : overallEnd;
    if (rangeEnd <= rangeStart) {
      throw new Error("Audio subtitle range is empty. Check startSeconds/endSeconds.");
    }

    var tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "PR_AI_Whisper_"));
    var commands = [
      "set -e",
      "echo 'Checking ffmpeg...'",
      resolveFfmpegShell(),
      "echo \"ffmpeg=$FFMPEG\""
    ];
    var stripPaths = [];
    var allSourceClips = [];
    for (var ci = 0; ci < candidateTracks.length; ci++) {
      var entry = candidateTracks[ci];
      var trackLabel = "A" + (entry.index + 1);
      var strip = buildTrackStripCommands(nodeRequire, tempDir, entry.track, trackLabel, rangeStart, rangeEnd);
      if (!strip) {
        continue;
      }
      var concatPath = path.join(tempDir, trackLabel + "_concat.txt");
      writeTextFile(nodeRequire, concatPath, strip.concatLines.join("\n") + "\n");
      var stripPath = path.join(tempDir, trackLabel + "_strip.wav");
      commands = commands.concat(strip.commands);
      commands.push("echo 'Joining " + trackLabel + " segments...'");
      commands.push("\"$FFMPEG\" -hide_banner -loglevel error -y -f concat -safe 0 -i " + shellQuote(concatPath) + " -c copy " + shellQuote(stripPath));
      stripPaths.push(stripPath);
      allSourceClips = allSourceClips.concat(strip.sourceClips);
    }
    if (!stripPaths.length) {
      throw new Error("No audio clips overlap the requested subtitle range on any track.");
    }

    var outputPath = path.join(tempDir, "sequence_mix.wav");
    if (stripPaths.length === 1) {
      commands.push("cp " + shellQuote(stripPaths[0]) + " " + shellQuote(outputPath));
    } else {
      var mixInputs = [];
      for (var mi = 0; mi < stripPaths.length; mi++) {
        mixInputs.push("-i " + shellQuote(stripPaths[mi]));
      }
      commands.push("echo 'Mixing " + stripPaths.length + " audio track(s)...'");
      commands.push("\"$FFMPEG\" -hide_banner -loglevel error -y " + mixInputs.join(" ") + " -filter_complex " + shellQuote("amix=inputs=" + stripPaths.length + ":duration=longest:dropout_transition=0,volume=" + stripPaths.length) + " -ac 1 -ar 16000 " + shellQuote(outputPath));
    }
    commands.push("echo audio_export=" + shellQuote(outputPath));

    return {
      command: commands.join("\n"),
      tempDir: tempDir,
      audioPath: outputPath,
      rangeStart: rangeStart,
      rangeEnd: rangeEnd,
      trackIndex: candidateTracks[0].index,
      trackLabel: candidateTracks.map(function (ct) { return "A" + (ct.index + 1); }).join("+"),
      allTracks: true,
      clipCount: allSourceClips.length,
      sourceClips: allSourceClips
    };
  }

  function runLocalAudioSubtitleAction(action) {
    var nodeRequire = getNodeRequire();
    if (!nodeRequire) {
      return Promise.reject(new Error("Node.js is not available in this CEP panel. Check manifest CEFCommandLine."));
    }
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    var exportPlan;
    var outputDir;
    var textPath;
    var srtPath;
    var jsonPath;
    var settings = getWhisperSettings();
    if (!settings.command) {
      return Promise.reject(new Error("Whisper is not configured. Open Settings, detect/install Whisper, and test the model first."));
    }
    // Run from the palette or a shortcut, this hidden runtime may never have read the project (its panel wasn't
    // opened), and the tracks came up empty: "No active sequence audio tracks" with audio on A1 (2026-11-21, Windows).
    // Read it first, once.
    if ((!state || !state.activeSequence || !state.activeSequence.audioTracks) && !action.__projectRead) {
      return refreshProjectContextForWork({ quiet: true, skipComponents: true }).then(function () {
        if (!state || !state.activeSequence) {
          // A read that failed says why (host script not loaded, CEP unavailable), not "no sequence".
          throw new Error(lastProjectContextError
            ? "Could not read the Premiere project: " + lastProjectContextError
            : "No sequence is open. Open one in Premiere's Timeline, then run this again.");
        }
        action.__projectRead = true;
        return runLocalAudioSubtitleAction(action);
      });
    }

    try {
      selectActiveScriptForWorkflow();
      exportPlan = buildAudioTrackExport(action);
      outputDir = path.join(exportPlan.tempDir, "srt");
      nodeRequire("fs").mkdirSync(outputDir);
      textPath = path.join(exportPlan.tempDir, "script.txt");
      var scriptPayload = getScriptInputPayload();
      var providedText = action.scriptText || action.text || scriptTranscriptTextForAudioAlignment(scriptPayload);
      writeTextFile(nodeRequire, textPath, providedText);
      var customOut = path.join(outputDir, "aligned.srt");
      var whisperCommand = buildWhisperAlignCommand(exportPlan.audioPath, textPath, isWhisperxCommand(settings.command) ? outputDir : customOut);
      var exportLabel = exportPlan.trackLabel || ("A" + (exportPlan.trackIndex + 1));
      var command = [
        exportPlan.command,
        "echo 'Running Whisper on " + exportLabel + " from " + exportPlan.rangeStart.toFixed(2) + "s to " + exportPlan.rangeEnd.toFixed(2) + "s...'",
        whisperCommand,
        "echo whisper_done=1"
      ].join("\n");
      setInstallStage("model", "running", "Agent subtitle run: exporting " + exportLabel + " and running Whisper...\n");
      setStatus("Running Whisper subtitles on " + exportLabel + "...");
      return runShellStreaming(command, {
        onData: function (text) {
          appendInstallStageLog("model", text);
        }
      }).then(function () {
        var cleaned = isWhisperxCommand(settings.command) ? cleanWhisperOutputFiles(nodeRequire, outputDir, function (text) {
          appendInstallStageLog("model", text);
        }) : null;
        if (cleaned) {
          jsonPath = cleaned.jsonPath;
          if (!cleaned.kept) {
            throw new Error(cleaned.dropped.length
              ? "Whisper heard no speech: the " + cleaned.dropped.length + " line(s) it wrote were made up (e.g. \"" + cleaned.dropped[0].text + "\")."
              : "Whisper heard no speech in this audio.");
          }
        }
        srtPath = cleaned ? cleaned.srtPath : isWhisperxCommand(settings.command) ? findGeneratedSrt(nodeRequire, outputDir) : customOut;
        var contents = fs.readFileSync(srtPath, "utf8");
        var whisperContents = contents;
        var timingSource = "whisperSrtChunks";
        var alignmentWords = [];
        var originalScriptBlocks = [];
        if ((action.useProvidedText === true || action.type === "cutAudioAndTimeSubtitles") && providedText.replace(/\s+/g, "")) {
          jsonPath = jsonPath || (isWhisperxCommand(settings.command) ? findGeneratedJson(nodeRequire, outputDir) : "");
          if (jsonPath) {
            alignmentWords = whisperWordsFromJsonText(fs.readFileSync(jsonPath, "utf8"));
            originalScriptBlocks = lineBlocksFromWhisperWords(alignmentWords, providedText);
          }
          var wordTimedContents = originalScriptBlocks.length ? buildSrtFromBlocks(originalScriptBlocks) : "";
          if (wordTimedContents) {
            contents = wordTimedContents;
            timingSource = "whisperWordJsonScriptWordCounts";
          } else {
            contents = retimeProvidedTextToDetectedSrt(contents, providedText);
          }
          if (action.preserveScriptLines !== false && action.wordByWord !== true && action.reflowSubtitles !== true) {
            contents = enforceProvidedLineSrt(contents, providedText);
          }
        }
        if (!contents.replace(/\s+/g, "")) {
          throw new Error("Whisper produced an empty SRT.");
        }
        var splitItems = parseSrtBlocks(contents);
        if (!originalScriptBlocks.length) {
          originalScriptBlocks = splitItems.slice(0);
        }
        var splitPlan = { times: [], localStarts: [] };
        if (action.type === "cutAudioAndTimeSubtitles") {
          action.audioRangeDurationSeconds = exportPlan.rangeEnd - exportPlan.rangeStart;
          splitPlan = audioTextSplitPlanFromItems(splitItems, exportPlan.rangeStart, action);
          splitPlan = snapAudioSplitPlanToClipEdges(splitPlan, exportPlan.sourceClips || [], exportPlan.rangeStart, action);
          if (action.alignSubtitlesToAudioCuts !== false) {
            splitItems = alignSrtBlocksToAudioSplitPlan(splitItems, splitPlan, action);
            contents = buildSrtFromBlocks(splitItems);
            timingSource += "+subtitleStartsAlignedToAudioCuts";
          }
        }
        var captionItems = splitItems;
        var optimizedRows = (action.useProvidedText === true || action.type === "cutAudioAndTimeSubtitles") ? optimizedSubtitleRowsFromScriptPayload(scriptPayload) : [];
        if (optimizedRows.length === splitItems.length) {
          var optimizedCaptionItems = [];
          for (var optimizedRowIndex = 0; optimizedRowIndex < optimizedRows.length; optimizedRowIndex++) {
            var optimizedBlocks = optimizedCaptionBlocksForAlignedLine(
              optimizedRows[optimizedRowIndex].chunks,
              splitItems[optimizedRowIndex],
              originalScriptBlocks[optimizedRowIndex],
              alignmentWords
            );
            optimizedCaptionItems = optimizedCaptionItems.concat(optimizedBlocks);
          }
          if (optimizedCaptionItems.length) {
            captionItems = optimizedCaptionItems;
            contents = buildSrtFromBlocks(captionItems);
            timingSource += "+optimizedText";
          }
        } else if (action.type === "transcribeAudioTrackToSrt" && action.optimizeCaptions !== false) {
          /* No script was given at all - just the audio. Whisper's own blocks
             are usually full sentences, which read slowly as burned-in
             captions. Re-split each block's own text through the same
             readability-aware splitter Optimized Text uses, timed from
             Whisper's own word-level output when WhisperX provided one. */
          if (!jsonPath && isWhisperxCommand(settings.command)) {
            jsonPath = findGeneratedJson(nodeRequire, outputDir);
          }
          if (jsonPath && !alignmentWords.length) {
            try {
              alignmentWords = whisperWordsFromJsonText(fs.readFileSync(jsonPath, "utf8"));
            } catch (wordErr) {
              alignmentWords = [];
            }
          }
          var noScriptOptimizedItems = optimizedCaptionItemsFromTimedBlocks(splitItems, alignmentWords, getCaptionChunkSettings());
          if (noScriptOptimizedItems.length) {
            captionItems = noScriptOptimizedItems;
            contents = buildSrtFromBlocks(captionItems);
            timingSource += "+optimizedTextNoScript" + (alignmentWords.length ? "+wordTimed" : "+proportional");
          }
        }
        /* The old path imported `contents` but returned `srtPath`, which still
           named Whisper's raw file. Saving that result therefore preserved the
           wrong rows. Keep the raw transcription for diagnosis and write the
           exact optimized/aligned contents to a separate file atomically. */
        if (contents !== whisperContents) {
          var optimizedSrtPath = path.join(outputDir, "optimized.srt");
          var optimizedSrtTemp = optimizedSrtPath + "." + Date.now() + ".tmp";
          fs.writeFileSync(optimizedSrtTemp, contents, "utf8");
          fs.renameSync(optimizedSrtTemp, optimizedSrtPath);
          srtPath = optimizedSrtPath;
        }
        if (action.skipImport === true && action.type === "transcribeAudioTrackToSrt") {
          /* PR AI agent chat: return the SRT without touching the project. */
          if (!jsonPath && isWhisperxCommand(settings.command)) {
            try {
              jsonPath = findGeneratedJson(nodeRequire, outputDir);
            } catch (jsonErr) {
              jsonPath = "";
            }
          }
          setInstallStage("model", "done", (els.modelInstallLog.textContent || "") + "\nWrote SRT (not imported): " + srtPath);
          return {
            localAction: action.type,
            track: exportLabel,
            sequenceName: state && state.activeSequence ? state.activeSequence.name : "",
            rangeStart: exportPlan.rangeStart,
            rangeEnd: exportPlan.rangeEnd,
            srtPath: srtPath,
            jsonPath: jsonPath || "",
            timingSource: timingSource,
            subtitleCount: captionItems.length,
            contents: contents
          };
        }
        var hostActions = [{
            type: "importSrtFile",
            contents: contents,
            startAtTime: exportPlan.rangeStart,
            createCaptionTrack: action.createCaptionTrack !== false,
            allowCaptionTrackCreate: true,
            suppressUI: action.suppressUI !== false,
            cleanupAfterImport: false,
            removeProjectItemAfterCaptionTrack: false,
            source: "whisperAgent",
            audioTrack: exportLabel
          }];
        var notesTrackAdded = false;
        if (action.createCaptionTrack !== false && scriptWantsNotesTrack()) {
          var notesRowsForTrack = scriptNotesRowsFromScriptPayload(scriptPayload);
          var notesCaptionItems = notesCaptionItemsFromAlignedBlocks(notesRowsForTrack, splitItems);
          if (notesCaptionItems.length) {
            hostActions.push({
              type: "importSrtFile",
              contents: buildSrtFromBlocks(notesCaptionItems),
              startAtTime: exportPlan.rangeStart,
              createCaptionTrack: true,
              allowCaptionTrackCreate: true,
              suppressUI: action.suppressUI !== false,
              cleanupAfterImport: false,
              removeProjectItemAfterCaptionTrack: false,
              source: "scriptNotesTrack",
              functionName: "Notes - delete before export"
            });
            notesTrackAdded = true;
          }
        }
        if (action.type === "cutAudioAndTimeSubtitles") {
          hostActions.push({
            type: "splitTrackAtTimes",
            trackType: "audio",
            trackIndex: exportPlan.trackIndex,
            times: splitPlan.times,
            epsilonSeconds: 0.01,
            source: "whisperTimedAudioCuts"
          });
        }
    var payload = attachTextTempFolder({ actions: hostActions });
    attachTargetSequence(payload);
    return evalHost("prAI_applyActions", payload).then(function (result) {
          if (!result.ok) {
            throw new Error(result.error || "Caption import failed.");
          }
          if (action.type === "cutAudioAndTimeSubtitles" && result.data && result.data.failed && result.data.failed.length) {
            for (var f = 0; f < result.data.failed.length; f++) {
              if (result.data.failed[f] && result.data.failed[f].type === "splitTrackAtTimes") {
                throw new Error(result.data.failed[f].error || "Audio splitting failed.");
              }
            }
          }
          setInstallStage("model", "done", (els.modelInstallLog.textContent || "") + "\nImported SRT from " + srtPath);
          if (notesTrackAdded) {
            warnIfNotesTrackMayAlreadyExist(activeScriptId);
          }
          return {
            localAction: action.type,
            track: exportLabel,
            rangeStart: exportPlan.rangeStart,
            rangeEnd: exportPlan.rangeEnd,
            srtPath: srtPath,
            jsonPath: jsonPath || "",
            timingSource: timingSource,
            subtitleCount: captionItems.length,
            notesTrackAdded: notesTrackAdded,
            importResult: result.data
          };
        });
      });
    } catch (err) {
      return Promise.reject(err);
    }
  }

  /* includeSilentRows: also plan rows whose Text is empty/"None" (b-roll with
     no voiceover). Only the timeline builder wants these; Full Process aligns
     one audio block per spoken line and must not see them. */
  function rowMediaPlansFromScript(scriptPayload, options) {
    scriptPayload = scriptPayload || getScriptInputPayload();
    var includeSilentRows = !!(options && options.includeSilentRows);
    var model = canonicalScriptModel(scriptPayload);
    var plans = [];
    if (model.columns.source < 0 || model.columns.cut < 0 || model.columns.text < 0) {
      return plans;
    }
    function mediaClipsForUnit(unit) {
      var sourceText = unit.sourceText;
      var cutText = unit.cutText;
      var sourceLines = scriptSourceLines(sourceText);
      var cut = parseCutDurationSeconds(cutText);
      if (model.columns.source === model.columns.cut && !cut.ranges.length && firstScriptSourceName(sourceText)) {
        cut.ranges = defaultCompactScriptRanges(sourceLines, 3);
        cut.unresolved = [];
      }
      if (!cut.ranges.length && !String(cutText || "").replace(/^\s+|\s+$/g, "") && sourceLines.length) {
        cut.ranges = [];
        for (var autoRangeIndex = 0; autoRangeIndex < sourceLines.length; autoRangeIndex++) {
          if (String(sourceLines[autoRangeIndex] || "").replace(/^\s+|\s+$/g, "")) {
            cut.ranges.push({ start: 0, end: 0, sourceLineIndex: autoRangeIndex, autoDuration: true });
          }
        }
        cut.unresolved = [];
      }
      var clips = [];
      var mediaDuration = 0;
      for (var r = 0; r < cut.ranges.length; r++) {
        var range = cut.ranges[r];
        var pairedSourceIndex = range.sourceLineIndex !== undefined ? Number(range.sourceLineIndex) : Number(range.lineIndex || 0);
        var rangeSources = String(sourceLines[pairedSourceIndex] || sourceLines[sourceLines.length - 1] || sourceLines[0] || "").split("\n");
        for (var rs = 0; rs < rangeSources.length; rs++) {
          var sourceName = rangeSources[rs].replace(/^\s+|\s+$/g, "");
          if (!sourceName) {
            continue;
          }
          var item = findProjectItemForScriptSource(sourceName);
          var duration = Math.max(0, Number(range.end) - Number(range.start));
          mediaDuration += duration;
          clips.push({
            row: unit.row,
            source: sourceName,
            projectItemName: item && item.name ? item.name : sourceName,
            projectItemId: item && item.nodeId ? item.nodeId : "",
            sourcePath: item && (item.mediaPath || item.path) ? (item.mediaPath || item.path) : "",
            resolved: !!item,
            inPointSeconds: Number(range.start),
            outPointSeconds: Number(range.end),
            sourceRangeMode: "offset",
            durationSeconds: duration,
            autoDuration: !!range.autoDuration
          });
        }
      }
      return {
        sourceText: sourceText,
        cutText: cutText,
        mediaDuration: mediaDuration,
        clips: clips
      };
    }
    for (var g = 0; g < model.groups.length; g++) {
      var group = model.groups[g];
      var allClips = [];
      var mediaDuration = 0;
      for (var u = 0; u < group.mediaUnits.length; u++) {
        var mediaPlan = mediaClipsForUnit(group.mediaUnits[u]);
        mediaDuration += mediaPlan.mediaDuration;
        allClips = allClips.concat(mediaPlan.clips);
      }
      if (!group.lines.length && includeSilentRows && allClips.length) {
        plans.push({
          row: group.mediaUnits[0].row,
          rowIndex: group.mediaUnits[0].rowIndex,
          text: "",
          optimizedText: "",
          subtitleChunks: [],
          mediaGroupKey: group.key,
          mediaSignature: "",
          mediaDuration: mediaDuration,
          clips: allClips,
          silent: true
        });
      }
      for (var l = 0; l < group.lines.length; l++) {
        var line = group.lines[l];
        plans.push({
          row: line.row,
          rowIndex: line.rowIndex,
          text: line.text,
          optimizedText: line.optimizedText,
          subtitleChunks: line.subtitleChunks && line.subtitleChunks.length ? line.subtitleChunks : [line.text],
          mediaGroupKey: group.key,
          mediaSignature: "",
          mediaDuration: mediaDuration,
          clips: allClips
        });
      }
    }
    return plans;
  }

  function audioMoveActionsForTimelineRange(sourceClips, timelineStart, timelineEnd, destinationStart, trackIndex) {
    var actions = [];
    for (var i = 0; i < sourceClips.length; i++) {
      var clip = sourceClips[i];
      var clipStart = Number(clip.startSeconds || 0);
      var clipEnd = Number(clip.endSeconds || clipStart);
      if (clipEnd <= timelineStart || clipStart >= timelineEnd) {
        continue;
      }
      var partStart = Math.max(timelineStart, clipStart);
      var partEnd = Math.min(timelineEnd, clipEnd);
      var duration = partEnd - partStart;
      if (duration <= 0.02) {
        continue;
      }
      actions.push({
        type: "moveClip",
        trackType: "audio",
        trackIndex: trackIndex,
        clipName: clip.name || clip.projectItemName || "",
        projectItemId: clip.projectItemId || "",
        projectItemName: clip.projectItemName || clip.name || "",
        targetStartSeconds: partStart,
        originalStartSeconds: partStart,
        startSeconds: destinationStart + (partStart - timelineStart),
        durationSeconds: duration,
        sourceTimelineEndSeconds: partEnd,
        abortOnFailure: true
      });
    }
    return actions;
  }

  function audioBoundaryCrossesSourceClip(sourceClips, seconds) {
    for (var i = 0; i < sourceClips.length; i++) {
      var clipStart = Number(sourceClips[i].startSeconds || 0);
      var clipEnd = Number(sourceClips[i].endSeconds || clipStart);
      if (seconds > clipStart + 0.02 && seconds < clipEnd - 0.02) {
        return true;
      }
    }
    return false;
  }

  function validateFullProcessPlan(plan) {
    var tolerance = 0.05;
    var ranges = plan.lineRanges || [];
    var audioDuration = Number(plan.audioDuration || 0);
    if (!ranges.length || ranges.length !== Number(plan.rowCount || 0)) {
      throw new Error("Full Process safety check failed: audio row ranges are incomplete.");
    }
    if (Math.abs(Number(ranges[0].start || 0)) > tolerance || Math.abs(Number(ranges[ranges.length - 1].end || 0) - audioDuration) > tolerance) {
      throw new Error("Full Process safety check failed: the plan does not preserve the complete audio head and tail.");
    }
    for (var r = 0; r < ranges.length; r++) {
      var rangeStart = Number(ranges[r].start || 0);
      var rangeEnd = Number(ranges[r].end || 0);
      if (rangeEnd <= rangeStart) {
        throw new Error("Full Process safety check failed: audio row " + (r + 1) + " has an empty range.");
      }
      if (r > 0 && Math.abs(Number(ranges[r - 1].end || 0) - rangeStart) > tolerance) {
        throw new Error("Full Process safety check failed: audio row ranges contain a gap or overlap.");
      }
    }

    var expectedSourceDuration = 0;
    var sourceClips = plan.sourceClips || [];
    for (var sc = 0; sc < sourceClips.length; sc++) {
      var clipStart = Number(sourceClips[sc].startSeconds || 0);
      var clipEnd = Number(sourceClips[sc].endSeconds || clipStart);
      expectedSourceDuration += Math.max(0, Math.min(Number(plan.rangeEnd), clipEnd) - Math.max(Number(plan.rangeStart), clipStart));
    }
    var plannedSourceDuration = 0;
    var moveActions = plan.audioMoveActions || [];
    var seenIntervals = {};
    for (var ma = 0; ma < moveActions.length; ma++) {
      var move = moveActions[ma];
      var intervalKey = String(move.projectItemId || move.projectItemName || move.clipName || "") + "@" + Number(move.targetStartSeconds || 0).toFixed(3);
      if (seenIntervals[intervalKey]) {
        throw new Error("Full Process safety check failed: an audio source interval was planned more than once.");
      }
      seenIntervals[intervalKey] = true;
      plannedSourceDuration += Math.max(0, Number(move.durationSeconds || 0));
    }
    var durationTolerance = Math.max(0.08, moveActions.length * 0.01);
    if (Math.abs(expectedSourceDuration - plannedSourceDuration) > durationTolerance) {
      throw new Error("Full Process safety check failed: planned audio coverage changed from " + expectedSourceDuration.toFixed(3) + "s to " + plannedSourceDuration.toFixed(3) + "s.");
    }

    var hostActions = plan.hostActions || [];
    for (var ha = 0; ha < hostActions.length; ha++) {
      var action = hostActions[ha] || {};
      var type = String(action.type || "");
      var trackType = String(action.trackType || "video");
      if ((type === "clearTrack" || type === "deleteTrackRange" || type === "deleteClip") && (trackType === "audio" || trackType === "both")) {
        throw new Error("Full Process safety check failed: destructive audio action " + type + " is forbidden.");
      }
      if ((type === "insertClipRange" || type === "insertProjectItem" || type === "overwriteClipRange" || type === "assembleFromScript") && trackType === "audio") {
        throw new Error("Full Process safety check failed: replacement audio insertion is forbidden.");
      }
      if ((type === "importSrtFile" || type === "importCaptionFile") && (action.cleanupAfterImport === true || action.removeProjectItemAfterCaptionTrack === true || action.deleteSrtAfterImport === true)) {
        throw new Error("Full Process safety check failed: SRT cleanup is forbidden.");
      }
    }
  }

  function paddedAudioLineRanges(blocks, audioDuration, headPad, tailPad) {
    var ranges = [];
    var boundaries = [];
    if (!blocks || !blocks.length) {
      return ranges;
    }
    audioDuration = Math.max(0.12, Number(audioDuration || 0));
    headPad = Math.max(0, Number(headPad || 0));
    tailPad = Math.max(0, Number(tailPad || 0));
    // Full Process must preserve the complete provided audio. Whisper only
    // chooses internal cuts; pre-roll belongs to the first row and the full
    // remaining tail belongs to the last row.
    boundaries[0] = 0;
    for (var i = 1; i < blocks.length; i++) {
      var previousStart = Number(blocks[i - 1].start || 0);
      var previousEnd = Math.max(previousStart, Number(blocks[i - 1].end || previousStart));
      var currentStart = Math.max(previousStart, Number(blocks[i].start || previousEnd));
      var boundary;
      if (currentStart > previousEnd + 0.02) {
        var paddedNextStart = currentStart - headPad;
        var paddedPreviousEnd = previousEnd + tailPad;
        boundary = paddedNextStart >= paddedPreviousEnd
          ? paddedNextStart
          : previousEnd + (currentStart - previousEnd) * 0.5;
      } else {
        boundary = currentStart - Math.min(headPad, 0.12);
      }
      boundary = Math.max(boundaries[i - 1] + 0.06, boundary);
      boundary = Math.min(audioDuration, boundary);
      boundaries[i] = boundary;
    }
    boundaries[blocks.length] = audioDuration;
    for (var b = blocks.length - 1; b > 0; b--) {
      if (boundaries[b + 1] - boundaries[b] < 0.06) {
        boundaries[b] = Math.max(boundaries[b - 1] + 0.02, boundaries[b + 1] - 0.06);
      }
    }
    for (var r = 0; r < blocks.length; r++) {
      ranges.push({
        start: boundaries[r],
        end: Math.max(boundaries[r] + 0.02, boundaries[r + 1]),
        rawStart: Number(blocks[r].start || 0),
        rawEnd: Number(blocks[r].end || blocks[r].start || 0)
      });
    }
    return ranges;
  }

  function automaticMediaDurationForGroup(audioDuration, fixedDuration, automaticClipCount) {
    var count = Math.max(0, Number(automaticClipCount || 0));
    if (!count) {
      return 0;
    }
    return Math.max(0.04, Math.max(0, Number(audioDuration || 0) - Number(fixedDuration || 0)) / count);
  }

  function fullProcessMediaResolutionPolicy(totalClipCount, resolvedClipCount, retryableClipCount) {
    var total = Math.max(0, Number(totalClipCount || 0));
    var resolved = Math.max(0, Math.min(total, Number(resolvedClipCount || 0)));
    var missing = Math.max(0, total - resolved);
    var retryable = Math.max(0, Math.min(missing, Number(retryableClipCount || 0)));
    var rate = total > 0 ? resolved / total : 0;
    return {
      total: total,
      resolved: resolved,
      missing: missing,
      retryable: retryable,
      resolutionRate: rate,
      canProceed: total > 0 && (resolved > 0 || retryable > 0) && (missing === 0 || rate >= 0.7 || retryable === missing)
    };
  }

  function runLocalFullProcessRowsAction(action) {
    var nodeRequire = getNodeRequire();
    if (!nodeRequire) {
      return Promise.reject(new Error("Node.js is not available in this CEP panel. Check manifest CEFCommandLine."));
    }
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    var settings = getWhisperSettings();
    if (!settings.command) {
      return Promise.reject(new Error("Whisper is not configured. Open Settings, detect/install Whisper, and test the model first."));
    }
    var exportPlan;
    var outputDir;
    var textPath;
    var jsonPath = "";
    try {
      selectActiveScriptForWorkflow();
      var scriptPayload = getScriptInputPayload();
      var rowPlans = rowMediaPlansFromScript(scriptPayload);
      if (!rowPlans.length) {
        var rows = scriptPayload.tableRows || [];
        var roles = scriptPayload.columnRoles || [];
        var failedColumns = canonicalScriptColumnMap(scriptPayload);
        var sourceIndex = failedColumns.source;
        var cutIndex = failedColumns.cut;
        var textIndex = failedColumns.text;
        throw new Error("Full Process could not parse script rows. rows=" + rows.length + ", sourceIndex=" + sourceIndex + ", cutIndex=" + cutIndex + ", textIndex=" + textIndex + ", roles=" + JSON.stringify(roles || []));
      }
      var checkedMediaGroups = {};
      var totalMediaClips = 0;
      for (var rp = 0; rp < rowPlans.length; rp++) {
        if (checkedMediaGroups[rowPlans[rp].mediaGroupKey]) {
          continue;
        }
        checkedMediaGroups[rowPlans[rp].mediaGroupKey] = true;
        for (var pc = 0; pc < (rowPlans[rp].clips || []).length; pc++) {
          var plannedClip = rowPlans[rp].clips[pc];
          totalMediaClips++;
        }
      }
      if (!totalMediaClips) {
        throw new Error("Full Process found script text but no usable Source/Cut footage ranges. Nothing was changed.");
      }
      var unresolvedMedia = [];
      var unresolvedMediaClipCount = 0;
      var resolvedMediaClipCount = 0;
      var checkedResolvedGroups = {};
      for (var ur = 0; ur < rowPlans.length; ur++) {
        if (checkedResolvedGroups[rowPlans[ur].mediaGroupKey]) {
          continue;
        }
        checkedResolvedGroups[rowPlans[ur].mediaGroupKey] = true;
        for (var uc = 0; uc < (rowPlans[ur].clips || []).length; uc++) {
          var unresolvedClip = rowPlans[ur].clips[uc];
          if (unresolvedClip.resolved) {
            resolvedMediaClipCount++;
          } else {
            unresolvedMediaClipCount++;
            if (unresolvedMedia.indexOf(unresolvedClip.source) === -1) {
              unresolvedMedia.push(unresolvedClip.source);
            }
          }
        }
      }
      var mediaResolutionPolicy = fullProcessMediaResolutionPolicy(resolvedMediaClipCount + unresolvedMediaClipCount, resolvedMediaClipCount, unresolvedMediaClipCount);
      if (!mediaResolutionPolicy.canProceed) {
        throw new Error("Full Process resolved only " + mediaResolutionPolicy.resolved + "/" + mediaResolutionPolicy.total + " footage clips after refreshing the entire Premiere project. Unresolved: " + unresolvedMedia.slice(0, 12).join(", ") + ". Nothing was changed to prevent a mostly empty timeline.");
      }
      var transcript = "";
      for (var rt = 0; rt < rowPlans.length; rt++) {
        transcript += (transcript ? "\n" : "") + rowPlans[rt].text;
      }
      exportPlan = buildAudioTrackExport(action);
      outputDir = path.join(exportPlan.tempDir, "srt");
      fs.mkdirSync(outputDir);
      textPath = path.join(exportPlan.tempDir, "script.txt");
      writeTextFile(nodeRequire, textPath, transcript);
      var customOut = path.join(outputDir, "aligned.srt");
      var whisperCommand = buildWhisperAlignCommand(exportPlan.audioPath, textPath, isWhisperxCommand(settings.command) ? outputDir : customOut);
      var command = [
        exportPlan.command,
        "echo 'Running Full Process Whisper alignment on A" + (exportPlan.trackIndex + 1) + "...'",
        whisperCommand,
        "echo whisper_done=1"
      ].join("\n");
      setInstallStage("model", "running", "Full Process: exporting A" + (exportPlan.trackIndex + 1) + " and aligning rows...\n");
      setStatus("Running Full Process alignment...");
      return runShellStreaming(command, {
        onData: function (text) {
          appendInstallStageLog("model", text);
        }
      }).then(function () {
        var cleaned = isWhisperxCommand(settings.command) ? cleanWhisperOutputFiles(nodeRequire, outputDir, function (text) {
          appendInstallStageLog("model", text);
        }) : null;
        jsonPath = cleaned ? cleaned.jsonPath : isWhisperxCommand(settings.command) ? findGeneratedJson(nodeRequire, outputDir) : "";
        var words = jsonPath ? whisperWordsFromJsonText(fs.readFileSync(jsonPath, "utf8")) : [];
        var detectedSrt = fs.readFileSync(cleaned ? cleaned.srtPath : isWhisperxCommand(settings.command) ? findGeneratedSrt(nodeRequire, outputDir) : customOut, "utf8");
        var audioBlocks = words.length ? lineBlocksFromWhisperWords(words, transcript) : parseSrtBlocks(retimeProvidedTextToDetectedSrt(detectedSrt, transcript));
        if (!audioBlocks.length) {
          throw new Error("Full Process could not align script rows to audio.");
        }
        if (audioBlocks.length !== rowPlans.length) {
          var forcedContents = retimeProvidedTextToDetectedSrt(buildSrtFromBlocks(audioBlocks), transcript);
          audioBlocks = parseSrtBlocks(forcedContents);
        }
        if (audioBlocks.length !== rowPlans.length && words.length) {
          audioBlocks = lineBlocksFromWhisperWordCounts(words, transcript);
        }
        if (audioBlocks.length !== rowPlans.length) {
          var detectedStart = audioBlocks.length ? Number(audioBlocks[0].start || 0) : 0;
          var detectedEnd = audioBlocks.length ? Number(audioBlocks[audioBlocks.length - 1].end || detectedStart) : Math.max(0.12, exportPlan.rangeEnd - exportPlan.rangeStart);
          var detectedDuration = Math.max(0.12, detectedEnd - detectedStart);
          audioBlocks = [];
          for (var fallbackLine = 0; fallbackLine < rowPlans.length; fallbackLine++) {
            audioBlocks.push({
              start: detectedStart + detectedDuration * fallbackLine / rowPlans.length,
              end: detectedStart + detectedDuration * (fallbackLine + 1) / rowPlans.length,
              text: rowPlans[fallbackLine].text,
              alignmentMethod: "scriptRowFallback"
            });
          }
        }
        var count = rowPlans.length;
        var videoTrackIndex = Number(action.videoTrackIndex !== undefined ? action.videoTrackIndex : (action.trackIndex !== undefined ? action.trackIndex : 0));
        var hasRequestedStart = action.startSeconds !== undefined && action.startSeconds !== null && action.startSeconds !== "";
        var timelineStart = hasRequestedStart ? Number(action.startSeconds) : Number(exportPlan.rangeStart || 0);
        var timelineCursor = timelineStart;
        var mediaActions = [];
        var audioMoveActions = [];
        var audioSplitTimes = [];
        var srtBlocks = [];
        var notesSrtBlocks = [];
        var notesTextByRow = {};
        if (scriptWantsNotesTrack()) {
          var notesRowsForFullProcess = scriptNotesRowsFromScriptPayload(scriptPayload);
          for (var nr = 0; nr < notesRowsForFullProcess.length; nr++) {
            if (notesRowsForFullProcess[nr].text) {
              notesTextByRow[notesRowsForFullProcess[nr].row] = notesRowsForFullProcess[nr].text;
            }
          }
        }
        var mediaInsertCount = 0;
        var deferredMediaClips = [];
        var audioMoveCount = 0;
        var finalRows = [];
        var audioHeadPad = Math.max(0, finiteNumber(action.audioHeadPadSeconds, settings.audioHeadPadSeconds !== undefined ? settings.audioHeadPadSeconds : 0.25));
        var audioTailPad = Math.max(0, finiteNumber(action.audioTailPadSeconds, settings.audioTailPadSeconds !== undefined ? settings.audioTailPadSeconds : 0.25));
        var lineRanges = paddedAudioLineRanges(audioBlocks.slice(0, count), exportPlan.rangeEnd - exportPlan.rangeStart, audioHeadPad, audioTailPad);
        for (var i = 0; i < count;) {
          var groupStartIndex = i;
          var groupKey = rowPlans[i].mediaGroupKey || ("row:" + i);
          var groupMediaSignature = rowPlans[i].mediaSignature || "";
          var groupEndIndex = i + 1;
          while (groupEndIndex < count && (
            (rowPlans[groupEndIndex].mediaGroupKey || ("row:" + groupEndIndex)) === groupKey ||
            (groupMediaSignature && rowPlans[groupEndIndex].mediaSignature === groupMediaSignature)
          )) {
            groupEndIndex++;
          }

          var groupStartTime = timelineCursor;
          var groupAudioDuration = 0;
          var groupMediaDuration = 0;
          var groupAlignedAudioDuration = 0;
          var groupClips = [];
          for (var gi = groupStartIndex; gi < groupEndIndex; gi++) {
            var row = rowPlans[gi];
            var alignedRange = lineRanges[gi];
            groupAlignedAudioDuration += Math.max(0.02, alignedRange.end - alignedRange.start);
            if (!groupClips.length && row.clips && row.clips.length) {
              groupClips = row.clips;
              groupMediaDuration = Number(row.mediaDuration || 0);
            }
          }

          var fixedMediaDuration = 0;
          var automaticMediaCount = 0;
          for (var durationIndex = 0; durationIndex < groupClips.length; durationIndex++) {
            if (groupClips[durationIndex].autoDuration) {
              automaticMediaCount++;
            } else {
              fixedMediaDuration += Math.max(0, Number(groupClips[durationIndex].durationSeconds || 0));
            }
          }
          var automaticMediaDuration = automaticMediaDurationForGroup(groupAlignedAudioDuration, fixedMediaDuration, automaticMediaCount);
          if (automaticMediaCount) {
            groupMediaDuration = fixedMediaDuration + automaticMediaDuration * automaticMediaCount;
          }

          var mediaCursor = groupStartTime;
          for (var c = 0; c < groupClips.length; c++) {
            var media = groupClips[c];
            var mediaDuration = media.autoDuration ? automaticMediaDuration : Number(media.durationSeconds || 0);
            var mediaInPoint = media.autoDuration ? 0 : Number(media.inPointSeconds || 0);
            var mediaOutPoint = media.autoDuration ? mediaDuration : Number(media.outPointSeconds || 0);
            if (mediaDuration <= 0) {
              continue;
            }
            if (!media.resolved) {
              deferredMediaClips.push({
                row: media.row,
                source: media.source,
                startSeconds: mediaCursor,
                durationSeconds: mediaDuration,
                reason: "Source was not found in the panel snapshot; Premiere will retry the literal name against the live project tree."
              });
            }
            mediaActions.push({
              type: "insertClipRange",
              trackType: "video",
              trackIndex: videoTrackIndex,
              seconds: mediaCursor,
              projectItemId: media.resolved ? media.projectItemId : "",
              projectItemName: media.resolved ? media.projectItemName : media.source,
              sourcePath: media.resolved ? media.sourcePath : "",
              sourceReference: media.source,
              strictProjectItemLookup: true,
              inPointSeconds: mediaInPoint,
              outPointSeconds: mediaOutPoint,
              sourceRangeMode: "offset",
              linked: true
            });
            mediaCursor += mediaDuration;
            mediaInsertCount++;
          }

          var audioCursor = groupStartTime;
          for (var gr = groupStartIndex; gr < groupEndIndex; gr++) {
            var groupRow = rowPlans[gr];
            var sourceRange = lineRanges[gr];
            var lineDuration = Math.max(0.02, sourceRange.end - sourceRange.start);
            var sourceTimelineStart = exportPlan.rangeStart + sourceRange.start;
            var sourceTimelineEnd = exportPlan.rangeStart + sourceRange.end;
            if (audioBoundaryCrossesSourceClip(exportPlan.sourceClips || [], sourceTimelineStart)) {
              audioSplitTimes.push(sourceTimelineStart);
            }
            if (audioBoundaryCrossesSourceClip(exportPlan.sourceClips || [], sourceTimelineEnd)) {
              audioSplitTimes.push(sourceTimelineEnd);
            }
            var originalAudioActions = audioMoveActionsForTimelineRange(
              exportPlan.sourceClips || [],
              sourceTimelineStart,
              sourceTimelineEnd,
              audioCursor,
              exportPlan.trackIndex
            );
            if (!originalAudioActions.length) {
              throw new Error("Full Process could not map script row " + groupRow.row + " back to the original audio near " + (exportPlan.rangeStart + sourceRange.start).toFixed(2) + "s.");
            }
            for (var oa = 0; oa < originalAudioActions.length; oa++) {
              audioMoveActions.push(originalAudioActions[oa]);
            }
            audioMoveCount += originalAudioActions.length;
            var subtitleStart = audioCursor;
            var subtitleEnd = audioCursor + lineDuration;
            var optimizedLineBlocks = optimizedCaptionBlocksForAlignedLine(
              groupRow.subtitleChunks && groupRow.subtitleChunks.length ? groupRow.subtitleChunks : [groupRow.text],
              { start: subtitleStart, end: subtitleEnd, text: groupRow.text },
              audioBlocks[gr],
              words
            );
            if (optimizedLineBlocks.length) {
              srtBlocks = srtBlocks.concat(optimizedLineBlocks);
            } else {
              srtBlocks.push({ start: subtitleStart, end: subtitleEnd, text: groupRow.text });
            }
            if (notesTextByRow[groupRow.row]) {
              /* One full, unsplit block per row - never run through the
                 optimized-text splitter, unlike the dialogue captions above. */
              notesSrtBlocks.push({ start: subtitleStart, end: subtitleEnd, text: notesTextByRow[groupRow.row] });
            }
            finalRows.push({ row: groupRow.row, startSeconds: subtitleStart, endSeconds: subtitleEnd, audioDuration: subtitleEnd - subtitleStart, mediaDuration: gr === groupStartIndex ? groupMediaDuration : 0, clipCount: gr === groupStartIndex ? groupClips.length : 0, mediaGroupKey: groupKey });
            audioCursor = subtitleEnd;
          }
          groupAudioDuration = audioCursor - groupStartTime;
          timelineCursor = groupStartTime + Math.max(groupAudioDuration, groupMediaDuration);
          i = groupEndIndex;
        }
        var finalDuration = timelineCursor - timelineStart;
        var clearDuration = Math.max(finalDuration, exportPlan.rangeEnd - exportPlan.rangeStart);
        audioSplitTimes.sort(function (a, b) { return a - b; });
        var uniqueSplitTimes = [];
        for (var st = 0; st < audioSplitTimes.length; st++) {
          if (!uniqueSplitTimes.length || Math.abs(uniqueSplitTimes[uniqueSplitTimes.length - 1] - audioSplitTimes[st]) > 0.01) {
            uniqueSplitTimes.push(audioSplitTimes[st]);
          }
        }
        audioMoveActions.sort(function (a, b) {
          return Number(b.targetStartSeconds || 0) - Number(a.targetStartSeconds || 0);
        });
        var hostActions = [];
        if (uniqueSplitTimes.length) {
          hostActions.push({
            type: "splitTrackAtTimes",
            trackType: "audio",
            trackIndex: exportPlan.trackIndex,
            times: uniqueSplitTimes,
            requireAllSplits: true,
            abortOnFailure: true
          });
        }
        for (var ai = 0; ai < audioMoveActions.length; ai++) {
          hostActions.push(audioMoveActions[ai]);
        }
        hostActions.push({
          type: "deleteTrackRange",
          trackType: "video",
          trackIndex: videoTrackIndex,
          startSeconds: timelineStart,
          endSeconds: timelineStart + clearDuration + 0.5,
          mode: "overlap",
          ripple: false,
          linked: false,
          abortOnFailure: true
        });
        hostActions.push({
          type: "importSrtFile",
          contents: buildSrtFromBlocks(srtBlocks),
          startAtTime: 0,
          createCaptionTrack: action.createCaptionTrack !== false,
          allowCaptionTrackCreate: true,
          suppressUI: action.suppressUI !== false,
          cleanupAfterImport: false,
          removeProjectItemAfterCaptionTrack: false,
          source: "fullProcessScriptRows",
          abortOnFailure: true
        });
        var fullProcessNotesTrackAdded = false;
        if (action.createCaptionTrack !== false && notesSrtBlocks.length) {
          hostActions.push({
            type: "importSrtFile",
            contents: buildSrtFromBlocks(notesSrtBlocks),
            startAtTime: 0,
            createCaptionTrack: true,
            allowCaptionTrackCreate: true,
            suppressUI: action.suppressUI !== false,
            cleanupAfterImport: false,
            removeProjectItemAfterCaptionTrack: false,
            source: "scriptNotesTrack",
            functionName: "Notes - delete before export",
            abortOnFailure: false
          });
          fullProcessNotesTrackAdded = true;
        }
        for (var mi = 0; mi < mediaActions.length; mi++) {
          mediaActions[mi].abortOnFailure = false;
          hostActions.push(mediaActions[mi]);
        }
        validateFullProcessPlan({
          rowCount: count,
          lineRanges: lineRanges,
          audioDuration: exportPlan.rangeEnd - exportPlan.rangeStart,
          rangeStart: exportPlan.rangeStart,
          rangeEnd: exportPlan.rangeEnd,
          sourceClips: exportPlan.sourceClips || [],
          audioMoveActions: audioMoveActions,
          hostActions: hostActions
        });
        var payload = attachTextTempFolder({
          actions: hostActions,
          protections: {
            workflow: "fullProcessScriptRows",
            preserveAudioTrackIndex: exportPlan.trackIndex,
            preserveImportedSrt: true
          }
        });
        attachTargetSequence(payload);
        return evalHost("prAI_applyActions", payload).then(function (result) {
          if (!result.ok) {
            throw new Error(result.error || "Full Process apply failed.");
          }
          var failed = result.data && result.data.failed ? result.data.failed : [];
          var failedVideoInserts = [];
          var failedVideoSources = [];
          var failedAudioEdits = [];
          for (var fi = 0; fi < failed.length; fi++) {
            var failedAction = failed[fi] || {};
            if (failedAction.type === "insertClipRange") {
              failedVideoInserts.push(failedAction.error || "Video insert failed.");
              failedVideoSources.push(failedAction.sourceReference || failedAction.projectItemName || "Unknown source");
            } else if (failedAction.type === "splitTrackAtTimes" || failedAction.type === "moveClip") {
              failedAudioEdits.push(failedAction.error || "Audio edit failed.");
            }
          }
          if (failedAudioEdits.length) {
            throw new Error("Full Process preserved the source audio but could not finish its cuts/moves: " + failedAudioEdits.slice(0, 3).join(" | "));
          }
          var successfulMediaInsertCount = Math.max(0, mediaInsertCount - failedVideoInserts.length);
          if (!successfulMediaInsertCount) {
            throw new Error("Full Process found audio/subtitle rows but no footage ranges. Check Source File and Cut from Source columns.");
          }
          var skippedMediaClips = [];
          for (var fvi = 0; fvi < failedVideoSources.length; fvi++) {
            skippedMediaClips.push({
              source: failedVideoSources[fvi],
              reason: failedVideoInserts[fvi] || "Premiere could not resolve the literal source name."
            });
          }
          if (skippedMediaClips.length) {
            appendMessage("system", "Full Process placed " + successfulMediaInsertCount + "/" + mediaInsertCount + " footage clips. Only these literal sources remained unresolved after Premiere's live-project retry: " + failedVideoSources.slice(0, 12).join(", ") + ". Their durations remain empty gaps; later sources were still processed.");
          }
          setInstallStage("model", "done", (els.modelInstallLog.textContent || "") + "\nFull Process rows: " + count + "\nMedia inserts: " + successfulMediaInsertCount + "/" + mediaInsertCount + "\nLive lookup retries: " + deferredMediaClips.length + "\nMedia gaps: " + skippedMediaClips.length + "\nAudio pieces moved: " + audioMoveCount);
          if (fullProcessNotesTrackAdded) {
            warnIfNotesTrackMayAlreadyExist(activeScriptId);
          }
          return { localAction: "fullProcessScriptRows", rows: finalRows, rowCount: count, mediaInsertCount: successfulMediaInsertCount, attemptedMediaInsertCount: mediaInsertCount, skippedCount: skippedMediaClips.length, skipped: skippedMediaClips, unresolvedSources: failedVideoSources, audioMoveCount: audioMoveCount, finalDuration: finalDuration, notesTrackAdded: fullProcessNotesTrackAdded, importResult: result.data };
        });
      });
    } catch (err) {
      return Promise.reject(err);
    }
  }

  function applyLocalAndHostActions(payload) {
    var actions = (payload && payload.actions) || [];
    var localActions = [];
    var hostActions = [];
    var skippedCreateSequence = false;
    for (var i = 0; i < actions.length; i++) {
      if (actions[i] && actions[i].type === "createSequence" && !actions[i].presetPath) {
        skippedCreateSequence = true;
        continue;
      }
      if (actions[i] && (actions[i].type === "importSrtFile" || actions[i].type === "importCaptionFile") && actions[i].createCaptionTrack === true && actions[i].allowCaptionTrackCreate !== true) {
        actions[i].createCaptionTrack = false;
        appendMessage("system", "Imported caption file only; skipped Premiere's createCaptionTrack call because it is returning EvalScript errors in this project.");
      }
      if (actions[i] && actions[i].type === "fullProcessScriptRows") {
        localActions.push(actions[i]);
      } else if (isLocalAudioSubtitleAction(actions[i])) {
        localActions.push(actions[i]);
      } else {
        hostActions.push(actions[i]);
      }
    }
    if (skippedCreateSequence) {
      appendMessage("system", "Skipped New sequence because Premiere's active-sequence clone call is returning EvalScript errors in this project. Applying the remaining actions to the active sequence.");
    }

    var localResults = [];
    var chain = Promise.resolve();
    for (var l = 0; l < localActions.length; l++) {
      (function (action) {
        chain = chain.then(function () {
          var runner = action.type === "fullProcessScriptRows" ? runLocalFullProcessRowsAction : runLocalAudioSubtitleAction;
          return runner(action).then(function (result) {
            localResults.push(result);
          });
        });
      })(localActions[l]);
    }

    return chain.then(function () {
      if (!hostActions.length) {
        return { ok: true, data: { applied: localResults, failed: [], undoActions: [] } };
      }
      return applyHostActionsSequential(hostActions, localResults);
    });
  }

  function applyHostActionsSequential(hostActions, localResults) {
    var combined = {
      applied: [],
      failed: [],
      undoActions: [],
      localApplied: localResults || []
    };
    var chain = Promise.resolve();
    for (var i = 0; i < hostActions.length; i++) {
      (function (action, index) {
        chain = chain.then(function () {
          var actionType = action && action.type ? action.type : "(unknown)";
          setStatus("Applying host action " + (index + 1) + "/" + hostActions.length + ": " + actionType);
          return evalHost("prAI_applyActions", attachTargetSequence({ actions: [action] })).then(function (result) {
            if (!result.ok) {
              return {
                ok: false,
                error: "Host action " + (index + 1) + " (" + actionType + ") failed: " + (result.error || "Unknown host error."),
                data: combined
              };
            }
            var data = result.data || {};
            if (data.applied && data.applied.length) {
              combined.applied = combined.applied.concat(data.applied);
            }
            if (data.failed && data.failed.length) {
              combined.failed = combined.failed.concat(data.failed);
            }
            if (data.undoActions && data.undoActions.length) {
              combined.undoActions = data.undoActions.concat(combined.undoActions);
            }
            return { ok: true };
          });
        }).then(function (result) {
          if (result && !result.ok) {
            throw result;
          }
        });
      })(hostActions[i], i);
    }
    return chain.then(function () {
      return { ok: true, data: combined };
    }).catch(function (result) {
      if (result && result.ok === false) {
        return result;
      }
      return { ok: false, error: String(result && result.message ? result.message : result), data: combined };
    });
  }

  function setInstallStage(stage, state, logText) {
    var map = {
      ffmpeg: { stage: els.ffmpegInstallStage, state: els.ffmpegInstallState, log: els.ffmpegInstallLog },
      whisper: { stage: els.whisperInstallStage, state: els.whisperInstallState, log: els.whisperInstallLog },
      model: { stage: els.modelInstallStage, state: els.modelInstallState, log: els.modelInstallLog },
      comfy: { stage: els.comfyInstallStage, state: els.comfyInstallState, log: els.comfyInstallLog },
      comfyServer: { stage: els.comfyServerStage, state: els.comfyServerState, log: els.comfyServerLog }
      ,
      comfyModel: { stage: els.comfyModelStage, state: els.comfyModelState, log: els.comfyModelLog },
      comfyRender: { stage: els.comfyRenderStage, state: els.comfyRenderState, log: els.comfyRenderLog },
      aiDetect: { stage: els.aiDetectStage, state: els.aiDetectState, log: els.aiDetectLog },
      claudeTest: { stage: els.claudeTestStage, state: els.claudeTestState, log: els.claudeTestLog },
      codexTest: { stage: els.codexTestStage, state: els.codexTestState, log: els.codexTestLog }
    };
    var target = map[stage];
    if (!target || !target.stage) {
      return;
    }
    target.stage.classList.remove("is-running", "is-done", "is-error");
    var providerCard = target.stage.closest ? target.stage.closest(".ai-provider-card") : null;
    if (providerCard) {
      providerCard.classList.remove("is-running", "is-done", "is-error");
    }
    var stateClass = "";
    if (state === "running") {
      stateClass = "is-running";
      target.state.textContent = stage === "aiDetect" ? "Checking" : stage === "claudeTest" || stage === "codexTest" ? "Testing" : "Running";
    } else if (state === "done") {
      stateClass = "is-done";
      target.state.textContent = stage === "aiDetect" ? "Ready" : stage === "claudeTest" || stage === "codexTest" ? "Connected" : "Done";
    } else if (state === "error") {
      stateClass = "is-error";
      target.state.textContent = stage === "aiDetect" || stage === "claudeTest" || stage === "codexTest" ? "Needs attention" : "Failed";
    } else {
      target.state.textContent = state || "Idle";
    }
    if (stateClass) {
      target.stage.classList.add(stateClass);
      if (providerCard) providerCard.classList.add(stateClass);
    }
    if (logText !== undefined) {
      target.log.textContent = tailText(logText, 1800);
      target.log.scrollTop = target.log.scrollHeight;
    }
  }

  function appendInstallStageLog(stage, text) {
    var logs = {
      ffmpeg: els.ffmpegInstallLog,
      whisper: els.whisperInstallLog,
      model: els.modelInstallLog,
      comfy: els.comfyInstallLog,
      comfyServer: els.comfyServerLog,
      comfyModel: els.comfyModelLog,
      comfyRender: els.comfyRenderLog,
      aiDetect: els.aiDetectLog,
      claudeTest: els.claudeTestLog,
      codexTest: els.codexTestLog
    };
    var log = logs[stage];
    if (!log || !text) {
      return;
    }
    log.textContent = tailText((log.textContent || "") + text, 1800);
    log.scrollTop = log.scrollHeight;
  }

  function activeQuickModes() {
    var buttons = document.querySelectorAll(".quick-action[aria-pressed='true']");
    var modes = [];
    for (var i = 0; i < buttons.length; i++) {
      var actionId = buttons[i].getAttribute("data-quick-action");
      if (actionId) {
        modes.push(actionId);
      }
    }
    return modes;
  }

  function workflowModesForRequest(request, selectedModes, images) {
    var modes = (selectedModes || []).slice(0);
    var value = String(request || "").toLowerCase();
    function add(id) {
      if (modes.indexOf(id) === -1) {
        modes.push(id);
      }
    }
    if (/\b(?:new|fresh|another|duplicate)\s+sequence\b/.test(value) || /\bcreate\s+(?:a\s+)?sequence\b/.test(value)) {
      add("create-new-sequence");
    }
    if (/\b(?:full|complete|whole)\s+(?:process|processing|workflow)\b/.test(value) || /\bfull\s+edit\b/.test(value)) {
      add("full-processing");
    } else if (/\b(?:audio\s*(?:\+|and)\s*text)\b/.test(value) ||
      /\b(?:cut|split|align|time|sync|match)\b[\s\S]{0,70}\baudio\b[\s\S]{0,70}\b(?:text|script|subtitle|caption)s?\b/.test(value) ||
      /\b(?:text|script|subtitle|caption)s?\b[\s\S]{0,70}\b(?:cut|split|align|time|sync|match)\b[\s\S]{0,70}\baudio\b/.test(value)) {
      add("audio-text-cuts");
    } else if (/\b(?:layout|lay\s+out|place|assemble|build)\b[\s\S]{0,100}\b(?:source|footage|media)\b[\s\S]{0,100}\b(?:text|caption|subtitle)s?\b/.test(value) ||
      /\b(?:text|caption|subtitle)s?\b[\s\S]{0,100}\b(?:and|with|plus)\b[\s\S]{0,40}\b(?:source|footage|media)\b/.test(value)) {
      add("auto-cut-textbound");
    } else if (/\b(?:add|place|create|make|generate|import)\b[\s\S]{0,60}\b(?:subtitle|caption|srt)s?\b[\s\S]{0,60}\b(?:script|text|overlay)\b/.test(value)) {
      add("auto-subtitle-layout");
    }
    if (requestWantsImageScriptAssembly(request, modes, images) &&
        modes.indexOf("full-processing") === -1 &&
        modes.indexOf("audio-text-cuts") === -1 &&
        modes.indexOf("auto-cut") === -1 &&
        modes.indexOf("auto-cut-textbound") === -1 &&
        modes.indexOf("auto-cut-clipbound") === -1) {
      add("auto-cut-textbound");
    }
    return modes;
  }

  function quickModeLabel(actionId) {
    if (actionId === "auto-cut") {
      return "Auto cut";
    }
    if (actionId === "auto-cut-textbound") {
      return "Layout";
    }
    if (actionId === "auto-cut-clipbound") {
      return "Clip-bound autocut";
    }
    if (actionId === "auto-subtitle-layout") {
      return "Add text";
    }
    if (actionId === "process-file-names") {
      return "Process file names";
    }
    if (actionId === "create-new-sequence") {
      return "New sequence";
    }
    if (actionId === "audio-subtitles") {
      return "Whisper timing";
    }
    if (actionId === "audio-text-cuts") {
      return "Audio + Text";
    }
    if (actionId === "full-processing") {
      return "Full Process";
    }
    return actionId;
  }

  function quickModeInstructions(modes) {
    var lines = [];
    for (var i = 0; i < modes.length; i++) {
      if (modes[i] === "auto-cut") {
        lines.push("Auto cut is ON: build each script row as Text + footage + audio. Use project footage from Source File/Cut from Source, use Overlay/Text cells as row transcripts, and use Whisper on the configured audio track to locate row audio timing. Never pass the whole flattened sheet/table as scriptText to cutAudioAndTimeSubtitles; pass only the ordered Text/Overlay cells, one row per line/block, preserving row boundaries and excluding source/cut/notes cells. When using cutAudioAndTimeSubtitles, it must only split the configured audio track in place for manual editing/testing; footage assembly still belongs in assembleFromScript/insertClipRange/overwriteClipRange. The text/subtitle duration for a row must be max(spoken audio duration for that row from Whisper, combined footage duration from that row's cut ranges), because either audio or clips can be longer. Pay special attention to the first and last words of each text cell to make row boundaries as correct as possible.");
      } else if (modes[i] === "auto-cut-textbound") {
        lines.push("Layout is ON: lay out all selected script Source File/Cut from Source media rows plus Text/Overlay captions. Do not run Whisper and do not emit cutAudioAndTimeSubtitles/transcribeAudioTrackToSrt. Use source/cut durations as the timeline timing, place media row-by-row on the configured video track, create/import matching captions from Text/Overlay cells, preserve row boundaries, and let blank text rows still consume their source duration.");
      } else if (modes[i] === "auto-cut-clipbound") {
        lines.push("Clip-bound autocut is ON: listed source ranges guide timing. Place clips sequentially on one track with linked audio when available. Text/captions follow the final cut timing.");
      } else if (modes[i] === "auto-subtitle-layout") {
        lines.push("Add text is ON: create an SRT/text caption file from Overlay Text timed by cut durations. Text follows cuts; blank overlay rows still consume time. Emit importSrtFile with inline contents, createCaptionTrack:true, allowCaptionTrackCreate:true, and suppressUI:true so text is placed on the timeline.");
      } else if (modes[i] === "process-file-names") {
        lines.push("Process file names is ON: source notes may be incomplete or incorrect. Resolve source labels by comparing script Source File/Cut notes against actual project item names and media paths. Use fuzzy matching on visible numbers, product/file keywords, extensions, and path names; prefer projectItemId when a likely item is found. If ambiguity remains, choose the strongest match and mention the assumption briefly.");
      } else if (modes[i] === "create-new-sequence") {
        lines.push("New sequence is ON: create another sequence before assembling or captioning when the requested workflow changes the timeline. Emit createSequence first with a clear name like PR AI Auto Edit plus the current date/time, no presetPath, and clear:true/default so the host clones the active sequence settings and clears the clone without opening Premiere's sequence template picker. Then run the enabled auto workflow in that new active sequence. Do not clear the current sequence when this is enabled.");
      } else if (modes[i] === "audio-subtitles") {
        lines.push(getWhisperSettings().command ? "Whisper timing is ON: emit transcribeAudioTrackToSrt with createCaptionTrack:true and suppressUI:true. Leave audioTrack/track/trackIndex unset unless the user names a specific track (e.g. 'just the A2 dialogue track'); with none given, the panel listens to the whole sequence - every audio track with clips, mixed together - like Premiere's own built-in transcription, rather than only the one track configured in Settings. If Script/table input or the request contains predetermined transcript text, set useProvidedText:true and include that text as scriptText so the panel uses Whisper timing but replaces generated words with the provided text. If no transcript is supplied, let Whisper generate the text; the panel then automatically re-splits Whisper's own captions into short, readability-based rows (optimizeCaptions is on by default), so no script is needed for a plain captioning request." : "Whisper timing is ON but Whisper is not configured. Do not emit transcribeAudioTrackToSrt; explain that Settings needs a real WhisperX command first, or proceed only with non-audio footage/text actions.");
      } else if (modes[i] === "audio-text-cuts") {
        lines.push(getWhisperSettings().command ? "Audio + Text is ON: split only the configured audio track in place for manual editing/testing, and add matching captions. Use original Text/Overlay rows as the provided transcript and audio-cut boundaries. Optimized Text, when present, subdivides captions inside each original audio section and must never create extra audio cuts. Emit one cutAudioAndTimeSubtitles action with useProvidedText:true, preserveScriptLines:true, alignSubtitlesToAudioCuts:true, createCaptionTrack:true, and suppressUI:true." : "Audio + Text is ON but Whisper is not configured. Do not emit cutAudioAndTimeSubtitles; explain that Settings needs a real WhisperX command first, or proceed only with non-audio Text + Footage/Add text actions.");
      } else if (modes[i] === "full-processing") {
        lines.push(getWhisperSettings().command ? "Full Process is ON: emit exactly one fullProcessScriptRows action. Do not emit generic insertClipRange, assembleFromScript, importSrtFile, cutAudioAndTimeSubtitles, or deleteTrackRange actions for this mode. The panel-local fullProcessScriptRows action owns row timing, media placement, in-place audio cuts/moves, and captions. It must preserve the configured source audio clips and imported SRT project item." : "Full Process is ON but Whisper is not configured. Ask the user to configure/test Whisper before full audio/subtitle/media processing.");
      }
    }
    return lines;
  }

  function handleQuickAction(event) {
    var button = event.currentTarget;
    /* A direct-run action (no data-quick-action) sits in this same row for
       visual consistency but is not a toggle - it must not pick up a pressed
       state or get folded into "Enabled: ..." like the real mode pills. */
    if (!button.hasAttribute("data-quick-action")) {
      return;
    }
    var enabled = button.getAttribute("aria-pressed") === "true";
    button.setAttribute("aria-pressed", enabled ? "false" : "true");
    button.className = enabled ? button.className.replace(/\s*\bis-active\b/g, "") : button.className + " is-active";
    var actionId = button.getAttribute("data-quick-action");
    if (!enabled && (actionId === "full-processing" || actionId === "auto-cut-textbound" || actionId === "audio-text-cuts" || actionId === "auto-subtitle-layout")) {
      selectActiveScriptForWorkflow();
    }
    if (!enabled && (actionId === "auto-cut" || actionId === "auto-cut-textbound" || actionId === "auto-cut-clipbound" || actionId === "audio-subtitles" || actionId === "audio-text-cuts" || actionId === "full-processing")) {
      var otherId = "";
      if (actionId === "auto-cut" || actionId === "auto-cut-textbound" || actionId === "auto-cut-clipbound" || actionId === "audio-text-cuts" || actionId === "full-processing") {
        var autocutIds = ["auto-cut", "auto-cut-textbound", "auto-cut-clipbound"];
        for (var ac = 0; ac < autocutIds.length; ac++) {
          if (autocutIds[ac] !== actionId) {
            var otherAutocut = document.querySelector(".quick-action[data-quick-action='" + autocutIds[ac] + "']");
            if (otherAutocut) {
              otherAutocut.setAttribute("aria-pressed", "false");
              otherAutocut.className = otherAutocut.className.replace(/\s*\bis-active\b/g, "");
            }
          }
        }
        if (actionId === "auto-cut" || actionId === "auto-cut-textbound" || actionId === "auto-cut-clipbound") {
          var audioTextCuts = document.querySelector(".quick-action[data-quick-action='audio-text-cuts']");
          if (audioTextCuts) {
            audioTextCuts.setAttribute("aria-pressed", "false");
            audioTextCuts.className = audioTextCuts.className.replace(/\s*\bis-active\b/g, "");
          }
          var fullProcessing = document.querySelector(".quick-action[data-quick-action='full-processing']");
          if (fullProcessing) {
            fullProcessing.setAttribute("aria-pressed", "false");
            fullProcessing.className = fullProcessing.className.replace(/\s*\bis-active\b/g, "");
          }
        }
        if (actionId === "audio-text-cuts" || actionId === "full-processing") {
          var timingOnly = document.querySelector(".quick-action[data-quick-action='audio-subtitles']");
          if (timingOnly) {
            timingOnly.setAttribute("aria-pressed", "false");
            timingOnly.className = timingOnly.className.replace(/\s*\bis-active\b/g, "");
          }
          var otherAudioWorkflow = document.querySelector(".quick-action[data-quick-action='" + (actionId === "audio-text-cuts" ? "full-processing" : "audio-text-cuts") + "']");
          if (otherAudioWorkflow) {
            otherAudioWorkflow.setAttribute("aria-pressed", "false");
            otherAudioWorkflow.className = otherAudioWorkflow.className.replace(/\s*\bis-active\b/g, "");
          }
        }
      } else {
        otherId = actionId === "audio-subtitles" ? "audio-text-cuts" : "audio-subtitles";
        var other = document.querySelector(".quick-action[data-quick-action='" + otherId + "']");
        if (other) {
          other.setAttribute("aria-pressed", "false");
          other.className = other.className.replace(/\s*\bis-active\b/g, "");
        }
      }
    }
    var modes = activeQuickModes();
    setStatus(modes.length ? "Enabled: " + modes.map(quickModeLabel).join(", ") : "Quick toggles off.");
  }

  function actionUsesTextTempFolder(action) {
    return action && (
      action.type === "addSubtitleLayer" ||
      action.type === "createCaptionTrack" ||
      action.type === "writeTempTextFile" ||
      action.type === "importTextFile" ||
      action.type === "importSrtFile" ||
      action.type === "importCaptionFile" ||
      action.type === "checkFilePath" ||
      action.type === "deleteTempFile"
    );
  }

  function attachTextTempFolder(payload) {
    var folder = getTextTempFolder();
    if (!payload || !payload.actions) {
      return payload;
    }
    for (var i = 0; i < payload.actions.length; i++) {
      if (actionUsesTextTempFolder(payload.actions[i]) && folder && !payload.actions[i].tempFolder) {
        payload.actions[i].tempFolder = folder;
      }
      if (payload.actions[i] && payload.actions[i].type === "createStyledTextXml") {
        if (getXmlOutputFolder() && !payload.actions[i].outputFolder) {
          payload.actions[i].outputFolder = getXmlOutputFolder();
        }
        if (!payload.actions[i].afterCreateAction) {
          payload.actions[i].afterCreateAction = getXmlAfterCreateAction();
        }
      }
    }
    return payload;
  }

  function getProjectContextForPrompt() {
    if (shouldIncludeComponents()) {
      return state;
    }
    return stripComponentsForPrompt(state);
  }

  function renderTargetSequenceOptions() {
    if (!els.targetSequence) {
      return;
    }
    var previous = targetSequenceId || "";
    while (els.targetSequence.firstChild) {
      els.targetSequence.removeChild(els.targetSequence.firstChild);
    }
    var activeOption = document.createElement("option");
    activeOption.value = "";
    activeOption.textContent = "Target: Active sequence";
    els.targetSequence.appendChild(activeOption);
    var sequences = state && state.sequences ? state.sequences : [];
    var found = !previous;
    for (var i = 0; i < sequences.length; i++) {
      var sequence = sequences[i] || {};
      if (!sequence.sequenceId) {
        continue;
      }
      var option = document.createElement("option");
      option.value = sequence.sequenceId;
      option.textContent = "Target: " + (sequence.name || ("Sequence " + (i + 1)));
      els.targetSequence.appendChild(option);
      if (sequence.sequenceId === previous) {
        found = true;
      }
    }
    if (!found) {
      targetSequenceId = "";
      try {
        window.localStorage.setItem(targetSequenceStorageKey, "");
      } catch (err) {
      }
    }
    els.targetSequence.value = targetSequenceId || "";
  }

  function attachTargetSequence(payload) {
    if (!payload) {
      payload = {};
    }
    if (targetSequenceId && !payload.targetSequenceId) {
      payload.targetSequenceId = targetSequenceId;
    }
    return payload;
  }

  function targetSequenceLabel() {
    if (!targetSequenceId) {
      return "Active sequence";
    }
    var sequences = state && state.sequences ? state.sequences : [];
    for (var i = 0; i < sequences.length; i++) {
      if (sequences[i] && sequences[i].sequenceId === targetSequenceId) {
        return sequences[i].name || targetSequenceId;
      }
    }
    return targetSequenceId;
  }

  function requestLooksLikeTimelineEdit(text, modes) {
    if (modes && modes.length) {
      return true;
    }
    return requestExplicitlyAllowsPremiereActions(text, modes);
  }

  function requestLooksLikeProjectContextQuery(text) {
    var value = String(text || "").toLowerCase();
    if (/\b(read|see|show|list|inspect|query|check|scan|tell me|what(?:'s| is)?|details?)\b[\s\S]{0,80}\b(timeline|sequence|active sequence|active comp|tracks?|clips?|bins?|project files?|project items?|media files?|footage|assets?)\b/.test(value)) {
      return true;
    }
    if (/\b(timeline|sequence|active sequence|active comp|tracks?|clips?|bins?|project files?|project items?|media files?|footage|assets?)\b[\s\S]{0,80}\b(read|see|show|list|inspect|query|check|scan|details?)\b/.test(value)) {
      return true;
    }
    return /\b(files?\s+in\s+(?:the\s+)?bins?|bin\s+contents?|active\s+(?:timeline|sequence|comp)|timeline\s+(?:details?|clips?|contents?)|project\s+(?:bins?|items?|media|files?))\b/.test(value);
  }

  function requestExplicitlyAllowsPremiereActions(text, modes) {
    if (modes && modes.length) {
      return true;
    }
    var value = String(text || "").toLowerCase();
    var politeCommand = /\b(?:can|could|would|will)\s+you\b/.test(value);
    var directRequest = /\b(?:please|i\s+(?:want|need|would like)|let(?:'s| us)|go ahead)\b/.test(value);
    var explicitRun = /\b(?:apply|run|execute|do it|make it|go ahead|change|modify)\b/.test(value);
    var editVerb = /\b(apply|run|execute|process|build|do|make|change|modify|create|add|place|layout|insert|import|delete|remove|trim|cut|move|split|replace|assemble|overwrite|clear|mute|unmute|enable|disable|rename|set|adjust|transcribe|subtitle|caption|render|detect|sync|align|time|retime|resize|scale|crop|rotate|position|duplicate|copy|link|unlink|nest)\b/.test(value);
    var advisoryQuestion = /(?:^|[.!?]\s*)\s*(?:how|what|why|should\s+(?:i|we)|could\s+(?:i|we)|would\s+it|do\s+you\s+recommend)\b/.test(value) ||
      /\b(?:recommendation|advice|explain|review|thoughts?|ideas?|any further|optimi[sz]ation recommended)\b/.test(value);
    if (advisoryQuestion && !explicitRun && !((politeCommand || directRequest) && editVerb)) {
      return false;
    }
    if (editVerb) {
      return true;
    }
    if (/\bmake\b[\s\S]{0,40}\b(clip|audio|video|timeline|sequence|caption|subtitle|track)\b/.test(value)) {
      return true;
    }
    if ((politeCommand || directRequest) && /\b(?:timeline|sequence|clips?|audio|video|footage|sources?|media|captions?|subtitles?|text|tracks?|bins?|project items?|markers?|in\s*point|out\s*point)\b/.test(value)) {
      return true;
    }
    return false;
  }

  function requestLooksLikeImageScriptImport(text, images, modes) {
    if (!images || !images.length) {
      return false;
    }
    modes = modes || [];
    if (modes.indexOf("full-processing") !== -1 ||
        modes.indexOf("audio-text-cuts") !== -1 ||
        modes.indexOf("auto-cut") !== -1 ||
        modes.indexOf("auto-cut-textbound") !== -1 ||
        modes.indexOf("auto-cut-clipbound") !== -1 ||
        modes.indexOf("auto-subtitle-layout") !== -1) {
      return true;
    }
    var value = String(text || "").toLowerCase();
    if (!value.replace(/\s+/g, "")) {
      return true;
    }
    return /\b(script|spreadsheet|sheet|table|rows?|columns?|cells?|source|footage|timecode|cut\s*(?:range|time)?|ocr|transcrib|extract|convert)\b/.test(value) ||
      /\b(read|use|import|build|assemble|layout|process)\b[\s\S]{0,80}\b(image|picture|photo|screenshot|attached|this)\b/.test(value) ||
      /\b(image|picture|photo|screenshot|attached)\b[\s\S]{0,80}\b(read|use|import|build|assemble|layout|process)\b/.test(value);
  }

  function requestWantsImageScriptAssembly(text, modes, images) {
    if (!requestLooksLikeImageScriptImport(text, images, modes)) {
      return false;
    }
    modes = modes || [];
    if (modes.indexOf("full-processing") !== -1 ||
        modes.indexOf("audio-text-cuts") !== -1 ||
        modes.indexOf("auto-cut") !== -1 ||
        modes.indexOf("auto-cut-textbound") !== -1 ||
        modes.indexOf("auto-cut-clipbound") !== -1 ||
        modes.indexOf("auto-subtitle-layout") !== -1) {
      return true;
    }
    return /\b(assemble|layout|place\s+(?:the\s+)?(?:clips?|footage|media)|build\s+(?:the\s+)?(?:edit|timeline)|run\s+(?:the\s+)?(?:edit|workflow|process)|full\s+(?:process|edit)|edit\s+(?:the\s+)?timeline)\b/i.test(String(text || ""));
  }

  function requestLooksLikeGeneralChat(text, modes, images, scriptPayload) {
    if (requestLooksLikeImageScriptImport(text, images, modes)) {
      return false;
    }
    if ((modes && modes.length) || (scriptPayload && scriptPayload.text)) {
      return false;
    }
    if (requestLooksLikeProjectContextQuery(text)) {
      return false;
    }
    if (requestExplicitlyAllowsPremiereActions(text, modes) || requestNeedsAudioSettings(text, modes || []) || requestNeedsVideoAiSettings(text) || requestAllowsGraphicText(text) || requestAllowsSvg(text)) {
      return false;
    }
    return true;
  }

  function compactClipForPrompt(clip) {
    if (!clip) {
      return null;
    }
    var itemId = clip.projectItemId || "";
    return {
      name: clip.name || clip.projectItemName || "",
      itemId: itemId ? String(itemId) : "",
      start: roundPromptSeconds(clip.startSeconds),
      end: roundPromptSeconds(clip.endSeconds),
      in: roundPromptSeconds(clip.inPointSeconds),
      out: roundPromptSeconds(clip.outPointSeconds),
      disabled: clip.disabled === true ? true : undefined
    };
  }

  function roundPromptSeconds(value) {
    var number = Number(value);
    if (isNaN(number)) {
      return value;
    }
    return Math.round(number * 100) / 100;
  }

  function requestTimeWindow(text) {
    var value = String(text || "");
    var match = value.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|second|seconds)\b/i) || value.match(/\b(?:at|around|near)\s+(\d+(?:\.\d+)?)/i);
    if (!match) {
      return null;
    }
    var center = Number(match[1]);
    if (isNaN(center)) {
      return null;
    }
    return { start: Math.max(0, center - 3), end: center + 3 };
  }

  function compactTracksForPrompt(sequence, userPrompt, limitPerTrack) {
    var result = {};
    if (!sequence) {
      return result;
    }
    var window = requestTimeWindow(userPrompt);
    function addTracks(kind, tracks) {
      if (!tracks) {
        return;
      }
      for (var t = 0; t < tracks.length; t++) {
        var track = tracks[t] || {};
        var clips = track.clips || [];
        var compact = [];
        for (var c = 0; c < clips.length; c++) {
          var clip = clips[c];
          if (window) {
            var startsBeforeEnd = Number(clip.startSeconds) < window.end;
            var endsAfterStart = Number(clip.endSeconds) > window.start;
            if (!startsBeforeEnd || !endsAfterStart) {
              continue;
            }
          }
          var compactClip = compactClipForPrompt(clip);
          if (compactClip) {
            compact.push(compactClip);
          }
          if (!window && compact.length >= limitPerTrack) {
            break;
          }
        }
        if (compact.length) {
          result[kind + (track.index + 1)] = compact;
        }
      }
    }
    addTracks("V", sequence.videoTracks || []);
    addTracks("A", sequence.audioTracks || []);
    return result;
  }

  function compactProjectItemsForPrompt(limit) {
    var items = state && state.projectItems ? state.projectItems : [];
    var compact = [];
    limit = Number(limit || 0);
    if (!limit || limit < 0) {
      limit = items.length;
    }
    for (var i = 0; i < items.length && compact.length < limit; i++) {
      var item = items[i] || {};
      compact.push({
        id: item.nodeId || "",
        name: item.name || "",
        type: item.type,
        path: item.path || "",
        mediaPath: item.mediaPath || ""
      });
    }
    return compact;
  }

  function projectContextProfile(userPrompt, modes, images, scriptPayload, isAutocut, graphicTextAllowed) {
    if (requestLooksLikeGeneralChat(userPrompt, modes, images, scriptPayload)) {
      return "none";
    }
    if (requestLooksLikeProjectContextQuery(userPrompt)) {
      return "inspect";
    }
    if (graphicTextAllowed || shouldIncludeComponents()) {
      return "full";
    }
    if (isAutocut || (scriptPayload && scriptPayload.text)) {
      return "script";
    }
    if (requestLooksLikeTimelineEdit(userPrompt, modes)) {
      return "timeline";
    }
    return "minimal";
  }

  function projectContextForPromptProfile(profile, userPrompt) {
    if (profile === "none" || profile === "minimal") {
      return { omitted: true, reason: "general chat or no Premiere context needed" };
    }
    if (profile === "full") {
      return getProjectContextForPrompt();
    }
    var sequence = state && state.activeSequence ? state.activeSequence : null;
    var context = {
      profile: profile,
      projectName: state && state.projectName ? state.projectName : "",
      activeSequence: sequence ? {
        name: sequence.name || "",
        sequenceId: sequence.sequenceId || "",
        fps: roundPromptSeconds(sequence.sequenceFps || 0),
        tracks: compactTracksForPrompt(sequence, userPrompt, (profile === "timeline" || profile === "inspect") ? 16 : 4)
      } : null
    };
    if (profile === "script" || profile === "inspect") {
      context.projectItems = compactProjectItemsForPrompt(180);
    }
    return context;
  }

  function createScriptProject(name, scripts) {
    var id = "project-" + (new Date()).getTime() + "-" + Math.floor(Math.random() * 1000);
    var projectScripts = scripts && scripts.length ? scripts : [{ id: "script-" + (new Date()).getTime() + "-" + Math.floor(Math.random() * 1000), name: "Script 1", html: "" }];
    return {
      id: id,
      name: name || "Product Project",
      activeScriptId: projectScripts[0].id,
      selectedScriptId: "",
      scripts: projectScripts
    };
  }

  function activeScriptProject() {
    if (!scriptProjects || !scriptProjects.length) {
      scriptProjects = [createScriptProject("Product Project", scriptDocuments)];
      activeScriptProjectId = scriptProjects[0].id;
    }
    for (var i = 0; i < scriptProjects.length; i++) {
      if (scriptProjects[i].id === activeScriptProjectId) {
        if (!scriptProjects[i].scripts || !scriptProjects[i].scripts.length) {
          scriptProjects[i].scripts = [{ id: "script-1", name: "Script 1", html: "" }];
        }
        scriptDocuments = scriptProjects[i].scripts;
        activeScriptId = scriptProjects[i].activeScriptId || scriptDocuments[0].id;
        selectedScriptId = scriptProjects[i].selectedScriptId || "";
        return scriptProjects[i];
      }
    }
    activeScriptProjectId = scriptProjects[0].id;
    return activeScriptProject();
  }

  function syncActiveScriptProjectState() {
    var project = null;
    for (var i = 0; i < scriptProjects.length; i++) {
      if (scriptProjects[i].id === activeScriptProjectId) {
        project = scriptProjects[i];
        break;
      }
    }
    if (!project) {
      project = activeScriptProject();
    }
    project.scripts = scriptDocuments;
    project.activeScriptId = activeScriptId;
    project.selectedScriptId = selectedScriptId;
  }

  function activeScriptDocument() {
    activeScriptProject();
    for (var i = 0; i < scriptDocuments.length; i++) {
      if (scriptDocuments[i].id === activeScriptId) {
        return scriptDocuments[i];
      }
    }
    activeScriptId = scriptDocuments[0].id;
    return scriptDocuments[0];
  }

  function selectedScriptDocument() {
    activeScriptProject();
    if (!selectedScriptId) {
      return null;
    }
    for (var i = 0; i < scriptDocuments.length; i++) {
      if (scriptDocuments[i].id === selectedScriptId) {
        return scriptDocuments[i];
      }
    }
    selectedScriptId = "";
    return null;
  }

  function selectActiveScriptForWorkflow() {
    var active = activeScriptDocument();
    if (selectedScriptId === active.id) {
      return active;
    }
    selectedScriptId = active.id;
    syncActiveScriptProjectState();
    renderScriptTabs();
    saveScriptDocuments();
    return active;
  }

  function saveScriptDocuments() {
    try {
      syncActiveScriptProjectState();
      localStorage.setItem(scriptDocumentsStorageKey, JSON.stringify({
        activeProjectId: activeScriptProjectId,
        projects: scriptProjects,
        activeScriptId: activeScriptId,
        selectedScriptId: selectedScriptId,
        scripts: scriptDocuments
      }));
    } catch (err) {
    }
  }

  function loadScriptDocuments() {
    try {
      var raw = localStorage.getItem(scriptDocumentsStorageKey);
      if (!raw) {
        return;
      }
      var parsed = JSON.parse(raw);
      if (parsed && parsed.projects && parsed.projects.length) {
        scriptProjects = parsed.projects;
        activeScriptProjectId = parsed.activeProjectId || scriptProjects[0].id;
        activeScriptProject();
      } else if (parsed && parsed.scripts && parsed.scripts.length) {
        scriptDocuments = parsed.scripts;
        activeScriptId = parsed.activeScriptId || scriptDocuments[0].id;
        selectedScriptId = parsed.selectedScriptId || "";
        scriptProjects = [{ id: "project-1", name: "Product Project", activeScriptId: activeScriptId, selectedScriptId: selectedScriptId, scripts: scriptDocuments }];
        activeScriptProjectId = "project-1";
      }
    } catch (err) {
    }
  }

  function saveActiveScriptDocument() {
    var script = activeScriptDocument();
    if (els.scriptNameInput) {
      var scriptName = String(els.scriptNameInput.value || "").replace(/^\s+|\s+$/g, "");
      if (scriptName) {
        script.name = scriptName;
      }
    }
    if (els.scriptValidationPrompt) {
      script.validationPrompt = String(els.scriptValidationPrompt.value || "");
    }
    if (els.scriptSplitTextToggle) {
      script.splitText = !!els.scriptSplitTextToggle.checked;
    }
    if (els.scriptNotesTrackToggle) {
      script.notesTrack = !!els.scriptNotesTrackToggle.checked;
    }
    script.html = els.scriptInput.innerHTML || "";
    saveScriptDocuments();
  }

  function syncScriptEditorFields() {
    var active = activeScriptDocument();
    if (els.scriptNameInput) {
      els.scriptNameInput.value = active.name || "";
    }
    if (els.scriptValidationPrompt) {
      els.scriptValidationPrompt.value = active.validationPrompt || "";
    }
    if (els.scriptSplitTextToggle) {
      els.scriptSplitTextToggle.checked = scriptWantsSplitText(active);
    }
    if (els.scriptNotesTrackToggle) {
      els.scriptNotesTrackToggle.checked = scriptWantsNotesTrack(active);
    }
  }

  function scriptCountLabel(count) {
    count = Math.max(0, Number(count) || 0);
    return count + " " + (count === 1 ? "script" : "scripts");
  }

  function renderScriptProjects() {
    if (!els.scriptProjectSelect) {
      return;
    }
    clearElement(els.scriptProjectSelect);
    if (els.scriptProjectList) {
      clearElement(els.scriptProjectList);
    }
    for (var i = 0; i < scriptProjects.length; i++) {
      var project = scriptProjects[i];
      var scriptCount = project && project.scripts ? project.scripts.length : 0;
      var countLabel = scriptCountLabel(scriptCount);
      var option = document.createElement("option");
      option.value = project.id;
      option.textContent = (project.name || ("Project " + (i + 1))) + " - " + countLabel;
      els.scriptProjectSelect.appendChild(option);
      if (els.scriptProjectList) {
        var item = document.createElement("button");
        item.type = "button";
        item.className = "script-project-list-item" + (project.id === activeScriptProjectId ? " is-active" : "");
        item.setAttribute("data-project-id", project.id);
        var name = document.createElement("span");
        name.className = "script-project-list-name";
        name.textContent = project.name || ("Project " + (i + 1));
        var count = document.createElement("span");
        count.className = "script-project-list-count";
        count.textContent = countLabel;
        item.appendChild(name);
        item.appendChild(count);
        item.addEventListener("click", function (event) {
          switchScriptProject(event.currentTarget.getAttribute("data-project-id"));
          renderScriptProjects();
        });
        els.scriptProjectList.appendChild(item);
      }
    }
    var newOption = document.createElement("option");
    newOption.value = "__new_script_project__";
    newOption.textContent = "+ New project";
    els.scriptProjectSelect.appendChild(newOption);
    els.scriptProjectSelect.value = activeScriptProjectId;
    updateScriptTabOverflowFade();
    window.requestAnimationFrame(updateScriptTabOverflowFade);
    var active = activeScriptProject();
    if (els.scriptProjectNameInput) {
      els.scriptProjectNameInput.value = active.name || "";
    }
    if (els.scriptProjectCount) {
      var activeCount = active && active.scripts ? active.scripts.length : 0;
      els.scriptProjectCount.textContent = scriptCountLabel(activeCount);
    }
    if (els.deleteScriptProjectBtn) {
      els.deleteScriptProjectBtn.disabled = scriptProjects.length <= 1;
    }
  }

  function renderScriptTabs() {
    if (!els.scriptTabs) {
      return;
    }
    activeScriptProject();
    renderScriptProjects();
    clearElement(els.scriptTabs);
    for (var i = 0; i < scriptDocuments.length; i++) {
      var script = scriptDocuments[i];
      var tab = document.createElement("button");
      tab.type = "button";
      var validation = script.validation || {};
      tab.className = "script-tab" +
        (script.id === activeScriptId ? " is-active" : "") +
        (script.id === selectedScriptId ? " is-selected" : "") +
        (validation.status === "validated" ? " is-validated" : "") +
        (validation.status === "needsContext" ? " needs-context" : "");
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", script.id === activeScriptId ? "true" : "false");
      tab.setAttribute("aria-pressed", script.id === selectedScriptId ? "true" : "false");
      tab.setAttribute("data-script-id", script.id);
      tab.title = (script.id === selectedScriptId ? "Included in agent prompt. " : "Not included in agent prompt. ") + (validation.message ? validation.message + " " : "") + (validation.actionCount ? validation.actionCount + " cached timeline action(s). " : "") + "Click to select/deselect. Double-click to edit.";
      var label = document.createElement("span");
      label.className = "script-tab-label";
      label.textContent = script.name || ("Script " + (i + 1));
      tab.appendChild(label);
      if (validation.status === "validated" || validation.status === "needsContext") {
        var badge = document.createElement("span");
        badge.className = "script-validation-badge";
        badge.setAttribute("aria-hidden", "true");
        if (validation.status === "validated") {
          var check = document.createElement("input");
          check.type = "checkbox";
          check.checked = true;
          check.disabled = true;
          badge.appendChild(check);
        } else {
          badge.textContent = "!";
        }
        tab.appendChild(badge);
      }
      tab.addEventListener("click", function (event) {
        scheduleScriptTabToggle(event.currentTarget.getAttribute("data-script-id"));
      });
      tab.addEventListener("dblclick", function (event) {
        openScriptTabForEdit(event.currentTarget.getAttribute("data-script-id"));
      });
      els.scriptTabs.appendChild(tab);
    }
    updateScriptTabOverflowFade();
    window.requestAnimationFrame(updateScriptTabOverflowFade);
    renderPromptHighlight();
    var active = activeScriptDocument();
    if (els.scriptNameInput) {
      els.scriptNameInput.value = active.name || "";
    }
    if (els.deleteScriptBtn) {
      els.deleteScriptBtn.disabled = scriptDocuments.length <= 1;
    }
    renderScriptWorkspaceState();
  }

  function updateScriptTabOverflowFade() {
    if (!els.scriptTabs) {
      return;
    }
    var maxScroll = Math.max(0, els.scriptTabs.scrollWidth - els.scriptTabs.clientWidth);
    els.scriptTabs.classList.toggle("can-scroll-left", els.scriptTabs.scrollLeft > 2);
    els.scriptTabs.classList.toggle("can-scroll-right", maxScroll - els.scriptTabs.scrollLeft > 2);
  }

  function switchScriptProject(projectId) {
    if (!projectId || projectId === activeScriptProjectId) {
      return;
    }
    saveActiveScriptDocument();
    syncActiveScriptProjectState();
    activeScriptProjectId = projectId;
    activeScriptProject();
    resetSheetHistory();
    sheetSelection = null;
    sheetActiveRowIndex = 0;
    sheetActiveColumnIndex = 0;
    closeSheetRowMenu();
    els.scriptInput.innerHTML = activeScriptDocument().html || "";
    renderScriptTabs();
    updateSheetRails();
    saveScriptDocuments();
    setStatus("Active product project: " + activeScriptProject().name);
  }

  function addScriptProject(useDefaultName) {
    saveActiveScriptDocument();
    syncActiveScriptProjectState();
    var name = useDefaultName ? "" : String(els.scriptProjectNameInput && els.scriptProjectNameInput.value ? els.scriptProjectNameInput.value : "").replace(/^\s+|\s+$/g, "");
    var project = createScriptProject(name || ("Product " + (scriptProjects.length + 1)), null);
    scriptProjects.push(project);
    activeScriptProjectId = project.id;
    activeScriptProject();
    resetSheetHistory();
    sheetSelection = null;
    sheetActiveRowIndex = 0;
    sheetActiveColumnIndex = 0;
    els.scriptInput.innerHTML = activeScriptDocument().html || "";
    renderScriptTabs();
    updateSheetRails();
    saveScriptDocuments();
    setStatus("New product project added.");
  }

  function renameScriptProject() {
    var project = activeScriptProject();
    var value = String(els.scriptProjectNameInput && els.scriptProjectNameInput.value ? els.scriptProjectNameInput.value : "").replace(/^\s+|\s+$/g, "");
    if (!value) {
      return;
    }
    project.name = value;
    renderScriptProjects();
    saveScriptDocuments();
    setStatus("Product project renamed.");
  }

  function deleteScriptProject() {
    if (scriptProjects.length <= 1) {
      setStatus("Keep at least one product project.", true);
      return;
    }
    var deleteIndex = 0;
    for (var i = 0; i < scriptProjects.length; i++) {
      if (scriptProjects[i].id === activeScriptProjectId) {
        deleteIndex = i;
        break;
      }
    }
    scriptProjects.splice(deleteIndex, 1);
    activeScriptProjectId = scriptProjects[Math.max(0, deleteIndex - 1)].id;
    activeScriptProject();
    resetSheetHistory();
    sheetSelection = null;
    sheetActiveRowIndex = 0;
    sheetActiveColumnIndex = 0;
    els.scriptInput.innerHTML = activeScriptDocument().html || "";
    renderScriptTabs();
    updateSheetRails();
    saveScriptDocuments();
    setStatus("Product project deleted.");
  }

  function scheduleScriptTabToggle(scriptId) {
    if (scriptTabClickTimer) {
      clearTimeout(scriptTabClickTimer);
      scriptTabClickTimer = null;
    }
    scriptTabClickTimer = setTimeout(function () {
      scriptTabClickTimer = null;
      toggleScriptSelected(scriptId);
    }, 220);
  }

  function toggleScriptSelected(scriptId) {
    if (!scriptId) {
      return;
    }
    saveActiveScriptDocument();
    selectedScriptId = selectedScriptId === scriptId ? "" : scriptId;
    syncActiveScriptProjectState();
    renderScriptTabs();
    saveScriptDocuments();
    setStatus(selectedScriptId ? "Script included: " + (selectedScriptDocument().name || "Script") : "Script context off.");
  }

  function openScriptTabForEdit(scriptId) {
    if (scriptTabClickTimer) {
      clearTimeout(scriptTabClickTimer);
      scriptTabClickTimer = null;
    }
    switchScript(scriptId);
    openScriptEditor();
  }

  /* Focusing a cell or input makes the browser scroll every scrollable ancestor
     to reveal it, which can open the editor already scrolled past its controls.
     Always start the editor at the top. */
  function resetScriptEditorScroll() {
    var panel = els.scriptEditorOverlay ? els.scriptEditorOverlay.querySelector(".script-editor-panel") : null;
    if (!panel) {
      return;
    }
    panel.scrollTop = 0;
    if (els.scriptEditorOverlay.scrollTop) {
      els.scriptEditorOverlay.scrollTop = 0;
    }
    window.requestAnimationFrame(function () {
      panel.scrollTop = 0;
      if (els.scriptEditorOverlay && els.scriptEditorOverlay.scrollTop) {
        els.scriptEditorOverlay.scrollTop = 0;
      }
    });
  }

  function openScriptEditor() {
    if (!els.scriptEditorOverlay) {
      return;
    }
    var script = activeScriptDocument();
    scriptEditorSnapshot = {
      id: script.id,
      name: script.name || "",
      html: script.html || "",
      validationPrompt: script.validationPrompt || "",
      splitText: scriptWantsSplitText(script),
      notesTrack: scriptWantsNotesTrack(script),
      validation: script.validation ? JSON.parse(JSON.stringify(script.validation)) : null
    };
    els.scriptEditorOverlay.hidden = false;
    setScriptEditorKeyIsolation(true);
    syncScriptEditorFields();
    applyScriptMediaMergeDisplay();
    if (els.scriptNameInput) {
      els.scriptNameInput.select();
    }
    updateSheetRails();
    resetScriptEditorScroll();
  }

  function closeScriptEditor() {
    if (!els.scriptEditorOverlay) {
      return;
    }
    saveActiveScriptDocument();
    scriptEditorSnapshot = null;
    closeSheetRowMenu();
    els.scriptEditorOverlay.hidden = true;
    setScriptEditorKeyIsolation(false);
    renderScriptTabs();
    setStatus("Script saved.");
  }

  function cancelScriptEditor() {
    if (!els.scriptEditorOverlay) {
      return;
    }
    if (scriptEditorSnapshot) {
      for (var i = 0; i < scriptDocuments.length; i++) {
        if (scriptDocuments[i].id === scriptEditorSnapshot.id) {
          scriptDocuments[i].name = scriptEditorSnapshot.name;
          scriptDocuments[i].html = scriptEditorSnapshot.html;
          scriptDocuments[i].validationPrompt = scriptEditorSnapshot.validationPrompt;
          scriptDocuments[i].splitText = scriptEditorSnapshot.splitText;
          scriptDocuments[i].notesTrack = scriptEditorSnapshot.notesTrack;
          if (scriptEditorSnapshot.validation) {
            scriptDocuments[i].validation = JSON.parse(JSON.stringify(scriptEditorSnapshot.validation));
          } else {
            delete scriptDocuments[i].validation;
          }
          activeScriptId = scriptEditorSnapshot.id;
          syncActiveScriptProjectState();
          break;
        }
      }
      els.scriptInput.innerHTML = scriptEditorSnapshot.html || "";
      if (els.scriptNameInput) {
        els.scriptNameInput.value = scriptEditorSnapshot.name || "";
      }
      if (els.scriptValidationPrompt) {
        els.scriptValidationPrompt.value = scriptEditorSnapshot.validationPrompt || "";
      }
      if (els.scriptSplitTextToggle) {
        els.scriptSplitTextToggle.checked = scriptEditorSnapshot.splitText !== false;
      }
      if (els.scriptNotesTrackToggle) {
        els.scriptNotesTrackToggle.checked = scriptEditorSnapshot.notesTrack !== false;
      }
      saveScriptDocuments();
    }
    scriptEditorSnapshot = null;
    resetSheetHistory();
    closeSheetRowMenu();
    els.scriptEditorOverlay.hidden = true;
    setScriptEditorKeyIsolation(false);
    renderScriptTabs();
    updateSheetRails();
    setStatus("Script edit canceled.");
  }

  var scriptMentionState = { open: false, start: -1, query: "", items: [], index: 0 };
  /* A textarea renders one uniform run of text, so the "@" cannot be hidden by
     styling. Accepting a suggestion swaps it for a zero-width word joiner: the
     tag still starts with a character we can find, but nothing is drawn. */
  var scriptMentionMarker = "\u2060";

  function scriptMentionCandidates() {
    activeScriptProject();
    var list = [];
    for (var i = 0; i < scriptDocuments.length; i++) {
      var name = String(scriptDocuments[i].name || "").replace(/^\s+|\s+$/g, "");
      if (name) {
        list.push({ id: scriptDocuments[i].id, name: name });
      }
    }
    return list;
  }

  /* Finds the @token the caret sits in. The query may contain spaces so that
     multi-word script names ("Script 2", "Hook 4.1") can be typed out; the
     caller closes the menu as soon as nothing matches, which ends the token. */
  function scriptMentionContext(value, caret) {
    var text = String(value || "");
    for (var i = caret - 1; i >= 0; i--) {
      var ch = text.charAt(i);
      if (ch === "\n") {
        return null;
      }
      if (ch === "@") {
        var before = i > 0 ? text.charAt(i - 1) : "";
        if (before && !/[\s(\[]/.test(before)) {
          return null;
        }
        return { start: i, query: text.slice(i + 1, caret) };
      }
      if (caret - i > 48) {
        return null;
      }
    }
    return null;
  }

  function matchScriptMentions(query) {
    var needle = String(query || "").toLowerCase().replace(/^\s+/, "");
    var all = scriptMentionCandidates();
    if (!needle) {
      return all;
    }
    var starts = [];
    var contains = [];
    for (var i = 0; i < all.length; i++) {
      var name = all[i].name.toLowerCase();
      if (name.indexOf(needle) === 0) {
        starts.push(all[i]);
      } else if (needle.indexOf(" ") === -1 && name.indexOf(needle) !== -1) {
        contains.push(all[i]);
      }
    }
    return starts.concat(contains);
  }

  function closeScriptMentionMenu() {
    scriptMentionState.open = false;
    scriptMentionState.start = -1;
    scriptMentionState.items = [];
    scriptMentionState.index = 0;
    if (els.scriptMentionMenu) {
      els.scriptMentionMenu.hidden = true;
    }
  }

  function renderScriptMentionMenu() {
    var menu = els.scriptMentionMenu;
    if (!menu) {
      return;
    }
    clearElement(menu);
    for (var i = 0; i < scriptMentionState.items.length; i++) {
      var item = scriptMentionState.items[i];
      var button = document.createElement("button");
      button.type = "button";
      button.className = "script-mention-item" + (i === scriptMentionState.index ? " is-active" : "");
      button.setAttribute("role", "option");
      button.setAttribute("data-script-id", item.id);
      button.setAttribute("aria-selected", i === scriptMentionState.index ? "true" : "false");
      var name = document.createElement("span");
      name.className = "script-mention-item-name";
      name.textContent = item.name;
      button.appendChild(name);
      var meta = document.createElement("span");
      meta.className = "script-mention-item-meta";
      meta.textContent = item.id === activeScriptId ? "open" : "";
      button.appendChild(meta);
      button.addEventListener("mousedown", function (event) {
        event.preventDefault();
        acceptScriptMention(event.currentTarget.getAttribute("data-script-id"));
      });
      menu.appendChild(button);
    }
    menu.hidden = false;
    var composer = menu.parentNode;
    if (composer && els.prompt) {
      menu.style.left = els.prompt.offsetLeft + "px";
      /* Prefer opening upward so the menu never covers the agent controls or the
         script strip, but flip below when there is not enough room above. */
      menu.style.bottom = "auto";
      menu.style.top = "0px";
      var menuHeight = menu.offsetHeight;
      var promptTop = els.prompt.getBoundingClientRect().top;
      if (menuHeight + 8 <= promptTop) {
        menu.style.top = "auto";
        menu.style.bottom = Math.max(0, composer.offsetHeight - els.prompt.offsetTop + 4) + "px";
      } else {
        menu.style.bottom = "auto";
        menu.style.top = (els.prompt.offsetTop + els.prompt.offsetHeight + 4) + "px";
      }
    }
    var active = menu.querySelector(".script-mention-item.is-active");
    if (active && active.scrollIntoView) {
      active.scrollIntoView({ block: "nearest" });
    }
  }

  function updateScriptMentionMenu() {
    if (!els.prompt || !els.scriptMentionMenu) {
      return;
    }
    var caret = els.prompt.selectionStart;
    if (caret === null || caret === undefined || caret !== els.prompt.selectionEnd) {
      closeScriptMentionMenu();
      return;
    }
    var context = scriptMentionContext(els.prompt.value, caret);
    if (!context) {
      closeScriptMentionMenu();
      return;
    }
    var items = matchScriptMentions(context.query);
    if (!items.length) {
      closeScriptMentionMenu();
      return;
    }
    var sameToken = scriptMentionState.open && scriptMentionState.start === context.start;
    scriptMentionState.open = true;
    scriptMentionState.start = context.start;
    scriptMentionState.query = context.query;
    scriptMentionState.items = items;
    scriptMentionState.index = sameToken ? Math.min(scriptMentionState.index, items.length - 1) : 0;
    renderScriptMentionMenu();
  }

  function acceptScriptMention(scriptId) {
    var items = scriptMentionState.items;
    var chosen = null;
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === scriptId) {
        chosen = items[i];
        break;
      }
    }
    if (!chosen || !els.prompt) {
      closeScriptMentionMenu();
      return;
    }
    var value = els.prompt.value;
    var caret = els.prompt.selectionStart;
    var token = scriptMentionMarker + chosen.name + " ";
    els.prompt.value = value.slice(0, scriptMentionState.start) + token + value.slice(caret);
    var nextCaret = scriptMentionState.start + token.length;
    els.prompt.setSelectionRange(nextCaret, nextCaret);
    closeScriptMentionMenu();
    renderPromptHighlight();
    els.prompt.focus();
  }

  function handleScriptMentionKeydown(event) {
    if (!scriptMentionState.open || !scriptMentionState.items.length) {
      return false;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      var step = event.key === "ArrowDown" ? 1 : -1;
      var count = scriptMentionState.items.length;
      scriptMentionState.index = (scriptMentionState.index + step + count) % count;
      renderScriptMentionMenu();
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      acceptScriptMention(scriptMentionState.items[scriptMentionState.index].id);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeScriptMentionMenu();
      return true;
    }
    return false;
  }

  /* Resolves @tags in the prompt back to scripts by matching the real script
     names, longest first, so names containing spaces or another name as a
     prefix still resolve unambiguously. */
  function scriptMentionsInText(text) {
    var value = String(text || "");
    var lower = value.toLowerCase();
    var candidates = scriptMentionCandidates().slice(0);
    candidates.sort(function (a, b) {
      return b.name.length - a.name.length;
    });
    var found = [];
    var claimed = [];
    var prefixes = [scriptMentionMarker, "@"];
    for (var i = 0; i < candidates.length; i++) {
      for (var pfx = 0; pfx < prefixes.length; pfx++) {
        var needle = prefixes[pfx] + candidates[i].name.toLowerCase();
        var from = 0;
        while (true) {
          var at = lower.indexOf(needle, from);
          if (at < 0) {
            break;
          }
          var overlaps = false;
          for (var c = 0; c < claimed.length; c++) {
            if (at < claimed[c].end && at + needle.length > claimed[c].start) {
              overlaps = true;
              break;
            }
          }
          var after = value.charAt(at + needle.length);
          if (!overlaps && (!after || /[\s.,;:!?)\]]/.test(after))) {
            claimed.push({ start: at, end: at + needle.length });
            found.push({ id: candidates[i].id, name: candidates[i].name, at: at, end: at + needle.length });
          }
          from = at + needle.length;
        }
      }
    }
    found.sort(function (a, b) {
      return a.at - b.at;
    });
    return found;
  }

  /* An @tag in the prompt picks the script for this run, so the tabs no longer
     have to be clicked first. Falls back to the open script when nothing is
     tagged. */
  function applyScriptMentionSelection(text) {
    var mentions = scriptMentionsInText(text);
    if (!mentions.length) {
      return null;
    }
    var target = mentions[0];
    if (target.id !== activeScriptId) {
      switchScript(target.id);
    }
    selectedScriptId = target.id;
    syncActiveScriptProjectState();
    renderScriptTabs();
    saveScriptDocuments();
    if (mentions.length > 1) {
      var names = [];
      for (var i = 1; i < mentions.length; i++) {
        names.push(mentions[i].name);
      }
      appendMessage("system", "Using the first tagged script: " + target.name + ". Also tagged but not used: " + names.join(", ") + ".");
    }
    return target;
  }

  function renderPromptHighlight() {
    var layer = els.promptHighlight;
    if (!layer || !els.prompt) {
      return;
    }
    var value = els.prompt.value;
    var mentions = scriptMentionsInText(value);
    clearElement(layer);
    var cursor = 0;
    for (var i = 0; i < mentions.length; i++) {
      var mention = mentions[i];
      if (mention.at > cursor) {
        layer.appendChild(document.createTextNode(value.slice(cursor, mention.at)));
      }
      var pill = document.createElement("span");
      pill.className = "prompt-mention";
      pill.textContent = value.slice(mention.at, mention.end);
      layer.appendChild(pill);
      cursor = mention.end;
    }
    if (cursor < value.length) {
      layer.appendChild(document.createTextNode(value.slice(cursor)));
    }
    /* pre-wrap drops a final newline, which would shift the layer out of sync
       with the textarea once the caret is on that last empty line. */
    if (/\n$/.test(value)) {
      layer.appendChild(document.createTextNode("\u200b"));
    }
    layer.scrollTop = els.prompt.scrollTop;
    layer.scrollLeft = els.prompt.scrollLeft;
  }

  function switchScript(scriptId) {
    if (!scriptId || scriptId === activeScriptId) {
      return;
    }
    saveActiveScriptDocument();
    activeScriptId = scriptId;
    syncActiveScriptProjectState();
    resetSheetHistory();
    sheetSelection = null;
    sheetActiveRowIndex = 0;
    sheetActiveColumnIndex = 0;
    closeSheetRowMenu();
    els.scriptInput.innerHTML = activeScriptDocument().html || "";
    renderScriptTabs();
    updateSheetRails();
    saveScriptDocuments();
    setStatus("Active script: " + activeScriptDocument().name);
  }

  function nextScriptName() {
    return "Script " + (scriptDocuments.length + 1);
  }

  function addScriptDocument() {
    saveActiveScriptDocument();
    var id = "script-" + (new Date()).getTime() + "-" + Math.floor(Math.random() * 1000);
    scriptDocuments.push({ id: id, name: nextScriptName(), html: "" });
    activeScriptId = id;
    selectedScriptId = "";
    syncActiveScriptProjectState();
    resetSheetHistory();
    els.scriptInput.innerHTML = "";
    renderScriptTabs();
    updateSheetRails();
    saveScriptDocuments();
    openScriptEditor();
    els.scriptInput.focus();
    setStatus("New script added.");
  }

  function duplicateScriptDocument() {
    saveActiveScriptDocument();
    var source = activeScriptDocument();
    var id = "script-" + (new Date()).getTime() + "-" + Math.floor(Math.random() * 1000);
    scriptDocuments.push({ id: id, name: (source.name || "Script") + " Copy", html: source.html || "", validationPrompt: source.validationPrompt || "", splitText: scriptWantsSplitText(source), notesTrack: scriptWantsNotesTrack(source) });
    activeScriptId = id;
    selectedScriptId = "";
    syncActiveScriptProjectState();
    resetSheetHistory();
    els.scriptInput.innerHTML = activeScriptDocument().html || "";
    renderScriptTabs();
    updateSheetRails();
    saveScriptDocuments();
    openScriptEditor();
    setStatus("Script duplicated.");
  }

  function renameScriptDocument() {
    var value = String(els.scriptNameInput && els.scriptNameInput.value ? els.scriptNameInput.value : "").replace(/^\s+|\s+$/g, "");
    if (!value) {
      return;
    }
    activeScriptDocument().name = value;
    renderScriptTabs();
    saveScriptDocuments();
    setStatus("Script renamed.");
  }

  function deleteScriptDocument() {
    if (scriptDocuments.length <= 1) {
      setStatus("Keep at least one script.", true);
      return;
    }
    var deleteIndex = 0;
    for (var i = 0; i < scriptDocuments.length; i++) {
      if (scriptDocuments[i].id === activeScriptId) {
        deleteIndex = i;
        break;
      }
    }
    scriptDocuments.splice(deleteIndex, 1);
    if (selectedScriptId === activeScriptId) {
      selectedScriptId = "";
    }
    activeScriptId = scriptDocuments[Math.max(0, deleteIndex - 1)].id;
    syncActiveScriptProjectState();
    resetSheetHistory();
    els.scriptInput.innerHTML = activeScriptDocument().html || "";
    renderScriptTabs();
    updateSheetRails();
    saveScriptDocuments();
    setStatus("Script deleted.");
  }

  function getScriptInputPayload() {
    saveActiveScriptDocument();
    var activeScript = selectedScriptDocument();
    if (!activeScript) {
      return {
        text: "",
        html: "",
        projectName: activeScriptProject().name || "",
        scriptName: "",
        tableRows: [],
        columnRoles: [],
        cutTimedSrtPlan: null
      };
    }
    var holder = document.createElement("div");
    holder.innerHTML = activeScript.html || "";
    var element = holder;
    var text = element ? String(element.innerText || element.textContent || "").replace(/\u00a0/g, " ") : "";
    var html = element ? String(element.innerHTML || "") : "";
    text = text.replace(/^\s+|\s+$/g, "");
    html = html.replace(/^\s+|\s+$/g, "");
    if (!text && (!html || html === "<br>")) {
      html = "";
    }
    var tableGrid = getScriptInputTableGrid(element);
    var tableRows = tableGrid.rows;
    var columnRoles = getScriptInputColumnRoles(element);
    var payload = {
      text: text,
      html: html,
      projectName: activeScriptProject().name || "",
      scriptName: activeScript.name || "",
      tableRows: tableRows,
      tableCells: tableGrid.cells,
      columnRoles: columnRoles
    };
    payload.cutTimedSrtPlan = buildCutTimedSrtPlan(payload);
    return payload;
  }

  function scriptTranscriptTextForAudioAlignment(scriptPayload) {
    scriptPayload = scriptPayload || getScriptInputPayload();
    if (!(scriptPayload.tableRows || []).length) {
      return scriptPayload.text || "";
    }
    var model = canonicalScriptModel(scriptPayload);
    var lines = [];
    for (var g = 0; g < model.groups.length; g++) {
      for (var i = 0; i < model.groups[g].lines.length; i++) {
        if (model.groups[g].lines[i].text) {
          lines.push(model.groups[g].lines[i].text);
        }
      }
    }
    return lines.length ? lines.join("\n") : (scriptPayload.text || "");
  }

  function scriptInputSummary(scriptPayload) {
    if (!scriptPayload || !scriptPayload.text) {
      return "";
    }
    var rows = scriptPayload.tableRows && scriptPayload.tableRows.length ? scriptPayload.tableRows.length : 0;
    var cols = rows && scriptPayload.tableRows[0] ? scriptPayload.tableRows[0].length : 0;
    var label = scriptPayload.scriptName || "selected script";
    if (rows) {
      return label + " (" + rows + " rows" + (cols ? ", " + cols + " columns" : "") + ")";
    }
    return label + " (" + scriptPayload.text.length + " chars)";
  }

  function createSheetCell(text, isHeader) {
    var cell = document.createElement(isHeader ? "th" : "td");
    cell.contentEditable = "false";
    cell.setAttribute("role", "gridcell");
    cell.textContent = text || "";
    return cell;
  }

  function sheetSnapshot() {
    var table = els.scriptInput.querySelector("table");
    if (!table) {
      return "";
    }
    var clone = table.cloneNode(true);
    var cells = clone.querySelectorAll("td,th");
    for (var i = 0; i < cells.length; i++) {
      cells[i].className = cells[i].className
        .replace(/\s*\bis-selected\b/g, "")
        .replace(/\s*\bis-active-cell\b/g, "")
        .replace(/\s*\bis-editing\b/g, "");
      cells[i].contentEditable = "false";
      cells[i].setAttribute("aria-selected", "false");
      cells[i].setAttribute("aria-readonly", "true");
    }
    return clone.outerHTML;
  }

  function sheetHistorySnapshot() {
    var cell = currentSheetCell();
    var coords = cell ? sheetCellCoordinates(cell) : null;
    return {
      html: sheetSnapshot(),
      rowIndex: coords ? coords.row : rowIndexForCell(cell),
      colIndex: coords ? coords.col : (cell ? cell.cellIndex : 0)
    };
  }

  function updateSheetHistoryButtons() {
    if (els.undoSheetBtn) {
      els.undoSheetBtn.disabled = !sheetUndoStack.length;
    }
    if (els.redoSheetBtn) {
      els.redoSheetBtn.disabled = !sheetRedoStack.length;
    }
  }

  function resetSheetHistory() {
    sheetUndoStack = [];
    sheetRedoStack = [];
    updateSheetHistoryButtons();
  }

  function pushSheetUndo(preserveRedo) {
    clearActiveScriptValidation();
    sheetUndoStack.push(sheetHistorySnapshot());
    if (sheetUndoStack.length > 80) {
      sheetUndoStack.shift();
    }
    if (!preserveRedo) {
      sheetRedoStack = [];
    }
    updateSheetHistoryButtons();
  }

  function restoreSheetSnapshot(snapshot) {
    var html = snapshot && snapshot.html !== undefined ? snapshot.html : snapshot;
    els.scriptInput.innerHTML = html || "";
    updateSheetRails();
    var cell = snapshot && snapshot.rowIndex !== undefined ? cellAt(snapshot.rowIndex, snapshot.colIndex || 0) : els.scriptInput.querySelector("td,th");
    if (cell) {
      focusSheetCell(cell);
    }
  }

  function undoSheetChange() {
    if (sheetEditingCell && sheetCellText(sheetEditingCell) === sheetEditOriginalText) {
      finishSheetEdit(true);
    }
    if (!sheetUndoStack.length) {
      setStatus("Nothing to undo in this sheet.");
      return false;
    }
    sheetRedoStack.push(sheetHistorySnapshot());
    if (sheetRedoStack.length > 80) {
      sheetRedoStack.shift();
    }
    if (sheetEditingCell) {
      sheetEditingCell.contentEditable = "false";
      sheetEditingCell.setAttribute("aria-readonly", "true");
      sheetEditingCell.className = sheetEditingCell.className.replace(/\s*\bis-editing\b/g, "");
    }
    sheetEditMode = false;
    sheetEditingCell = null;
    sheetEditOriginalText = "";
    sheetEditUndoCaptured = false;
    restoreSheetSnapshot(sheetUndoStack.pop());
    saveActiveScriptDocument();
    updateSheetHistoryButtons();
    setStatus("Sheet undo.");
    return true;
  }

  function redoSheetChange() {
    if (!sheetRedoStack.length) {
      setStatus("Nothing to redo in this sheet.");
      return false;
    }
    sheetUndoStack.push(sheetHistorySnapshot());
    if (sheetUndoStack.length > 80) {
      sheetUndoStack.shift();
    }
    if (sheetEditingCell) {
      sheetEditingCell.contentEditable = "false";
      sheetEditingCell.setAttribute("aria-readonly", "true");
      sheetEditingCell.className = sheetEditingCell.className.replace(/\s*\bis-editing\b/g, "");
    }
    sheetEditMode = false;
    sheetEditingCell = null;
    sheetEditOriginalText = "";
    sheetEditUndoCaptured = false;
    restoreSheetSnapshot(sheetRedoStack.pop());
    saveActiveScriptDocument();
    updateSheetHistoryButtons();
    setStatus("Sheet redo.");
    return true;
  }

  function ensureScriptTable() {
    var table = els.scriptInput.querySelector("table");
    if (table) {
      updateSheetRails();
      return table;
    }
    table = document.createElement("table");
    var tbody = document.createElement("tbody");
    var tr = document.createElement("tr");
    tr.appendChild(createSheetCell("", false));
    tbody.appendChild(tr);
    table.appendChild(tbody);
    els.scriptInput.innerHTML = "";
    els.scriptInput.appendChild(table);
    updateSheetRails();
    focusSheetCell(tbody.rows[0].cells[0]);
    return table;
  }

  function isEmptySheetPlaceholder() {
    var table = els.scriptInput.querySelector("table");
    var rows = table ? table.querySelectorAll("tr") : [];
    if (rows.length !== 1 || rows[0].children.length !== 1) {
      return false;
    }
    return !String(rows[0].children[0].innerText || "").replace(/\s+/g, "");
  }

  function currentSheetCell() {
    var selection = window.getSelection ? window.getSelection() : null;
    if (!selection || !selection.anchorNode) {
      return sheetEditMode || document.activeElement === els.scriptInput || els.scriptInput.contains(document.activeElement) ? activeSheetCell() : null;
    }
    var node = selection.anchorNode.nodeType === 1 ? selection.anchorNode : selection.anchorNode.parentNode;
    while (node && node !== els.scriptInput) {
      if (node.tagName && /^(TD|TH)$/i.test(node.tagName)) {
        return node;
      }
      node = node.parentNode;
    }
    return sheetEditMode || document.activeElement === els.scriptInput || els.scriptInput.contains(document.activeElement) ? activeSheetCell() : null;
  }

  function sheetInfoForCell(table, cell) {
    var grid = logicalSheetGrid(table);
    for (var i = 0; i < grid.cells.length; i++) {
      if (grid.cells[i].cell === cell) {
        return grid.cells[i];
      }
    }
    return null;
  }

  function activeSheetCell() {
    var table = els.scriptInput.querySelector("table");
    return table ? logicalSheetCellAt(table, sheetActiveRowIndex, sheetActiveColumnIndex) : null;
  }

  function sheetCellCoordinates(cell) {
    var table = els.scriptInput.querySelector("table");
    var info = table && cell ? sheetInfoForCell(table, cell) : null;
    return info ? { row: info.originRow, col: info.originCol, info: info } : null;
  }

  function sheetCellFromEventTarget(target) {
    var node = target;
    while (node && node !== els.scriptInput) {
      if (node.tagName && /^(TD|TH)$/i.test(node.tagName)) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }

  function sheetColumnCount(table) {
    return Math.max(logicalSheetGrid(table).columnCount, 1);
  }

  function focusSheetCell(cell, preserveSelection) {
    if (!cell) {
      return;
    }
    if (sheetEditMode && sheetEditingCell !== cell) {
      finishSheetEdit(true);
    }
    var coords = sheetCellCoordinates(cell);
    sheetActiveRowIndex = coords ? coords.row : Math.max(0, rowIndexForCell(cell));
    sheetActiveColumnIndex = coords ? coords.col : Math.max(0, cell.cellIndex || 0);
    if (!preserveSelection) {
      sheetSelectionAnchorRow = sheetActiveRowIndex;
      sheetSelectionAnchorColumn = sheetActiveColumnIndex;
      setSheetSelection(sheetActiveRowIndex, sheetActiveRowIndex, sheetActiveColumnIndex, sheetActiveColumnIndex, sheetActiveRowIndex, sheetActiveColumnIndex);
    }
    els.scriptInput.focus();
    var selection = window.getSelection ? window.getSelection() : null;
    if (selection) {
      selection.removeAllRanges();
    }
    scrollSheetCellIntoView(cell);
  }

  function placeCaretAtEnd(cell) {
    var range = document.createRange();
    range.selectNodeContents(cell);
    range.collapse(false);
    var selection = window.getSelection ? window.getSelection() : null;
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  function placeCaretAtStart(cell) {
    var range = document.createRange();
    range.selectNodeContents(cell);
    range.collapse(true);
    var selection = window.getSelection ? window.getSelection() : null;
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  function placeCaretFromPoint(cell, clientX, clientY) {
    var range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(clientX, clientY);
    } else if (document.caretPositionFromPoint) {
      var position = document.caretPositionFromPoint(clientX, clientY);
      if (position) {
        range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.collapse(true);
      }
    }
    if (!range || !cell.contains(range.startContainer)) {
      placeCaretAtEnd(cell);
      return;
    }
    var selection = window.getSelection ? window.getSelection() : null;
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  function selectSheetEditingCellText() {
    if (!sheetEditingCell) {
      return;
    }
    var range = document.createRange();
    range.selectNodeContents(sheetEditingCell);
    var selection = window.getSelection ? window.getSelection() : null;
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  function sheetEventKey(event) {
    var key = String(event.key || event.code || "");
    var legacyNames = {
      Left: "ArrowLeft",
      Right: "ArrowRight",
      Up: "ArrowUp",
      Down: "ArrowDown",
      Esc: "Escape",
      Del: "Delete",
      Spacebar: " "
    };
    if (legacyNames[key]) {
      return legacyNames[key];
    }
    if (key && key !== "Unidentified") {
      return key;
    }
    var keyCode = Number(event.which || event.keyCode || 0);
    var keyCodes = {
      8: "Backspace",
      9: "Tab",
      13: "Enter",
      27: "Escape",
      32: " ",
      33: "PageUp",
      34: "PageDown",
      35: "End",
      36: "Home",
      37: "ArrowLeft",
      38: "ArrowUp",
      39: "ArrowRight",
      40: "ArrowDown",
      46: "Delete",
      113: "F2"
    };
    return keyCodes[keyCode] || (keyCode >= 65 && keyCode <= 90 ? String.fromCharCode(keyCode) : "");
  }

  function moveSheetEditingCaret(event) {
    if (!sheetEditingCell || !window.getSelection) {
      return false;
    }
    var key = sheetEventKey(event);
    var direction = "";
    var granularity = "character";
    if (key === "ArrowLeft") {
      direction = "backward";
      granularity = event.ctrlKey || event.altKey ? "word" : "character";
    } else if (key === "ArrowRight") {
      direction = "forward";
      granularity = event.ctrlKey || event.altKey ? "word" : "character";
    } else if (key === "ArrowUp") {
      direction = "backward";
      granularity = "line";
    } else if (key === "ArrowDown") {
      direction = "forward";
      granularity = "line";
    } else if (key === "Home") {
      direction = "backward";
      granularity = event.ctrlKey ? "documentboundary" : "lineboundary";
    } else if (key === "End") {
      direction = "forward";
      granularity = event.ctrlKey ? "documentboundary" : "lineboundary";
    } else if (key === "PageUp") {
      direction = "backward";
      granularity = "documentboundary";
    } else if (key === "PageDown") {
      direction = "forward";
      granularity = "documentboundary";
    } else {
      return false;
    }
    var selection = window.getSelection();
    if (!selection || typeof selection.modify !== "function") {
      return false;
    }
    selection.modify(event.shiftKey ? "extend" : "move", direction, granularity);
    if (!sheetEditingCell.contains(selection.anchorNode) || !sheetEditingCell.contains(selection.focusNode)) {
      if (direction === "backward") {
        placeCaretAtStart(sheetEditingCell);
      } else {
        placeCaretAtEnd(sheetEditingCell);
      }
    }
    return true;
  }

  function scrollSheetCellIntoView(cell) {
    if (cell && cell.scrollIntoView) {
      try {
        cell.scrollIntoView({ block: "nearest", inline: "nearest" });
      } catch (error) {
        cell.scrollIntoView(false);
      }
    }
  }

  function enterSheetEdit(cell, replacementText) {
    cell = cell || activeSheetCell();
    if (!cell) {
      return;
    }
    if (sheetEditMode && sheetEditingCell === cell) {
      placeCaretAtEnd(cell);
      return;
    }
    if (sheetEditMode) {
      finishSheetEdit(true);
    }
    focusSheetCell(cell, true);
    sheetEditMode = true;
    sheetEditingCell = cell;
    sheetEditOriginalText = sheetCellText(cell);
    pushSheetUndo(true);
    sheetEditUndoCaptured = true;
    cell.contentEditable = "true";
    cell.setAttribute("aria-readonly", "false");
    cell.className = cell.className.replace(/\s*\bis-editing\b/g, "") + " is-editing";
    if (replacementText !== undefined) {
      setCellText(cell, replacementText);
      sheetRedoStack = [];
      updateSheetHistoryButtons();
    }
    cell.focus();
    placeCaretAtEnd(cell);
    updateSheetSelectionDisplay("editing");
  }

  function finishSheetEdit(commit) {
    if (!sheetEditMode || !sheetEditingCell) {
      return null;
    }
    var cell = sheetEditingCell;
    var changed = sheetCellText(cell) !== sheetEditOriginalText;
    if (!commit) {
      setCellText(cell, sheetEditOriginalText);
      if (sheetEditUndoCaptured && sheetUndoStack.length) {
        sheetUndoStack.pop();
      }
    } else if (!changed && sheetEditUndoCaptured && sheetUndoStack.length) {
      sheetUndoStack.pop();
    } else if (changed) {
      sheetRedoStack = [];
    }
    cell.contentEditable = "false";
    cell.setAttribute("aria-readonly", "true");
    cell.className = cell.className.replace(/\s*\bis-editing\b/g, "");
    sheetEditMode = false;
    sheetEditingCell = null;
    sheetEditOriginalText = "";
    sheetEditUndoCaptured = false;
    updateSheetRails();
    updateSheetHistoryButtons();
    saveActiveScriptDocument();
    return cell;
  }

  function setCellText(cell, text) {
    var parts = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    cell.innerHTML = "";
    for (var i = 0; i < parts.length; i++) {
      if (i) {
        cell.appendChild(document.createElement("br"));
      }
      cell.appendChild(document.createTextNode(parts[i]));
    }
  }

  function cellAt(rowIndex, colIndex) {
    var table = els.scriptInput.querySelector("table");
    var rows = table ? table.querySelectorAll("tr") : [];
    if (!rows.length) {
      return null;
    }
    rowIndex = Math.max(0, Math.min(rowIndex, rows.length - 1));
    var cells = rows[rowIndex].children;
    if (!cells.length) {
      return null;
    }
    colIndex = Math.max(0, Math.min(colIndex, cells.length - 1));
    return cells[colIndex];
  }

  function rowIndexForCell(cell) {
    return cell && cell.parentNode ? Array.prototype.indexOf.call(cell.parentNode.parentNode.children, cell.parentNode) : -1;
  }

  function columnRoleOptions() {
    return {
      text: "Text",
      optimizedText: "Optimized Text",
      source: "Source",
      cut: "Cut",
      notes: "Notes",
      skip: "Skip"
    };
  }

  /* Column roles live on the first row, but every other sheet helper addresses
     columns logically (merged cells included). Indexing rows[0].children here
     would shift every role by the width of any colspan in that row. */
  function headerCellForColumn(table, colIndex) {
    if (!table || !table.querySelectorAll("tr").length) {
      return null;
    }
    var firstRow = logicalSheetGrid(table).refs[0];
    var info = firstRow ? firstRow[colIndex] : null;
    if (!info) {
      return null;
    }
    return info.originCol === colIndex ? info.cell : null;
  }

  function getColumnRole(table, colIndex) {
    var header = headerCellForColumn(table, colIndex);
    if (!header) {
      return "";
    }
    var explicit = header.getAttribute("data-column-role") || "";
    if (explicit) {
      return explicit;
    }
    var text = normalizeHeaderCell(sheetCellText(header));
    if (/optimized\s*(?:text|subtitle|caption)|subtitle\s*optimized/.test(text)) {
      return "optimizedText";
    }
    if (/overlay\s*text|caption|subtitle|srt|text\s*\[?5\]?/.test(text)) {
      return "text";
    }
    if (/source\s*file|source\s*name|media|clip\s*name/.test(text)) {
      return "source";
    }
    if (/cut\s*from\s*source|source\s*range|range|cut\s*\[?7\]?/.test(text)) {
      return "cut";
    }
    if (/note|comment|direction/.test(text)) {
      return "notes";
    }
    return "";
  }

  function findColumnByRole(table, role, fallbackPattern, oneBasedFallback) {
    var cols = table ? sheetColumnCount(table) : 0;
    var headers = [];
    for (var c = 0; c < cols; c++) {
      if (getColumnRole(table, c) === role) {
        return c;
      }
      var header = headerCellForColumn(table, c);
      headers.push(header ? sheetCellText(header) : "");
    }
    return findScriptColumn(headers, fallbackPattern, oneBasedFallback);
  }

  function selectedColumnIndex() {
    if (sheetSelection && sheetSelection.colStart === sheetSelection.colEnd) {
      return sheetSelection.colStart;
    }
    var cell = currentSheetCell();
    if (cell) {
      sheetActiveRowIndex = Math.max(0, rowIndexForCell(cell));
      sheetActiveColumnIndex = Math.max(0, logicalColumnForCell(cell));
      return sheetActiveColumnIndex;
    }
    var table = els.scriptInput.querySelector("table");
    var cols = table ? sheetColumnCount(table) : 0;
    if (cols && sheetActiveColumnIndex >= 0 && sheetActiveColumnIndex < cols) {
      return sheetActiveColumnIndex;
    }
    return -1;
  }

  function setSheetSelection(rowStart, rowEnd, colStart, colEnd, activeRow, activeCol) {
    var table = els.scriptInput.querySelector("table");
    var rows = table ? table.querySelectorAll("tr") : [];
    var cols = table ? sheetColumnCount(table) : 0;
    if (!rows.length || !cols) {
      sheetSelection = null;
      updateSheetSelectionDisplay();
      return;
    }
    sheetSelection = {
      rowStart: Math.max(0, Math.min(rowStart, rowEnd)),
      rowEnd: Math.min(rows.length - 1, Math.max(rowStart, rowEnd)),
      colStart: Math.max(0, Math.min(colStart, colEnd)),
      colEnd: Math.min(cols - 1, Math.max(colStart, colEnd))
    };
    sheetActiveRowIndex = activeRow === undefined ? sheetSelection.rowStart : Math.max(0, Math.min(activeRow, rows.length - 1));
    sheetActiveColumnIndex = activeCol === undefined ? sheetSelection.colStart : Math.max(0, Math.min(activeCol, cols - 1));
    applySheetSelectionClasses();
    updateSheetSelectionDisplay();
  }

  function clearSheetSelection() {
    sheetSelection = null;
    applySheetSelectionClasses();
    updateSheetSelectionDisplay();
  }

  function applySheetSelectionClasses() {
    var table = els.scriptInput.querySelector("table");
    var cells = table ? table.querySelectorAll("td,th") : [];
    for (var i = 0; i < cells.length; i++) {
      cells[i].className = cells[i].className
        .replace(/\s*\bis-selected\b/g, "")
        .replace(/\s*\bis-active-cell\b/g, "")
        .replace(/\s*\bis-empty-cell\b/g, "");
      cells[i].setAttribute("aria-selected", "false");
    }
    var handles = document.querySelectorAll(".sheet-handle");
    for (var h = 0; h < handles.length; h++) {
      handles[h].className = handles[h].className.replace(/\s*\bis-selected\b/g, "");
    }
    if (!sheetSelection || !table) {
      return;
    }
    var grid = logicalSheetGrid(table);
    var selectedCells = [];
    for (var r = sheetSelection.rowStart; r <= sheetSelection.rowEnd; r++) {
      for (var c = sheetSelection.colStart; c <= sheetSelection.colEnd; c++) {
        var info = grid.refs[r] && grid.refs[r][c] ? grid.refs[r][c] : null;
        if (info && selectedCells.indexOf(info.cell) === -1) {
          selectedCells.push(info.cell);
          info.cell.className += " is-selected";
          info.cell.setAttribute("aria-selected", "true");
        }
      }
    }
    var active = activeSheetCell();
    if (active) {
      active.className = active.className.replace(/\s*\bis-active-cell\b/g, "") + " is-active-cell";
      if (!sheetCellText(active).replace(/\s+/g, "")) {
        active.className += " is-empty-cell";
      }
    }
    var rowHandles = els.sheetRowRail ? els.sheetRowRail.querySelectorAll(".sheet-row-handle") : [];
    for (var rh = sheetSelection.rowStart; rh <= sheetSelection.rowEnd; rh++) {
      if (rowHandles[rh]) {
        rowHandles[rh].className += " is-selected";
      }
    }
    var colHandles = els.sheetColumnRail ? els.sheetColumnRail.querySelectorAll(".sheet-column-handle") : [];
    for (var ch = sheetSelection.colStart; ch <= sheetSelection.colEnd; ch++) {
      if (colHandles[ch]) {
        colHandles[ch].className += " is-selected";
      }
    }
  }

  function updateSheetSelectionDisplay(extraText) {
    if (!els.sheetSelectionSummary) {
      return;
    }
    var table = els.scriptInput.querySelector("table");
    var text = "No cells selected";
    if (sheetSelection && table) {
      var rows = sheetSelection.rowEnd - sheetSelection.rowStart + 1;
      var cols = sheetSelection.colEnd - sheetSelection.colStart + 1;
      text = columnLabel(sheetActiveColumnIndex) + String(sheetActiveRowIndex + 1) + " | " + rows + " row" + (rows === 1 ? "" : "s") + " x " + cols + " col" + (cols === 1 ? "" : "s") + " selected";
      var cutIndex = findColumnByRole(table, "cut", /cut\s*from\s*source|cut|source\s*range|range/, 7);
      if (cutIndex >= sheetSelection.colStart && cutIndex <= sheetSelection.colEnd) {
        var selectionGrid = logicalSheetGrid(table);
        var countedCutCells = [];
        var total = 0;
        for (var r = Math.max(1, sheetSelection.rowStart); r <= sheetSelection.rowEnd; r++) {
          var cutInfo = selectionGrid.refs[r] && selectionGrid.refs[r][cutIndex] ? selectionGrid.refs[r][cutIndex] : null;
          var cutCell = cutInfo ? cutInfo.cell : null;
          if (cutCell && countedCutCells.indexOf(cutCell) !== -1) {
            continue;
          }
          if (cutCell) {
            countedCutCells.push(cutCell);
          }
          var cut = cutCell ? parseCutDurationSeconds(sheetCellText(cutCell)) : null;
          if (cut && cut.durationSeconds !== null) {
            total += cut.durationSeconds;
          }
        }
        if (total > 0) {
          text += " | cuts " + formatCompactSeconds(total);
        }
      }
    }
    if (extraText) {
      text += " | " + extraText;
    }
    els.sheetSelectionSummary.textContent = text;
    syncSheetColumnRoleControl();
  }

  function syncSheetColumnRoleControl() {
    if (!els.sheetColumnRole) {
      return;
    }
    var table = els.scriptInput.querySelector("table");
    var col = selectedColumnIndex();
    els.sheetColumnRole.disabled = !table || col < 0;
    els.sheetColumnRole.value = table && col >= 0 ? getColumnRole(table, col) : "";
  }

  function formatCompactSeconds(seconds) {
    seconds = Math.max(0, Number(seconds || 0));
    var minutes = Math.floor(seconds / 60);
    var remainder = Math.round((seconds % 60) * 10) / 10;
    if (minutes) {
      return minutes + ":" + (remainder < 10 ? "0" : "") + remainder.toFixed(remainder % 1 ? 1 : 0);
    }
    return remainder.toFixed(remainder % 1 ? 1 : 0) + "s";
  }

  function normalizeSheetInputFocus() {
    var cell = currentSheetCell();
    if (cell) {
      return cell;
    }
    var table = ensureScriptTable();
    var firstCell = table.querySelector("td,th");
    focusSheetCell(firstCell);
    return firstCell;
  }

  function handleSheetBeforeInput(event) {
    var cell = currentSheetCell();
    if (!cell) {
      event.preventDefault();
      normalizeSheetInputFocus();
      return;
    }
    if (event.inputType !== "historyUndo" && event.inputType !== "historyRedo" && sheetEditMode) {
      sheetRedoStack = [];
      updateSheetHistoryButtons();
    }
  }

  function handleSheetInput() {
    if (sheetEditMode && sheetEditingCell && sheetCellText(sheetEditingCell) !== sheetEditOriginalText) {
      sheetRedoStack = [];
      updateSheetHistoryButtons();
    }
    saveActiveScriptDocument();
  }

  function isPrintableSheetKey(event) {
    return !event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing && event.key && event.key.length === 1;
  }

  function consumeSheetKey(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) {
      event.stopImmediatePropagation();
    }
  }

  function sheetSelectionBounds() {
    if (sheetSelection) {
      return sheetSelection;
    }
    return {
      rowStart: sheetActiveRowIndex,
      rowEnd: sheetActiveRowIndex,
      colStart: sheetActiveColumnIndex,
      colEnd: sheetActiveColumnIndex
    };
  }

  function clearSelectedSheetCells() {
    var table = els.scriptInput.querySelector("table");
    if (!table) {
      return false;
    }
    var bounds = sheetSelectionBounds();
    var grid = logicalSheetGrid(table);
    var targets = [];
    for (var r = bounds.rowStart; r <= bounds.rowEnd; r++) {
      for (var c = bounds.colStart; c <= bounds.colEnd; c++) {
        var info = grid.refs[r] && grid.refs[r][c] ? grid.refs[r][c] : null;
        if (info && targets.indexOf(info.cell) === -1) {
          targets.push(info.cell);
        }
      }
    }
    if (!targets.length) {
      return false;
    }
    pushSheetUndo();
    for (var i = 0; i < targets.length; i++) {
      setCellText(targets[i], "");
    }
    updateSheetRails();
    saveActiveScriptDocument();
    return true;
  }

  function selectSheetCoordinates(row, col, extend) {
    var table = els.scriptInput.querySelector("table");
    var grid = table ? logicalSheetGrid(table) : null;
    if (!grid || !grid.rows.length || !grid.columnCount) {
      return;
    }
    row = Math.max(0, Math.min(row, grid.rows.length - 1));
    col = Math.max(0, Math.min(col, grid.columnCount - 1));
    var info = grid.refs[row] && grid.refs[row][col] ? grid.refs[row][col] : null;
    if (!info) {
      return;
    }
    row = info.originRow;
    col = info.originCol;
    if (!extend) {
      sheetSelectionAnchorRow = row;
      sheetSelectionAnchorColumn = col;
      setSheetSelection(row, row + info.rowspan - 1, col, col + info.colspan - 1, row, col);
    } else {
      var anchorInfo = grid.refs[sheetSelectionAnchorRow] && grid.refs[sheetSelectionAnchorRow][sheetSelectionAnchorColumn] ? grid.refs[sheetSelectionAnchorRow][sheetSelectionAnchorColumn] : null;
      var anchorRowEnd = anchorInfo ? anchorInfo.originRow + anchorInfo.rowspan - 1 : sheetSelectionAnchorRow;
      var anchorColEnd = anchorInfo ? anchorInfo.originCol + anchorInfo.colspan - 1 : sheetSelectionAnchorColumn;
      setSheetSelection(
        Math.min(sheetSelectionAnchorRow, row),
        Math.max(anchorRowEnd, row + info.rowspan - 1),
        Math.min(sheetSelectionAnchorColumn, col),
        Math.max(anchorColEnd, col + info.colspan - 1),
        row,
        col
      );
    }
    els.scriptInput.focus();
    scrollSheetCellIntoView(info.cell);
  }

  function moveSheetSelection(key, extend, jump, reverseTab) {
    var table = els.scriptInput.querySelector("table");
    var grid = table ? logicalSheetGrid(table) : null;
    if (!grid || !grid.rows.length) {
      return;
    }
    var info = grid.refs[sheetActiveRowIndex] && grid.refs[sheetActiveRowIndex][sheetActiveColumnIndex] ? grid.refs[sheetActiveRowIndex][sheetActiveColumnIndex] : null;
    if (!info) {
      return;
    }
    var row = info.originRow;
    var col = info.originCol;
    if (key === "ArrowUp") {
      row = jump ? 0 : info.originRow - 1;
    } else if (key === "ArrowDown" || key === "Enter") {
      row = jump ? grid.rows.length - 1 : info.originRow + info.rowspan;
    } else if (key === "ArrowLeft") {
      col = jump ? 0 : info.originCol - 1;
    } else if (key === "ArrowRight") {
      col = jump ? grid.columnCount - 1 : info.originCol + info.colspan;
    } else if (key === "Home") {
      row = jump ? 0 : info.originRow;
      col = 0;
    } else if (key === "End") {
      row = jump ? grid.rows.length - 1 : info.originRow;
      col = grid.columnCount - 1;
    } else if (key === "PageUp") {
      row = info.originRow - 10;
    } else if (key === "PageDown") {
      row = info.originRow + 10;
    } else if (key === "Tab") {
      if (reverseTab) {
        col = info.originCol - 1;
        if (col < 0 && info.originRow > 0) {
          row = info.originRow - 1;
          col = grid.columnCount - 1;
        }
      } else {
        col = info.originCol + info.colspan;
        if (col >= grid.columnCount) {
          row = info.originRow + info.rowspan;
          col = 0;
        }
      }
      extend = false;
    }
    if (row >= grid.rows.length && (key === "Enter" || key === "Tab") && !extend) {
      addSheetRow();
      table = els.scriptInput.querySelector("table");
      grid = logicalSheetGrid(table);
      row = Math.min(row, grid.rows.length - 1);
    }
    row = Math.max(0, Math.min(row, grid.rows.length - 1));
    col = Math.max(0, Math.min(col, grid.columnCount - 1));
    selectSheetCoordinates(row, col, extend);
  }

  function handleSheetKeyDown(event) {
    var key = sheetEventKey(event);
    var historyKey = String(key).toLowerCase();
    var isBlockedCommandHistory = event.metaKey && (historyKey === "z" || historyKey === "y");
    var isSheetUndo = event.ctrlKey && !event.metaKey && !event.shiftKey && historyKey === "z";
    var isSheetRedo = event.ctrlKey && !event.metaKey && ((event.shiftKey && historyKey === "z") || (!event.shiftKey && historyKey === "y"));
    if (isBlockedCommandHistory) {
      consumeSheetKey(event);
      setStatus("Script editor uses Ctrl+Z for undo and Ctrl+Shift+Z for redo.");
      return;
    }
    if (isSheetUndo || isSheetRedo) {
      if (sheetEditMode) {
        consumeSheetKey(event);
        document.execCommand(isSheetRedo ? "redo" : "undo", false, null);
        saveActiveScriptDocument();
        return;
      }
      consumeSheetKey(event);
      if (isSheetRedo) {
        redoSheetChange();
      } else {
        undoSheetChange();
      }
      return;
    }
    if (sheetEditMode) {
      if (moveSheetEditingCaret(event)) {
        consumeSheetKey(event);
      } else if ((event.ctrlKey || event.metaKey) && historyKey === "a") {
        consumeSheetKey(event);
        selectSheetEditingCellText();
      } else if (key === "Escape") {
        consumeSheetKey(event);
        var cancelledCell = finishSheetEdit(false);
        focusSheetCell(cancelledCell);
      } else if (key === "Enter" && event.altKey) {
        consumeSheetKey(event);
        document.execCommand("insertLineBreak", false, null);
      } else if (key === "Tab" || (key === "Enter" && !event.altKey)) {
        consumeSheetKey(event);
        var stay = (event.metaKey || event.ctrlKey) && key === "Enter";
        var editedCell = finishSheetEdit(true);
        focusSheetCell(editedCell);
        if (!stay) {
          moveSheetSelection(key === "Enter" && event.shiftKey ? "ArrowUp" : key, false, false, key === "Tab" && event.shiftKey);
        }
      } else {
        event.stopPropagation();
        if (event.stopImmediatePropagation) {
          event.stopImmediatePropagation();
        }
      }
      return;
    }
    if ((event.metaKey || event.ctrlKey) && historyKey === "a") {
      var allTable = els.scriptInput.querySelector("table");
      var allGrid = allTable ? logicalSheetGrid(allTable) : null;
      if (allGrid && allGrid.rows.length && allGrid.columnCount) {
        consumeSheetKey(event);
        sheetSelectionAnchorRow = 0;
        sheetSelectionAnchorColumn = 0;
        setSheetSelection(0, allGrid.rows.length - 1, 0, allGrid.columnCount - 1, sheetActiveRowIndex, sheetActiveColumnIndex);
      }
      return;
    }
    if (key === "F2") {
      consumeSheetKey(event);
      enterSheetEdit(activeSheetCell());
      return;
    }
    if (isPrintableSheetKey(event)) {
      consumeSheetKey(event);
      enterSheetEdit(activeSheetCell(), event.key);
      return;
    }
    if ((key === "Backspace" || key === "Delete") && !event.metaKey && !event.ctrlKey && !event.altKey) {
      consumeSheetKey(event);
      clearSelectedSheetCells();
      return;
    }
    if (event.altKey || event.isComposing) {
      return;
    }
    if (key !== "ArrowUp" && key !== "ArrowDown" && key !== "ArrowLeft" && key !== "ArrowRight" && key !== "Tab" && key !== "Enter" && key !== "Home" && key !== "End" && key !== "PageUp" && key !== "PageDown") {
      return;
    }
    consumeSheetKey(event);
    normalizeSheetInputFocus();
    if (key === "Enter" && event.shiftKey) {
      moveSheetSelection("ArrowUp", false, false, false);
    } else {
      moveSheetSelection(key, key !== "Tab" && event.shiftKey, event.metaKey || event.ctrlKey, key === "Tab" && event.shiftKey);
    }
  }

  function handleSheetCellMouseDown(event) {
    var cell = sheetCellFromEventTarget(event.target);
    if (!cell) {
      return;
    }
    if (sheetEditMode && sheetEditingCell === cell) {
      return;
    }
    if (sheetEditMode) {
      finishSheetEdit(true);
    }
    var coords = sheetCellCoordinates(cell);
    var rowIndex = coords ? coords.row : rowIndexForCell(cell);
    var colIndex = coords ? coords.col : cell.cellIndex;
    if (event.shiftKey && sheetSelection) {
      event.preventDefault();
      sheetPointerDownCell = null;
      selectSheetCoordinates(rowIndex, colIndex, true);
      return;
    }
    event.preventDefault();
    sheetCellDragAnchor = { rowIndex: rowIndex, colIndex: colIndex };
    sheetPointerDownCell = cell;
    sheetPointerDownX = Number(event.clientX || 0);
    sheetPointerDownY = Number(event.clientY || 0);
    sheetPointerDragged = false;
    sheetLastRowIndex = rowIndex;
    sheetLastColumnIndex = colIndex;
    selectSheetCoordinates(rowIndex, colIndex, false);
  }

  function handleSheetCellMouseOver(event) {
    if (!sheetCellDragAnchor || event.buttons !== 1) {
      return;
    }
    var cell = sheetCellFromEventTarget(event.target);
    if (!cell) {
      return;
    }
    event.preventDefault();
    if (cell !== sheetPointerDownCell) {
      sheetPointerDragged = true;
    }
    var coords = sheetCellCoordinates(cell);
    if (coords) {
      setSheetSelection(sheetCellDragAnchor.rowIndex, coords.row, sheetCellDragAnchor.colIndex, coords.col, coords.row, coords.col);
    }
  }

  function handleSheetPointerMove(event) {
    if (!sheetPointerDownCell || event.buttons !== 1) {
      return;
    }
    if (Math.abs(Number(event.clientX || 0) - sheetPointerDownX) > 4 || Math.abs(Number(event.clientY || 0) - sheetPointerDownY) > 4) {
      sheetPointerDragged = true;
    }
  }

  function handleSheetCellMouseUp(event) {
    var clickedCell = sheetCellFromEventTarget(event.target);
    var shouldEdit = sheetPointerDownCell && !sheetPointerDragged && clickedCell === sheetPointerDownCell && !event.shiftKey && Number(event.button || 0) === 0;
    var editCell = sheetPointerDownCell;
    sheetCellDragAnchor = null;
    sheetPointerDownCell = null;
    sheetPointerDragged = false;
    if (shouldEdit && editCell) {
      enterSheetEdit(editCell);
      placeCaretFromPoint(editCell, event.clientX, event.clientY);
    }
  }

  function sheetHasFocus() {
    var active = document.activeElement;
    if (active === els.scriptInput) {
      return true;
    }
    while (active) {
      if (active === els.scriptInput) {
        return true;
      }
      active = active.parentNode;
    }
    return sheetEditMode;
  }

  function blockSheetNavigationLeak(event) {
    if (!sheetHasFocus() || sheetEditMode) {
      return;
    }
    var key = sheetEventKey(event);
    if (key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight" || key === "Tab" || key === "Home" || key === "End" || key === "PageUp" || key === "PageDown") {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) {
        event.stopImmediatePropagation();
      }
      handleSheetKeyDown(event);
    }
  }

  function handleScriptEditorControlArrow(event) {
    if (!els.scriptEditorOverlay || els.scriptEditorOverlay.hidden || !event.ctrlKey || event.metaKey || event.altKey || !sheetHasFocus()) {
      return;
    }
    var key = sheetEventKey(event);
    if (key !== "ArrowUp" && key !== "ArrowDown" && key !== "ArrowLeft" && key !== "ArrowRight") {
      return;
    }
    if (sheetEditMode) {
      if (!moveSheetEditingCaret(event)) {
        if (key === "ArrowLeft" || key === "ArrowUp") {
          placeCaretAtStart(sheetEditingCell);
        } else {
          placeCaretAtEnd(sheetEditingCell);
        }
      }
      consumeSheetKey(event);
      return;
    }
    consumeSheetKey(event);
    normalizeSheetInputFocus();
    moveSheetSelection(key, event.shiftKey, false, false);
  }

  function updateSheetDiagnostics() {
    var table = els.scriptInput.querySelector("table");
    if (!table) {
      updateSheetSelectionDisplay();
      return;
    }
    var rows = table.querySelectorAll("tr");
    var cells = table.querySelectorAll("td,th");
    for (var i = 0; i < cells.length; i++) {
      cells[i].className = cells[i].className
        .replace(/\s*\bis-invalid\b/g, "")
        .replace(/\s*\bis-warning\b/g, "")
        .replace(/\s*\bis-validation-error\b/g, "");
      cells[i].removeAttribute("data-sheet-warning");
      cells[i].removeAttribute("title");
    }
    var cutIndex = findColumnByRole(table, "cut", /cut\s*from\s*source|cut|source\s*range|range/, 7);
    var sourceIndex = findColumnByRole(table, "source", /source\s*file|source\s*name|media|clip\s*name|source/, 6);
    var textIndex = findColumnByRole(table, "text", /overlay\s*text|caption|subtitle|srt|text\s*\[?5\]?/, 5);
    var warningCount = 0;
    var totalDuration = 0;
    var rowHandles = els.sheetRowRail ? els.sheetRowRail.querySelectorAll(".sheet-row-handle") : [];
    for (var r = 1; r < rows.length; r++) {
      var cutCell = cutIndex >= 0 ? rows[r].children[cutIndex] : null;
      var sourceCell = sourceIndex >= 0 ? rows[r].children[sourceIndex] : null;
      var textCell = textIndex >= 0 ? rows[r].children[textIndex] : null;
      var cut = cutCell ? parseCutDurationSeconds(sheetCellText(cutCell)) : null;
      if (cut && cut.durationSeconds !== null) {
        totalDuration += cut.durationSeconds;
        if (rowHandles[r]) {
          var durationChip = document.createElement("span");
          durationChip.className = "sheet-duration-chip";
          durationChip.textContent = formatCompactSeconds(cut.durationSeconds);
          rowHandles[r].appendChild(durationChip);
        }
      }
      if (cutCell && cut && cut.unresolved.length) {
        cutCell.className += " is-warning";
        cutCell.setAttribute("data-sheet-warning", "Unparsed cut line: " + cut.unresolved.join(", "));
        cutCell.title = "Unparsed cut line: " + cut.unresolved.join(", ");
        warningCount++;
      }
      if (cutCell && sheetCellText(cutCell) && (!cut || cut.durationSeconds === null)) {
        cutCell.className += " is-invalid";
        cutCell.setAttribute("data-sheet-warning", "Use a range like 5-8s or a single-second selection like giây 11.");
        cutCell.title = "Use a range like 5-8s or a single-second selection like giây 11.";
        warningCount++;
      }
      if (sourceCell && !sheetCellText(sourceCell) && cutCell && sheetCellText(cutCell)) {
        sourceCell.className += " is-warning";
        sourceCell.setAttribute("data-sheet-warning", "Cut exists but source file is empty.");
        sourceCell.title = "Cut exists but source file is empty.";
        warningCount++;
      }
      if (textCell && cleanOverlayCaptionText(sheetCellText(textCell)) && cutCell && !sheetCellText(cutCell)) {
        cutCell.className += " is-warning";
        cutCell.setAttribute("data-sheet-warning", "Text row has no cut timing.");
        cutCell.title = "Text row has no cut timing.";
        warningCount++;
      }
    }
    var extra = [];
    if (totalDuration > 0) {
      extra.push("total cuts " + formatCompactSeconds(totalDuration));
    }
    if (warningCount) {
      extra.push(warningCount + " warning" + (warningCount === 1 ? "" : "s"));
    }
    applyActiveScriptValidationHighlights(table);
    updateSheetSelectionDisplay(extra.join(" | "));
  }

  function applyActiveScriptValidationHighlights(table) {
    var script = activeScriptDocument();
    var validation = script && script.validation ? script.validation : null;
    var issueCells = validation && validation.issueCells ? validation.issueCells : [];
    if (!table || !issueCells.length) {
      return;
    }
    var rows = table.querySelectorAll("tr");
    for (var i = 0; i < issueCells.length; i++) {
      var rowIndex = Math.max(0, Number(issueCells[i].row || 1) - 1);
      var colIndex = Math.max(0, Number(issueCells[i].column || 1) - 1);
      var cell = rows[rowIndex] && rows[rowIndex].children[colIndex] ? rows[rowIndex].children[colIndex] : null;
      if (!cell) {
        continue;
      }
      cell.className += " is-validation-error";
      var message = issueCells[i].message || validation.message || "Validation issue";
      cell.setAttribute("data-sheet-warning", message);
      cell.title = message;
    }
  }

  function updateSheetRails() {
    if (!els.sheetColumnRail || !els.sheetRowRail) {
      return;
    }
    var table = els.scriptInput.querySelector("table");
    if (table) {
      normalizeSheetDom(table);
    } else {
      sheetSelection = null;
    }
    var rows = table ? table.querySelectorAll("tr") : [];
    var cols = table ? sheetColumnCount(table) : 0;

    while (els.sheetColumnRail.firstChild) {
      els.sheetColumnRail.removeChild(els.sheetColumnRail.firstChild);
    }
    for (var c = 0; c < cols; c++) {
      var colHandle = document.createElement("button");
      colHandle.type = "button";
      colHandle.className = "sheet-handle sheet-column-handle";
      colHandle.draggable = true;
      colHandle.setAttribute("data-col-index", String(c));
      colHandle.title = "Drag column " + columnLabel(c) + " to reorder. Shift-click to select a range.";
      var colLabel = document.createElement("span");
      colLabel.className = "sheet-handle-label";
      colLabel.textContent = columnLabel(c);
      colHandle.appendChild(colLabel);
      var role = getColumnRole(table, c);
      if (role) {
        var roleChip = document.createElement("span");
        roleChip.className = "sheet-role-chip";
        roleChip.textContent = columnRoleOptions()[role] || role;
        colHandle.appendChild(roleChip);
      }
      colHandle.addEventListener("click", handleSheetColumnHandleClick);
      colHandle.addEventListener("dragstart", handleSheetColumnDragStart);
      colHandle.addEventListener("dragover", handleSheetColumnDragOver);
      colHandle.addEventListener("dragleave", handleSheetColumnDragLeave);
      colHandle.addEventListener("drop", handleSheetColumnDrop);
      colHandle.addEventListener("dragend", handleSheetColumnDragEnd);
      colHandle.addEventListener("contextmenu", openSheetColumnMenu);
      els.sheetColumnRail.appendChild(colHandle);
    }
    els.sheetColumnRail.appendChild(els.addSheetColumnBtn);

    while (els.sheetRowRail.firstChild) {
      els.sheetRowRail.removeChild(els.sheetRowRail.firstChild);
    }
    for (var r = 0; r < rows.length; r++) {
      var rowHandle = document.createElement("button");
      rowHandle.type = "button";
      rowHandle.className = "sheet-handle sheet-row-handle";
      var rowLabel = document.createElement("span");
      rowLabel.className = "sheet-handle-label";
      rowLabel.textContent = String(r + 1);
      rowHandle.appendChild(rowLabel);
      rowHandle.title = "Drag row " + (r + 1) + " to reorder. Right-click for options.";
      rowHandle.draggable = true;
      rowHandle.setAttribute("data-row-index", String(r));
      rowHandle.addEventListener("click", handleSheetRowHandleClick);
      rowHandle.addEventListener("dragstart", handleSheetRowDragStart);
      rowHandle.addEventListener("dragover", handleSheetRowDragOver);
      rowHandle.addEventListener("dragleave", handleSheetRowDragLeave);
      rowHandle.addEventListener("drop", handleSheetRowDrop);
      rowHandle.addEventListener("dragend", handleSheetRowDragEnd);
      rowHandle.addEventListener("contextmenu", openSheetRowMenu);
      els.sheetRowRail.appendChild(rowHandle);
    }
    els.sheetRowRail.appendChild(els.addSheetRowBtn);
    updateSheetDiagnostics();
    applySheetSelectionClasses();
    updateSheetSelectionDisplay();
  }

  function normalizeSheetDom(table) {
    var cells = table.querySelectorAll("td,th");
    for (var i = 0; i < cells.length; i++) {
      cells[i].contentEditable = sheetEditMode && cells[i] === sheetEditingCell ? "true" : "false";
      if (!(sheetEditMode && cells[i] === sheetEditingCell)) {
        cells[i].className = cells[i].className.replace(/\s*\bis-editing\b/g, "");
      }
      cells[i].setAttribute("role", "gridcell");
      cells[i].setAttribute("aria-readonly", sheetEditMode && cells[i] === sheetEditingCell ? "false" : "true");
    }
    var nodes = [];
    for (var n = 0; n < els.scriptInput.childNodes.length; n++) {
      nodes.push(els.scriptInput.childNodes[n]);
    }
    for (var j = 0; j < nodes.length; j++) {
      if (nodes[j] !== table) {
        els.scriptInput.removeChild(nodes[j]);
      }
    }
  }

  function columnLabel(index) {
    var label = "";
    var n = index;
    do {
      label = String.fromCharCode(65 + (n % 26)) + label;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return label;
  }

  function handleSheetRowHandleClick(event) {
    var rowIndex = Number(event.currentTarget.getAttribute("data-row-index"));
    var table = els.scriptInput.querySelector("table");
    var cols = table ? sheetColumnCount(table) : 0;
    if (!cols || isNaN(rowIndex)) {
      return;
    }
    if (event.shiftKey && sheetLastRowIndex !== null) {
      setSheetSelection(sheetLastRowIndex, rowIndex, 0, cols - 1);
    } else {
      setSheetSelection(rowIndex, rowIndex, 0, cols - 1);
      sheetLastRowIndex = rowIndex;
    }
    focusSheetCell(logicalSheetCellAt(table, rowIndex, 0), true);
  }

  function handleSheetColumnHandleClick(event) {
    var colIndex = Number(event.currentTarget.getAttribute("data-col-index"));
    var table = els.scriptInput.querySelector("table");
    var rows = table ? table.querySelectorAll("tr") : [];
    if (!rows.length || isNaN(colIndex)) {
      return;
    }
    if (event.shiftKey && sheetLastColumnIndex !== null) {
      setSheetSelection(0, rows.length - 1, sheetLastColumnIndex, colIndex);
    } else {
      setSheetSelection(0, rows.length - 1, colIndex, colIndex);
      sheetLastColumnIndex = colIndex;
    }
    focusSheetCell(logicalSheetCellAt(table, 0, colIndex), true);
  }

  function handleSheetRowDragStart(event) {
    sheetDraggedRowIndex = Number(event.currentTarget.getAttribute("data-row-index"));
    event.currentTarget.className += " is-dragging";
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(sheetDraggedRowIndex));
    }
  }

  function handleSheetRowDragOver(event) {
    event.preventDefault();
    event.currentTarget.className = event.currentTarget.className.replace(/\s*\bis-drop-target\b/g, "") + " is-drop-target";
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
  }

  function handleSheetRowDragLeave(event) {
    event.currentTarget.className = event.currentTarget.className.replace(/\s*\bis-drop-target\b/g, "");
  }

  function handleSheetRowDrop(event) {
    event.preventDefault();
    var toIndex = Number(event.currentTarget.getAttribute("data-row-index"));
    moveSheetRow(sheetDraggedRowIndex, toIndex);
    sheetDraggedRowIndex = null;
  }

  function handleSheetRowDragEnd() {
    sheetDraggedRowIndex = null;
    updateSheetRails();
  }

  function handleSheetColumnDragStart(event) {
    sheetDraggedColumnIndex = Number(event.currentTarget.getAttribute("data-col-index"));
    event.currentTarget.className += " is-dragging";
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(sheetDraggedColumnIndex));
    }
  }

  function handleSheetColumnDragOver(event) {
    event.preventDefault();
    event.currentTarget.className = event.currentTarget.className.replace(/\s*\bis-drop-target\b/g, "") + " is-drop-target";
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
  }

  function handleSheetColumnDragLeave(event) {
    event.currentTarget.className = event.currentTarget.className.replace(/\s*\bis-drop-target\b/g, "");
  }

  function handleSheetColumnDrop(event) {
    event.preventDefault();
    var toIndex = Number(event.currentTarget.getAttribute("data-col-index"));
    moveSheetColumn(sheetDraggedColumnIndex, toIndex);
    sheetDraggedColumnIndex = null;
  }

  function handleSheetColumnDragEnd() {
    sheetDraggedColumnIndex = null;
    updateSheetRails();
  }

  function moveSheetRow(fromIndex, toIndex) {
    if (fromIndex === null || isNaN(fromIndex) || isNaN(toIndex) || fromIndex === toIndex) {
      updateSheetRails();
      return;
    }
    var table = els.scriptInput.querySelector("table");
    var tbody = table && (table.tBodies[0] || table);
    var rows = tbody ? tbody.querySelectorAll("tr") : [];
    if (!tbody || fromIndex < 0 || toIndex < 0 || fromIndex >= rows.length || toIndex >= rows.length) {
      updateSheetRails();
      return;
    }
    pushSheetUndo();
    var row = rows[fromIndex];
    var target = rows[toIndex];
    if (fromIndex < toIndex) {
      tbody.insertBefore(row, target.nextSibling);
    } else {
      tbody.insertBefore(row, target);
    }
    updateSheetRails();
    saveActiveScriptDocument();
    setStatus("Sheet row moved.");
  }

  function moveSheetColumn(fromIndex, toIndex) {
    if (fromIndex === null || isNaN(fromIndex) || isNaN(toIndex) || fromIndex === toIndex) {
      updateSheetRails();
      return;
    }
    var table = els.scriptInput.querySelector("table");
    var rows = table ? table.querySelectorAll("tr") : [];
    var cols = table ? sheetColumnCount(table) : 0;
    if (!table || fromIndex < 0 || toIndex < 0 || fromIndex >= cols || toIndex >= cols) {
      updateSheetRails();
      return;
    }
    pushSheetUndo();
    for (var r = 0; r < rows.length; r++) {
      var cell = rows[r].children[fromIndex];
      var target = rows[r].children[toIndex];
      if (!cell || !target) {
        continue;
      }
      if (fromIndex < toIndex) {
        rows[r].insertBefore(cell, target.nextSibling);
      } else {
        rows[r].insertBefore(cell, target);
      }
    }
    setSheetSelection(0, Math.max(0, rows.length - 1), toIndex, toIndex);
    updateSheetRails();
    saveActiveScriptDocument();
    setStatus("Sheet column moved.");
  }

  function openSheetRowMenu(event) {
    event.preventDefault();
    sheetContextRowIndex = Number(event.currentTarget.getAttribute("data-row-index"));
    sheetContextColumnIndex = selectedColumnIndex();
    if (isNaN(sheetContextColumnIndex) || sheetContextColumnIndex < 0) {
      sheetContextColumnIndex = 0;
    }
    setSheetSelection(sheetContextRowIndex, sheetContextRowIndex, 0, Math.max(0, sheetColumnCount(els.scriptInput.querySelector("table")) - 1));
    openSheetContextMenuAt(event.clientX, event.clientY);
  }

  function openSheetColumnMenu(event) {
    event.preventDefault();
    sheetContextColumnIndex = Number(event.currentTarget.getAttribute("data-col-index"));
    sheetContextRowIndex = currentSheetCell() ? rowIndexForCell(currentSheetCell()) : 0;
    var table = els.scriptInput.querySelector("table");
    var rows = table ? table.querySelectorAll("tr") : [];
    setSheetSelection(0, Math.max(0, rows.length - 1), sheetContextColumnIndex, sheetContextColumnIndex);
    openSheetContextMenuAt(event.clientX, event.clientY);
  }

  /* A merged cell is one DOM node stretched across several rows or columns, so
     right-clicking anywhere inside it always hits that same node. Using its
     raw DOM position (cell.cellIndex, the physical <td> count in that one
     <tr>) as the target row/column is wrong the moment an earlier row's
     rowspan - or an earlier cell's colspan - has consumed a slot: the physical
     count no longer lines up with the logical column, and Delete Row/Column
     silently acts on whichever adjacent row/column the math landed on
     instead. Resolve both through the same logical grid every other sheet
     operation already uses. */
  function rowIndexFromCellClick(cell, clientY) {
    var origin = rowIndexForCell(cell);
    var rowSpan = Math.max(1, Number(cell.getAttribute("rowspan") || cell.rowSpan || 1));
    if (rowSpan <= 1 || typeof clientY !== "number") {
      return origin;
    }
    var tbody = cell.parentNode && cell.parentNode.parentNode;
    var rowNodes = tbody ? tbody.children : null;
    if (!rowNodes) {
      return origin;
    }
    for (var offset = 0; offset < rowSpan; offset++) {
      var rowNode = rowNodes[origin + offset];
      if (!rowNode) {
        break;
      }
      var rect = rowNode.getBoundingClientRect();
      if (clientY < rect.bottom || offset === rowSpan - 1) {
        return origin + offset;
      }
    }
    return origin;
  }

  function openSheetCellMenu(event) {
    var cell = sheetCellFromEventTarget(event.target);
    if (!cell) {
      return;
    }
    event.preventDefault();
    var coords = sheetCellCoordinates(cell);
    sheetContextRowIndex = rowIndexFromCellClick(cell, event.clientY);
    sheetContextColumnIndex = coords ? coords.col : logicalColumnForCell(cell);
    setSheetSelection(sheetContextRowIndex, sheetContextRowIndex, sheetContextColumnIndex, sheetContextColumnIndex);
    focusSheetCell(cell);
    openSheetContextMenuAt(event.clientX, event.clientY);
  }

  function openSheetContextMenuAt(x, y) {
    if (!els.sheetContextMenu) {
      return;
    }
    els.sheetContextMenu.hidden = false;
    els.sheetContextMenu.style.left = x + "px";
    els.sheetContextMenu.style.top = y + "px";
  }

  function closeSheetRowMenu() {
    if (els.sheetContextMenu) {
      els.sheetContextMenu.hidden = true;
    }
  }

  function insertSheetRowAt(index) {
    var table = ensureScriptTable();
    pushSheetUndo();
    var tbody = table.tBodies[0] || table.appendChild(document.createElement("tbody"));
    var rows = tbody.querySelectorAll("tr");
    var cols = sheetColumnCount(table);
    var row = document.createElement("tr");
    for (var c = 0; c < cols; c++) {
      row.appendChild(createSheetCell("", false));
    }
    index = Math.max(0, Math.min(Number(index || 0), rows.length));
    if (rows[index]) {
      tbody.insertBefore(row, rows[index]);
    } else {
      tbody.appendChild(row);
    }
    closeSheetRowMenu();
    focusSheetCell(row.cells[0]);
    updateSheetRails();
    saveActiveScriptDocument();
    setStatus("Sheet row inserted.");
  }

  /* rows[r].children[index] assumes every row has the same number of physical
     <td> elements up to the insertion point, which is only true without any
     rowspan above row r. Once an earlier row's rowspan covers a slot in row
     r, row r has one fewer physical cell than the logical column count, and
     the insert lands one column early for every row below that point. Count
     how many cells actually originate in row r before the target logical
     column instead, so the new cell lands at the same logical column in
     every row regardless of what spans over it. */
  function physicalInsertionIndexForRow(grid, rowIndex, logicalIndex) {
    var count = 0;
    for (var c = 0; c < logicalIndex; c++) {
      var info = grid.refs[rowIndex] ? grid.refs[rowIndex][c] : null;
      if (info && info.originRow === rowIndex && info.originCol === c) {
        count++;
      }
    }
    return count;
  }

  function insertSheetColumnAt(index) {
    var table = ensureScriptTable();
    pushSheetUndo();
    var grid = logicalSheetGrid(table);
    var rowNodes = grid.rows;
    var cols = grid.columnCount;
    index = Math.max(0, Math.min(Number(index || 0), cols));
    for (var r = 0; r < rowNodes.length; r++) {
      var isHeader = rowNodes[r].children.length && rowNodes[r].children[0].tagName === "TH";
      var cell = createSheetCell("", isHeader);
      var physicalIndex = physicalInsertionIndexForRow(grid, r, index);
      if (rowNodes[r].children[physicalIndex]) {
        rowNodes[r].insertBefore(cell, rowNodes[r].children[physicalIndex]);
      } else {
        rowNodes[r].appendChild(cell);
      }
    }
    closeSheetRowMenu();
    focusSheetCell(logicalSheetCellAt(table, 0, index) || cellAt(0, index));
    updateSheetRails();
    saveActiveScriptDocument();
    setStatus("Sheet column inserted.");
  }

  function deleteSheetRow(index) {
    var rowIndex = index !== undefined ? index : sheetContextRowIndex;
    var table = els.scriptInput.querySelector("table");
    var tbody = table && (table.tBodies[0] || table);
    var rows = tbody ? tbody.querySelectorAll("tr") : [];
    if (!tbody || isNaN(rowIndex) || rowIndex < 0 || rowIndex >= rows.length) {
      closeSheetRowMenu();
      return;
    }
    pushSheetUndo();
    tbody.removeChild(rows[rowIndex]);
    if (!tbody.querySelector("tr")) {
      els.scriptInput.innerHTML = "";
    }
    closeSheetRowMenu();
    updateSheetRails();
    saveActiveScriptDocument();
    setStatus("Sheet row deleted.");
  }

  function deleteSheetColumn(index) {
    var colIndex = index !== undefined ? index : sheetContextColumnIndex;
    var table = els.scriptInput.querySelector("table");
    var grid = table ? logicalSheetGrid(table) : { rows: [], columnCount: 0, refs: [] };
    var rows = grid.rows || [];
    var cols = grid.columnCount || 0;
    if (!table || isNaN(colIndex) || colIndex < 0 || colIndex >= cols) {
      closeSheetRowMenu();
      return;
    }
    pushSheetUndo();
    if (cols <= 1) {
      for (var one = 0; one < rows.length; one++) {
        while (rows[one].firstChild) {
          rows[one].removeChild(rows[one].firstChild);
        }
        rows[one].appendChild(createSheetCell("", false));
      }
    } else {
      var targets = [];
      for (var r = 0; r < rows.length; r++) {
        var info = grid.refs[r] && grid.refs[r][colIndex] ? grid.refs[r][colIndex] : null;
        if (info && targets.indexOf(info) === -1) {
          targets.push(info);
        }
      }
      for (var t = 0; t < targets.length; t++) {
        var target = targets[t];
        if (target.colspan > 1) {
          target.cell.setAttribute("colspan", String(target.colspan - 1));
        } else if (target.cell.parentNode) {
          target.cell.parentNode.removeChild(target.cell);
        }
      }
      for (var rr = 0; rr < rows.length; rr++) {
        if (!rows[rr].children.length) {
          rows[rr].appendChild(createSheetCell("", false));
        }
      }
    }
    closeSheetRowMenu();
    updateSheetRails();
    focusSheetCell(logicalSheetCellAt(table, 0, Math.max(0, colIndex - 1)) || table.querySelector("td,th"));
    saveActiveScriptDocument();
    setStatus("Sheet column deleted.");
  }

  function addSheetRow() {
    var table = ensureScriptTable();
    var cell = currentSheetCell();
    var rows = table.querySelectorAll("tr");
    var rowIndex = cell ? rowIndexForCell(cell) + 1 : rows.length;
    insertSheetRowAt(rowIndex);
  }

  function addSheetColumn() {
    var table = ensureScriptTable();
    var selectedCell = currentSheetCell();
    var coords = selectedCell ? sheetCellCoordinates(selectedCell) : null;
    var insertIndex = coords ? coords.col + 1 : (selectedCell ? selectedCell.cellIndex + 1 : sheetColumnCount(table));
    insertSheetColumnAt(insertIndex);
  }

  function clearSheetInput() {
    pushSheetUndo();
    els.scriptInput.innerHTML = "";
    els.scriptInput.focus();
    closeSheetRowMenu();
    updateSheetRails();
    saveActiveScriptDocument();
    setStatus("Sheet input cleared.");
  }

  function ensureSheetSize(table, rowIndex, colIndex) {
    table = table || ensureScriptTable();
    var tbody = table.tBodies[0] || table.appendChild(document.createElement("tbody"));
    var cols = Math.max(sheetColumnCount(table), colIndex + 1, 1);
    while (tbody.querySelectorAll("tr").length <= rowIndex) {
      var tr = document.createElement("tr");
      for (var c = 0; c < cols; c++) {
        tr.appendChild(createSheetCell("", false));
      }
      tbody.appendChild(tr);
    }
    var rows = tbody.querySelectorAll("tr");
    for (var r = 0; r < rows.length; r++) {
      while (rows[r].children.length < cols) {
        rows[r].appendChild(createSheetCell("", rows[r].children.length && rows[r].children[0].tagName === "TH"));
      }
    }
    return table;
  }

  function columnIndexFromValidationEdit(edit, table) {
    if (edit.column !== undefined && edit.column !== null && edit.column !== "") {
      var numeric = Number(edit.column);
      if (!isNaN(numeric)) {
        return Math.max(0, numeric - 1);
      }
    }
    var name = String(edit.columnName || edit.header || "").toLowerCase().replace(/^\s+|\s+$/g, "");
    if (!name || !table) {
      return -1;
    }
    var rows = table.querySelectorAll("tr");
    var headers = rows.length ? rows[0].children : [];
    for (var c = 0; c < headers.length; c++) {
      if (sheetCellText(headers[c]).toLowerCase().replace(/^\s+|\s+$/g, "") === name) {
        return c;
      }
    }
    return -1;
  }

  function logicalSheetGrid(table) {
    var rowNodes = table ? table.querySelectorAll("tr") : [];
    var refs = [];
    var cells = [];
    var columnCount = 0;
    for (var r = 0; r < rowNodes.length; r++) {
      refs[r] = refs[r] || [];
      var physical = rowNodes[r].children;
      var col = 0;
      for (var c = 0; c < physical.length; c++) {
        while (refs[r][col]) {
          col++;
        }
        var rowspan = Math.max(1, Number(physical[c].getAttribute("rowspan") || physical[c].rowSpan || 1));
        var colspan = Math.max(1, Number(physical[c].getAttribute("colspan") || physical[c].colSpan || 1));
        var info = {
          cell: physical[c],
          originRow: r,
          originCol: col,
          rowspan: rowspan,
          colspan: colspan
        };
        cells.push(info);
        for (var rr = 0; rr < rowspan; rr++) {
          refs[r + rr] = refs[r + rr] || [];
          for (var cc = 0; cc < colspan; cc++) {
            refs[r + rr][col + cc] = info;
          }
        }
        col += colspan;
        columnCount = Math.max(columnCount, col);
      }
      columnCount = Math.max(columnCount, refs[r].length);
    }
    return { refs: refs, cells: cells, columnCount: columnCount, rows: rowNodes };
  }

  function logicalColumnForCell(cell) {
    var table = cell && cell.closest ? cell.closest("table") : null;
    if (!table) {
      return cell && cell.cellIndex ? cell.cellIndex : 0;
    }
    var cells = logicalSheetGrid(table).cells;
    for (var i = 0; i < cells.length; i++) {
      if (cells[i].cell === cell) {
        return cells[i].originCol;
      }
    }
    return cell.cellIndex || 0;
  }

  function appendLogicalSheetColumn(table, headerText, headerRowCount) {
    var grid = logicalSheetGrid(table);
    var width = grid.columnCount;
    var rowNodes = table.querySelectorAll("tr");
    for (var r = 0; r < rowNodes.length; r++) {
      var isHeader = headerRowCount === 1 && r === 0;
      var covered = grid.refs[r] ? grid.refs[r].length : 0;
      for (var pad = covered; pad < width; pad++) {
        rowNodes[r].appendChild(createSheetCell("", isHeader));
      }
      rowNodes[r].appendChild(createSheetCell(isHeader ? headerText : "", isHeader));
    }
    return width;
  }

  function logicalSheetCellAt(table, rowIndex, colIndex) {
    var grid = logicalSheetGrid(table);
    var info = grid.refs[rowIndex] && grid.refs[rowIndex][colIndex] ? grid.refs[rowIndex][colIndex] : null;
    return info ? info.cell : null;
  }

  function applyScriptValidationPayload(payload) {
    if (!payload) {
      return 0;
    }
    if (payload.scriptHtml) {
      pushSheetUndo();
      els.scriptInput.innerHTML = normalizeScriptInputMarkup(String(payload.scriptHtml || ""), "");
      updateSheetRails();
      saveActiveScriptDocument();
      return 1;
    }
    var edits = payload.scriptEdits || payload.edits || [];
    if (!edits.length) {
      return 0;
    }
    var table = ensureScriptTable();
    pushSheetUndo();
    var applied = 0;
    var appliedCells = [];
    for (var i = 0; i < edits.length; i++) {
      var edit = edits[i] || {};
      var rowIndex = Number(edit.row !== undefined ? edit.row : edit.rowIndex);
      if (isNaN(rowIndex)) {
        continue;
      }
      rowIndex = Math.max(0, rowIndex - 1);
      var colIndex = columnIndexFromValidationEdit(edit, table);
      if (colIndex < 0) {
        continue;
      }
      var cell = logicalSheetCellAt(table, rowIndex, colIndex);
      if (!cell || appliedCells.indexOf(cell) !== -1) {
        continue;
      }
      appliedCells.push(cell);
      setCellText(cell, edit.value !== undefined ? edit.value : edit.text);
      if (edit.reason) {
        cell.setAttribute("title", String(edit.reason));
      }
      applied++;
    }
    updateSheetRails();
    saveActiveScriptDocument();
    return applied;
  }

  function clearActiveScriptValidation() {
    var script = activeScriptDocument();
    if (script.validation) {
      delete script.validation;
      renderScriptTabs();
      renderScriptWorkspaceState();
      saveScriptDocuments();
    }
  }

  function validationIssueCellsFromPayload(payload, scriptPayload) {
    payload = payload || {};
    scriptPayload = scriptPayload || getScriptInputPayload();
    var rows = scriptPayload.tableRows || [];
    var columnMap = canonicalScriptColumnMap(scriptPayload);
    var sourceIndex = columnMap.source;
    var cutIndex = columnMap.cut;
    var textIndex = columnMap.text;
    var cells = [];
    var seen = {};

    function addCell(row, col, message) {
      row = Number(row);
      col = Number(col);
      if (isNaN(row) || isNaN(col) || row < 1 || col < 1) {
        return;
      }
      var key = row + ":" + col;
      if (seen[key]) {
        return;
      }
      seen[key] = true;
      cells.push({ row: row, column: col, message: String(message || "Validation issue") });
    }

    function columnForIssue(item) {
      if (!item || typeof item === "string") {
        return sourceIndex >= 0 ? sourceIndex + 1 : 1;
      }
      if (item.column !== undefined || item.columnIndex !== undefined) {
        var direct = Number(item.column !== undefined ? item.column : item.columnIndex);
        return isNaN(direct) ? 1 : (item.columnIndex !== undefined ? direct + 1 : direct);
      }
      var name = String(item.columnName || item.header || item.field || "").toLowerCase();
      if (/cut|range/.test(name) && cutIndex >= 0) {
        return cutIndex + 1;
      }
      if (/text|overlay|caption|subtitle/.test(name) && textIndex >= 0) {
        return textIndex + 1;
      }
      return sourceIndex >= 0 ? sourceIndex + 1 : 1;
    }

    function addFromList(value, fallbackMessage) {
      var list = Object.prototype.toString.call(value) === "[object Array]" ? value : (value ? [value] : []);
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        if (item && typeof item !== "string" && (item.row !== undefined || item.rowIndex !== undefined)) {
          var row = Number(item.row !== undefined ? item.row : item.rowIndex);
          addCell(item.rowIndex !== undefined ? row + 1 : row, columnForIssue(item), item.message || item.reason || item.value || fallbackMessage);
          continue;
        }
        var needle = String(item && typeof item !== "string" ? (item.name || item.source || item.file || item.value || item.message || "") : item || "").toLowerCase();
        if (!needle || sourceIndex < 0) {
          continue;
        }
        var needleNorm = normalizeScriptSourceName(needle);
        for (var r = scriptDataStartIndex(rows); r < rows.length; r++) {
          var cellText = String(rows[r] && rows[r][sourceIndex] ? rows[r][sourceIndex] : "").toLowerCase();
          var cellNorm = normalizeScriptSourceName(cellText);
          if (cellText && (cellText.indexOf(needle) !== -1 || needle.indexOf(cellText) !== -1 || (needleNorm && cellNorm && (cellNorm.indexOf(needleNorm) !== -1 || needleNorm.indexOf(cellNorm) !== -1)))) {
            addCell(r + 1, sourceIndex + 1, fallbackMessage + ": " + String(item && typeof item !== "string" ? (item.name || item.source || item.file || item.value || item.message || "") : item));
          }
        }
      }
    }

    addFromList(payload.missingSources, "Missing source");
    addFromList(payload.unresolvedSources, "Unresolved source");
    addFromList(payload.ambiguousMatches, "Needs context");
    addFromList(payload.validationIssues || payload.issues || payload.issueCells, "Validation issue");
    return cells;
  }

  function validationPercentFromIssues(scriptPayload, issueCells, needsContext) {
    var rows = scriptPayload && scriptPayload.tableRows ? scriptPayload.tableRows.length : 0;
    var dataRows = Math.max(0, rows - (scriptHasHeaderRow(scriptPayload && scriptPayload.tableRows ? scriptPayload.tableRows : []) ? 1 : 0));
    if (!dataRows) {
      return needsContext ? 0 : 100;
    }
    var issueRows = {};
    for (var i = 0; issueCells && i < issueCells.length; i++) {
      var row = Number(issueCells[i].row || 0);
      if (row >= 1) {
        issueRows[row] = true;
      }
    }
    var issueCount = 0;
    for (var key in issueRows) {
      if (issueRows.hasOwnProperty(key)) {
        issueCount++;
      }
    }
    if (needsContext && !issueCount) {
      return 50;
    }
    return Math.max(0, Math.min(100, Math.round(((dataRows - issueCount) / dataRows) * 100)));
  }

  function localScriptValidationPayload(scriptPayload, options) {
    scriptPayload = scriptPayload || getScriptInputPayload();
    options = options || {};
    var rows = scriptPayload.tableRows || [];
    var model = canonicalScriptModel(scriptPayload);
    var sourceIndex = model.columns.source;
    var cutIndex = model.columns.cut;
    var missing = [];
    var unresolved = [];
    var ambiguous = [];
    var issues = [];
    var seen = {};

    function pushUnique(list, value) {
      value = String(value || "").replace(/^\s+|\s+$/g, "");
      if (value && list.indexOf(value) === -1) {
        list.push(value);
      }
    }

    function addIssue(row, column, message, listValue, list) {
      var key = row + ":" + column + ":" + message;
      if (seen[key]) {
        return;
      }
      seen[key] = true;
      issues.push({ row: row, column: column, message: message });
      if (list && listValue) {
        pushUnique(list, listValue);
      }
    }

    if (rows.length <= model.dataStartIndex) {
      return {
        validationStatus: "needsContext",
        needsContext: true,
        validationMessage: "Script has no data rows to validate.",
        validationIssues: [{ row: 1, column: 1, message: "No script rows found." }],
        unresolvedSources: ["No script rows found"]
      };
    }
    if (sourceIndex < 0) {
      addIssue(1, 1, "Source column not found.", "Source column not found", unresolved);
    }
    if (cutIndex < 0) {
      addIssue(1, 1, "Cut range column not found.", "Cut range column not found", unresolved);
    }
    if (model.columns.text < 0) {
      addIssue(1, 1, "Text/Overlay column not found.", "Text/Overlay column not found", unresolved);
    }

    for (var g = 0; g < model.groups.length; g++) {
      var mediaUnits = model.groups[g].mediaUnits;
      for (var m = 0; m < mediaUnits.length; m++) {
      var unit = mediaUnits[m];
      var sourceText = unit.sourceText;
      var cutText = unit.cutText;
      var sources = scriptSourceLines(sourceText);
      var cut = cutIndex >= 0 ? parseCutDurationSeconds(cutText) : { ranges: [], unresolved: [] };
      if (sourceIndex === cutIndex && !cut.ranges.length && firstScriptSourceName(sourceText)) {
        cut.ranges = defaultCompactScriptRanges(sources, 3);
        cut.unresolved = [];
      }
      var hasSource = !!firstScriptSourceName(sourceText);
      var hasCut = !!String(cutText || "").replace(/\s+/g, "");
      if (hasCut && !hasSource && sourceIndex >= 0) {
        addIssue(unit.row, sourceIndex + 1, "Cut exists but source file is empty.", "Row " + unit.row + " source empty", unresolved);
      }
      if (hasSource && !hasCut && cutIndex >= 0) {
        addIssue(unit.row, cutIndex + 1, "Source exists but cut range is empty.", "Row " + unit.row + " cut range empty", unresolved);
      }
      if (hasSource && hasCut && !cut.ranges.length && cutIndex >= 0) {
        addIssue(unit.row, cutIndex + 1, "Use ranges like 5-8s or single-second selections like giây 11.", "Row " + unit.row + " cut range invalid", unresolved);
      }
      for (var u = 0; u < cut.unresolved.length; u++) {
        if (cutIndex >= 0) {
          addIssue(unit.row, cutIndex + 1, "Unparsed cut line: " + cut.unresolved[u], "Row " + unit.row + ": " + cut.unresolved[u], unresolved);
        }
      }
      for (var s = 0; s < sources.length; s++) {
        var expandedSources = String(sources[s] || "").split("\n");
        for (var ex = 0; ex < expandedSources.length; ex++) {
        var sourceName = expandedSources[ex];
        if (!sourceName) {
          continue;
        }
        var match = options.skipSourceLookup ? { item: { name: sourceName }, ambiguous: false } : sourceMatchForScriptSource(sourceName);
        var item = match && match.item ? match.item : null;
        if (!options.skipSourceLookup && match && match.ambiguous && sourceIndex >= 0) {
          addIssue(unit.row, sourceIndex + 1, "Ambiguous source: " + sourceName, ambiguousSourceDescription(sourceName, match), ambiguous);
        } else if (!options.skipSourceLookup && !item && sourceIndex >= 0) {
          addIssue(unit.row, sourceIndex + 1, "Source not found in project: " + sourceName, sourceName, missing);
        }
        }
      }
      }
    }

    var needsContext = !!(missing.length || unresolved.length || ambiguous.length);
    var warning = options.skipSourceLookup ? "Project context is unavailable, so source names were not verified against Premiere. Script structure is valid and timeline actions were cached by source name." : "";
    var contextError = options.skipSourceLookup && lastProjectContextError ? lastProjectContextError : "";
    return {
      validationStatus: needsContext ? "needsContext" : "validated",
      needsContext: needsContext,
      validationMessage: needsContext ? "Fast validation found " + (missing.length + unresolved.length + ambiguous.length) + " issue(s)." : (warning || "Fast validation complete. Script is ready to apply."),
      scriptEdits: [],
      missingSources: missing,
      unresolvedSources: unresolved,
      ambiguousMatches: ambiguous,
      warnings: warning ? [warning] : [],
      projectContextError: contextError,
      projectContextAvailable: !options.skipSourceLookup,
      validationIssues: issues
    };
  }

  function setActiveScriptValidation(status, message, editsApplied, cachedActions, issueCells, percent) {
    var script = activeScriptDocument();
    script.validation = {
      status: status,
      message: message || "",
      editsApplied: Number(editsApplied || 0),
      actionCount: cachedActions && cachedActions.length ? cachedActions.length : 0,
      issueCells: issueCells || [],
      percent: Math.max(0, Math.min(100, Number(percent !== undefined ? percent : (status === "validated" ? 100 : 0)))),
      elapsedSeconds: scriptValidationStartedAt ? Math.round(((Date.now() - scriptValidationStartedAt) / 1000) * 10) / 10 : null,
      checkedAt: (new Date()).toISOString()
    };
    if (cachedActions && cachedActions.length) {
      script.validation.cachedActions = cachedActions;
    }
    renderScriptTabs();
    renderScriptWorkspaceState();
    saveScriptDocuments();
  }

  function scriptValidationNeedsContext(payload, output) {
    if (payload && (payload.needsContext === true || payload.needMoreContext === true)) {
      return true;
    }
    if (payload && ((payload.unresolvedSources && payload.unresolvedSources.length) || (payload.ambiguousMatches && payload.ambiguousMatches.length) || (payload.missingSources && payload.missingSources.length))) {
      return true;
    }
    var status = String(payload && (payload.validationStatus || payload.status || "") || "").toLowerCase();
    if (/need|context|ambiguous|uncertain|blocked/.test(status)) {
      return true;
    }
    var text = String(output || "").toLowerCase();
    return /\b(need more context|needs more context|not enough context|cannot confidently|ambiguous|uncertain|could not match|can't match)\b/.test(text);
  }

  function setScriptValidationProgress(percent, label, tone) {
    percent = Math.max(0, Math.min(100, Number(percent || 0)));
    if (els.scriptWorkspaceStatus) {
      els.scriptWorkspaceStatus.textContent = label || "Validating...";
    }
    if (els.scriptWorkspacePercent) {
      els.scriptWorkspacePercent.textContent = Math.round(percent) + "%";
    }
    if (els.scriptValidationTimer && !scriptValidationTimerId && scriptValidationStartedAt <= 0) {
      els.scriptValidationTimer.textContent = "";
    }
    if (els.scriptValidationProgressFill) {
      els.scriptValidationProgressFill.style.width = percent + "%";
    }
    if (els.scriptWorkspaceState) {
      els.scriptWorkspaceState.className = "script-workspace-state" +
        (tone === "needsContext" ? " needs-context" : "") +
        (tone === "error" ? " has-errors" : "");
    }
  }

  function updateScriptValidationTimer() {
    if (!els.scriptValidationTimer || !scriptValidationStartedAt) {
      return;
    }
    var elapsed = Math.max(0, (Date.now() - scriptValidationStartedAt) / 1000);
    els.scriptValidationTimer.textContent = elapsed.toFixed(1) + "s";
  }

  function startScriptValidationTimer() {
    stopScriptValidationTimer(false);
    scriptValidationStartedAt = Date.now();
    updateScriptValidationTimer();
    scriptValidationTimerId = window.setInterval(updateScriptValidationTimer, 100);
  }

  function stopScriptValidationTimer(keepElapsed) {
    if (scriptValidationTimerId) {
      window.clearInterval(scriptValidationTimerId);
      scriptValidationTimerId = null;
    }
    if (keepElapsed) {
      updateScriptValidationTimer();
      scriptValidationStartedAt = 0;
    } else {
      scriptValidationStartedAt = 0;
      if (els.scriptValidationTimer) {
        els.scriptValidationTimer.textContent = "";
      }
    }
  }

  function applyValidatedScriptToTimeline() {
    var script = activeScriptDocument();
    var actions = script && script.validation && script.validation.cachedActions ? script.validation.cachedActions : [];
    if (!actions.length) {
      setStatus("No cached validation actions to apply.", true);
      return;
    }
    appendMessage("system", "Using cached action code from script validation.");
    setPendingActions({ actions: actions });
    applyJson();
  }

  function renderScriptWorkspaceState() {
    var script = activeScriptDocument();
    var validation = script && script.validation ? script.validation : null;
    if (!validation) {
      setScriptValidationProgress(0, "Not validated", "");
      if (els.applyValidatedScriptBtn) {
        els.applyValidatedScriptBtn.hidden = true;
      }
      return;
    }
    var percent = Number(validation.percent !== undefined ? validation.percent : (validation.status === "validated" ? 100 : 0));
    var label = validation.status === "needsContext" ? "Needs context" : (validation.status === "validating" ? "Validating..." : "Validated");
    if (validation.actionCount) {
      label += " | " + validation.actionCount + " cached action" + (validation.actionCount === 1 ? "" : "s");
    }
    setScriptValidationProgress(percent, label, validation.status === "needsContext" ? "needsContext" : "");
    if (els.scriptValidationTimer) {
      els.scriptValidationTimer.textContent = validation.elapsedSeconds !== null && validation.elapsedSeconds !== undefined ? Number(validation.elapsedSeconds).toFixed(1) + "s" : "";
    }
    if (els.applyValidatedScriptBtn) {
      els.applyValidatedScriptBtn.hidden = !(validation.status === "validated" && validation.cachedActions && validation.cachedActions.length);
    }
  }

  function scriptValidationMessage(payload, output, applied, needsContext) {
    var message = String(payload && (payload.validationMessage || payload.message || payload.summary || "") || "").replace(/^\s+|\s+$/g, "");
    if (message && needsContext && !/missing|not found|needs? context|cannot|could not|ambiguous|unresolved|import|bin|folder|verify/i.test(message)) {
      return message;
    }
    if (message && !/missing|not found|needs? context|cannot|could not|ambiguous|unresolved/i.test(message)) {
      return message;
    }
    if (needsContext) {
      return "Needs more context to validate all footage references.";
    }
    if (applied) {
      return "Validated and applied " + applied + " script edit" + (applied === 1 ? "" : "s") + ".";
    }
    return "Validated. No script edits were needed.";
  }

  function validationListValues(value) {
    if (!value) {
      return [];
    }
    if (Object.prototype.toString.call(value) === "[object Array]") {
      var list = [];
      for (var i = 0; i < value.length; i++) {
        if (typeof value[i] === "string") {
          list.push(value[i]);
        } else if (value[i]) {
          list.push(value[i].name || value[i].source || value[i].file || value[i].value || value[i].message || JSON.stringify(value[i]));
        }
      }
      return list;
    }
    return [String(value)];
  }

  function isScriptMediaExtensionToken(value) {
    return /^\.?\s*(?:mp4|mov|m4v|avi|mxf|webm|wav|mp3|png|jpe?g|gif|tiff?|bmp|webp|heic|psd)\s*$/i.test(String(value || ""));
  }

  function mediaFilenameFromScriptLine(value) {
    var line = String(value || "").replace(/^\s+|\s+$/g, "");
    var match = line.match(/^(.+?\.(?:mp4|mov|m4v|avi|mxf|webm|png|jpe?g|gif|tiff?|bmp|webp|heic|psd))(?=$|[\s,;)\]])/i);
    if (!match || !/[A-Za-z0-9\u00C0-\u1EF9]/.test(match[1].replace(/\.(?:mp4|mov|m4v|avi|mxf|webm|png|jpe?g|gif|tiff?|bmp|webp|heic|psd)$/i, ""))) {
      return "";
    }
    return match[1].replace(/^\s+|\s+$/g, "");
  }

  function sourceLabelsFromValidationText(value) {
    var text = normalizeScriptSourceAlias(value);
    var matches = text.match(/[A-Za-z]+\d+(?:[._-]\d+)*|\d+(?:[._-]\d+)*/g) || [];
    var labels = [];
    for (var i = 0; i < matches.length; i++) {
      var label = matches[i];
      if (isScriptMediaExtensionToken(label)) {
        continue;
      }
      if (/^\d+$/.test(label) && label.length > 3) {
        continue;
      }
      var norm = normalizeScriptSourceName(label);
      if (norm && labels.indexOf(label) === -1) {
        labels.push(label);
      }
    }
    return labels;
  }

  function reconcileValidationPayloadWithProject(payload, scriptPayload) {
    payload = payload || {};
    scriptPayload = scriptPayload || getScriptInputPayload();
    var rows = scriptPayload.tableRows || [];
    var roles = scriptPayload.columnRoles || [];
    var sourceIndex = inferScriptColumnIndex(rows, roles, "source", /source\s*file|source\s*name|media|clip\s*name|source/, 6);
    if (sourceIndex < 0 || !rows.length || !hasProjectItemContext()) {
      return payload;
    }
    var resolved = [];
    var ambiguous = [];
    var edits = payload.scriptEdits || payload.edits || [];
    if (!edits.length) {
      edits = [];
      payload.scriptEdits = edits;
    }
    function pushResolved(label) {
      var norm = normalizeScriptSourceName(label);
      if (norm && resolved.indexOf(norm) === -1) {
        resolved.push(norm);
      }
    }
    function pushAmbiguous(label) {
      var norm = normalizeScriptSourceName(label);
      if (norm && ambiguous.indexOf(norm) === -1) {
        ambiguous.push(norm);
      }
    }
    function hasEdit(row, column) {
      for (var e = 0; e < edits.length; e++) {
        var edit = edits[e] || {};
        if (Number(edit.row || 0) === row && Number(edit.column || edit.columnIndex || 0) === column) {
          return true;
        }
      }
      return false;
    }
    for (var r = scriptDataStartIndex(rows); r < rows.length; r++) {
      var sourceText = String(rows[r] && rows[r][sourceIndex] ? rows[r][sourceIndex] : "");
      if (!sourceText.replace(/\s+/g, "")) {
        continue;
      }
      var sourceLines = scriptSourceLines(sourceText);
      var replacementLines = [];
      var canReplace = true;
      var changed = false;
      for (var l = 0; l < sourceLines.length; l++) {
        var label = String(sourceLines[l] || "").replace(/^\s+|\s+$/g, "");
        if (!label) {
          replacementLines.push(label);
          continue;
        }
        var match = sourceMatchForScriptSource(label);
        if (match && match.item) {
          var itemName = match.item.name || label;
          pushResolved(label);
          replacementLines.push(itemName);
          if (normalizeScriptSourceName(itemName) !== normalizeScriptSourceName(label)) {
            changed = true;
          }
        } else if (match && match.ambiguous) {
          pushAmbiguous(label);
          canReplace = false;
          replacementLines.push(label);
        } else {
          canReplace = false;
          replacementLines.push(label);
        }
      }
      if (canReplace && changed && !hasEdit(r + 1, sourceIndex + 1)) {
        edits.push({
          row: r + 1,
          column: sourceIndex + 1,
          value: replacementLines.join("\n"),
          reason: "Auto-linked compact source labels to project item names."
        });
      }
    }
    function filterResolvedList(list) {
      var values = validationListValues(list);
      var out = [];
      for (var i = 0; i < values.length; i++) {
        var value = values[i];
        if (isScriptMediaExtensionToken(value)) {
          continue;
        }
        var norm = normalizeScriptSourceName(value);
        var isResolved = false;
        var labels = sourceLabelsFromValidationText(value);
        if (!labels.length) {
          labels = [value];
        }
        for (var li = 0; !isResolved && li < labels.length; li++) {
          if (sourceMatchForScriptSource(labels[li]).item) {
            isResolved = true;
          }
        }
        for (var rr = 0; !isResolved && rr < resolved.length; rr++) {
          if (norm && resolved[rr] && (norm.indexOf(resolved[rr]) !== -1 || resolved[rr].indexOf(norm) !== -1)) {
            isResolved = true;
          }
        }
        if (!isResolved) {
          out.push(value);
        }
      }
      return out;
    }
    payload.missingSources = filterResolvedList(payload.missingSources);
    payload.unresolvedSources = filterResolvedList(payload.unresolvedSources);
    var existingAmbiguous = validationListValues(payload.ambiguousMatches);
    for (var a = 0; a < ambiguous.length; a++) {
      if (existingAmbiguous.indexOf(ambiguous[a]) === -1) {
        existingAmbiguous.push(ambiguous[a]);
      }
    }
    payload.ambiguousMatches = existingAmbiguous;
    if (!payload.missingSources.length && !payload.unresolvedSources.length && !payload.ambiguousMatches.length) {
      payload.needsContext = false;
      payload.validationStatus = payload.validationStatus === "needsContext" ? "validated" : (payload.validationStatus || "validated");
    }
    return payload;
  }

  function inferMissingFromScriptEdits(payload) {
    var edits = payload && (payload.scriptEdits || payload.edits) ? (payload.scriptEdits || payload.edits) : [];
    var missing = [];
    for (var i = 0; i < edits.length; i++) {
      var reason = String(edits[i] && edits[i].reason ? edits[i].reason : "");
      reason.replace(/\b([A-Za-z0-9][A-Za-z0-9._ -]*\.(?:mp4|mov|m4v|avi|wav|mp3))\b/gi, function (match) {
        if (/not in project|missing|not found|could not match/i.test(reason) && missing.indexOf(match) === -1) {
          missing.push(match);
        }
        return match;
      });
    }
    return missing;
  }

  function scriptValidationActionSections(payload, needsContext) {
    payload = payload || {};
    var sections = [];
    var missing = validationListValues(payload.missingSources).concat(validationListValues(payload.unresolvedSources));
    var inferredMissing = inferMissingFromScriptEdits(payload);
    for (var m = 0; m < inferredMissing.length; m++) {
      if (missing.indexOf(inferredMissing[m]) === -1) {
        missing.push(inferredMissing[m]);
      }
    }
    if (missing.length) {
      sections.push({ title: "Missing", icon: "x", tone: "missing", items: missing });
    }
    var ambiguous = validationListValues(payload.ambiguousMatches);
    if (ambiguous.length || needsContext) {
      sections.push({ title: "Needs Context", icon: "!", tone: "context", items: ambiguous.length ? ambiguous : ["More footage context is needed before every reference can be verified."] });
    }
    var edits = payload.scriptEdits || payload.edits || [];
    var fixed = [];
    for (var i = 0; i < edits.length; i++) {
      var edit = edits[i] || {};
      var value = edit.value !== undefined ? edit.value : edit.text;
      if (value !== undefined && value !== null && value !== "") {
        fixed.push("Row " + (edit.row || edit.rowIndex || "?") + ": " + value);
      }
    }
    if (fixed.length) {
      sections.push({ title: "Fixed", icon: "check", tone: "fixed", items: fixed });
    }
    var movedNotes = validationListValues(payload.movedToNotes);
    if (movedNotes.length) {
      sections.push({ title: "Moved to Notes", icon: "check", tone: "fixed", items: movedNotes });
    }
    if (!sections.length) {
      sections.push({ title: "Validated", icon: "check", tone: "fixed", items: ["No missing footage or script edits found."] });
    }
    return sections;
  }

  function renderValidationActionList(container, sections) {
    var wrap = document.createElement("div");
    wrap.className = "validation-action-list";
    for (var i = 0; i < sections.length; i++) {
      var section = document.createElement("div");
      section.className = "validation-action-section " + sections[i].tone;
      var title = document.createElement("strong");
      title.textContent = sections[i].title + ":";
      section.appendChild(title);
      var ul = document.createElement("ul");
      for (var j = 0; j < sections[i].items.length; j++) {
        var li = document.createElement("li");
        var icon = document.createElement("span");
        icon.className = "validation-action-icon";
        icon.textContent = sections[i].icon === "check" ? "✓" : (sections[i].icon === "!" ? "!" : "✕");
        var text = document.createElement("span");
        text.textContent = sections[i].items[j];
        li.appendChild(icon);
        li.appendChild(text);
        ul.appendChild(li);
      }
      section.appendChild(ul);
      wrap.appendChild(section);
    }
    container.appendChild(wrap);
  }

  function scriptValidationActionText(payload, rawText) {
    var needsContext = scriptValidationNeedsContext(payload, rawText);
    var sections = scriptValidationActionSections(payload, needsContext);
    var lines = [];
    for (var i = 0; i < sections.length; i++) {
      lines.push(sections[i].title + ":");
      for (var j = 0; j < sections[i].items.length; j++) {
        var icon = sections[i].icon === "check" ? "✅" : (sections[i].icon === "!" ? "⚠️" : "❌");
        lines.push(icon + " " + sections[i].items[j]);
      }
      if (i < sections.length - 1) {
        lines.push("");
      }
    }
    return lines.join("\n");
  }

  function showScriptValidationOverlay(status, message, scriptName, editsApplied, rawDetails, payload) {
    if (!els.scriptValidationOverlay || !els.scriptValidationBody) {
      return;
    }
    clearElement(els.scriptValidationBody);
    var card = document.createElement("div");
    card.className = "script-validation-result " + (status === "needsContext" ? "needs-context" : "is-validated");
    var iconWrap = document.createElement("div");
    iconWrap.className = "script-validation-icon";
    if (status === "needsContext") {
      iconWrap.textContent = "!";
    } else {
      var check = document.createElement("input");
      check.type = "checkbox";
      check.checked = true;
      check.disabled = true;
      iconWrap.appendChild(check);
    }
    var copy = document.createElement("div");
    var title = document.createElement("strong");
    title.textContent = status === "needsContext" ? "Needs more context" : "Validated";
    var line = document.createElement("p");
    line.textContent = (scriptName || "Script") + (editsApplied ? " | " + editsApplied + " edit" + (editsApplied === 1 ? "" : "s") + " applied" : "");
    var detail = document.createElement("p");
    detail.textContent = message || "";
    copy.appendChild(title);
    copy.appendChild(line);
    var cachedCount = activeScriptDocument().validation && activeScriptDocument().validation.actionCount ? Number(activeScriptDocument().validation.actionCount || 0) : 0;
    if (status !== "needsContext" && cachedCount) {
      var ready = document.createElement("p");
      ready.textContent = cachedCount + " timeline action" + (cachedCount === 1 ? "" : "s") + " cached for no-wait apply.";
      copy.appendChild(ready);
    }
    copy.appendChild(detail);
    card.appendChild(iconWrap);
    card.appendChild(copy);
    els.scriptValidationBody.appendChild(card);
    renderValidationActionList(els.scriptValidationBody, scriptValidationActionSections(payload, status === "needsContext"));
    var cachedActions = activeScriptDocument().validation && activeScriptDocument().validation.cachedActions ? activeScriptDocument().validation.cachedActions : [];
    if (cachedActions.length) {
      var applyCachedBtn = document.createElement("button");
      applyCachedBtn.type = "button";
      applyCachedBtn.className = "validation-apply-btn";
      applyCachedBtn.textContent = "Apply cached";
      applyCachedBtn.addEventListener("click", function () {
        closeScriptValidationOverlay();
        applyValidatedScriptToTimeline();
      });
      els.scriptValidationBody.appendChild(applyCachedBtn);
      var actionDetails = document.createElement("details");
      actionDetails.className = "code-details script-validation-details";
      actionDetails.open = false;
      var actionSummary = document.createElement("summary");
      var actionSummaryText = document.createElement("span");
      actionSummaryText.textContent = "Cached action code";
      actionSummary.appendChild(actionSummaryText);
      var actionPre = document.createElement("pre");
      actionPre.className = "message-code";
      actionPre.textContent = JSON.stringify({ actions: cachedActions }, null, 2);
      actionDetails.appendChild(actionSummary);
      actionDetails.appendChild(actionPre);
      els.scriptValidationBody.appendChild(actionDetails);
    }
    if (rawDetails) {
      var details = document.createElement("details");
      details.className = "code-details script-validation-details";
      details.open = false;
      var summary = document.createElement("summary");
      var summaryText = document.createElement("span");
      summaryText.textContent = "Validation details";
      summary.appendChild(summaryText);
      var pre = document.createElement("pre");
      pre.className = "message-code";
      pre.textContent = String(rawDetails || "");
      details.appendChild(summary);
      details.appendChild(pre);
      els.scriptValidationBody.appendChild(details);
    }
    els.scriptValidationOverlay.hidden = false;
  }

  function closeScriptValidationOverlay() {
    if (els.scriptValidationOverlay) {
      els.scriptValidationOverlay.hidden = true;
    }
  }

  function extractValidationPayload(output) {
    try {
      return extractJson(output);
    } catch (err) {
      return {
        validationStatus: "needsContext",
        needsContext: true,
        validationMessage: "Validation ran, but the response could not be parsed as script edits. Open Validation details to inspect the reply.",
        missingSources: [],
        ambiguousMatches: ["Unparsed validation response"],
        unresolvedSources: []
      };
    }
  }

  function validationColumnFromInstructions(instructions, rolePattern) {
    var lines = String(instructions || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    for (var i = 0; i < lines.length; i++) {
      if (!rolePattern.test(lines[i])) {
        continue;
      }
      var match = lines[i].match(/\b(?:column|collumn|col)\s*([A-Z])\b/i) || lines[i].match(/\b([A-Z])\s*(?:column|collumn|col)\b/i);
      if (match) {
        return match[1].toUpperCase().charCodeAt(0) - 65;
      }
    }
    return -1;
  }

  function validationColumnFromPayload(payload, role) {
    var map = payload && (payload.columnMap || payload.columns || payload.columnRoles);
    var value = map && map[role] !== undefined ? map[role] : null;
    if (typeof value === "string" && /^[A-Z]$/i.test(value.replace(/^\s+|\s+$/g, ""))) {
      return value.replace(/^\s+|\s+$/g, "").toUpperCase().charCodeAt(0) - 65;
    }
    value = Number(value);
    return isNaN(value) || value < 1 ? -1 : Math.floor(value - 1);
  }

  function confirmedValidationColumnIndex(payload, scriptPayload, instructions, role) {
    var rows = scriptPayload.tableRows || [];
    var roles = scriptPayload.columnRoles || [];
    var instructionPattern = role === "source" ? /\b(source|file|footage|media|clip)\b/i : (role === "cut" ? /\b(cut|time|timecode|range|in.?out)\b/i : /\b(text|overlay|caption|subtitle|script)\b/i);
    var fromInstructions = validationColumnFromInstructions(instructions, instructionPattern);
    if (fromInstructions >= 0) {
      return fromInstructions;
    }
    var fromPayload = validationColumnFromPayload(payload, role);
    if (fromPayload >= 0) {
      return fromPayload;
    }
    for (var r = 0; r < roles.length; r++) {
      if (roles[r] === role) {
        return r;
      }
    }
    if (role === "source") {
      return inferScriptColumnIndex(rows, roles, role, /source\s*file|source\s*name|media|clip\s*name|source/, 6);
    }
    if (role === "cut") {
      return inferScriptColumnIndex(rows, roles, role, /cut\s*from\s*source|source\s*range|range|cut/, 7);
    }
    return inferScriptColumnIndex(rows, roles, role, /overlay\s*text|caption|subtitle|srt|text/, 5);
  }

  function sanitizeValidationPayload(payload, scriptPayload, validationInstructions) {
    payload = payload || {};
    scriptPayload = scriptPayload || getScriptInputPayload();
    var rows = scriptPayload.tableRows || [];
    var cells = scriptPayload.tableCells || [];
    var sourceIndex = confirmedValidationColumnIndex(payload, scriptPayload, validationInstructions, "source");
    var cutIndex = confirmedValidationColumnIndex(payload, scriptPayload, validationInstructions, "cut");
    var edits = payload.scriptEdits || payload.edits || [];
    var safeEdits = [];
    var seen = {};
    delete payload.scriptHtml;

    if (sourceIndex < 0 || sourceIndex === cutIndex) {
      payload.scriptEdits = [];
      delete payload.edits;
      if (edits.length) {
        payload.needsContext = true;
        payload.validationStatus = "needsContext";
        payload.validationMessage = "Validation did not change the sheet because Source and Cut columns were not safely distinguishable.";
      }
      return payload;
    }

    for (var i = 0; i < edits.length; i++) {
      var edit = edits[i] || {};
      var row = Number(edit.row !== undefined ? edit.row : edit.rowIndex);
      var value = edit.value !== undefined ? edit.value : edit.text;
      if (isNaN(row) || row < 1 || row > rows.length || value === undefined || value === null) {
        continue;
      }
      var valueText = String(value).replace(/^\s+|\s+$/g, "");
      var valueCut = parseCutDurationSeconds(valueText);
      if (!valueText || (valueCut.ranges.length && !/\.(mp4|mov|m4v|avi|mxf|webm|wav|mp3|png|jpe?g|gif|tiff?|bmp|webp|heic|psd)\b/i.test(valueText))) {
        continue;
      }
      var verifiedMatch = sourceMatchForScriptSource(valueText);
      if (!verifiedMatch || !verifiedMatch.item || verifiedMatch.ambiguous) {
        continue;
      }
      var existingValue = rows[row - 1] && rows[row - 1][sourceIndex] !== undefined ? rows[row - 1][sourceIndex] : "";
      var existingMatch = sourceMatchForScriptSource(existingValue);
      if (existingMatch && existingMatch.item && !existingMatch.ambiguous) {
        continue;
      }
      value = verifiedMatch.item.name || valueText;
      var meta = cells[row - 1] && cells[row - 1][sourceIndex] ? cells[row - 1][sourceIndex] : null;
      if (meta && meta.originRow !== undefined) {
        row = Number(meta.originRow) + 1;
      }
      var key = row + ":" + sourceIndex;
      if (seen[key]) {
        continue;
      }
      seen[key] = true;
      safeEdits.push({
        row: row,
        column: sourceIndex + 1,
        value: value,
        reason: edit.reason || "Validated source link."
      });
    }
    payload.scriptEdits = safeEdits;
    delete payload.edits;
    payload.columnMap = payload.columnMap || {};
    payload.columnMap.source = sourceIndex + 1;
    if (cutIndex >= 0) {
      payload.columnMap.cut = cutIndex + 1;
    }
    return payload;
  }

  function splitTextPromptSection(scriptPayload) {
    var caption = getCaptionChunkSettings();
    return [
      "",
      "ALSO SPLIT THE TEXT INTO CAPTION ROWS.",
      "Decide what every column is from its cell contents, not from column order or any existing role. Allowed roles: text (the spoken script line), optimizedText (caption rows generated from it), cut (source in/out ranges), source (footage/clip names), notes (anything else, including product feature lists, marketing bullets, comments or directions), skip (empty/unused). Exactly one column may be text. A column of product features or commentary is notes, never text and never optimizedText.",
      "Then split each data row's text cell into caption rows for burned-in subtitles.",
      "Split on meaning and readability: break at sentence ends, clause boundaries and natural phrase edges. Never split an article, preposition, auxiliary verb, negation or modifier away from the word it belongs to, and never let one caption row span two sentences.",
      "Keep each caption row at most " + caption.maxWords + " words and " + caption.maxCharacters + " characters. Those are ceilings, not targets: prefer a shorter row that breaks in the right place.",
      caption.trimEndPunctuation ? "Drop a trailing period or comma at the end of each caption row, but keep ellipses, question marks, exclamation marks and mid-row punctuation." : "Keep the original punctuation in every caption row.",
      "Preserve the original wording and language exactly, including non-English text. Do not translate, rewrite, summarise or correct anything. Empty text cell means an empty lines array.",
      "Add these two fields to the same JSON object you return, using 1-based row numbers that match the Script table rows:",
      '"splitColumnRoles":[{"column":"A","role":"text"},{"column":"B","role":"cut"}], "optimizedRows":[{"row":1,"lines":["First caption row","Second caption row"]}]',
      "",
      "Script table as columns (tab separated, \u21b5 marks a line break inside a cell):",
      splitTextPromptRows(scriptPayload)
    ].join("\n");
  }

  function buildScriptValidationPrompt(scriptPayload, validationInstructions) {
    var validationContext = {
      projectName: state && state.projectName ? state.projectName : "",
      projectPath: state && state.projectPath ? state.projectPath : "",
      activeSequence: state && state.activeSequence ? {
        name: state.activeSequence.name || "",
        sequenceId: state.activeSequence.sequenceId || "",
        videoTracks: state.activeSequence.videoTracks || [],
        audioTracks: state.activeSequence.audioTracks || []
      } : null,
      projectItems: compactProjectItemsForPrompt(0)
    };
    return [
      "You validate and repair PR AI script tables before timeline editing.",
      "Compare the script's Source File, Source, media, clip, and Cut columns against the actual Premiere project items and current sequence clips.",
      "Find footage references that are missing, ambiguous, misspelled, or do not match the user's naming convention. Prefer exact projectItemId/name/path matches, then fuzzy matches on visible numbers, compact source IDs, product/file keywords, extensions, and folder/bin names.",
      "The user's validation instructions are authoritative for column identity. If they identify column A/B/C/etc as Source, Cut/Time, or Text, use that mapping even when cell contents are mixed or headers are absent.",
      "Never infer a Source column from values that are source timecodes or ranges such as 00-01, 05-06, 45-48, giay 11, or 0-2s. Those belong to Cut/Time. Never replace a Cut/Time cell with a media filename.",
      "Cut cells are intentionally flexible and may contain annotations plus several selections. Accept decimal-comma ranges such as 'giây 1,06 - 2,05', ordinary ranges such as '17-18', single seconds such as 'Giây 11', and multiple single seconds on one line such as 'Giây 6, giây 17'. Pair meaningful Cut lines with non-empty Source lines in order; ignore annotation-only lines like '(đũng)'. Multiple selections on one Cut line all use that same Source line. Do not flag or rewrite these valid forms merely to standardize formatting.",
      "Return columnMap with 1-based indexes, for example {\"columnMap\":{\"text\":1,\"cut\":2,\"source\":3}}, and emit scriptEdits only for the confirmed Source column.",
      "Preserve all merged cells. Do not return scriptHtml and do not add/delete/reorder rows or columns. For a source cell spanning several rows, return at most one edit targeting the merged cell's origin row.",
      "Compact source IDs are valid source references. Examples: D2.5 matches D2.5.mp4 or D2.5 - details of source.mp4; S1.12 matches S1.12.mov/mp4 with extra description; 26 matches a unique filename beginning with or tokenized as 26, such as 26- olive, điện thoại túi, đứng, mobility.mp4. Do not require the full filename or extension when the compact letters/numbers identify one project item.",
      "If the user says a source is in a specific bin/folder, use that as a soft search hint only. Never mark a compact source ID missing just because the named bin/folder is absent when a matching project item exists anywhere in the project.",
      "You may edit the script and prepare reusable timeline action code, but validation must not apply anything to Premiere.",
      "Return concise notes, then exactly one JSON object.",
      "Use this JSON shape when editing cells: {\"scriptEdits\":[{\"row\":2,\"column\":3,\"value\":\"Correct source name\",\"reason\":\"Matched project item ...\"}]}",
      "When the script is usable, also include timelineActions with ready-to-apply Premiere actions. Prefer one assembleFromScript action using projectItemId when available, trackType:\"video\", trackIndex:0, startSeconds:0, overwrite:true, linked:true, and clips in script row order. Include importSrtFile only when Overlay/Text cells and cut timing are usable.",
      "Also include validationStatus:\"validated\" when the script is usable, or validationStatus:\"needsContext\" with needsContext:true when footage references are ambiguous, missing, or impossible to verify from the available project context.",
      "Always include action-list fields when applicable: missingSources:[\"B1.3.mp4\"], ambiguousMatches:[\"Source X could be A or B\"], unresolvedSources:[\"Unknown source\"]. These power the panel's visible Missing/Fixed/Needs Context list.",
      "When a specific table cell causes a problem, include validationIssues:[{\"row\":3,\"columnName\":\"Source File\",\"message\":\"B1.3.mp4 is missing\"}] so the panel can red-highlight that cell.",
      "Include validationMessage with a short user-facing explanation naming the script and the unresolved source/context when validationStatus is needsContext.",
      "Rows and columns are 1-based and include the header row. Use columnName instead of column when it is clearer.",
      "If no changes are needed, return {\"scriptEdits\":[]}.",
      "User validation instructions:",
      validationInstructions || "(none)",
      "Project context:",
      JSON.stringify(validationContext, null, 2),
      "Script name:",
      scriptPayload.scriptName || activeScriptDocument().name || "(unnamed)",
      "Product/project name:",
      scriptPayload.projectName || activeScriptProject().name || "(unnamed)",
      "Script column roles:",
      scriptPayload.columnRoles && scriptPayload.columnRoles.length ? JSON.stringify(scriptPayload.columnRoles, null, 2) : "(none)",
      "Script plain text:",
      scriptPayload.text || "(empty)",
      "Script table rows:",
      scriptPayload.tableRows && scriptPayload.tableRows.length ? JSON.stringify(scriptPayload.tableRows, null, 2) : "(none)",
      "Script merged-cell map:",
      scriptPayload.tableCells && scriptPayload.tableCells.length ? JSON.stringify(scriptPayload.tableCells, null, 2) : "(none)",
      "Script HTML:",
      scriptPayload.html || "(empty)",
      scriptWantsSplitText() ? splitTextPromptSection(scriptPayload) : ""
    ].join("\n\n");
  }

  var captionChunkCost = 25;
  var captionSentenceCrossCost = 400;
  var captionBreakScores = {
    sentence: 100,
    softClause: 80,
    subordinator: 70,
    coordinator: 65,
    determiner: 45,
    preposition: 40,
    neutral: 18,
    weak: 4,
    sticky: -60
  };

  function captionWordSet(list) {
    var set = {};
    for (var i = 0; i < list.length; i++) {
      set[list[i]] = true;
    }
    return set;
  }

  var captionSubordinators = captionWordSet([
    "because", "although", "though", "while", "whereas", "unless", "until",
    "since", "whenever", "wherever", "whether", "if", "when", "which", "who",
    "whom", "whose", "where", "that", "than", "as", "before", "after", "once"
  ]);
  var captionCoordinators = captionWordSet(["and", "but", "or", "so", "yet", "nor", "plus", "then", "also", "however", "instead", "meanwhile", "therefore", "still"]);
  var captionSubjectPronouns = captionWordSet(["i", "you", "we", "they", "he", "she", "it", "there", "here", "this", "these", "those", "everyone", "nobody", "someone", "everything", "nothing", "something"]);
  var captionDeterminers = captionWordSet(["the", "a", "an", "my", "your", "our", "their", "his", "her", "its", "every", "each", "another", "both", "all", "any", "some", "no", "most", "few", "many", "much", "one"]);
  var captionPrepositions = captionWordSet([
    "in", "on", "at", "with", "for", "from", "to", "by", "of", "about", "into",
    "onto", "over", "under", "through", "during", "without", "within", "between",
    "against", "across", "toward", "towards", "around", "behind", "beyond",
    "above", "below", "along", "beside", "besides", "per", "via", "like", "upon"
  ]);
  var captionAuxiliaries = captionWordSet([
    "is", "are", "was", "were", "am", "be", "been", "being", "have", "has", "had",
    "do", "does", "did", "will", "would", "shall", "should", "can", "could",
    "may", "might", "must", "going", "gonna", "let", "lets"
  ]);
  var captionNegations = captionWordSet(["not", "dont", "doesnt", "didnt", "cant", "cannot", "wont", "wouldnt", "isnt", "arent", "wasnt", "werent", "havent", "hasnt", "hadnt", "shouldnt", "couldnt", "never"]);
  var captionAbbreviations = captionWordSet(["mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "eg", "ie", "approx", "fig", "no", "inc", "ltd", "co", "dept", "est", "min", "max", "sec", "vol"]);
  var captionModifiers = captionWordSet([
    "first", "second", "third", "last", "next", "same", "other", "another", "such",
    "own", "whole", "entire", "single", "only", "just", "very", "really", "quite",
    "pretty", "more", "most", "less", "least", "better", "best", "worse", "worst",
    "big", "biggest", "small", "smallest", "new", "old", "good", "bad", "great",
    "real", "main", "final", "full", "half", "few", "several", "certain", "actual",
    "even", "still", "almost", "nearly", "always", "never", "often", "sometimes",
    "too", "so", "much", "many", "how", "what", "why", "super", "highly"
  ]);

  function captionWordCore(word) {
    return String(word || "")
      .toLowerCase()
      .replace(/[‘’']/g, "")
      .replace(/[^a-z0-9]+/g, "");
  }

  function captionEndsSentence(word) {
    var text = String(word || "");
    if (!/[.!?…][")'\]”’]*$/.test(text)) {
      return false;
    }
    if (/[!?…]/.test(text)) {
      return true;
    }
    var core = captionWordCore(text);
    if (captionAbbreviations[core] || core.length <= 1) {
      return false;
    }
    if (/^\d+$/.test(core)) {
      return false;
    }
    if (/^(?:[a-z]\.){2,}$/i.test(text)) {
      return false;
    }
    return true;
  }

  function captionEndsSoftClause(word) {
    return /[,;:—–][")'\]”’]*$/.test(String(word || ""));
  }

  function captionStickyAfter(word, next) {
    var text = String(word || "");
    var core = captionWordCore(text);
    if (captionDeterminers[core] || captionPrepositions[core] || captionAuxiliaries[core] ||
      captionNegations[core] || captionCoordinators[core] || captionSubordinators[core] ||
      captionAbbreviations[core] || captionModifiers[core]) {
      return true;
    }
    if (/[-–—]$/.test(text) || /^\d+(?:[.,]\d+)?$/.test(core)) {
      return true;
    }
    if (next && /^[")'\]”’,.;:!?…%]/.test(String(next))) {
      return true;
    }
    return false;
  }

  function captionWeakBreakAfter(word) {
    return captionSubjectPronouns[captionWordCore(word)] === true;
  }

  function captionGapScores(words, mode) {
    var scores = [];
    for (var i = 0; i < words.length; i++) {
      var word = words[i];
      var next = i + 1 < words.length ? words[i + 1] : "";
      var nextCore = captionWordCore(next);
      var score = captionBreakScores.neutral;
      if (captionEndsSentence(word)) {
        score = captionBreakScores.sentence;
      } else if (captionEndsSoftClause(word)) {
        score = captionBreakScores.softClause;
      } else if (mode === "readability") {
        if (captionSubordinators[nextCore]) {
          score = captionBreakScores.subordinator;
        } else if (captionCoordinators[nextCore]) {
          score = captionBreakScores.coordinator;
        } else if (captionDeterminers[nextCore]) {
          score = captionBreakScores.determiner;
        } else if (captionPrepositions[nextCore]) {
          score = captionBreakScores.preposition;
        }
      }
      if (mode === "even") {
        score = captionBreakScores.neutral;
      } else if (score < captionBreakScores.softClause) {
        if (captionStickyAfter(word, next)) {
          score = captionBreakScores.sticky;
        } else if (captionWeakBreakAfter(word)) {
          score = Math.min(score, captionBreakScores.weak);
        }
      }
      scores.push(score);
    }
    return scores;
  }

  function captionChunkPlan(words, maxWords, maxCharacters, scores) {
    var count = words.length;
    var charTotals = [0];
    var sentenceTotals = [0];
    for (var i = 0; i < count; i++) {
      charTotals.push(charTotals[i] + words[i].length);
      sentenceTotals.push(sentenceTotals[i] + (captionEndsSentence(words[i]) ? 1 : 0));
    }
    function chunkLength(from, to) {
      return charTotals[to + 1] - charTotals[from] + (to - from);
    }
    function internalSentenceEnds(from, to) {
      return sentenceTotals[to] - sentenceTotals[from];
    }
    var stubLength = Math.max(4, Math.round(maxCharacters * 0.4));
    var minWords = Math.max(1, Math.min(2, maxWords - 1));
    var best = [0];
    var origin = [0];
    for (var end = 0; end < count; end++) {
      best[end + 1] = Infinity;
      origin[end + 1] = end;
      var earliest = Math.max(0, end - maxWords + 1);
      for (var start = earliest; start <= end; start++) {
        if (best[start] === Infinity) {
          continue;
        }
        var chunkWords = end - start + 1;
        var length = chunkLength(start, end);
        if (chunkWords > 1 && length > maxCharacters) {
          continue;
        }
        var cost = best[start] + captionChunkCost;
        cost += end === count - 1 ? 0 : (captionBreakScores.sentence - scores[end]);
        cost += internalSentenceEnds(start, end) * captionSentenceCrossCost;
        if (length < stubLength && end < count - 1) {
          cost += (stubLength - length) * 2;
        }
        if (chunkWords < minWords && count > minWords) {
          cost += 30;
        }
        if (cost < best[end + 1]) {
          best[end + 1] = cost;
          origin[end + 1] = start;
        }
      }
    }
    var bounds = [];
    var cursor = count;
    while (cursor > 0) {
      var from = origin[cursor];
      bounds.unshift([from, cursor - 1]);
      cursor = from;
    }
    return bounds;
  }

  function trimCaptionEndPunctuation(text) {
    var value = String(text || "");
    /* A standalone dash can also land at the start of a row when the split
       happened on it, which reads as a stray bullet. */
    value = value.replace(/^[\s\u2013\u2014-]+(?=\S)/, "");
    var closers = "";
    var trailingClosers = value.match(/(["')\]\u201d\u2019]+)$/);
    if (trailingClosers) {
      closers = trailingClosers[1];
      value = value.slice(0, value.length - closers.length);
    }
    /* Dashes are how the splitter marks a clause break, so a row can end on one.
       Drop a trailing comma or dash; a dash inside the row is left alone. */
    if (/[,\u2013\u2014-]$/.test(value)) {
      return value.replace(/[\s,\u2013\u2014-]+$/, "") + closers;
    }
    if (/(?:\.\.\.|\u2026)$/.test(value)) {
      return value + closers;
    }
    if (/\.$/.test(value)) {
      var tokens = value.split(/\s+/);
      if (captionEndsSentence(tokens[tokens.length - 1])) {
        return value.slice(0, value.length - 1) + closers;
      }
    }
    return value + closers;
  }

  function getCaptionChunkSettings() {
    var shared = readSharedMediaSettings();
    var maxWords = Math.round(finiteNumber(
      shared.captionMaxWords != null ? shared.captionMaxWords : els.captionMaxWords && els.captionMaxWords.value !== "" ? els.captionMaxWords.value : defaultCaptionMaxWords,
      defaultCaptionMaxWords
    ));
    var maxCharacters = Math.round(finiteNumber(
      shared.captionMaxChars != null ? shared.captionMaxChars : els.captionMaxChars && els.captionMaxChars.value !== "" ? els.captionMaxChars.value : defaultCaptionMaxChars,
      defaultCaptionMaxChars
    ));
    return {
      maxWords: Math.max(1, Math.min(20, maxWords)),
      maxCharacters: Math.max(8, Math.min(90, maxCharacters)),
      mode: captionSplitMode(shared.captionSplitMode || (els.captionSplitMode && els.captionSplitMode.value) || defaultCaptionSplitMode),
      trimEndPunctuation: shared.captionTrimEndPunctuation != null ? !!shared.captionTrimEndPunctuation : !els.captionTrimEndPunctuation || els.captionTrimEndPunctuation.checked
    };
  }

  function captionSplitMode(value) {
    var mode = String(value || "");
    if (mode === "even" || mode === "standard") {
      return "even";
    }
    if (mode === "punctuation") {
      return "punctuation";
    }
    return "readability";
  }

  function optimizedSubtitleChunks(value, options) {
    var text = String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "");
    if (!text) {
      return [];
    }
    var settings = options || getCaptionChunkSettings();
    var maxWords = Math.max(1, Number(settings.maxWords) || defaultCaptionMaxWords);
    var maxCharacters = Math.max(8, Number(settings.maxCharacters) || defaultCaptionMaxChars);
    var mode = captionSplitMode(settings.mode !== undefined ? settings.mode : (settings.fine === false ? "even" : "readability"));
    var words = text.split(" ");
    var scores = captionGapScores(words, mode);
    var bounds = captionChunkPlan(words, maxWords, maxCharacters, scores);
    var trimEnds = settings.trimEndPunctuation !== false;
    var chunks = [];
    for (var i = 0; i < bounds.length; i++) {
      var chunk = words.slice(bounds[i][0], bounds[i][1] + 1).join(" ");
      if (trimEnds) {
        chunk = trimCaptionEndPunctuation(chunk);
      }
      if (chunk) {
        chunks.push(chunk);
      }
    }
    return chunks;
  }

  function subtitleChunksFromOptimizedCell(value, fallbackText) {
    var lines = String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    var chunks = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/^\s+|\s+$/g, "");
      if (line) {
        chunks.push(line);
      }
    }
    return chunks.length ? chunks : (fallbackText ? [fallbackText] : []);
  }

  function proportionalCaptionBlocks(chunks, start, end) {
    chunks = chunks && chunks.length ? chunks : [];
    start = Number(start || 0);
    end = Math.max(start + 0.02, Number(end || start));
    if (!chunks.length) {
      return [];
    }
    var weights = [];
    var totalWeight = 0;
    for (var i = 0; i < chunks.length; i++) {
      var weight = Math.max(1, alignmentTokens(chunks[i]).length);
      weights.push(weight);
      totalWeight += weight;
    }
    var blocks = [];
    var cumulative = 0;
    for (var c = 0; c < chunks.length; c++) {
      var blockStart = start + (end - start) * cumulative / totalWeight;
      cumulative += weights[c];
      var blockEnd = c === chunks.length - 1 ? end : start + (end - start) * cumulative / totalWeight;
      blocks.push({ start: blockStart, end: Math.max(blockStart + 0.02, blockEnd), text: chunks[c] });
    }
    return blocks;
  }

  /* Finds the run of Whisper word timings that falls inside one natural SRT
     block's time window, so a block can be re-timed without any script to
     match it against - the block's OWN timestamps are the ground truth. A
     small tolerance absorbs the millisecond rounding SRT timestamps go
     through versus the raw JSON floats. */
  function wordIndexRangeForTimeWindow(words, start, end) {
    if (!words || !words.length) {
      return null;
    }
    var tolerance = 0.12;
    var startIndex = -1;
    var endIndex = -1;
    for (var i = 0; i < words.length; i++) {
      var word = words[i];
      if (!word || !isFinite(Number(word.start))) {
        continue;
      }
      var wordStart = Number(word.start);
      if (wordStart >= start - tolerance && wordStart <= end + tolerance) {
        if (startIndex < 0) {
          startIndex = i;
        }
        endIndex = i;
      }
    }
    if (startIndex < 0 || endIndex < startIndex) {
      return null;
    }
    return { start: startIndex, end: endIndex };
  }

  /* Re-splits Whisper's OWN natural SRT blocks (sentence/phrase-length
     segments) into shorter, readability-aware caption rows, with no script
     involved anywhere. Each block supplies its own time window and - when
     word-level timing is available - its own word range, so every block is
     retimed independently of the others. */
  function optimizedCaptionItemsFromTimedBlocks(blocks, words, captionSettings) {
    var result = [];
    for (var b = 0; b < blocks.length; b++) {
      var block = blocks[b];
      var text = String(block && block.text || "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
      if (!text) {
        continue;
      }
      var chunks = optimizedSubtitleChunks(text, captionSettings);
      if (chunks.length <= 1) {
        result.push({ start: block.start, end: block.end, text: chunks.length ? chunks[0] : text });
        continue;
      }
      var wordRange = wordIndexRangeForTimeWindow(words, block.start, block.end);
      var originalBlock = wordRange ? { start: block.start, end: block.end, wordStartIndex: wordRange.start, wordEndIndex: wordRange.end } : null;
      var blocksForChunk = optimizedCaptionBlocksForAlignedLine(chunks, block, originalBlock, words);
      result = result.concat(blocksForChunk.length ? blocksForChunk : [{ start: block.start, end: block.end, text: text }]);
    }
    return result;
  }

  function optimizedCaptionBlocksForAlignedLine(chunks, alignedBlock, originalBlock, words) {
    chunks = chunks && chunks.length ? chunks : [];
    if (!chunks.length || !alignedBlock) {
      return [];
    }
    if (chunks.length === 1) {
      var singleStart = Number(alignedBlock.start || 0);
      return [{ start: singleStart, end: Math.max(singleStart + 0.02, Number(alignedBlock.end || singleStart)), text: chunks[0] }];
    }
    var alignedStart = Number(alignedBlock.start || 0);
    var alignedEnd = Math.max(alignedStart + 0.02, Number(alignedBlock.end || alignedStart));
    var wordStart = originalBlock && isFinite(originalBlock.wordStartIndex) ? Number(originalBlock.wordStartIndex) : -1;
    var wordEnd = originalBlock && isFinite(originalBlock.wordEndIndex) ? Number(originalBlock.wordEndIndex) : -1;
    if (!words || !words.length || wordStart < 0 || wordEnd < wordStart || !words[wordStart] || !words[wordEnd]) {
      return proportionalCaptionBlocks(chunks, alignedStart, alignedEnd);
    }
    var rawStart = Number(originalBlock.start !== undefined ? originalBlock.start : words[wordStart].start);
    var rawEnd = Math.max(rawStart + 0.02, Number(originalBlock.end !== undefined ? originalBlock.end : words[wordEnd].end));
    var tokenCounts = [];
    var totalTokens = 0;
    for (var t = 0; t < chunks.length; t++) {
      var tokenCount = Math.max(1, alignmentTokens(chunks[t]).length);
      tokenCounts.push(tokenCount);
      totalTokens += tokenCount;
    }
    var boundaries = [alignedStart];
    var cumulativeTokens = 0;
    var detectedCount = wordEnd - wordStart + 1;
    if (detectedCount < 2) {
      return proportionalCaptionBlocks(chunks, alignedStart, alignedEnd);
    }
    for (var b = 1; b < chunks.length; b++) {
      cumulativeTokens += tokenCounts[b - 1];
      var detectedOffset = Math.max(1, Math.min(detectedCount - 1, Math.round(cumulativeTokens / totalTokens * detectedCount)));
      var boundaryWord = words[wordStart + detectedOffset];
      var rawBoundary = boundaryWord ? Number(boundaryWord.start) : rawStart + (rawEnd - rawStart) * cumulativeTokens / totalTokens;
      var ratio = Math.max(0, Math.min(1, (rawBoundary - rawStart) / Math.max(0.02, rawEnd - rawStart)));
      boundaries.push(alignedStart + (alignedEnd - alignedStart) * ratio);
    }
    boundaries.push(alignedEnd);
    var minimum = Math.min(0.12, (alignedEnd - alignedStart) / Math.max(1, chunks.length));
    for (var forward = 1; forward < boundaries.length; forward++) {
      boundaries[forward] = Math.max(boundaries[forward], boundaries[forward - 1] + minimum);
    }
    boundaries[boundaries.length - 1] = alignedEnd;
    for (var backward = boundaries.length - 2; backward > 0; backward--) {
      boundaries[backward] = Math.min(boundaries[backward], boundaries[backward + 1] - minimum);
    }
    var blocks = [];
    for (var i = 0; i < chunks.length; i++) {
      blocks.push({
        start: boundaries[i],
        end: Math.max(boundaries[i] + 0.02, boundaries[i + 1]),
        text: chunks[i]
      });
    }
    return blocks;
  }

  /* One entry per text line, same order/count as optimizedSubtitleRowsFromScriptPayload
     and the Whisper-aligned blocks it pairs with by index - so a Notes track can reuse
     whichever row's timing the main captions already computed for this run, with zero
     duplicate alignment work. Rows with no note are included (empty text) so callers can
     still pair by index; they filter the empties out when building caption blocks. */
  function scriptNotesRowsFromScriptPayload(scriptPayload) {
    var payload = scriptPayload || getScriptInputPayload();
    var model = canonicalScriptModel(payload);
    var notesIndex = model.columns.notes;
    var rows = payload.tableRows || [];
    var out = [];
    for (var g = 0; g < model.groups.length; g++) {
      for (var l = 0; l < model.groups[g].lines.length; l++) {
        var line = model.groups[g].lines[l];
        var raw = notesIndex >= 0 && rows[line.rowIndex] && rows[line.rowIndex][notesIndex] !== undefined ? rows[line.rowIndex][notesIndex] : "";
        out.push({ row: line.row, rowIndex: line.rowIndex, text: String(raw || "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "") });
      }
    }
    return out;
  }

  /* Pairs each notes row with the SAME aligned time window the main dialogue caption at
     that index already uses - one full, unsplit caption block per row that has a note,
     so "optimized" splitting never touches it. alignedBlocks must be in the same row
     order/count as notesRows (true for both runLocalAudioSubtitleAction's splitItems and
     Full Process's per-row subtitle loop). */
  function notesCaptionItemsFromAlignedBlocks(notesRows, alignedBlocks) {
    if (!notesRows || !notesRows.length || !alignedBlocks || alignedBlocks.length !== notesRows.length) {
      return [];
    }
    var items = [];
    for (var i = 0; i < notesRows.length; i++) {
      var text = notesRows[i].text;
      var block = alignedBlocks[i];
      if (!text || !block) {
        continue;
      }
      items.push({ start: block.start, end: block.end, text: text });
    }
    return items;
  }

  function notesTrackSourceName(scriptPayload) {
    var name = String((scriptPayload && scriptPayload.scriptName) || (activeScriptDocument && activeScriptDocument() ? activeScriptDocument().name : "") || "Script").replace(/^\s+|\s+$/g, "");
    return (name || "Script") + " - EDITOR NOTES (delete before export)";
  }

  var notesTrackCreatedForScriptId = {};

  /* Premiere's ExtendScript API has no way to enumerate or delete a caption track once
     created (confirmed: no sequence.captionTracks/getCaptionTrackCount, no documented
     removal method - the only way is right-clicking the track header in the Timeline).
     So a rerun can never replace the previous Notes track automatically; the best this
     can do is warn when PR AI already made one this session, so a stray extra track is
     a reminder, not a surprise at export time. */
  function warnIfNotesTrackMayAlreadyExist(scriptId) {
    if (notesTrackCreatedForScriptId[scriptId]) {
      appendMessage("system", "A Notes caption track was already created for this script earlier in this session. Premiere does not let PR AI remove the old one automatically - delete it by hand (right-click its track header in the Timeline > Delete Track) before export, or you will end up with more than one.");
    }
    notesTrackCreatedForScriptId[scriptId] = true;
  }

  function optimizedSubtitleRowsFromScriptPayload(scriptPayload) {
    var model = canonicalScriptModel(scriptPayload || getScriptInputPayload());
    var rows = [];
    for (var g = 0; g < model.groups.length; g++) {
      for (var l = 0; l < model.groups[g].lines.length; l++) {
        var line = model.groups[g].lines[l];
        rows.push({
          row: line.row,
          text: line.text,
          chunks: line.subtitleChunks && line.subtitleChunks.length ? line.subtitleChunks : [line.text]
        });
      }
    }
    return rows;
  }

  function validationDeclinesOptimizedText(validationInstructions) {
    var value = String(validationInstructions || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "");
    if (!value) {
      return false;
    }
    return /\b(?:do not|don t|dont|no|never|skip|stop)\s+(?:auto(?:matically)?\s+)?(?:optimi[sz]|split|break|reflow|chunk)/.test(value);
  }

  function scriptWantsSplitText(scriptDoc) {
    scriptDoc = scriptDoc || (activeScriptDocument ? activeScriptDocument() : null);
    if (validationDeclinesOptimizedText(scriptDoc && scriptDoc.validationPrompt)) {
      return false;
    }
    if (!scriptDoc || scriptDoc.splitText === undefined) {
      return defaultScriptSplitText;
    }
    return scriptDoc.splitText !== false;
  }

  function scriptWantsNotesTrack(scriptDoc) {
    scriptDoc = scriptDoc || (activeScriptDocument ? activeScriptDocument() : null);
    if (!scriptDoc || scriptDoc.notesTrack === undefined) {
      return true;
    }
    return scriptDoc.notesTrack !== false;
  }

  function removeAutoGeneratedOptimizedTextColumn() {
    if (scriptWantsSplitText()) {
      return 0;
    }
    var table = els.scriptInput ? els.scriptInput.querySelector("table") : null;
    if (!table) {
      return 0;
    }
    var model = canonicalScriptModel(getScriptInputPayload());
    var optimizedIndex = model.columns.optimizedText;
    if (optimizedIndex < 0) {
      return 0;
    }
    var expectedByRow = {};
    for (var g = 0; g < model.groups.length; g++) {
      for (var l = 0; l < model.groups[g].lines.length; l++) {
        var line = model.groups[g].lines[l];
        expectedByRow[line.rowIndex] = optimizedSubtitleChunks(line.text).join("\n");
      }
    }
    var grid = logicalSheetGrid(table);
    var checkedCells = [];
    for (var rowIndex = model.dataStartIndex; rowIndex < grid.rows.length; rowIndex++) {
      var info = grid.refs[rowIndex] && grid.refs[rowIndex][optimizedIndex] ? grid.refs[rowIndex][optimizedIndex] : null;
      if (!info || checkedCells.indexOf(info.cell) !== -1) {
        continue;
      }
      checkedCells.push(info.cell);
      var current = sheetCellText(info.cell);
      if (!current) {
        continue;
      }
      if (info.cell.getAttribute("data-generated-optimized-text") !== "true" || current !== (expectedByRow[info.originRow] || "")) {
        return 0;
      }
    }
    if (!checkedCells.length) {
      return 0;
    }
    deleteSheetColumn(optimizedIndex);
    return 1;
  }

  var scriptColumnRoleNames = { text: true, optimizedText: true, cut: true, source: true, notes: true, skip: true };

  function columnLetter(index) {
    var letter = "";
    var value = Number(index);
    while (value >= 0) {
      letter = String.fromCharCode(65 + (value % 26)) + letter;
      value = Math.floor(value / 26) - 1;
    }
    return letter;
  }

  function columnIndexFromLabel(label) {
    var value = String(label === undefined || label === null ? "" : label).replace(/^\s+|\s+$/g, "");
    if (/^\d+$/.test(value)) {
      return Number(value);
    }
    if (!/^[A-Za-z]+$/.test(value)) {
      return -1;
    }
    value = value.toUpperCase();
    var index = 0;
    for (var i = 0; i < value.length; i++) {
      index = index * 26 + (value.charCodeAt(i) - 64);
    }
    return index - 1;
  }

  function setLogicalColumnRole(table, colIndex, role) {
    var header = headerCellForColumn(table, colIndex);
    if (!header) {
      return false;
    }
    var current = header.getAttribute("data-column-role") || "";
    if (current === (role || "")) {
      return false;
    }
    if (role) {
      header.setAttribute("data-column-role", role);
    } else {
      header.removeAttribute("data-column-role");
      header.removeAttribute("data-column-label");
    }
    return true;
  }

  /* The agent decides what each column is; its answer replaces every existing
     role so a stale or mis-stamped tag cannot survive. */
  function applyAgentColumnRoles(table, payload) {
    var entries = payload && (payload.splitColumnRoles || payload.columnRoles || payload.columns);
    if (!entries) {
      return 0;
    }
    var byIndex = {};
    var i;
    if (Object.prototype.toString.call(entries) === "[object Array]") {
      for (i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (typeof entry === "string") {
          byIndex[i] = entry;
          continue;
        }
        if (!entry) {
          continue;
        }
        var at = entry.column !== undefined ? entry.column : (entry.index !== undefined ? entry.index : i);
        var resolved = columnIndexFromLabel(at);
        if (resolved >= 0) {
          byIndex[resolved] = entry.role || "";
        }
      }
    } else {
      for (var role in entries) {
        if (entries.hasOwnProperty(role) && scriptColumnRoleNames[role]) {
          var mapped = columnIndexFromLabel(entries[role]);
          if (mapped >= 0) {
            byIndex[mapped] = role;
          }
        }
      }
    }
    var columnCount = logicalSheetGrid(table).columnCount;
    var changed = 0;
    for (var c = 0; c < columnCount; c++) {
      var wanted = byIndex[c] && scriptColumnRoleNames[byIndex[c]] && byIndex[c] !== "skip" ? byIndex[c] : "";
      if (setLogicalColumnRole(table, c, wanted)) {
        changed++;
      }
    }
    return changed;
  }

  /* Repairs sheets tagged by the pre-fix column-index bug. A tag this generator
     claims (it writes data-column-label alongside the role) but whose column
     holds no cell it actually wrote cannot be a real Optimized Text column, so
     it is dropped. Roles a user set by hand carry no label and are left alone. */
  function repairOptimizedTextColumnRoles(table) {
    var grid = logicalSheetGrid(table);
    var tagged = [];
    for (var c = 0; c < grid.columnCount; c++) {
      var header = headerCellForColumn(table, c);
      if (!header || header.getAttribute("data-column-role") !== "optimizedText") {
        continue;
      }
      var owns = false;
      for (var r = 0; r < grid.rows.length; r++) {
        var info = grid.refs[r] ? grid.refs[r][c] : null;
        if (info && info.cell.getAttribute("data-generated-optimized-text") === "true") {
          owns = true;
          break;
        }
      }
      tagged.push({
        header: header,
        owns: owns,
        claimed: header.getAttribute("data-column-label") === "Optimized Text"
      });
    }
    if (!tagged.length) {
      return 0;
    }
    var keep = -1;
    for (var t = 0; t < tagged.length; t++) {
      if (tagged[t].owns) {
        keep = t;
      }
    }
    var cleared = 0;
    for (var k = 0; k < tagged.length; k++) {
      if (k === keep || (!tagged[k].claimed && tagged.length < 2)) {
        continue;
      }
      tagged[k].header.removeAttribute("data-column-role");
      tagged[k].header.removeAttribute("data-column-label");
      cleared++;
    }
    return cleared;
  }

  function ensureOptimizedTextColumn(valuesByRow) {
    if (!scriptWantsSplitText()) {
      return 0;
    }
    var table = els.scriptInput ? els.scriptInput.querySelector("table") : null;
    if (!table) {
      return 0;
    }
    var repaired = repairOptimizedTextColumnRoles(table);
    if (repaired) {
      pushSheetUndo();
      updateSheetRails();
      saveActiveScriptDocument();
    }
    var scriptPayload = getScriptInputPayload();
    var model = canonicalScriptModel(scriptPayload);
    if (model.columns.text < 0 || !model.rows.length) {
      return repaired;
    }
    var grid = logicalSheetGrid(table);
    var optimizedIndex = model.columns.optimizedText;
    var needsColumn = optimizedIndex < 0;
    if (needsColumn) {
      optimizedIndex = grid.columnCount;
    }
    var desiredByRow = {};
    for (var g = 0; g < model.groups.length; g++) {
      for (var l = 0; l < model.groups[g].lines.length; l++) {
        var line = model.groups[g].lines[l];
        desiredByRow[line.rowIndex] = valuesByRow && valuesByRow[line.rowIndex] !== undefined
          ? String(valuesByRow[line.rowIndex])
          : optimizedSubtitleChunks(line.text).join("\n");
      }
    }
    var dataStart = model.dataStartIndex;
    var changed = needsColumn;
    if (!needsColumn) {
      for (var checkRow = dataStart; checkRow < grid.rows.length; checkRow++) {
        var checkInfo = grid.refs[checkRow] && grid.refs[checkRow][optimizedIndex] ? grid.refs[checkRow][optimizedIndex] : null;
        if (checkInfo && checkInfo.originRow !== checkRow) {
          continue;
        }
        var desired = desiredByRow[checkRow] || "";
        if (!checkInfo || sheetCellText(checkInfo.cell) !== desired) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) {
      return 0;
    }

    pushSheetUndo();
    if (needsColumn) {
      optimizedIndex = appendLogicalSheetColumn(table, "Optimized Text", dataStart);
    }
    grid = logicalSheetGrid(table);
    var roleCell = grid.refs[0] && grid.refs[0][optimizedIndex] ? grid.refs[0][optimizedIndex].cell : null;
    if (roleCell) {
      roleCell.setAttribute("data-column-role", "optimizedText");
      roleCell.setAttribute("data-column-label", "Optimized Text");
      if (dataStart === 1) {
        setCellText(roleCell, "Optimized Text");
      }
    }
    var writtenCells = [];
    var changedCells = 0;
    for (var rowIndex = dataStart; rowIndex < grid.rows.length; rowIndex++) {
      var info = grid.refs[rowIndex] && grid.refs[rowIndex][optimizedIndex] ? grid.refs[rowIndex][optimizedIndex] : null;
      if (!info || writtenCells.indexOf(info.cell) !== -1) {
        continue;
      }
      writtenCells.push(info.cell);
      var value = desiredByRow[info.originRow] || "";
      var existing = sheetCellText(info.cell);
      /* Only ever write into cells this generator owns. Anything the user typed
         stays put, so a column-index slip can never eat script content. */
      if (existing && info.cell.getAttribute("data-generated-optimized-text") !== "true") {
        continue;
      }
      if (existing !== value) {
        setCellText(info.cell, value);
        info.cell.setAttribute("data-generated-optimized-text", "true");
        changedCells++;
      }
    }
    updateSheetRails();
    saveActiveScriptDocument();
    return Math.max(1, changedCells);
  }

  function splitTextPromptRows(scriptPayload) {
    var rows = scriptPayload.tableRows || [];
    var lines = [];
    var width = 0;
    var r;
    for (r = 0; r < rows.length; r++) {
      width = Math.max(width, rows[r] ? rows[r].length : 0);
    }
    var header = ["row"];
    for (var c = 0; c < width; c++) {
      header.push(columnLetter(c));
    }
    lines.push(header.join("\t"));
    for (r = 0; r < rows.length; r++) {
      var cells = [String(r + 1)];
      for (var cc = 0; cc < width; cc++) {
        cells.push(String(rows[r] && rows[r][cc] !== undefined ? rows[r][cc] : "").replace(/\t/g, " ").replace(/\n/g, " \u21b5 "));
      }
      lines.push(cells.join("\t"));
    }
    return lines.join("\n");
  }

  function buildSplitTextPrompt(scriptPayload) {
    var caption = getCaptionChunkSettings();
    var roleHint = [];
    var roles = scriptPayload.columnRoles || [];
    for (var i = 0; i < roles.length; i++) {
      if (roles[i]) {
        roleHint.push(columnLetter(i) + "=" + roles[i]);
      }
    }
    return [
      "You are preparing caption rows for a Premiere Pro script sheet.",
      "",
      "Do two things and return one JSON object only, with no prose and no code fence.",
      "",
      "1. Decide what every column is. Allowed roles: text (the spoken script line), optimizedText (caption rows generated from it), cut (source in/out ranges), source (footage/clip names), notes (anything else, including product feature lists, comments, or directions), skip (empty/unused).",
      "Exactly one column may be text. Columns holding product features, marketing bullets, or commentary are notes, never text and never optimizedText.",
      "Judge from the cell contents, not from the column order or any existing role.",
      "",
      "2. For every data row, split that row's text cell into caption rows for burned-in subtitles.",
      "Split on meaning and readability: break at sentence ends, clause boundaries and natural phrase edges. Never split an article, preposition, auxiliary verb, negation or modifier away from the word it belongs to. Never let one caption row span two sentences.",
      "Keep each caption row at most " + caption.maxWords + " words and " + caption.maxCharacters + " characters; treat those as ceilings, not targets, and prefer a shorter row that breaks in the right place.",
      caption.trimEndPunctuation ? "Drop a trailing period or comma at the end of each caption row, but keep ellipses, question marks, exclamation marks and mid-row punctuation." : "Keep the original punctuation in every caption row.",
      "Preserve the original wording and language exactly, including any non-English text. Do not translate, rewrite, summarise or correct anything.",
      "If a row's text cell is empty, return an empty lines array for it.",
      "",
      "Return this shape:",
      '{"splitColumnRoles":[{"column":"A","role":"text"},{"column":"B","role":"cut"}],"optimizedRows":[{"row":1,"lines":["First caption row","Second caption row"]}]}',
      "",
      "Row numbers are 1-based and match the first column of the table below. A header row, if present, must not appear in optimizedRows.",
      "",
      "Existing column roles (these may be wrong; re-decide them yourself): " + (roleHint.length ? roleHint.join(", ") : "(none)"),
      "",
      "Script name: " + (scriptPayload.scriptName || "(unnamed)"),
      "Product/project: " + (scriptPayload.projectName || "(unnamed)"),
      "",
      "Table (tab separated, \u21b5 marks a line break inside a cell):",
      splitTextPromptRows(scriptPayload)
    ].join("\n");
  }

  function optimizedValuesFromAgentPayload(payload) {
    var entries = payload && (payload.optimizedRows || payload.rows || payload.optimizedText);
    if (!entries || Object.prototype.toString.call(entries) !== "[object Array]") {
      return null;
    }
    var valuesByRow = {};
    var found = 0;
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (!entry) {
        continue;
      }
      var rowNumber = Number(entry.row !== undefined ? entry.row : entry.rowIndex);
      if (!isFinite(rowNumber) || rowNumber < 1) {
        continue;
      }
      var lines = entry.lines || entry.chunks || entry.captions || entry.text;
      var text;
      if (Object.prototype.toString.call(lines) === "[object Array]") {
        var kept = [];
        for (var l = 0; l < lines.length; l++) {
          var line = String(lines[l] === undefined || lines[l] === null ? "" : lines[l]).replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
          if (line) {
            kept.push(line);
          }
        }
        text = kept.join("\n");
      } else {
        text = String(lines === undefined || lines === null ? "" : lines).replace(/^\s+|\s+$/g, "");
      }
      valuesByRow[rowNumber - 1] = text;
      found++;
    }
    return found ? valuesByRow : null;
  }

  function splitScriptTextLocally(reason) {
    var changed = ensureOptimizedTextColumn();
    updateSheetDiagnostics();
    var suffix = reason ? " (" + reason + ")" : "";
    setStatus(changed
      ? "Split text updated " + changed + " Optimized Text row(s) locally" + suffix + "."
      : "Optimized Text is already up to date" + suffix + ".", !!reason);
    return changed;
  }

  function splitScriptTextWithAgent() {
    if (isAgentRunning) {
      setStatus("Waiting for current reply before splitting text.", true);
      return;
    }
    saveActiveScriptDocument();
    var scriptPayload = getScriptInputPayload();
    if (!scriptPayload.text) {
      setStatus("Script is empty.", true);
      return;
    }
    if (!scriptWantsSplitText()) {
      var removed = removeAutoGeneratedOptimizedTextColumn();
      updateSheetDiagnostics();
      setStatus(removed ? "Split text is off; removed the generated Optimized Text column." : "Split text is off for this script.", !removed);
      return;
    }
    var table = els.scriptInput ? els.scriptInput.querySelector("table") : null;
    if (!table) {
      splitScriptTextLocally("no table");
      return;
    }
    var provider = els.provider && els.provider.value === "codex" ? "codex" : "claude";
    isAgentRunning = true;
    if (els.splitScriptTextBtn) {
      els.splitScriptTextBtn.disabled = true;
    }
    startRequestTimer("Splitting text");
    setStatus("Asking " + (provider === "codex" ? "Codex" : "Claude") + " to read the columns and split the text...");
    runAgent(provider, buildSplitTextPrompt(scriptPayload), [], undefined, { lean: true }).then(function (output) {
      var payload;
      try {
        payload = extractJson(output);
      } catch (parseErr) {
        payload = null;
      }
      var valuesByRow = optimizedValuesFromAgentPayload(payload);
      if (!valuesByRow) {
        splitScriptTextLocally("agent reply had no caption rows");
        return;
      }
      pushSheetUndo();
      var roleChanges = applyAgentColumnRoles(table, payload);
      if (roleChanges) {
        updateSheetRails();
      }
      var changed = ensureOptimizedTextColumn(valuesByRow);
      updateSheetDiagnostics();
      setStatus(changed
        ? "Split text updated " + changed + " Optimized Text row(s)" + (roleChanges ? " and re-read " + roleChanges + " column role(s)" : "") + "."
        : "Optimized Text is already up to date.");
    }).catch(function (err) {
      splitScriptTextLocally(String(err && err.message ? err.message : err));
    }).then(function () {
      isAgentRunning = false;
      if (els.splitScriptTextBtn) {
        els.splitScriptTextBtn.disabled = false;
      }
      stopRequestTimer(true, "ready", "Ready to send");
    });
  }

  function splitScriptTextNow() {
    saveActiveScriptDocument();
    if (!getScriptInputPayload().text) {
      setStatus("Script is empty.", true);
      return 0;
    }
    if (!scriptWantsSplitText()) {
      var removed = removeAutoGeneratedOptimizedTextColumn();
      updateSheetDiagnostics();
      if (removed) {
        setStatus("Split text is off; removed the generated Optimized Text column.");
      } else if (validationDeclinesOptimizedText(activeScriptDocument().validationPrompt)) {
        setStatus("Validation instructions ask not to split this script.", true);
      } else {
        setStatus("Split text is off for this script.", true);
      }
      return removed;
    }
    var changed = ensureOptimizedTextColumn();
    updateSheetDiagnostics();
    setStatus(changed ? "Split text updated " + changed + " Optimized Text row(s)." : "Optimized Text is already up to date.");
    return changed;
  }

  function setValidateButtonsDisabled(disabled) {
    if (els.validateScriptBtn) {
      els.validateScriptBtn.disabled = disabled;
    }
    if (els.validateScriptAiBtn) {
      els.validateScriptAiBtn.disabled = disabled;
    }
  }

  /* AI validation is scoped: the local check runs first and Claude only sees
     what it flagged - the failing rows plus a shortlist of plausible project
     items per bad source - instead of the whole sheet four times over and every
     project item. Caption splitting is a separate job sent as small parallel
     batches of text lines only. Both run in lean CLI mode. */
  var aiValidationCandidateLimit = 8;
  var aiValidationSmallProjectItems = 60;
  var aiSplitBatchLines = 4;
  var aiSplitMaxParallel = 8;

  function aiValidationLooseScore(sourceName, item) {
    var name = String(item.name || "").toLowerCase();
    var file = String(item.mediaPath || "").split(/[\/\\]/).pop().toLowerCase();
    var haystack = name + " " + file;
    var tokens = String(sourceName || "").toLowerCase().split(/[^a-z0-9À-ỹ]+/);
    var score = 0;
    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i];
      if (!token) {
        continue;
      }
      if (new RegExp("(^|[^a-z0-9])0*" + token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^a-z0-9]|$)").test(haystack)) {
        score += /^\d+$/.test(token) ? 3 : 4;
      } else if (token.length >= 3 && haystack.indexOf(token) !== -1) {
        score += 2;
      }
    }
    return score;
  }

  function aiValidationCandidates(sourceName) {
    var items = state && state.projectItems ? state.projectItems : [];
    var picked = [];
    var seen = {};
    function add(item) {
      var key = item.nodeId || item.name;
      if (!key || seen[key] || Number(item.type) === 2) {
        return;
      }
      seen[key] = true;
      picked.push(item.name || String(item.mediaPath || "").split(/[\/\\]/).pop());
    }
    var match = sourceMatchForScriptSource(sourceName);
    var strong = match && match.candidates ? match.candidates.slice(0) : [];
    strong.sort(function (a, b) { return b.score - a.score; });
    for (var i = 0; i < strong.length && picked.length < aiValidationCandidateLimit; i++) {
      add(strong[i].item || {});
    }
    if (picked.length < aiValidationCandidateLimit) {
      var loose = [];
      for (var j = 0; j < items.length; j++) {
        var score = aiValidationLooseScore(sourceName, items[j] || {});
        if (score > 0) {
          loose.push({ item: items[j], score: score });
        }
      }
      loose.sort(function (a, b) { return b.score - a.score; });
      for (var k = 0; k < loose.length && picked.length < aiValidationCandidateLimit; k++) {
        add(loose[k].item);
      }
    }
    return picked;
  }

  function aiValidationAllItemNames() {
    var items = state && state.projectItems ? state.projectItems : [];
    var names = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i] && Number(items[i].type) !== 2 && items[i].name) {
        names.push(items[i].name);
      }
    }
    return names;
  }

  function aiValidationRowLine(rows, rowIndex) {
    var cells = rows[rowIndex] || [];
    var out = [String(rowIndex + 1)];
    for (var c = 0; c < cells.length; c++) {
      out.push(String(cells[c] === undefined ? "" : cells[c]).replace(/\t/g, " ").replace(/\n/g, " ↵ "));
    }
    return out.join("\t");
  }

  function notesColumnHint(scriptPayload) {
    var model = canonicalScriptModel(scriptPayload);
    return model.columns.notes >= 0
      ? "The Notes column is " + columnLetter(model.columns.notes) + "."
      : "There is no Notes column yet; the panel will create one for moved notes.";
  }

  function normalizedNoteLine(value) {
    return String(value || "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "").toLowerCase();
  }

  /* Moves editor notes the AI found in Source/Cut cells into the Notes column
     (created if missing) so they reach the Notes caption track. A line is only
     moved when it is really in that cell; the Notes cell is appended to, never
     overwritten. Returns the moved texts. */
  function applyMoveToNotes(payload) {
    var moves = payload && payload.moveToNotes;
    if (!moves || Object.prototype.toString.call(moves) !== "[object Array]" || !moves.length) {
      return [];
    }
    var table = els.scriptInput ? els.scriptInput.querySelector("table") : null;
    if (!table) {
      return [];
    }
    var model = canonicalScriptModel(getScriptInputPayload());
    var protectedColumns = [model.columns.text, model.columns.optimizedText, model.columns.notes];
    var grid = logicalSheetGrid(table);
    var pending = [];
    for (var i = 0; i < moves.length; i++) {
      var move = moves[i] || {};
      var rowIndex = Number(move.row) - 1;
      var colIndex = /^[A-Z]$/i.test(String(move.column || "")) ? String(move.column).toUpperCase().charCodeAt(0) - 65 : columnIndexFromValidationEdit(move, table);
      var text = String(move.text || move.value || "").replace(/^\s+|\s+$/g, "");
      if (!text || isNaN(rowIndex) || rowIndex < model.dataStartIndex || colIndex < 0 || protectedColumns.indexOf(colIndex) !== -1) {
        continue;
      }
      var info = grid.refs[rowIndex] && grid.refs[rowIndex][colIndex] ? grid.refs[rowIndex][colIndex] : null;
      if (!info) {
        continue;
      }
      var lines = sheetCellText(info.cell).split("\n");
      var wanted = normalizedNoteLine(text);
      var hit = -1;
      for (var l = 0; l < lines.length; l++) {
        if (normalizedNoteLine(lines[l]) === wanted) {
          hit = l;
          break;
        }
      }
      if (hit < 0) {
        continue;
      }
      pending.push({ info: info, line: hit, rowIndex: info.originRow, text: String(lines[hit]).replace(/^\s+|\s+$/g, "") });
    }
    /* A bare timing line moved alongside a note (the note's own Cut line) is
       folded into that note as "(0-3)"; on its own it would be a meaningless
       note, and a timing line moved without a note is left where it was. */
    var timingByRow = {};
    var noteRows = {};
    var kept = [];
    for (var t = 0; t < pending.length; t++) {
      if (/^[\s\d.,:;\-–—s]*\d[\s\d.,:;\-–—s]*$/i.test(pending[t].text.replace(/giây|giay|sec/gi, ""))) {
        (timingByRow[pending[t].rowIndex] = timingByRow[pending[t].rowIndex] || []).push(pending[t]);
      } else {
        noteRows[pending[t].rowIndex] = true;
        kept.push(pending[t]);
      }
    }
    for (var timingRow in timingByRow) {
      if (Object.prototype.hasOwnProperty.call(timingByRow, timingRow) && noteRows[timingRow]) {
        for (var tr = 0; tr < timingByRow[timingRow].length; tr++) {
          timingByRow[timingRow][tr].timingOnly = true;
          kept.push(timingByRow[timingRow][tr]);
        }
      }
    }
    pending = kept;
    if (!pending.length) {
      return [];
    }
    pushSheetUndo();
    var notesIndex = model.columns.notes;
    if (notesIndex < 0) {
      notesIndex = appendLogicalSheetColumn(table, "Notes", model.dataStartIndex);
      grid = logicalSheetGrid(table);
      var header = grid.refs[0] && grid.refs[0][notesIndex] ? grid.refs[0][notesIndex].cell : null;
      if (header) {
        header.setAttribute("data-column-role", "notes");
        header.setAttribute("data-column-label", "Notes");
      }
    }
    /* Remove lines bottom-up per cell so earlier indexes stay valid. */
    pending.sort(function (a, b) { return b.line - a.line; });
    var moved = [];
    for (var p = 0; p < pending.length; p++) {
      var entry = pending[p];
      var cellLines = sheetCellText(entry.info.cell).split("\n");
      if (normalizedNoteLine(cellLines[entry.line]) !== normalizedNoteLine(entry.text)) {
        continue;
      }
      cellLines.splice(entry.line, 1);
      setCellText(entry.info.cell, cellLines.join("\n").replace(/^\n+|\n+$/g, ""));
      if (entry.timingOnly) {
        continue;
      }
      var timings = [];
      var rowTimings = timingByRow[entry.rowIndex] || [];
      for (var rt = 0; rt < rowTimings.length; rt++) {
        if (!rowTimings[rt].attached) {
          rowTimings[rt].attached = true;
          timings.push(rowTimings[rt].text);
        }
      }
      if (timings.length) {
        entry.text += " (" + timings.join(", ") + ")";
      }
      var notesInfo = grid.refs[entry.rowIndex] && grid.refs[entry.rowIndex][notesIndex] ? grid.refs[entry.rowIndex][notesIndex] : null;
      if (notesInfo) {
        var existing = sheetCellText(notesInfo.cell).replace(/^\s+|\s+$/g, "");
        if (normalizedNoteLine(existing).indexOf(normalizedNoteLine(entry.text)) === -1) {
          setCellText(notesInfo.cell, existing ? existing + "\n" + entry.text : entry.text);
        }
      }
      moved.push("Row " + (entry.rowIndex + 1) + ": " + entry.text);
    }
    updateSheetRails();
    saveActiveScriptDocument();
    return moved;
  }

  /* Returns null when the local check found nothing Claude could fix. */
  function buildScopedRepairPrompt(scriptPayload, localPayload, validationInstructions) {
    var issues = localPayload && localPayload.validationIssues ? localPayload.validationIssues : [];
    if (!issues.length) {
      return null;
    }
    var rows = scriptPayload.tableRows || [];
    var model = canonicalScriptModel(scriptPayload);
    var missingColumns = model.columns.source < 0 || model.columns.cut < 0;
    var rowSet = {};
    var rowOrder = [];
    function addRow(index) {
      if (index >= 0 && index < rows.length && !rowSet[index]) {
        rowSet[index] = true;
        rowOrder.push(index);
      }
    }
    var badSources = [];
    for (var h = 0; h < model.dataStartIndex; h++) {
      addRow(h);
    }
    if (missingColumns) {
      for (var sample = model.dataStartIndex; sample < Math.min(rows.length, model.dataStartIndex + 4); sample++) {
        addRow(sample);
      }
    }
    for (var i = 0; i < issues.length; i++) {
      addRow(Number(issues[i].row) - 1);
      var sourceMatch = /^(?:Ambiguous source|Source not found in project): (.+)$/.exec(String(issues[i].message || ""));
      if (sourceMatch && badSources.indexOf(sourceMatch[1]) === -1) {
        badSources.push(sourceMatch[1]);
      }
    }
    rowOrder.sort(function (a, b) { return a - b; });
    var tableLines = [];
    for (var r = 0; r < rowOrder.length; r++) {
      tableLines.push(aiValidationRowLine(rows, rowOrder[r]));
    }
    var issueLines = [];
    for (var j = 0; j < issues.length; j++) {
      issueLines.push("row " + issues[j].row + ", column " + columnLetter(Number(issues[j].column) - 1) + ": " + issues[j].message);
    }
    var allNames = aiValidationAllItemNames();
    var candidateBlock;
    if (allNames.length <= aiValidationSmallProjectItems) {
      candidateBlock = "Project items (complete list):\n" + (allNames.length ? allNames.join("\n") : "(none)");
    } else {
      var parts = [];
      for (var b = 0; b < badSources.length; b++) {
        var names = aiValidationCandidates(badSources[b]);
        parts.push("\"" + badSources[b] + "\" -> " + (names.length ? names.join(" | ") : "(no plausible items)"));
      }
      candidateBlock = "Candidate project items for each bad source (" + allNames.length + " items in project; only plausible ones shown):\n" + (parts.length ? parts.join("\n") : "(no source lookups failed)");
    }
    return [
      "Fix the flagged cells in this Premiere script sheet. A local checker already validated every other row; only the rows below need attention.",
      "Source cells name footage. Short IDs are valid references: D2.5 means D2.5.mp4 or 'D2.5 - description.mp4'; 26 means a file named '26- something.mp4'.",
      "For a missing or ambiguous source, pick the project item the user meant, using the exact item name from the candidate list. If nothing fits, leave it out and list it in unresolvedSources.",
      "Cut cells hold timing (e.g. 5-8, giây 11, 1,06 - 2,05). Never put a filename in a Cut cell and never treat timing as a source.",
      missingColumns ? "The checker could not identify the Source and/or Cut column. Include columnMap with 1-based column numbers for text, cut and source." : "",
      "Each edit value replaces the whole Source cell; keep any other source lines in that cell, separated by \\n.",
      "Some flagged lines are not footage or timing at all but editor notes: visual directions, overlays, graphics, variants, prices/sale tags, reminders (e.g. 'Variants bra đổi màu', 'Sale tag 70%'). Move those to the Notes column with moveToNotes:[{\"row\":25,\"column\":2,\"text\":\"Sale tag 70%\"}], giving the exact line as it appears in the cell. Do not also list them as unresolved. If a moved Source line had its own Cut line, move that Cut line too so the remaining lines stay paired. If a scriptEdit rewrites the same cell, leave the moved line out of its value.",
      notesColumnHint(scriptPayload),
      "",
      "Return only: {\"scriptEdits\":[{\"row\":3,\"column\":2,\"value\":\"Exact item name.mp4\"}],\"moveToNotes\":[],\"columnMap\":{\"text\":1,\"cut\":2,\"source\":3},\"unresolvedSources\":[\"...\"],\"validationMessage\":\"one short sentence\"}",
      "Omit columnMap unless asked for above. Rows and columns are 1-based and include the header row.",
      "",
      validationInstructions ? "User instructions (authoritative):\n" + validationInstructions + "\n" : "",
      "Problems found:",
      issueLines.join("\n"),
      "",
      "Rows (tab separated; first field is the row number, then columns A, B, C...; ↵ marks a line break inside a cell):",
      tableLines.join("\n"),
      "",
      candidateBlock
    ].join("\n");
  }

  function scriptTextLinesForSplit(scriptPayload) {
    var model = canonicalScriptModel(scriptPayload);
    if (model.columns.text < 0) {
      return null;
    }
    var lines = [];
    for (var g = 0; g < model.groups.length; g++) {
      for (var l = 0; l < model.groups[g].lines.length; l++) {
        var line = model.groups[g].lines[l];
        if (String(line.text || "").replace(/\s+/g, "")) {
          lines.push({ row: line.rowIndex + 1, text: String(line.text) });
        }
      }
    }
    return lines;
  }

  function buildSplitBatchPrompt(batch) {
    var caption = getCaptionChunkSettings();
    var body = [];
    for (var i = 0; i < batch.length; i++) {
      body.push(batch[i].row + "\t" + batch[i].text.replace(/\t/g, " ").replace(/\n/g, " ↵ "));
    }
    return [
      "Split each script line below into caption rows for burned-in subtitles.",
      "Break on meaning: sentence ends, clause boundaries, natural phrase edges. Never strand an article, preposition, auxiliary, negation or modifier away from its word, and never let a caption row span two sentences.",
      "At most " + caption.maxWords + " words and " + caption.maxCharacters + " characters per caption row; these are ceilings, not targets.",
      caption.trimEndPunctuation ? "Drop a trailing period or comma at the end of each caption row; keep ellipses, ? and !." : "Keep the original punctuation.",
      "Keep the wording and language exactly; do not translate, rewrite or correct.",
      "Return only: {\"optimizedRows\":[{\"row\":4,\"lines\":[\"First caption row\",\"Second caption row\"]}]} with one entry per input row, using its row number.",
      "",
      "Lines (row number, tab, text):",
      body.join("\n")
    ].join("\n");
  }

  function runInLimitedParallel(tasks, limit) {
    var results = new Array(tasks.length);
    var next = 0;
    function worker() {
      if (next >= tasks.length) {
        return Promise.resolve();
      }
      var index = next++;
      return tasks[index]().then(function (value) {
        results[index] = value;
        return worker();
      });
    }
    var workers = [];
    for (var w = 0; w < Math.min(limit, tasks.length); w++) {
      workers.push(worker());
    }
    return Promise.all(workers).then(function () {
      return results;
    });
  }

  /* Resolves to {optimizedRows, splitColumnRoles?} or null. When the text
     column is unknown it falls back to one lean call that also reads roles. */
  function runScopedSplit(provider, scriptPayload) {
    var lines = scriptTextLinesForSplit(scriptPayload);
    if (!lines) {
      return runAgent(provider, buildSplitTextPrompt(scriptPayload), [], undefined, { lean: true }).then(function (output) {
        try {
          return extractJson(output);
        } catch (parseErr) {
          return null;
        }
      });
    }
    if (!lines.length) {
      return Promise.resolve(null);
    }
    var tasks = [];
    for (var start = 0; start < lines.length; start += aiSplitBatchLines) {
      (function (batch) {
        tasks.push(function () {
          return runAgent(provider, buildSplitBatchPrompt(batch), [], undefined, { lean: true }).then(function (output) {
            try {
              var parsed = extractJson(output);
              return parsed && parsed.optimizedRows ? parsed.optimizedRows : [];
            } catch (parseErr) {
              return [];
            }
          }, function () {
            return [];
          });
        });
      })(lines.slice(start, start + aiSplitBatchLines));
    }
    return runInLimitedParallel(tasks, aiSplitMaxParallel).then(function (batches) {
      var merged = [];
      for (var i = 0; i < batches.length; i++) {
        merged = merged.concat(batches[i] || []);
      }
      return merged.length ? { optimizedRows: merged } : null;
    });
  }

  /* Repair + split in parallel; merged into one validation-shaped payload. */
  function runScopedAiValidation(provider, scriptPayload, validationInstructions, skipSourceLookup, wantsSplitText) {
    var localPayload = localScriptValidationPayload(scriptPayload, { skipSourceLookup: skipSourceLookup });
    var repairPrompt = buildScopedRepairPrompt(scriptPayload, localPayload, validationInstructions);
    var repairPromise = repairPrompt
      ? runAgent(provider, repairPrompt, [], undefined, { lean: true }).then(function (output) {
        return extractValidationPayload(output);
      })
      : Promise.resolve(null);
    var splitPromise = wantsSplitText ? runScopedSplit(provider, scriptPayload) : Promise.resolve(null);
    return Promise.all([repairPromise, splitPromise]).then(function (parts) {
      var payload = parts[0] || { scriptEdits: [] };
      if (!payload.scriptEdits) {
        payload.scriptEdits = [];
      }
      if (parts[1]) {
        payload.optimizedRows = parts[1].optimizedRows;
        if (parts[1].splitColumnRoles) {
          payload.splitColumnRoles = parts[1].splitColumnRoles;
        }
      }
      payload.aiScope = {
        repairCalled: !!repairPrompt,
        splitCalled: !!wantsSplitText
      };
      return payload;
    });
  }

  /* Two modes. Logic (default, fast): source lookup + structure checks only,
     fully local - no Claude call, and it leaves Optimized Text untouched rather
     than falling back to the rule-based splitter. AI (slow, for the hard cases):
     always routes through the agent, which can repair sources and does the
     context-aware text split in the same call. */
  function validateScriptWithAgent(options) {
    var useAgent = !!(options && options.useAgent);
    if (isAgentRunning) {
      setStatus("Waiting for current reply before validating script.", true);
      return;
    }
    saveActiveScriptDocument();
    selectedScriptId = activeScriptId;
    syncActiveScriptProjectState();
    renderScriptTabs();
    var scriptInput = getScriptInputPayload();
    var validationInstructions = String(activeScriptDocument().validationPrompt || "").replace(/^\s+|\s+$/g, "");
    var wantsSplitText = useAgent && scriptWantsSplitText();
    if (!scriptInput.text) {
      setStatus("Script is empty.", true);
      return;
    }
    isAgentRunning = true;
    setValidateButtonsDisabled(true);
    startScriptValidationTimer();
    setScriptValidationProgress(5, "Preparing validation...", "");
    startRequestTimer("Validating script");
    setStatus(useAgent ? "Refreshing project for AI validation..." : "Refreshing project for fast validation...");
    var usedAgentValidation = false;
    var validationSkipSourceLookup = false;
    var contextPromise = refreshProjectContextForWork({ quiet: true, skipComponents: true });
    contextPromise.then(function (refreshed) {
      var skipSourceLookup = !refreshed || !hasProjectItemContext();
      validationSkipSourceLookup = skipSourceLookup;
      if (skipSourceLookup) {
        setScriptValidationProgress(35, "Validating without project lookup", "needsContext");
      } else {
        setScriptValidationProgress(35, "Project context loaded", "");
      }
      setRunPhase("Validating script");
      if (useAgent) {
        usedAgentValidation = true;
        var provider = els.provider ? els.provider.value : "claude";
        setStatus(wantsSplitText ? "AI fixing flagged rows and splitting text..." : "AI fixing flagged rows...");
        setScriptValidationProgress(55, "AI checking only the flagged rows...", "");
        return runScopedAiValidation(provider, scriptInput, validationInstructions, skipSourceLookup, wantsSplitText).then(function (agentPayload) {
          setScriptValidationProgress(70, "Checking AI validation reply...", "");
          return agentPayload;
        });
      }
      setStatus("Fast-validating script locally...");
      setScriptValidationProgress(65, "Checking script rows...", "");
      return localScriptValidationPayload(scriptInput, { skipSourceLookup: skipSourceLookup });
    }).then(function (output) {
      setScriptValidationProgress(78, "Applying validation results...", "");
      var payload = typeof output === "string" ? extractValidationPayload(output) : output;
      payload = sanitizeValidationPayload(payload, scriptInput, validationInstructions);
      var applied = applyScriptValidationPayload(payload);
      var movedNotes = usedAgentValidation ? applyMoveToNotes(payload) : [];
      applied += movedNotes.length;
      applied += removeAutoGeneratedOptimizedTextColumn();
      var splitTable = els.scriptInput ? els.scriptInput.querySelector("table") : null;
      var agentSplitValues = wantsSplitText ? optimizedValuesFromAgentPayload(payload) : null;
      if (agentSplitValues && splitTable) {
        applied += applyAgentColumnRoles(splitTable, payload);
      }
      if (useAgent) {
        applied += ensureOptimizedTextColumn(agentSplitValues);
      }
      var scriptName = activeScriptDocument().name || "Script";
      var validatedScriptInput = getScriptInputPayload();
      var authoritativePayload = localScriptValidationPayload(validatedScriptInput, { skipSourceLookup: validationSkipSourceLookup });
      authoritativePayload.scriptEdits = payload.scriptEdits || [];
      authoritativePayload.fixedSources = payload.fixedSources || payload.fixed || [];
      if (usedAgentValidation && payload.validationMessage && authoritativePayload.validationStatus === "validated") {
        authoritativePayload.validationMessage = String(payload.validationMessage);
      }
      if (usedAgentValidation) {
        authoritativePayload.validationMessage = String(authoritativePayload.validationMessage || "").replace(/^Fast validation/, "AI validation");
        if (movedNotes.length) {
          authoritativePayload.movedToNotes = movedNotes;
          authoritativePayload.validationMessage += " Moved " + movedNotes.length + " note(s) to the Notes column.";
        }
      }
      payload = authoritativePayload;
      var needsContext = scriptValidationNeedsContext(payload, "");
      var validationStatus = needsContext ? "needsContext" : "validated";
      var validationMessage = scriptValidationMessage(payload, output, applied, needsContext);
      var issueCells = validationIssueCellsFromPayload(payload, validatedScriptInput);
      var percent = validationPercentFromIssues(validatedScriptInput, issueCells, needsContext);
      var cachedActions = needsContext ? [] : validationCachedActionsFromPayload(payload, validatedScriptInput);
      setScriptValidationProgress(92, "Preparing timeline action code...", needsContext ? "needsContext" : "");
      setActiveScriptValidation(validationStatus, validationMessage, applied, cachedActions, issueCells, percent);
      showScriptValidationOverlay(validationStatus, validationMessage, scriptName, applied, JSON.stringify(payload, null, 2), payload);
      updateSheetDiagnostics();
      var validationLabel = usedAgentValidation ? "AI validation" : "Fast validation";
      setStatus(needsContext ? validationLabel + " needs more context." : (cachedActions.length ? validationLabel + " cached " + cachedActions.length + " ready action(s)." : (applied ? validationLabel + " applied " + applied + " edit(s)." : validationLabel + " complete. No edits applied.")));
    }).catch(function (err) {
      var message = String(err && err.message ? err.message : err);
      setScriptValidationProgress(0, "Validation failed", "error");
      setActiveScriptValidation("needsContext", message, 0, [], [], 0);
      showScriptValidationOverlay("needsContext", message, activeScriptDocument().name || "Script", 0, message, {
        validationStatus: "needsContext",
        needsContext: true,
        ambiguousMatches: [message]
      });
      appendMessage("system", message);
      setStatus("Script validation failed.", true);
    }).then(function () {
      isAgentRunning = false;
      setValidateButtonsDisabled(false);
      stopScriptValidationTimer(true);
      renderScriptWorkspaceState();
      stopRequestTimer(true, "ready", "Ready to send");
    });
  }

  function setSelectedColumnRole() {
    var table = els.scriptInput.querySelector("table");
    var col = selectedColumnIndex();
    if (!table || col < 0 || !els.sheetColumnRole) {
      return;
    }
    var header = headerCellForColumn(table, col);
    if (!header) {
      return;
    }
    var role = els.sheetColumnRole.value || "";
    var currentRole = header.getAttribute("data-column-role") || "";
    if (currentRole === role) {
      return;
    }
    pushSheetUndo();
    if (role) {
      header.setAttribute("data-column-role", role);
    } else {
      header.removeAttribute("data-column-role");
    }
    var rows = table.querySelectorAll("tr");
    if (rows.length) {
      sheetSelection = {
        rowStart: 0,
        rowEnd: rows.length - 1,
        colStart: col,
        colEnd: col
      };
      sheetActiveRowIndex = 0;
      sheetActiveColumnIndex = col;
    }
    updateSheetRails();
    saveActiveScriptDocument();
    setStatus(role ? "Column role set to " + (columnRoleOptions()[role] || role) + "." : "Column role set to auto.");
  }

  function getScriptInputTableRows(element) {
    return getScriptInputTableGrid(element).rows;
  }

  function getScriptInputTableGrid(element) {
    if (!element) {
      return { rows: [], cells: [] };
    }
    var table = element.querySelector("table");
    if (!table) {
      return { rows: [], cells: [] };
    }
    var rowNodes = table.querySelectorAll("tr");
    var rows = [];
    var cellGrid = [];
    var activeRowspans = [];
    var maxCols = 0;

    function spanCount(cell, attrName, propName) {
      var value = Number(cell.getAttribute(attrName) || cell[propName] || 1);
      return isNaN(value) || value < 1 ? 1 : Math.floor(value);
    }

    function cellMeta(text, originRow, originCol, rowspan, colspan, isOrigin, generatedOptimizedText) {
      return {
        text: text,
        originRow: originRow,
        originCol: originCol,
        rowspan: rowspan,
        colspan: colspan,
        isOrigin: isOrigin === true,
        generatedOptimizedText: generatedOptimizedText === true,
        key: originRow + ":" + originCol
      };
    }

    function fillActiveSpan(cells, metas, col) {
      var span = activeRowspans[col];
      if (!span || span.remaining <= 0) {
        activeRowspans[col] = null;
        return false;
      }
      cells[col] = span.text;
      metas[col] = cellMeta(span.text, span.originRow, span.originCol, span.rowspan, span.colspan, false, span.generatedOptimizedText);
      span.remaining--;
      if (span.remaining <= 0) {
        activeRowspans[col] = null;
      }
      return true;
    }

    for (var i = 0; i < rowNodes.length; i++) {
      var cellNodes = rowNodes[i].children;
      var cells = [];
      var metas = [];
      var col = 0;
      for (var j = 0; j < cellNodes.length; j++) {
        var tag = String(cellNodes[j].tagName || "").toLowerCase();
        if (tag !== "th" && tag !== "td") {
          continue;
        }
        while (fillActiveSpan(cells, metas, col)) {
          col++;
        }
        var text = sheetCellText(cellNodes[j]);
        var colspan = spanCount(cellNodes[j], "colspan", "colSpan");
        var rowspan = spanCount(cellNodes[j], "rowspan", "rowSpan");
        var generatedOptimizedText = cellNodes[j].getAttribute("data-generated-optimized-text") === "true";
        for (var cc = 0; cc < colspan; cc++) {
          cells[col + cc] = text;
          metas[col + cc] = cellMeta(text, i, col, rowspan, colspan, cc === 0, generatedOptimizedText);
          if (rowspan > 1) {
            activeRowspans[col + cc] = { text: text, remaining: rowspan - 1, originRow: i, originCol: col, rowspan: rowspan, colspan: colspan, generatedOptimizedText: generatedOptimizedText };
          }
        }
        col += colspan;
      }
      while (col < maxCols || activeRowspans[col]) {
        if (!fillActiveSpan(cells, metas, col) && cells[col] === undefined) {
          cells[col] = "";
          metas[col] = cellMeta("", i, col, 1, 1, true);
        }
        col++;
      }
      if (cells.length) {
        rows.push(cells);
        cellGrid.push(metas);
        maxCols = Math.max(maxCols, cells.length);
      }
    }
    for (var r = 0; r < rows.length; r++) {
      while (rows[r].length < maxCols) {
        rows[r].push("");
        cellGrid[r].push(cellMeta("", r, cellGrid[r].length, 1, 1, true));
      }
    }
    return { rows: rows, cells: cellGrid };
  }

  function getScriptInputColumnRoles(element) {
    var table = element ? element.querySelector("table") : null;
    if (!table) {
      return [];
    }
    var roles = [];
    var cols = sheetColumnCount(table);
    for (var c = 0; c < cols; c++) {
      roles.push(getColumnRole(table, c));
    }
    return roles;
  }

  function sheetCellText(cell) {
    var parts = [];

    function addText(value) {
      if (value) {
        parts.push(String(value).replace(/\u00a0/g, " "));
      }
    }

    function addNewline() {
      if (parts.length && parts[parts.length - 1] !== "\n") {
        parts.push("\n");
      }
    }

    function walk(node) {
      if (!node) {
        return;
      }
      if (node.nodeType === 3) {
        addText(node.nodeValue);
        return;
      }
      if (node.nodeType !== 1) {
        return;
      }
      var tag = String(node.tagName || "").toLowerCase();
      if (tag === "br") {
        addNewline();
        return;
      }
      var block = tag === "div" || tag === "p" || tag === "li" || tag === "section" || tag === "article";
      if (block) {
        addNewline();
      }
      for (var i = 0; i < node.childNodes.length; i++) {
        walk(node.childNodes[i]);
      }
      if (block) {
        addNewline();
      }
    }

    for (var i = 0; i < cell.childNodes.length; i++) {
      walk(cell.childNodes[i]);
    }

    return parts.join("")
      .replace(/[ \t]*\n[ \t]*/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\s+|\s+$/g, "");
  }

  function normalizeHeaderCell(value) {
    return String(value || "").toLowerCase().replace(/\s+/g, " ");
  }

  function findScriptColumn(headers, namePattern, oneBasedFallback) {
    for (var i = 0; i < headers.length; i++) {
      if (namePattern.test(normalizeHeaderCell(headers[i]))) {
        return i;
      }
    }
    var bracketPattern = new RegExp("\\[" + oneBasedFallback + "\\]");
    for (var j = 0; j < headers.length; j++) {
      if (bracketPattern.test(headers[j])) {
        return j;
      }
    }
    return -1;
  }

  function parseScriptNumber(value) {
    var parsed = Number(String(value || "").replace(",", "."));
    return isNaN(parsed) ? null : parsed;
  }

  function parseScriptTimestamp(value) {
    var text = String(value || "").replace(/^\s+|\s+$/g, "");
    if (text.indexOf(":") === -1) {
      return parseScriptNumber(text);
    }
    var parts = text.split(":");
    if (parts.length < 2 || parts.length > 3) {
      return null;
    }
    var seconds = 0;
    for (var i = 0; i < parts.length; i++) {
      var part = parseScriptNumber(parts[i]);
      if (part === null || part < 0 || (i > 0 && part >= 60)) {
        return null;
      }
      seconds = seconds * 60 + part;
    }
    return seconds;
  }

  function parseCutDurationSeconds(value) {
    var text = String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[–—]/g, "-");
    var lines = text.split("\n");
    var total = 0;
    var ranges = [];
    var unresolved = [];
    var sourceLineIndex = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/^\s+|\s+$/g, "");
      if (!line || /^-+$/.test(line)) {
        continue;
      }
      var parseLine = line.replace(/^\s*(?:[-*]+\s*)+/, "")
        .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}|（[^）]*）|【[^】]*】/g, " ");
      var annotationOnly = /^(?:\([^)]*\)|\[[^\]]*\])$/.test(line);
      var foundRange = false;
      var lineRangeStart = ranges.length;
      parseLine.replace(/(\d+(?::\d+){1,2}(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*-\s*(\d+(?::\d+){1,2}(?:[.,]\d+)?|\d+(?:[.,]\d+)?)/g, function (match, startText, endText) {
        var start = parseScriptTimestamp(startText);
        var end = parseScriptTimestamp(endText);
        if (start !== null && end !== null && end > start) {
          var duration = end - start;
          total += duration;
          ranges.push({ text: match, start: start, end: end, duration: duration, lineIndex: i, sourceLineIndex: sourceLineIndex });
          foundRange = true;
        }
        return match;
      });
      if (!foundRange) {
        var compact = parseLine.match(/^([A-Za-z]*)(\d+(?:\+\d+)*)\s*-\s*(\d+(?:[.,]\d+)?)\s*$/);
        if (compact) {
          var durationOnly = parseScriptNumber(compact[3]);
          if (durationOnly !== null && durationOnly > 0) {
            total += durationOnly;
            ranges.push({ text: line, start: 0, end: durationOnly, duration: durationOnly, lineIndex: i, sourceLineIndex: sourceLineIndex, compactSources: compact[1] + compact[2] });
            foundRange = true;
          }
        }
      }
      if (!foundRange) {
        var edgeRange = parseLine.match(/(?:cuối|end(?:\s+of)?)\s+(?:gi[âa]y|sec(?:ond)?s?)\s*(\d+(?:[.,]\d+)?)\s+(?:đầu|start(?:\s+of)?)\s+(?:gi[âa]y|sec(?:ond)?s?)\s*(\d+(?:[.,]\d+)?)/i);
        if (edgeRange) {
          var edgeStart = parseScriptNumber(edgeRange[1]);
          var edgeEnd = parseScriptNumber(edgeRange[2]);
          if (edgeStart !== null && edgeEnd !== null && edgeEnd > edgeStart) {
            total += edgeEnd - edgeStart;
            ranges.push({ text: edgeRange[0], start: edgeStart, end: edgeEnd, duration: edgeEnd - edgeStart, lineIndex: i, sourceLineIndex: sourceLineIndex, edgeRange: true });
            foundRange = true;
          }
        }
      }
      if (!foundRange) {
        var singleSecondPattern = /(?:gi[âa]y|sec(?:ond)?s?)\s*(\d+(?:[.,]\d+)?)\s*s?\b|(\d+(?:[.,]\d+)?)\s*(?:gi[âa]y|sec(?:ond)?s?|s)\b/ig;
        var singleSecond;
        while ((singleSecond = singleSecondPattern.exec(parseLine)) !== null) {
          var second = parseScriptNumber(singleSecond[1] !== undefined ? singleSecond[1] : singleSecond[2]);
          if (second !== null && second >= 0) {
            var singleEnd = second + 1;
            total += 1;
            ranges.push({ text: singleSecond[0].replace(/^\s+|\s+$/g, ""), start: second, end: singleEnd, duration: 1, lineIndex: i, sourceLineIndex: sourceLineIndex, singleSecond: true });
            foundRange = true;
          }
        }
      }
      if (!foundRange && !annotationOnly && /\d/.test(line)) {
        unresolved.push(line);
      }
      if (foundRange && ranges.length > lineRangeStart) {
        sourceLineIndex++;
      }
    }
    return {
      durationSeconds: total > 0 ? total : null,
      ranges: ranges,
      unresolved: unresolved
    };
  }

  function defaultCompactScriptRanges(sourceLines, defaultDuration) {
    var ranges = [];
    var lines = sourceLines || [];
    var cursor = 0;
    var duration = Number(defaultDuration || 3);
    if (!duration || duration <= 0) {
      duration = 3;
    }
    for (var i = 0; i < lines.length; i++) {
      var lineSources = String(lines[i] || "").split("\n");
      for (var s = 0; s < lineSources.length; s++) {
        var source = firstScriptSourceName(lineSources[s]);
        if (!source) {
          continue;
        }
        ranges.push({
          text: source,
          start: 0,
          end: duration,
          duration: duration,
          lineIndex: i,
          defaultDuration: true,
          targetStartSeconds: cursor
        });
        cursor += duration;
      }
    }
    return ranges;
  }

  function cleanOverlayCaptionText(value) {
    var text = String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/^\s+|\s+$/g, "");
    if (!text || /^\(?none\)?$/i.test(text) || /^-+$/.test(text)) {
      return "";
    }
    return text;
  }

  function findScriptColumnWithRoles(headers, roles, role, namePattern, oneBasedFallback) {
    for (var i = 0; roles && i < roles.length; i++) {
      if (roles[i] === role) {
        return i;
      }
    }
    return findScriptColumn(headers, namePattern, oneBasedFallback);
  }

  function scriptCellLooksLikeSource(value) {
    var text = String(value || "").replace(/^\s+|\s+$/g, "");
    if (!text) {
      return false;
    }
    return /\.(mov|mp4|m4v|avi|mxf|webm|png|jpe?g|gif|tiff?|bmp|webp|heic|psd)\b/i.test(text) ||
      /\b[A-Z]{0,4}\d+(?:[._-]\d+)*[A-Z]?\b/i.test(text) && text.length < 48;
  }

  function scriptCellLooksLikeProductionNote(value) {
    var text = String(value || "").toLowerCase();
    return /\b(zoom|source|frame|full frame|speed|sfx|hiệu ứng|cảnh|đoạn|phần|note|loop|highlight|chạy)\b/.test(text);
  }

  function inferTextColumnFromRows(rows, roles, excludedIndexes) {
    if (!rows || !rows.length) {
      return -1;
    }
    var cols = 0;
    for (var r = 0; r < rows.length; r++) {
      cols = Math.max(cols, rows[r] ? rows[r].length : 0);
    }
    var start = scriptDataStartIndex(rows);
    var bestIndex = -1;
    var bestScore = 0;
    for (var c = 0; c < cols; c++) {
      if (excludedIndexes && excludedIndexes.indexOf(c) !== -1) {
        continue;
      }
      if (roles && (roles[c] === "source" || roles[c] === "cut" || roles[c] === "notes" || roles[c] === "optimizedText" || roles[c] === "skip")) {
        continue;
      }
      var score = 0;
      var filled = 0;
      for (var i = start; i < rows.length; i++) {
        var raw = rows[i] && rows[i][c] !== undefined ? rows[i][c] : "";
        var text = cleanOverlayCaptionText(raw);
        if (!text) {
          continue;
        }
        filled++;
        var cut = parseCutDurationSeconds(text);
        if (cut.durationSeconds !== null || cut.unresolved.length) {
          score -= 4;
        }
        if (scriptCellLooksLikeSource(text)) {
          score -= 5;
        }
        if (scriptCellLooksLikeProductionNote(text)) {
          score -= 2;
        }
        if (/[A-Za-z\u00C0-\u1EF9]/.test(text)) {
          score += 2;
        }
        if (/\s/.test(text)) {
          score += 2;
        }
        if (text.length >= 12) {
          score += 2;
        }
        if (/[.!?]$/.test(text)) {
          score += 1;
        }
      }
      if (filled >= 2) {
        score += filled;
      }
      if (score > bestScore) {
        bestScore = score;
        bestIndex = c;
      }
    }
    return bestScore > 0 ? bestIndex : -1;
  }

  function inferSourceColumnFromRows(rows, roles, excludedIndexes) {
    if (!rows || !rows.length) {
      return -1;
    }
    var cols = 0;
    for (var r = 0; r < rows.length; r++) {
      cols = Math.max(cols, rows[r] ? rows[r].length : 0);
    }
    var start = scriptDataStartIndex(rows);
    var bestIndex = -1;
    var bestScore = 0;
    for (var c = 0; c < cols; c++) {
      if (excludedIndexes && excludedIndexes.indexOf(c) !== -1) {
        continue;
      }
      if (roles && (roles[c] === "text" || roles[c] === "notes" || roles[c] === "skip")) {
        continue;
      }
      var score = 0;
      for (var i = start; i < rows.length; i++) {
        var value = rows[i] && rows[i][c] !== undefined ? rows[i][c] : "";
        if (!String(value || "").replace(/\s+/g, "")) {
          continue;
        }
        var cut = parseCutDurationSeconds(value);
        var isMediaName = /\.(mov|mp4|m4v|avi|mxf|webm|wav|mp3|png|jpe?g|gif|tiff?|bmp|webp|heic|psd)\b/i.test(String(value || ""));
        if (cut.ranges.length && !isMediaName) {
          score -= 30;
          continue;
        }
        if (scriptCellLooksLikeSource(value)) {
          score += 4;
        }
        if (parseCompactSourceCut(value).length) {
          score += 5;
        }
        if (firstScriptSourceName(value) && findProjectItemForScriptSource(value)) {
          score += 8;
        }
        if (cut.ranges.length && !parseCompactSourceCut(value).length) {
          score -= 2;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestIndex = c;
      }
    }
    return bestScore > 0 ? bestIndex : -1;
  }

  function inferCutColumnFromRows(rows, roles, excludedIndexes) {
    if (!rows || !rows.length) {
      return -1;
    }
    var cols = 0;
    for (var r = 0; r < rows.length; r++) {
      cols = Math.max(cols, rows[r] ? rows[r].length : 0);
    }
    var start = scriptDataStartIndex(rows);
    var bestIndex = -1;
    var bestScore = 0;
    for (var c = 0; c < cols; c++) {
      if (excludedIndexes && excludedIndexes.indexOf(c) !== -1) {
        continue;
      }
      if (roles && (roles[c] === "text" || roles[c] === "notes" || roles[c] === "skip")) {
        continue;
      }
      var score = 0;
      for (var i = start; i < rows.length; i++) {
        var value = rows[i] && rows[i][c] !== undefined ? rows[i][c] : "";
        var cut = parseCutDurationSeconds(value);
        if (cut.ranges.length) {
          score += 6 + cut.ranges.length;
        }
        if (parseCompactSourceCut(value).length) {
          score += 4;
        }
        if (scriptCellLooksLikeSource(value) && !cut.ranges.length) {
          score -= 2;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestIndex = c;
      }
    }
    return bestScore > 0 ? bestIndex : -1;
  }

  function scriptHasHeaderRow(rows) {
    var first = rows && rows[0] ? rows[0] : [];
    var headerCells = 0;
    for (var i = 0; i < first.length; i++) {
      var value = normalizeHeaderCell(first[i]).replace(/^\s+|\s+$/g, "").replace(/\s*\[\d+\]\s*$/, "");
      if (!value || /\.(mov|mp4|m4v|avi|mxf|webm|wav|mp3|png|jpe?g|gif|tiff?|bmp|webp|heic|psd)\b/i.test(value) || parseCutDurationSeconds(value).ranges.length) {
        continue;
      }
      if (/^(?:source(?:\s*(?:file|name))?|media(?:\s*(?:file|name))?|clip(?:\s*(?:file|name))?|cut(?:\s*(?:from\s*source|range|time))?|source\s*range|time(?:code|\s*range)?|overlay(?:[\s/]*text)?|text(?:[\s/]*overlay)?|optimized\s*(?:text|subtitle|caption)|caption|subtitle|script(?:\s*text)?|notes?)$/i.test(value)) {
        headerCells++;
      }
    }
    return headerCells > 0;
  }

  function scriptDataStartIndex(rows) {
    return scriptHasHeaderRow(rows) ? 1 : 0;
  }

  function inferScriptColumnIndex(rows, roles, role, namePattern, oneBasedFallback) {
    var headers = scriptHasHeaderRow(rows) ? (rows[0] || []) : [];
    if (role === "text") {
      for (var ri = 0; roles && ri < roles.length; ri++) {
        if (roles[ri] === "text") {
          return ri;
        }
      }
      for (var hi = 0; hi < headers.length; hi++) {
        if ((roles && roles[hi] === "optimizedText") || /optimized\s*(?:text|subtitle|caption)/i.test(normalizeHeaderCell(headers[hi]))) {
          continue;
        }
        if (namePattern.test(normalizeHeaderCell(headers[hi]))) {
          return hi;
        }
      }
      var inferredText = inferTextColumnFromRows(rows, roles);
      if (inferredText >= 0) {
        return inferredText;
      }
    }
    var found = findScriptColumnWithRoles(headers, roles, role, namePattern, oneBasedFallback);
    if (found >= 0) {
      return found;
    }
    if (role === "source") {
      found = inferSourceColumnFromRows(rows, roles);
      if (found >= 0) {
        return found;
      }
    } else if (role === "cut") {
      found = inferCutColumnFromRows(rows, roles);
      if (found >= 0) {
        return found;
      }
    }
    var first = rows && rows[0] ? rows[0] : [];
    if (!scriptHasHeaderRow(rows) && first.length === 2) {
      if (role === "text") {
        return 0;
      }
      if (role === "source" || role === "cut") {
        return 1;
      }
    }
    return -1;
  }

  function canonicalScriptColumnMap(scriptPayload) {
    scriptPayload = scriptPayload || {};
    var rows = scriptPayload.tableRows || [];
    var roles = scriptPayload.columnRoles || [];
    var instructions = String(activeScriptDocument && activeScriptDocument() ? (activeScriptDocument().validationPrompt || "") : "");

    function explicitColumn(role) {
      var pattern = role === "source" ? /\b(source|file|footage|media|clip)\b/i : (role === "cut" ? /\b(cut|time|timecode|range|in.?out)\b/i : /\b(text|overlay|caption|subtitle|script)\b/i);
      var instructed = validationColumnFromInstructions(instructions, pattern);
      if (instructed >= 0) {
        return instructed;
      }
      for (var i = 0; i < roles.length; i++) {
        if (roles[i] === role) {
          return i;
        }
      }
      return -1;
    }

    var sourceIndex = explicitColumn("source");
    var cutIndex = explicitColumn("cut");
    var textIndex = explicitColumn("text");
    var optimizedTextIndex = -1;
    for (var optimizedRoleIndex = 0; optimizedRoleIndex < roles.length; optimizedRoleIndex++) {
      if (roles[optimizedRoleIndex] === "optimizedText") {
        optimizedTextIndex = optimizedRoleIndex;
        break;
      }
    }
    if (optimizedTextIndex < 0 && scriptHasHeaderRow(rows)) {
      var optimizedHeaders = rows[0] || [];
      for (var optimizedHeaderIndex = 0; optimizedHeaderIndex < optimizedHeaders.length; optimizedHeaderIndex++) {
        if (/optimized\s*(?:text|subtitle|caption)|subtitle\s*optimized/i.test(normalizeHeaderCell(optimizedHeaders[optimizedHeaderIndex]))) {
          optimizedTextIndex = optimizedHeaderIndex;
          break;
        }
      }
    }
    if (sourceIndex < 0) {
      sourceIndex = inferScriptColumnIndex(rows, roles, "source", /source\s*file|source\s*name|media|clip\s*name|source/, 6);
    }
    if (cutIndex < 0) {
      cutIndex = inferScriptColumnIndex(rows, roles, "cut", /cut\s*from\s*source|source\s*range|range|cut/, 7);
    }
    if (sourceIndex === cutIndex && sourceIndex >= 0) {
      var alternateCut = inferCutColumnFromRows(rows, roles, [sourceIndex]);
      var alternateSource = inferSourceColumnFromRows(rows, roles, [cutIndex]);
      if (alternateCut >= 0) {
        cutIndex = alternateCut;
      } else if (alternateSource >= 0) {
        sourceIndex = alternateSource;
      }
    }
    if (textIndex < 0) {
      textIndex = inferTextColumnFromRows(rows, roles, [sourceIndex, cutIndex]);
    }
    function soleRemainingColumn(excluded) {
      var columnCount = 0;
      for (var rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        columnCount = Math.max(columnCount, rows[rowIndex] ? rows[rowIndex].length : 0);
      }
      var remaining = -1;
      for (var columnIndex = 0; columnIndex < columnCount; columnIndex++) {
        if (excluded.indexOf(columnIndex) !== -1 || (roles && (roles[columnIndex] === "notes" || roles[columnIndex] === "optimizedText" || roles[columnIndex] === "skip"))) {
          continue;
        }
        if (remaining >= 0) {
          return -1;
        }
        remaining = columnIndex;
      }
      return remaining;
    }
    if (sourceIndex < 0 && cutIndex >= 0 && textIndex >= 0) {
      sourceIndex = soleRemainingColumn([cutIndex, textIndex, optimizedTextIndex]);
    }
    if (cutIndex < 0 && sourceIndex >= 0 && textIndex >= 0) {
      cutIndex = soleRemainingColumn([sourceIndex, textIndex, optimizedTextIndex]);
    }
    if (textIndex < 0 && sourceIndex >= 0 && cutIndex >= 0) {
      textIndex = soleRemainingColumn([sourceIndex, cutIndex, optimizedTextIndex]);
    }
    var notesIndex = -1;
    for (var notesRoleIndex = 0; notesRoleIndex < roles.length; notesRoleIndex++) {
      if (roles[notesRoleIndex] === "notes") {
        notesIndex = notesRoleIndex;
        break;
      }
    }
    if (notesIndex < 0 && scriptHasHeaderRow(rows)) {
      var notesHeaders = rows[0] || [];
      for (var notesHeaderIndex = 0; notesHeaderIndex < notesHeaders.length; notesHeaderIndex++) {
        if (/note|comment|direction/i.test(normalizeHeaderCell(notesHeaders[notesHeaderIndex]))) {
          notesIndex = notesHeaderIndex;
          break;
        }
      }
    }
    return { text: textIndex, optimizedText: optimizedTextIndex, source: sourceIndex, cut: cutIndex, notes: notesIndex };
  }

  function canonicalScriptModel(scriptPayload) {
    scriptPayload = scriptPayload || getScriptInputPayload();
    var rows = scriptPayload.tableRows || [];
    var cells = scriptPayload.tableCells || [];
    var roles = scriptPayload.columnRoles || [];
    var columns = canonicalScriptColumnMap(scriptPayload);
    var start = scriptDataStartIndex(rows);
    var parent = [];
    var rowEntries = [];
    var i;

    function find(value) {
      while (parent[value] !== value) {
        parent[value] = parent[parent[value]];
        value = parent[value];
      }
      return value;
    }
    function join(a, b) {
      a = find(a);
      b = find(b);
      if (a !== b) {
        parent[b] = a;
      }
    }
    function metaAt(rowIndex, colIndex) {
      return colIndex >= 0 && cells[rowIndex] && cells[rowIndex][colIndex] ? cells[rowIndex][colIndex] : null;
    }
    function originKey(meta, rowIndex, colIndex, prefix) {
      if (meta && Number(meta.rowspan || 1) > 1) {
        return prefix + ":" + meta.key;
      }
      return prefix + ":row:" + rowIndex + ":col:" + colIndex;
    }

    for (i = start; i < rows.length; i++) {
      parent[i] = i;
    }
    var mergeColumns = [columns.text, columns.source, columns.cut];
    for (var mc = 0; mc < mergeColumns.length; mc++) {
      var colIndex = mergeColumns[mc];
      if (colIndex < 0) {
        continue;
      }
      for (i = start; i < rows.length; i++) {
        var mergeMeta = metaAt(i, colIndex);
        if (!mergeMeta || Number(mergeMeta.rowspan || 1) <= 1) {
          continue;
        }
        var origin = Math.max(start, Number(mergeMeta.originRow));
        if (origin < rows.length && parent[origin] !== undefined) {
          join(origin, i);
        }
      }
    }

    var seenLines = {};
    var groupsByRoot = {};
    var groups = [];
    for (i = start; i < rows.length; i++) {
      var row = rows[i] || [];
      var textMeta = metaAt(i, columns.text);
      var optimizedTextMeta = metaAt(i, columns.optimizedText);
      var sourceMeta = metaAt(i, columns.source);
      var cutMeta = metaAt(i, columns.cut);
      var text = scriptOverlayTextForRow(row, rows, roles, columns.text, columns.source, columns.cut)
        .replace(/\s*\n+\s*/g, " ")
        .replace(/\s{2,}/g, " ")
        .replace(/^\s+|\s+$/g, "");
      var optimizedText = columns.optimizedText >= 0 ? String(row[columns.optimizedText] || "").replace(/^\s+|\s+$/g, "") : "";
      if (optimizedTextMeta && optimizedTextMeta.generatedOptimizedText && !scriptWantsSplitText()) {
        optimizedText = "";
      }
      var sourceText = columns.source >= 0 ? String(row[columns.source] || "").replace(/^\s+|\s+$/g, "") : "";
      var cutText = columns.cut >= 0 ? String(row[columns.cut] || "").replace(/^\s+|\s+$/g, "") : "";
      var lineKey = originKey(textMeta, i, columns.text, "text");
      var sourceIsMerged = sourceMeta && Number(sourceMeta.rowspan || 1) > 1;
      var cutIsMerged = cutMeta && Number(cutMeta.rowspan || 1) > 1;
      var mediaKey = sourceIsMerged || cutIsMerged ? (
        (sourceIsMerged ? ("source:" + sourceMeta.key) : ("source:value:" + sourceText.toLowerCase())) + "|" +
        (cutIsMerged ? ("cut:" + cutMeta.key) : ("cut:value:" + cutText.toLowerCase()))
      ) : ("media:row:" + i);
      var root = find(i);
      var group = groupsByRoot[root];
      if (!group) {
        group = { key: "group:" + root, firstRowIndex: i, rows: [], lines: [], mediaUnits: [] };
        groupsByRoot[root] = group;
        groups.push(group);
      }
      var entry = {
        row: i + 1,
        rowIndex: i,
        text: text,
        optimizedText: optimizedText,
        subtitleChunks: subtitleChunksFromOptimizedCell(optimizedText, text),
        sourceText: sourceText,
        cutText: cutText,
        lineKey: lineKey,
        mediaKey: mediaKey,
        groupKey: group.key
      };
      rowEntries.push(entry);
      group.rows.push(entry);
      if (text && !seenLines[lineKey]) {
        seenLines[lineKey] = true;
        group.lines.push(entry);
      }
      var mediaSeen = false;
      for (var mu = 0; mu < group.mediaUnits.length; mu++) {
        if (group.mediaUnits[mu].key === mediaKey) {
          mediaSeen = true;
          break;
        }
      }
      if (!mediaSeen && (sourceText || cutText)) {
        group.mediaUnits.push({ key: mediaKey, row: i + 1, rowIndex: i, sourceText: sourceText, cutText: cutText });
      }
    }
    return { rows: rowEntries, groups: groups, columns: columns, dataStartIndex: start, sourceRows: rows, roles: roles };
  }

  function scriptColumnIsAuthoritativeText(columnIndex, roles, preferredIndex) {
    return columnIndex === preferredIndex || !!(roles && roles[columnIndex] === "text");
  }

  function scriptOverlayTextForRow(row, rows, roles, preferredIndex, sourceIndex, cutIndex) {
    row = row || [];
    if (preferredIndex >= 0 && preferredIndex < row.length) {
      return cleanOverlayCaptionText(row[preferredIndex]);
    }
    var bestText = "";
    var bestScore = -1000;
    for (var c = 0; c < row.length; c++) {
      if (c === cutIndex || (roles && roles[c] === "cut") || (roles && roles[c] === "notes") || (roles && roles[c] === "optimizedText") || (roles && roles[c] === "skip")) {
        continue;
      }
      var text = cleanOverlayCaptionText(row[c]);
      if (!text) {
        continue;
      }
      var parsedCut = parseCutDurationSeconds(text);
      var definiteSource = /\.(mov|mp4|m4v|avi|mxf|webm|wav|mp3|png|jpe?g|gif|tiff?|bmp|webp|heic|psd)\b/i.test(text) ||
        /^\s*[A-Za-z]{1,4}\d+(?:[._-]\d+)*[A-Za-z]?\s*$/.test(text) ||
        /^\s*\d+\s*$/.test(text);
      var authoritativeText = scriptColumnIsAuthoritativeText(c, roles, preferredIndex);
      if (!authoritativeText && (parsedCut.ranges.length || definiteSource)) {
        continue;
      }
      var score = 0;
      if (roles && roles[c] === "text") {
        score += 100;
      }
      if (c === preferredIndex) {
        score += 20;
      }
      if (c === sourceIndex || (roles && roles[c] === "source")) {
        score -= 8;
      }
      if (/[A-Za-z\u00C0-\u1EF9]/.test(text)) {
        score += 4;
      }
      if (/\s/.test(text)) {
        score += 5;
      }
      if (text.length >= 8) {
        score += 3;
      }
      if (text.length >= 18) {
        score += 2;
      }
      if (scriptCellLooksLikeProductionNote(text)) {
        score -= 3;
      }
      if (score > bestScore) {
        bestScore = score;
        bestText = text;
      }
    }
    return bestScore > 0 ? bestText : "";
  }

  function parseCompactSourceCut(value) {
    var text = String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[–—]/g, "-");
    var raw = text.split("\n");
    var lines = [];
    for (var i = 0; i < raw.length; i++) {
      var line = raw[i].replace(/^\s+|\s+$/g, "");
      if (!line || /^\(?none\)?$/i.test(line) || /^-+$/.test(line)) {
        continue;
      }
      var match = line.match(/^([A-Za-z]*)(\d+(?:\+\d+)*)\s*-\s*(\d+(?:[.,]\d+)?)\s*$/);
      if (!match) {
        continue;
      }
      var prefix = match[1] || "";
      var numbers = match[2].split("+");
      var duration = parseScriptNumber(match[3]);
      var sources = [];
      for (var n = 0; n < numbers.length; n++) {
        if (numbers[n]) {
          sources.push(prefix + numbers[n]);
        }
      }
      lines.push({ lineIndex: i, sources: sources, duration: duration });
    }
    return lines;
  }

  function buildCutTimedSrtPlan(scriptPayload) {
    scriptPayload = scriptPayload || {};
    var rows = scriptPayload.tableRows || [];
    if (!rows.length) {
      return null;
    }
    var model = canonicalScriptModel(scriptPayload);
    if (model.columns.cut < 0 || model.columns.text < 0) {
      return null;
    }
    var cursor = 0;
    var captionIndex = 1;
    var captions = [];
    var rowPlans = [];
    var unresolved = [];
    var srtLines = [];
    for (var g = 0; g < model.groups.length; g++) {
      var group = model.groups[g];
      var duration = 0;
      for (var u = 0; u < group.mediaUnits.length; u++) {
        var parsed = parseCutDurationSeconds(group.mediaUnits[u].cutText);
        if (parsed.durationSeconds !== null) {
          duration += parsed.durationSeconds;
        }
        if (parsed.unresolved.length) {
          unresolved.push({ row: group.mediaUnits[u].row, cutLines: parsed.unresolved });
        }
      }
      if (!group.lines.length) {
        /* A no-voiceover row still occupies timeline time; later captions
           must start after its footage, not at its start. */
        cursor += duration;
        continue;
      }
      if (!duration) {
        continue;
      }
      var lineDuration = duration / group.lines.length;
      for (var l = 0; l < group.lines.length; l++) {
        var line = group.lines[l];
        var start = cursor;
        var end = cursor + lineDuration;
        var lineChunks = line.subtitleChunks && line.subtitleChunks.length ? line.subtitleChunks : [line.text];
        rowPlans.push({ row: line.row, overlayText: line.text, optimizedText: line.optimizedText, subtitleChunks: lineChunks, durationSeconds: lineDuration, startSeconds: start, endSeconds: end, groupKey: group.key });
        var lineCaptionBlocks = proportionalCaptionBlocks(lineChunks, start, end);
        for (var cb = 0; cb < lineCaptionBlocks.length; cb++) {
          srtLines.push(String(captionIndex++));
          srtLines.push(secondsToSrtTime(lineCaptionBlocks[cb].start) + " --> " + secondsToSrtTime(lineCaptionBlocks[cb].end));
          srtLines.push(lineCaptionBlocks[cb].text);
          srtLines.push("");
          captions.push({ text: lineCaptionBlocks[cb].text, startSeconds: lineCaptionBlocks[cb].start, endSeconds: lineCaptionBlocks[cb].end, row: line.row });
        }
        cursor = end;
      }
    }
    if (!captions.length && !rowPlans.length) {
      return null;
    }
    return {
      overlayColumnIndex: model.columns.text,
      cutColumnIndex: model.columns.cut,
      totalParsedDurationSeconds: cursor,
      captions: captions,
      rows: rowPlans,
      unresolvedCutLines: unresolved,
      srt: srtLines.join("\r\n")
    };
  }

  function normalizeScriptSourceName(value) {
    return normalizeScriptSourceAlias(value).toLowerCase()
      .replace(/\.(mp4|mov|m4v|avi|mxf|webm|wav|mp3|png|jpe?g|gif|tiff?|bmp|webp|heic|psd)$/i, "")
      .replace(/[^a-z0-9]+/g, "");
  }

  function normalizeScriptSourceAlias(value) {
    return String(value || "").replace(/(^|[\r\n,;\/\\])\s*(?:seed(?:ance)?|seadance|sea\s*dance)\s*([0-9]+(?:[._-][0-9]+)+)\b/ig, function (match, boundary, sourceId) {
      return boundary + "S" + sourceId;
    });
  }

  function sourceLookupTokens(value) {
    var text = normalizeScriptSourceAlias(value).replace(/\.(mp4|mov|m4v|avi|mxf|webm|wav|mp3|png|jpe?g|gif|tiff?|bmp|webp|heic|psd)(?=$|[\s,;)\]])/ig, "");
    var tokens = text.match(/[A-Za-z]+\d+(?:[._-]\d+)*|\d+(?:[._-]\d+)*/g) || [];
    var out = [];
    for (var i = 0; i < tokens.length; i++) {
      var norm = normalizeScriptSourceName(tokens[i]);
      if (/^(mp4|mov|m4v|avi|mxf|webm|wav|mp3|png|jpe?g|gif|tiff?|bmp|webp|heic|psd)$/i.test(norm)) {
        continue;
      }
      if (norm && out.indexOf(norm) === -1) {
        out.push(norm);
      }
    }
    return out;
  }

  function sourceKeywordTokens(value) {
    var text = normalizeScriptSourceAlias(value).toLowerCase().replace(/\.(mp4|mov|m4v|avi|mxf|webm|wav|mp3|png|jpe?g|gif|tiff?|bmp|webp|heic|psd)\b/g, " ");
    var matches = text.match(/[a-z]{3,}/g) || [];
    var ignored = { clip: true, video: true, source: true, media: true, copy: true, final: true };
    var out = [];
    for (var i = 0; i < matches.length; i++) {
      if (!ignored[matches[i]] && out.indexOf(matches[i]) === -1) {
        out.push(matches[i]);
      }
    }
    return out;
  }

  function validationBinHints() {
    var text = String(activeScriptDocument && activeScriptDocument() && activeScriptDocument().validationPrompt ? activeScriptDocument().validationPrompt : "").toLowerCase();
    var hints = [];
    text.replace(/\b(?:bin|folder|thư mục|folder\/bin)\s*[:=]?\s*([A-Za-z0-9._ -]{2,40})/gi, function (match, value) {
      value = String(value || "").replace(/\b(file|source|media|clip|is|are|in|the)\b.*$/i, "").replace(/^\s+|\s+$/g, "");
      var norm = normalizeScriptSourceName(value);
      if (norm && hints.indexOf(norm) === -1) {
        hints.push(norm);
      }
      return match;
    });
    return hints;
  }

  /* Same-name project items are not a real ambiguity when only one is actual
     footage (the others being sequences made with "New Sequence From Clip",
     offline items, etc.) or when they are the same file imported twice. */
  function collapseDuplicateSourceCandidates(list) {
    if (!list || list.length < 2) {
      return list || [];
    }
    var withMedia = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].item && list[i].item.mediaPath) {
        withMedia.push(list[i]);
      }
    }
    if (withMedia.length) {
      list = withMedia;
    }
    var firstPath = String(list[0].item && list[0].item.mediaPath || "").toLowerCase();
    if (!firstPath) {
      return list;
    }
    for (var j = 1; j < list.length; j++) {
      if (String(list[j].item.mediaPath || "").toLowerCase() !== firstPath) {
        return list;
      }
    }
    return [list[0]];
  }

  function ambiguousSourceDescription(sourceName, match) {
    var where = [];
    var candidates = match && match.candidates ? match.candidates : [];
    for (var i = 0; i < candidates.length && where.length < 4; i++) {
      var item = candidates[i].item || {};
      var bin = String(item.path || "").replace(/\\/g, "/").replace(/\/[^\/]*$/, "");
      var file = String(item.mediaPath || "").split(/[\/\\]/).pop();
      where.push((bin ? bin + "/" : "") + (item.name || file || "?") + (item.mediaPath ? " -> " + file : " (no media)"));
    }
    return sourceName + " matches " + candidates.length + " project items: " + where.join("; ");
  }

  function sourceMatchForScriptSource(sourceName) {
    var source = normalizeScriptSourceAlias(firstScriptSourceName(sourceName));
    if (!source) {
      return { item: null, ambiguous: false, candidates: [] };
    }
    var items = state && state.projectItems ? state.projectItems : [];
    var sourceLower = source.toLowerCase();
    var sourceNorm = normalizeScriptSourceName(source);
    var sourceTokens = sourceLookupTokens(source);
    var sourceKeywords = sourceKeywordTokens(source);
    var binHints = validationBinHints();
    var candidates = [];
    var exactCandidates = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var name = String(item.name || "");
      var path = String(item.mediaPath || item.path || "");
      var fileName = path ? path.split(/[\/\\]/).pop() : "";
      if (!name && !fileName && !path) {
        continue;
      }
      var mediaPath = String(item.mediaPath || "");
      if (Number(item.type) === 2) {
        continue;
      }
      var canonicalName = normalizeScriptSourceAlias(name);
      var canonicalFileName = normalizeScriptSourceAlias(fileName);
      var nameLower = canonicalName.toLowerCase();
      var pathLower = normalizeScriptSourceAlias(path).toLowerCase();
      var nameNorm = normalizeScriptSourceName(name);
      var fileNorm = normalizeScriptSourceName(fileName);
      var pathNorm = normalizeScriptSourceName(path);
      var itemTokens = sourceLookupTokens(canonicalName + "\n" + canonicalFileName);
      var itemKeywords = sourceKeywordTokens(canonicalName + "\n" + canonicalFileName);
      var exactStem = !!(sourceNorm && (nameNorm === sourceNorm || fileNorm === sourceNorm));
      if (nameLower === sourceLower || canonicalFileName.toLowerCase() === sourceLower || exactStem) {
        exactCandidates.push({ item: item, score: 2000, name: name || fileName, exact: true });
        continue;
      }
      var qualifiersComplete = true;
      for (var requiredTokenIndex = 1; requiredTokenIndex < sourceTokens.length; requiredTokenIndex++) {
        if (itemTokens.indexOf(sourceTokens[requiredTokenIndex]) === -1) {
          qualifiersComplete = false;
          break;
        }
      }
      if (qualifiersComplete) {
        for (var requiredKeywordIndex = 0; requiredKeywordIndex < sourceKeywords.length; requiredKeywordIndex++) {
          if (itemKeywords.indexOf(sourceKeywords[requiredKeywordIndex]) === -1) {
            qualifiersComplete = false;
            break;
          }
        }
      }
      if ((sourceTokens.length > 1 || sourceKeywords.length) && !qualifiersComplete) {
        continue;
      }
      var score = 0;
      var compactMatched = false;
      if (mediaPath || /\.(mov|mp4|m4v|avi|mxf|webm|png|jpe?g|gif|tiff?|bmp|webp|heic|psd)\b/i.test(name) || /\.(mov|mp4|m4v|avi|mxf|webm|png|jpe?g|gif|tiff?|bmp|webp|heic|psd)\b/i.test(fileName)) {
        score += 80;
      }
      if (sourceNorm && sourceNorm.length >= 2 && (nameNorm.indexOf(sourceNorm) === 0 || fileNorm.indexOf(sourceNorm) === 0)) {
        score += sourceNorm.length >= 3 ? 420 : 120;
      }
      if (sourceNorm && sourceNorm.length >= 3 && (nameNorm.indexOf(sourceNorm) !== -1 || fileNorm.indexOf(sourceNorm) !== -1)) {
        score += 260;
      }
      for (var t = 0; t < sourceTokens.length; t++) {
        var token = sourceTokens[t];
        if (!token) {
          continue;
        }
        if (itemTokens.indexOf(token) !== -1) {
          score += /^\d+$/.test(token) ? 180 : 360;
          compactMatched = true;
        } else if (token.length >= 3 && (nameNorm.indexOf(token) !== -1 || fileNorm.indexOf(token) !== -1)) {
          score += 160;
          compactMatched = true;
        }
      }
      var keywordMatches = 0;
      for (var kw = 0; kw < sourceKeywords.length; kw++) {
        if (itemKeywords.indexOf(sourceKeywords[kw]) !== -1) {
          score += 90;
          keywordMatches++;
        }
      }
      if (sourceKeywords.length && keywordMatches === sourceKeywords.length) {
        score += 80;
      }
      if (/^\d+$/.test(sourceNorm)) {
        var leadingDigitsPattern = new RegExp("^0*" + sourceNorm + "([^0-9]|$)");
        if (leadingDigitsPattern.test(name) || leadingDigitsPattern.test(fileName)) {
          score += 700;
          compactMatched = true;
        }
        var digitsPattern = new RegExp("(^|[^a-z0-9])0*" + sourceNorm + "([^0-9]|$)", "i");
        if (digitsPattern.test(name) || digitsPattern.test(fileName)) {
          score += 120;
        }
      }
      if (compactMatched || score >= 420) {
        score += 120;
      }
      for (var h = 0; h < binHints.length; h++) {
        if (binHints[h] && pathNorm.indexOf(binHints[h]) !== -1) {
          score += 40;
        }
      }
      if (score >= 120) {
        candidates.push({ item: item, score: score, name: name || fileName });
      }
    }
    exactCandidates = collapseDuplicateSourceCandidates(exactCandidates);
    if (exactCandidates.length === 1) {
      return { item: exactCandidates[0].item, ambiguous: false, candidates: exactCandidates, score: exactCandidates[0].score, exact: true };
    }
    if (exactCandidates.length > 1) {
      return { item: null, ambiguous: true, candidates: exactCandidates, score: exactCandidates[0].score, exact: true };
    }
    candidates.sort(function (a, b) {
      return b.score - a.score;
    });
    if (!candidates.length) {
      return { item: null, ambiguous: false, candidates: [] };
    }
    var top = candidates[0];
    var tied = [top];
    for (var c = 1; c < candidates.length; c++) {
      if (candidates[c].score === top.score) {
        tied.push(candidates[c]);
      }
    }
    tied = collapseDuplicateSourceCandidates(tied);
    if (tied.length === 1) {
      top = tied[0];
    }
    if (tied.length > 1 && top.score < 900) {
      return { item: null, ambiguous: true, candidates: tied, score: top.score };
    }
    return { item: top.item, ambiguous: false, candidates: candidates, score: top.score };
  }

  function firstScriptSourceName(value) {
    var compact = parseCompactSourceCut(value);
    if (compact.length && compact[0].sources.length) {
      return compact[0].sources[0];
    }
    var extracted = extractScriptSourceLabels(value);
    if (extracted.length) {
      return extracted[0];
    }
    var lines = String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/^\s+|\s+$/g, "");
      if (line && !/^\(?none\)?$/i.test(line) && !/^-+$/.test(line)) {
        return normalizeScriptSourceAlias(line);
      }
    }
    return "";
  }

  function scriptSourceLines(value) {
    var compact = parseCompactSourceCut(value);
    if (compact.length) {
      var compactLines = [];
      for (var c = 0; c < compact.length; c++) {
        compactLines.push(compact[c].sources.join("\n"));
      }
      return compactLines;
    }
    var extracted = extractScriptSourceLabels(value);
    if (extracted.length) {
      return extracted;
    }
    var raw = String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    var lines = [];
    for (var i = 0; i < raw.length; i++) {
      var line = firstScriptSourceName(raw[i]);
      lines.push(line);
    }
    return lines;
  }

  function scriptSourceLineHasDescriptors(value) {
    var words = String(value || "").match(/[A-Za-z\u00C0-\u1EF9]{3,}/g) || [];
    return words.length > 0;
  }

  function extractScriptSourceLabels(value) {
    var text = String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    var lines = text.split("\n");
    var labels = [];
    function addLabel(label) {
      label = String(label || "").replace(/^\s+|\s+$/g, "");
      if (!label || isScriptMediaExtensionToken(label) || /^\(?none\)?$/i.test(label) || /^-+$/.test(label)) {
        return;
      }
      if (labels.indexOf(label) === -1) {
        labels.push(label);
      }
    }
    function labelPrefix(label) {
      var match = String(label || "").match(/^\s*([A-Za-z]*\d+(?:[._-]\d+)*)/);
      return match ? normalizeScriptSourceName(match[1]) : "";
    }
    for (var i = 0; i < lines.length; i++) {
      var line = normalizeScriptSourceAlias(lines[i].replace(/^\s+|\s+$/g, ""));
      if (!line || /^\(?none\)?$/i.test(line) || /^-+$/.test(line)) {
        continue;
      }
      var fullMedia = [];
      var remainder = line;
      var fullLineMedia = mediaFilenameFromScriptLine(line);
      if (fullLineMedia) {
        fullMedia.push(fullLineMedia);
        addLabel(fullLineMedia);
        remainder = remainder.slice(fullLineMedia.length);
      }
      var coveredPrefixes = [];
      for (var fm = 0; fm < fullMedia.length; fm++) {
        var prefix = labelPrefix(fullMedia[fm]);
        if (prefix && coveredPrefixes.indexOf(prefix) === -1) {
          coveredPrefixes.push(prefix);
        }
      }
      var compactLabels = sourceLabelsFromValidationText(remainder);
      if (!fullMedia.length && compactLabels.length && scriptSourceLineHasDescriptors(line)) {
        addLabel(line);
        compactLabels = [];
      }
      for (var c = 0; c < compactLabels.length; c++) {
        var compactNorm = normalizeScriptSourceName(compactLabels[c]);
        if (compactNorm && coveredPrefixes.indexOf(compactNorm) !== -1) {
          continue;
        }
        addLabel(compactLabels[c]);
      }
      if (!fullMedia.length && !compactLabels.length && scriptCellLooksLikeSource(line)) {
        addLabel(line);
      }
    }
    return labels;
  }

  function findProjectItemForScriptSource(sourceName) {
    var match = sourceMatchForScriptSource(sourceName);
    return match && match.item ? match.item : null;
  }

  function cachedTimelineActionsFromScript(scriptPayload, options) {
    scriptPayload = scriptPayload || getScriptInputPayload();
    options = options || {};
    var rowPlans = rowMediaPlansFromScript(scriptPayload, { includeSilentRows: true });
    var clips = [];
    var usedGroups = {};
    for (var i = 0; i < rowPlans.length; i++) {
      if (usedGroups[rowPlans[i].mediaGroupKey]) {
        continue;
      }
      usedGroups[rowPlans[i].mediaGroupKey] = true;
      for (var c = 0; c < rowPlans[i].clips.length; c++) {
        clips.push(rowPlans[i].clips[c]);
      }
    }
    if (!clips.length) {
      return [];
    }
    var actions = [{
      type: "assembleFromScript",
      trackType: "video",
      trackIndex: 0,
      startSeconds: 0,
      overwrite: true,
      linked: true,
      skipMissing: false,
      skipInvalid: false,
      continueOnError: false,
      preserveSkippedGaps: true,
      clips: clips
    }];
    if (options.includeText !== false && scriptPayload.cutTimedSrtPlan && scriptPayload.cutTimedSrtPlan.srt) {
      actions.push({
        type: "importSrtFile",
        contents: scriptPayload.cutTimedSrtPlan.srt,
        startAtTime: 0,
        createCaptionTrack: true,
        allowCaptionTrackCreate: true,
        suppressUI: true,
        cleanupAfterImport: false,
        removeProjectItemAfterCaptionTrack: false,
        source: "layoutScriptText"
      });
    }
    return actions;
  }

  function cachedAudioTextActionFromScript(scriptPayload) {
    var transcript = scriptTranscriptTextForAudioAlignment(scriptPayload);
    if (!transcript.replace(/\s+/g, "")) {
      return [];
    }
    return [{
      type: "cutAudioAndTimeSubtitles",
      audioTrack: getWhisperSettings().audioTrack || "A1",
      scriptText: transcript,
      useProvidedText: true,
      createCaptionTrack: true,
      suppressUI: true
    }];
  }

  function validationCachedActionsFromPayload(payload, scriptPayload) {
    var actions = payload && (payload.timelineActions || payload.actions || payload.cachedActions);
    if (actions && Object.prototype.toString.call(actions) === "[object Array]" && actions.length) {
      return actions;
    }
    return cachedTimelineActionsFromScript(scriptPayload, { includeText: true });
  }

  function cachedActionsForQuickModes(scriptPayload, quickModes) {
    var script = selectedScriptDocument() || activeScriptDocument();
    var validation = script && script.validation ? script.validation : null;
    if (!validation || validation.status !== "validated") {
      return [];
    }
    var actions = [];
    if (quickModes.indexOf("full-processing") !== -1) {
      return [];
    }
    if (quickModes.indexOf("audio-text-cuts") !== -1) {
      actions = cachedAudioTextActionFromScript(scriptPayload);
    } else if (quickModes.indexOf("auto-subtitle-layout") !== -1) {
      if (scriptPayload.cutTimedSrtPlan && scriptPayload.cutTimedSrtPlan.srt) {
        actions = [{
          type: "importSrtFile",
          contents: scriptPayload.cutTimedSrtPlan.srt,
          startAtTime: 0,
          createCaptionTrack: true,
          allowCaptionTrackCreate: true,
          suppressUI: true,
          cleanupAfterImport: false,
          removeProjectItemAfterCaptionTrack: false
        }];
      }
    } else if (quickModes.indexOf("auto-cut-textbound") !== -1) {
      actions = validation.cachedActions && validation.cachedActions.length ? validation.cachedActions : cachedTimelineActionsFromScript(scriptPayload, { includeText: true });
    }
    if (!actions.length) {
      return [];
    }
    if (quickModes.indexOf("create-new-sequence") !== -1) {
      var stamp = (new Date()).toISOString().replace(/[:T]/g, "-").slice(0, 16);
      actions = [{
        type: "createSequence",
        name: "PR AI Validated Edit " + stamp,
        clear: true
      }].concat(actions);
    }
    return actions;
  }

  function applyCachedValidatedActions(scriptPayload, quickModes) {
    var actions = cachedActionsForQuickModes(scriptPayload, quickModes);
    if (!actions.length) {
      return false;
    }
    appendMessage("system", "Using validated cached action code. No agent generation needed.");
    setPendingActions({ actions: actions });
    setRunPhase("Applying cached actions");
    setStatus("Applying validated cached actions...");
    applyJson();
    return true;
  }

  function deterministicQuickModeActions(scriptPayload, quickModes) {
    quickModes = quickModes || [];
    var actions = [];
    if (quickModes.indexOf("create-new-sequence") !== -1) {
      var stamp = (new Date()).toISOString().replace(/[:T]/g, "-").slice(0, 16);
      actions.push({
        type: "createSequence",
        name: "PR AI Edit " + stamp,
        clear: true
      });
    }
    if (quickModes.indexOf("full-processing") !== -1) {
      actions.push({ type: "fullProcessScriptRows" });
      return actions;
    }
    if (quickModes.indexOf("audio-text-cuts") !== -1) {
      return actions.concat(cachedAudioTextActionFromScript(scriptPayload));
    }
    if (quickModes.indexOf("auto-cut-textbound") !== -1) {
      var layoutActions = cachedTimelineActionsFromScript(scriptPayload, { includeText: true });
      var hasLayoutText = false;
      for (var la = 0; la < layoutActions.length; la++) {
        if (layoutActions[la] && (layoutActions[la].type === "importSrtFile" || layoutActions[la].type === "importCaptionFile")) {
          hasLayoutText = true;
        }
      }
      if (!hasLayoutText) {
        throw new Error("Layout found no usable script text timed to source cuts. Set the Text/Overlay and Cut column roles, or fix the highlighted cut cells; no footage was placed.");
      }
      return actions.concat(layoutActions);
    }
    if (quickModes.indexOf("auto-subtitle-layout") !== -1 && scriptPayload && scriptPayload.cutTimedSrtPlan && scriptPayload.cutTimedSrtPlan.srt) {
      actions.push({
        type: "importSrtFile",
        contents: scriptPayload.cutTimedSrtPlan.srt,
        startAtTime: 0,
        createCaptionTrack: true,
        allowCaptionTrackCreate: true,
        suppressUI: true,
        cleanupAfterImport: false,
        removeProjectItemAfterCaptionTrack: false
      });
      return actions;
    }
    return actions;
  }

  function shouldUseDeterministicQuickMode(request, quickModes) {
    if (!quickModes || !quickModes.length) {
      return false;
    }
    return quickModes.indexOf("full-processing") !== -1 ||
      quickModes.indexOf("audio-text-cuts") !== -1 ||
      quickModes.indexOf("auto-cut-textbound") !== -1 ||
      quickModes.indexOf("auto-subtitle-layout") !== -1 ||
      quickModes.indexOf("create-new-sequence") !== -1;
  }

  function shouldUseValidatedActionCache(request, quickModes) {
    if (!quickModes || !quickModes.length) {
      return false;
    }
    var hasFastMode = quickModes.indexOf("auto-cut-textbound") !== -1 ||
      quickModes.indexOf("auto-subtitle-layout") !== -1 ||
      quickModes.indexOf("audio-text-cuts") !== -1 ||
      quickModes.indexOf("full-processing") !== -1;
    if (!hasFastMode) {
      return false;
    }
    var value = String(request || "").toLowerCase().replace(/^\s+|\s+$/g, "");
    if (!value) {
      return true;
    }
    return /\b(apply|run|do it|place|port|use validated|validated|timeline|send it|go)\b/.test(value) &&
      !/\b(change|instead|only|except|but|custom|different|revise|fix|validate)\b/.test(value);
  }

  function handleScriptInputPaste(event) {
    var rows = rowsFromClipboardEvent(event, true);
    if (!rows.length) {
      return;
    }
    var structuredPaste = !!rows.pastedTableHtml || rows.length > 1 || (rows[0] && rows[0].length > 1);
    if (sheetEditMode && !structuredPaste) {
      return;
    }
    if (sheetEditMode && structuredPaste) {
      var pasteCell = sheetEditingCell;
      finishSheetEdit(true);
      focusSheetCell(pasteCell);
    }
    event.preventDefault();
    if (els.scriptInput.querySelector("table") && !isEmptySheetPlaceholder()) {
      pasteRowsIntoSheetSelection(rows);
      return;
    }
    pasteRowsIntoScriptTable(rows);
  }

  function sheetSelectionAsText() {
    var table = els.scriptInput.querySelector("table");
    if (!table) {
      return "";
    }
    var bounds = sheetSelectionBounds();
    var grid = logicalSheetGrid(table);
    var lines = [];
    for (var r = bounds.rowStart; r <= bounds.rowEnd; r++) {
      var values = [];
      for (var c = bounds.colStart; c <= bounds.colEnd; c++) {
        var info = grid.refs[r] && grid.refs[r][c] ? grid.refs[r][c] : null;
        values.push(info && info.originRow === r && info.originCol === c ? sheetCellText(info.cell) : "");
      }
      lines.push(values.join("\t"));
    }
    return lines.join("\n");
  }

  function handleSheetCopy(event) {
    if (!sheetHasFocus() || sheetEditMode) {
      return;
    }
    var text = sheetSelectionAsText();
    if (!text && !activeSheetCell()) {
      return;
    }
    event.preventDefault();
    if (event.clipboardData && event.clipboardData.setData) {
      event.clipboardData.setData("text/plain", text);
    }
  }

  function handleSheetCut(event) {
    if (!sheetHasFocus() || sheetEditMode) {
      return;
    }
    handleSheetCopy(event);
    clearSelectedSheetCells();
  }

  function ensureSheetLogicalSize(table, targetRows, targetColumns) {
    var tbody = table.tBodies[0] || table.appendChild(document.createElement("tbody"));
    var grid = logicalSheetGrid(table);
    while (grid.rows.length < targetRows) {
      var tr = document.createElement("tr");
      for (var c = 0; c < Math.max(grid.columnCount, targetColumns, 1); c++) {
        tr.appendChild(createSheetCell("", false));
      }
      tbody.appendChild(tr);
      grid = logicalSheetGrid(table);
    }
    var guard = 0;
    while (grid.columnCount < targetColumns && guard++ < 100) {
      for (var r = 0; r < grid.rows.length; r++) {
        var rowRefs = grid.refs[r] || [];
        if (rowRefs.length < targetColumns) {
          grid.rows[r].appendChild(createSheetCell("", grid.rows[r].children.length && grid.rows[r].children[0].tagName === "TH"));
        }
      }
      grid = logicalSheetGrid(table);
    }
    return grid;
  }

  function pasteRowsIntoSheetSelection(rows) {
    if (!rows || !rows.length) {
      return;
    }
    var table = ensureScriptTable();
    var startRow = sheetActiveRowIndex;
    var startCol = sheetActiveColumnIndex;
    var width = 1;
    for (var i = 0; i < rows.length; i++) {
      width = Math.max(width, rows[i].length || 1);
    }
    pushSheetUndo();
    var grid = ensureSheetLogicalSize(table, startRow + rows.length, startCol + width);
    var written = [];
    var singleValue = rows.length === 1 && rows[0].length === 1;
    var bounds = sheetSelectionBounds();
    if (singleValue && (bounds.rowEnd > bounds.rowStart || bounds.colEnd > bounds.colStart)) {
      for (var sr = bounds.rowStart; sr <= bounds.rowEnd; sr++) {
        for (var sc = bounds.colStart; sc <= bounds.colEnd; sc++) {
          var fillInfo = grid.refs[sr] && grid.refs[sr][sc] ? grid.refs[sr][sc] : null;
          if (fillInfo && written.indexOf(fillInfo.cell) === -1) {
            written.push(fillInfo.cell);
            setCellText(fillInfo.cell, rows[0][0]);
          }
        }
      }
    } else {
      for (var r = 0; r < rows.length; r++) {
        for (var c = 0; c < rows[r].length; c++) {
          var info = grid.refs[startRow + r] && grid.refs[startRow + r][startCol + c] ? grid.refs[startRow + r][startCol + c] : null;
          if (info && written.indexOf(info.cell) === -1) {
            written.push(info.cell);
            setCellText(info.cell, rows[r][c]);
          }
        }
      }
      setSheetSelection(startRow, startRow + rows.length - 1, startCol, startCol + width - 1, startRow, startCol);
    }
    updateSheetRails();
    saveActiveScriptDocument();
    setStatus("Pasted " + rows.length + " row" + (rows.length === 1 ? "" : "s") + " into the sheet.");
  }

  function handleScriptOverlayPaste(event) {
    if (!els.scriptEditorOverlay || els.scriptEditorOverlay.hidden || !els.scriptEditorOverlay.contains(event.target)) {
      return;
    }
    if (els.scriptInput && els.scriptInput.contains(event.target)) {
      return;
    }
    if (isEditableTarget(event.target)) {
      return;
    }
    var rows = rowsFromClipboardEvent(event, false);
    if (!rows.length) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) {
      event.stopImmediatePropagation();
    }
    els.scriptInput.focus();
    pasteRowsIntoScriptTable(rows);
  }

  function rowsFromClipboardEvent(event, allowPlainTextFallback) {
    var clipboard = event.clipboardData || window.clipboardData;
    var html = clipboard && clipboard.getData ? clipboard.getData("text/html") : "";
    var text = clipboard && clipboard.getData ? clipboard.getData("text/plain") : "";
    if (!html && !text) {
      return [];
    }
    var rows = html ? rowsFromPastedHtml(html) : [];
    if (rows.length && html) {
      var normalizedHolder = document.createElement("div");
      normalizedHolder.innerHTML = normalizePastedTableHtml(html);
      var normalizedTable = normalizedHolder.querySelector("table");
      if (normalizedTable) {
        rows.pastedTableHtml = normalizedTable.outerHTML;
      }
    }
    if (!rows.length) {
      rows = rowsFromDelimitedText(text);
    }
    if (!rows.length && allowPlainTextFallback && text) {
      rows = [[text]];
    }
    if (!rows.length && allowPlainTextFallback && html) {
      rows = [[String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "")]];
    }
    return rows;
  }

  function pasteRowsIntoScriptTable(rows) {
    if (rows && rows.pastedTableHtml && (!els.scriptInput.querySelector("table") || isEmptySheetPlaceholder())) {
      pushSheetUndo();
      els.scriptInput.innerHTML = rows.pastedTableHtml;
      updateSheetRails();
      saveActiveScriptDocument();
      setStatus("Pasted sheet loaded with merged cells preserved.");
      return;
    }
    if (rows.length && isEmptySheetPlaceholder()) {
      pushSheetUndo();
      els.scriptInput.innerHTML = "";
    }
    if (rows.length && (appendRowsToScriptTable(rows) || createScriptTableFromRows(rows))) {
      applyScriptMediaMergeDisplay();
      return;
    }
  }

  function rowsFromPastedHtml(html) {
    var holder = document.createElement("div");
    holder.innerHTML = normalizePastedTableHtml(html);
    var table = holder.querySelector("table");
    if (!table) {
      return [];
    }
    return getScriptInputTableRows(holder);
  }

  function rowsFromDelimitedText(text) {
    var value = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (value.indexOf("\t") === -1) {
      return [];
    }
    var lines = value.split("\n");
    var rows = [];
    for (var i = 0; i < lines.length; i++) {
      if (!lines[i] && i === lines.length - 1) {
        continue;
      }
      rows.push(lines[i].split("\t"));
    }
    return rows;
  }

  /* RFC4180-ish CSV parsing: quoted fields may contain commas, embedded
     newlines, and escaped quotes ("" -> "). rowsFromDelimitedText (above)
     only ever understood tab-separated paste text, so a real comma CSV file
     - like a scene/shot export from an external nav-script tool - could not
     be read at all before this. */
  function parseCsvText(text) {
    var input = String(text || "");
    if (input.charCodeAt(0) === 0xfeff) {
      input = input.slice(1);
    }
    var rows = [];
    var row = [];
    var field = "";
    var inQuotes = false;
    var sawAnyContent = false;
    var i = 0;
    var len = input.length;
    function endField() {
      row.push(field);
      field = "";
    }
    function endRow() {
      endField();
      rows.push(row);
      row = [];
    }
    while (i < len) {
      var ch = input.charAt(i);
      if (inQuotes) {
        if (ch === "\"") {
          if (input.charAt(i + 1) === "\"") {
            field += "\"";
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        field += ch;
        i++;
        continue;
      }
      if (ch === "\"") {
        inQuotes = true;
        sawAnyContent = true;
        i++;
        continue;
      }
      if (ch === ",") {
        sawAnyContent = true;
        endField();
        i++;
        continue;
      }
      if (ch === "\r") {
        if (input.charAt(i + 1) === "\n") {
          i++;
        }
        endRow();
        i++;
        continue;
      }
      if (ch === "\n") {
        endRow();
        i++;
        continue;
      }
      if (ch.replace(/\s/, "")) {
        sawAnyContent = true;
      }
      field += ch;
      i++;
    }
    if (field.length || row.length) {
      endRow();
    }
    while (rows.length && rows[rows.length - 1].length === 1 && !rows[rows.length - 1][0]) {
      rows.pop();
    }
    return sawAnyContent ? rows : [];
  }

  /* Turns a plain header name into a readable column label: "voice_over" ->
     "Voice Over", "s3_path" -> "S3 Path". Used for CSV columns that have no
     equivalent in PR AI's own model and are kept only for reference. */
  function friendlyCsvColumnLabel(raw, index) {
    var value = String(raw || "").replace(/^\s+|\s+$/g, "");
    if (!value) {
      return "Column " + (index + 1);
    }
    return value.replace(/[_\-]+/g, " ").replace(/\b[a-z]/g, function (letter) {
      return letter.toUpperCase();
    });
  }

  function csvCutValueForRow(row, startIndex, endIndex) {
    var startValue = startIndex >= 0 && row[startIndex] !== undefined ? String(row[startIndex]).replace(/^\s+|\s+$/g, "") : "";
    var endValue = endIndex >= 0 && row[endIndex] !== undefined ? String(row[endIndex]).replace(/^\s+|\s+$/g, "") : "";
    if (startValue && endValue) {
      return startValue + "-" + endValue;
    }
    return startValue || endValue;
  }

  /* Maps a known nav-script CSV export shape onto PR AI's own column roles:
     text_overlay -> Text, footage_name -> Source, shot_start+shot_end merged
     into one Cut cell (PR AI's Cut column is always a single "start-end"
     value, never two separate columns), notes -> Notes. Every other column
     from the source file (scene, content, effects, voice_over, visual,
     shot_name, s3_path, drive_path, drive_link, duration_seconds, or any
     future/unrecognized column) is kept as-is, tagged "skip" so it never
     interferes with Text/Source/Cut inference, so nothing from the source
     file is ever silently discarded even if this tool's export shape changes
     later. */
  function buildScriptTableFromCsvRows(rows) {
    if (!rows || rows.length < 1) {
      return null;
    }
    var headerRow = rows[0];
    var dataRows = rows.slice(1);
    var headers = [];
    for (var h = 0; h < headerRow.length; h++) {
      headers.push(String(headerRow[h] || "").replace(/^\s+|\s+$/g, "").toLowerCase());
    }
    function headerIndex(name) {
      return headers.indexOf(name);
    }
    var textIndex = headerIndex("text_overlay");
    var sourceIndex = headerIndex("footage_name");
    var shotStartIndex = headerIndex("shot_start");
    var shotEndIndex = headerIndex("shot_end");
    var notesIndex = headerIndex("notes");

    var columns = [];
    var usedIndexes = {};
    function useColumn(index) {
      if (index >= 0) {
        usedIndexes[index] = true;
      }
    }
    if (textIndex >= 0) {
      columns.push({ role: "text", label: "Text", index: textIndex });
      useColumn(textIndex);
    }
    if (sourceIndex >= 0) {
      columns.push({ role: "source", label: "Source", index: sourceIndex });
      useColumn(sourceIndex);
    }
    if (shotStartIndex >= 0 || shotEndIndex >= 0) {
      columns.push({ role: "cut", label: "Cut", mergeStart: shotStartIndex, mergeEnd: shotEndIndex });
      useColumn(shotStartIndex);
      useColumn(shotEndIndex);
    }
    if (notesIndex >= 0) {
      columns.push({ role: "notes", label: "Notes", index: notesIndex });
      useColumn(notesIndex);
    }
    for (var c = 0; c < headerRow.length; c++) {
      if (usedIndexes[c]) {
        continue;
      }
      columns.push({ role: "skip", label: friendlyCsvColumnLabel(headerRow[c], c), index: c });
    }
    if (!columns.length) {
      return null;
    }

    var table = document.createElement("table");
    var tbody = document.createElement("tbody");
    var headerTr = document.createElement("tr");
    for (var hc = 0; hc < columns.length; hc++) {
      var headerCell = createSheetCell(columns[hc].label, true);
      headerCell.setAttribute("data-column-role", columns[hc].role);
      headerCell.setAttribute("data-column-label", columns[hc].label);
      headerTr.appendChild(headerCell);
    }
    tbody.appendChild(headerTr);
    var rowCount = 0;
    for (var r = 0; r < dataRows.length; r++) {
      var dataRow = dataRows[r];
      if (!dataRow || !dataRow.length || !dataRow.join("").replace(/\s+/g, "")) {
        continue;
      }
      var tr = document.createElement("tr");
      for (var ci = 0; ci < columns.length; ci++) {
        var column = columns[ci];
        var value;
        if (column.mergeStart !== undefined) {
          value = csvCutValueForRow(dataRow, column.mergeStart, column.mergeEnd);
        } else {
          value = dataRow[column.index] !== undefined ? dataRow[column.index] : "";
        }
        tr.appendChild(createSheetCell(String(value || ""), false));
      }
      tbody.appendChild(tr);
      rowCount++;
    }
    table.appendChild(tbody);
    return {
      table: table,
      rowCount: rowCount,
      mappedText: textIndex >= 0,
      mappedSource: sourceIndex >= 0,
      mappedCut: shotStartIndex >= 0 || shotEndIndex >= 0,
      mappedNotes: notesIndex >= 0,
      extraColumnCount: columns.filter(function (column) { return column.role === "skip"; }).length
    };
  }

  function nextAvailableScriptName(base) {
    var name = String(base || "").replace(/^\s+|\s+$/g, "") || "Imported CSV";
    var existing = {};
    for (var i = 0; i < scriptDocuments.length; i++) {
      existing[scriptDocuments[i].name] = true;
    }
    if (!existing[name]) {
      return name;
    }
    var n = 2;
    while (existing[name + " (" + n + ")"]) {
      n++;
    }
    return name + " (" + n + ")";
  }

  /* Opens a native file picker (no clipboard involved) and imports a CSV
     straight off disk as a new script - the file itself, not a paste, since
     the source is a saved export rather than something copied from an app. */
  function importScriptCsvFile() {
    if (isAgentRunning) {
      setStatus("Waiting for current reply before importing a CSV.", true);
      return;
    }
    setStatus("Opening CSV file browser...");
    evalHost("prAI_selectCsvFile").then(function (result) {
      if (!result.ok) {
        setStatus(result.error || "Could not open the file browser.", true);
        return;
      }
      var filePath = result.data && result.data.filePath;
      if (!filePath) {
        setStatus("CSV import cancelled.");
        return;
      }
      var nodeRequire = getNodeRequire();
      if (!nodeRequire) {
        setStatus("Node.js is not available in this CEP panel. Check manifest CEFCommandLine.", true);
        return;
      }
      var fs = nodeRequire("fs");
      var path = nodeRequire("path");
      var raw;
      try {
        raw = fs.readFileSync(filePath, "utf8");
      } catch (readErr) {
        setStatus("Could not read " + filePath + ": " + String(readErr && readErr.message ? readErr.message : readErr), true);
        return;
      }
      var rows = parseCsvText(raw);
      if (!rows.length) {
        setStatus("That CSV file is empty or could not be parsed.", true);
        return;
      }
      var mapped = buildScriptTableFromCsvRows(rows);
      if (!mapped || !mapped.table || !mapped.rowCount) {
        setStatus("Could not find any usable rows in that CSV.", true);
        return;
      }
      saveActiveScriptDocument();
      var baseName = nextAvailableScriptName(path.basename(filePath).replace(/\.csv$/i, ""));
      var id = "script-" + (new Date()).getTime() + "-" + Math.floor(Math.random() * 1000);
      scriptDocuments.push({ id: id, name: baseName, html: mapped.table.outerHTML });
      activeScriptId = id;
      selectedScriptId = "";
      syncActiveScriptProjectState();
      resetSheetHistory();
      els.scriptInput.innerHTML = mapped.table.outerHTML;
      renderScriptTabs();
      updateSheetRails();
      saveScriptDocuments();
      openScriptEditor();
      els.scriptInput.focus();
      var mappedRoles = [];
      if (mapped.mappedText) mappedRoles.push("Text");
      if (mapped.mappedSource) mappedRoles.push("Source");
      if (mapped.mappedCut) mappedRoles.push("Cut");
      if (mapped.mappedNotes) mappedRoles.push("Notes");
      var summary = "Imported " + mapped.rowCount + " row(s) from " + path.basename(filePath) + ".";
      summary += mappedRoles.length ? " Mapped: " + mappedRoles.join(", ") + "." : " No columns matched Text/Source/Cut/Notes - check column roles manually.";
      if (mapped.extraColumnCount > 0) {
        summary += " " + mapped.extraColumnCount + " other column(s) kept for reference.";
      }
      setStatus(summary);
    }).catch(function (err) {
      setStatus(String(err && err.message ? err.message : err), true);
    });
  }

  function appendRowsToScriptTable(rows) {
    if (!rows || !rows.length) {
      return false;
    }
    var existing = els.scriptInput.querySelector("table");
    if (!existing) {
      return false;
    }
    pushSheetUndo();
    var tbody = existing.tBodies[0] || existing.appendChild(document.createElement("tbody"));
    var selectedCell = currentSheetCell();
    var selectedRow = selectedCell && selectedCell.parentNode && selectedCell.parentNode.parentNode === tbody ? selectedCell.parentNode : null;
    var insertBefore = selectedRow ? selectedRow.nextSibling : null;
    var maxCols = sheetColumnCount(existing);
    for (var rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      maxCols = Math.max(maxCols, rows[rowIndex].length);
    }
    while (sheetColumnCount(existing) < maxCols) {
      var currentRows = existing.querySelectorAll("tr");
      for (var r = 0; r < currentRows.length; r++) {
        currentRows[r].appendChild(createSheetCell("", currentRows[r].children.length && currentRows[r].children[0].tagName === "TH"));
      }
    }
    var firstNewCell = null;
    for (var i = 0; i < rows.length; i++) {
      var tr = document.createElement("tr");
      for (var c = 0; c < maxCols; c++) {
        var appendedCell = createSheetCell("", false);
        setCellText(appendedCell, rows[i][c] || "");
        tr.appendChild(appendedCell);
      }
      if (!firstNewCell) {
        firstNewCell = tr.cells[0];
      }
      if (insertBefore) {
        tbody.insertBefore(tr, insertBefore);
      } else {
        tbody.appendChild(tr);
      }
    }
    focusSheetCell(firstNewCell);
    updateSheetRails();
    saveActiveScriptDocument();
    setStatus("Pasted rows appended to sheet.");
    return true;
  }

  function createScriptTableFromRows(rows) {
    if (!rows || !rows.length) {
      return false;
    }
    pushSheetUndo();
    var maxCols = 1;
    for (var i = 0; i < rows.length; i++) {
      maxCols = Math.max(maxCols, rows[i].length);
    }
    var table = document.createElement("table");
    var tbody = document.createElement("tbody");
    var firstCell = null;
    for (var r = 0; r < rows.length; r++) {
      var tr = document.createElement("tr");
      for (var c = 0; c < maxCols; c++) {
        var newCell = createSheetCell("", false);
        setCellText(newCell, rows[r][c] || "");
        tr.appendChild(newCell);
      }
      if (!firstCell) {
        firstCell = tr.cells[0];
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    els.scriptInput.innerHTML = "";
    els.scriptInput.appendChild(table);
    focusSheetCell(firstCell);
    updateSheetRails();
    saveActiveScriptDocument();
    setStatus("Pasted sheet loaded.");
    return true;
  }

  function mediaMergeDisplayKey(sourceText, cutText) {
    sourceText = String(sourceText || "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    cutText = String(cutText || "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    if (!sourceText || !cutText) {
      return "";
    }
    var cut = parseCutDurationSeconds(cutText);
    if (!cut.ranges.length) {
      return "";
    }
    if (!scriptCellLooksLikeSource(sourceText) && !firstScriptSourceName(sourceText)) {
      return "";
    }
    return sourceText.toLowerCase() + "||" + cutText.toLowerCase();
  }

  function applyScriptMediaMergeDisplay() {
    var table = els.scriptInput ? els.scriptInput.querySelector("table") : null;
    if (!table) {
      return false;
    }
    var existingMergedCells = table.querySelectorAll("td[rowspan],th[rowspan]");
    for (var em = 0; em < existingMergedCells.length; em++) {
      if (Number(existingMergedCells[em].getAttribute("rowspan") || 1) > 1) {
        return false;
      }
    }
    var holder = document.createElement("div");
    holder.appendChild(table.cloneNode(true));
    var grid = getScriptInputTableGrid(holder);
    var rows = grid.rows || [];
    if (!rows.length) {
      return false;
    }
    var roles = getScriptInputColumnRoles(holder);
    var sourceIndex = inferScriptColumnIndex(rows, roles, "source", /source\s*file|source\s*name|media|clip\s*name|source/, 6);
    var cutIndex = inferScriptColumnIndex(rows, roles, "cut", /cut\s*from\s*source|source\s*range|range|cut\s*\[?7\]?/, 7);
    var textIndex = inferScriptColumnIndex(rows, roles, "text", /overlay\s*text|caption|subtitle|srt|text\s*\[?5\]?/, 5);
    if (sourceIndex < 0 || cutIndex < 0 || textIndex < 0 || sourceIndex === cutIndex) {
      return false;
    }
    var start = scriptDataStartIndex(rows);
    var mergeStarts = {};
    var skipCells = {};
    var changed = false;
    var r = start;
    while (r < rows.length) {
      var key = mediaMergeDisplayKey(rows[r] && rows[r][sourceIndex], rows[r] && rows[r][cutIndex]);
      if (!key) {
        r++;
        continue;
      }
      var end = r + 1;
      while (end < rows.length && mediaMergeDisplayKey(rows[end] && rows[end][sourceIndex], rows[end] && rows[end][cutIndex]) === key) {
        end++;
      }
      var span = end - r;
      if (span > 1) {
        mergeStarts[r + ":" + sourceIndex] = span;
        mergeStarts[r + ":" + cutIndex] = span;
        for (var sr = r + 1; sr < end; sr++) {
          skipCells[sr + ":" + sourceIndex] = true;
          skipCells[sr + ":" + cutIndex] = true;
        }
        changed = true;
      }
      r = end;
    }
    r = start;
    while (r < rows.length) {
      var text = cleanOverlayCaptionText(rows[r] && rows[r][textIndex]);
      if (!text) {
        r++;
        continue;
      }
      var textEnd = r + 1;
      while (textEnd < rows.length && cleanOverlayCaptionText(rows[textEnd] && rows[textEnd][textIndex]) === text) {
        textEnd++;
      }
      var textSpan = textEnd - r;
      if (textSpan > 1) {
        mergeStarts[r + ":" + textIndex] = textSpan;
        for (var tr = r + 1; tr < textEnd; tr++) {
          skipCells[tr + ":" + textIndex] = true;
        }
        changed = true;
      }
      r = textEnd;
    }
    if (!changed) {
      return false;
    }

    var originalRows = table.querySelectorAll("tr");
    var originalRoleAttrs = [];
    if (originalRows.length) {
      for (var rc = 0; rc < rows[0].length; rc++) {
        var headerCell = originalRows[0].children[rc];
        originalRoleAttrs[rc] = headerCell ? (headerCell.getAttribute("data-column-role") || "") : "";
      }
    }
    var newTable = document.createElement("table");
    var tbody = document.createElement("tbody");
    for (var rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      var tr = document.createElement("tr");
      for (var colIndex = 0; colIndex < rows[rowIndex].length; colIndex++) {
        if (skipCells[rowIndex + ":" + colIndex]) {
          continue;
        }
        var cell = createSheetCell("", false);
        setCellText(cell, rows[rowIndex][colIndex] || "");
        if (rowIndex === 0 && originalRoleAttrs[colIndex]) {
          cell.setAttribute("data-column-role", originalRoleAttrs[colIndex]);
        }
        var rowspan = mergeStarts[rowIndex + ":" + colIndex] || 1;
        if (rowspan > 1) {
          cell.setAttribute("rowspan", String(rowspan));
          cell.className += " is-merged-media";
          cell.setAttribute("title", "Merged media cell spanning " + rowspan + " script rows.");
        }
        tr.appendChild(cell);
      }
      tbody.appendChild(tr);
    }
    newTable.appendChild(tbody);
    table.parentNode.replaceChild(newTable, table);
    updateSheetRails();
    saveActiveScriptDocument();
    setStatus("Merged repeated media cells in script display.");
    return true;
  }

  function normalizePastedTableHtml(html) {
    var value = String(html || "");
    var styleText = "";
    value = value.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, function (match, css) {
      styleText += "\n" + css;
      return "";
    });
    var bodyMatch = value.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      value = bodyMatch[1];
    }
    value = value.replace(/<script[\s\S]*?<\/script>/gi, "");
    return normalizeScriptInputMarkup(value, styleText);
  }

  function normalizeScriptInputMarkup(html, styleText) {
    var holder = document.createElement("div");
    holder.innerHTML = html;
    applyPastedStyleRules(holder, styleText || "");
    normalizeScriptInputNode(holder);
    return holder.innerHTML;
  }

  function applyPastedStyleRules(root, styleText) {
    var rules = parsePastedStyleRules(styleText);
    for (var selector in rules) {
      if (!Object.prototype.hasOwnProperty.call(rules, selector)) {
        continue;
      }
      var elements = [];
      try {
        elements = root.querySelectorAll(selector);
      } catch (err) {
        continue;
      }
      for (var i = 0; i < elements.length; i++) {
        applyAllowedInlineStyles(elements[i], rules[selector]);
      }
    }
  }

  function parsePastedStyleRules(styleText) {
    var rules = {};
    var css = String(styleText || "").replace(/\/\*[\s\S]*?\*\//g, "");
    css.replace(/([^{}]+)\{([^{}]+)\}/g, function (match, selectorText, body) {
      var styles = allowedStylesFromCssText(body);
      var selectors = selectorText.split(",");
      for (var i = 0; i < selectors.length; i++) {
        var selector = selectors[i].replace(/^\s+|\s+$/g, "");
        if (!selector || /[\s>+~:#\[]/.test(selector)) {
          continue;
        }
        if (selector.charAt(0) !== "." && selector.charAt(0) !== "#") {
          continue;
        }
        rules[selector] = styles;
      }
    });
    return rules;
  }

  function allowedStylesFromCssText(cssText) {
    var allowed = {};
    var declarations = String(cssText || "").split(";");
    for (var i = 0; i < declarations.length; i++) {
      var pair = declarations[i].split(":");
      if (pair.length < 2) {
        continue;
      }
      var key = pair[0].replace(/^\s+|\s+$/g, "").toLowerCase();
      var value = pair.slice(1).join(":").replace(/^\s+|\s+$/g, "");
      if (key === "font-weight" || key === "font-style" || key === "text-decoration" || key === "text-align" || key === "vertical-align") {
        allowed[key] = value;
      }
    }
    return allowed;
  }

  function applyAllowedInlineStyles(element, styles) {
    if (!element || !element.style || !styles) {
      return;
    }
    if (styles["font-weight"]) {
      element.style.fontWeight = styles["font-weight"];
    }
    if (styles["font-style"]) {
      element.style.fontStyle = styles["font-style"];
    }
    if (styles["text-decoration"]) {
      element.style.textDecoration = styles["text-decoration"];
    }
    if (styles["text-align"]) {
      element.style.textAlign = styles["text-align"];
    }
    if (styles["vertical-align"]) {
      element.style.verticalAlign = styles["vertical-align"];
    }
  }

  function normalizeScriptInputNode(node) {
    if (!node || !node.childNodes) {
      return;
    }
    for (var i = 0; i < node.childNodes.length; i++) {
      var child = node.childNodes[i];
      if (child.nodeType !== 1) {
        continue;
      }
      child.removeAttribute("bgcolor");
      child.removeAttribute("color");
      child.removeAttribute("width");
      child.removeAttribute("height");
      if (child.style) {
        child.style.background = "";
        child.style.backgroundColor = "";
        child.style.color = "";
        child.style.fontFamily = "";
        child.style.fontSize = "";
        child.style.lineHeight = "";
        child.style.width = "";
        child.style.height = "";
        child.style.minWidth = "";
        child.style.maxWidth = "";
      }
      normalizeScriptInputNode(child);
    }
  }

  function textToTableHtml(text) {
    var rows = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    var hasTabs = /\t/.test(text);
    if (!hasTabs && rows.length <= 1) {
      return escapeHtml(text).replace(/\n/g, "<br>");
    }
    var html = ["<table><tbody>"];
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i] && i === rows.length - 1) {
        continue;
      }
      var cells = hasTabs ? rows[i].split("\t") : [rows[i]];
      html.push("<tr>");
      for (var j = 0; j < cells.length; j++) {
        html.push("<td>" + escapeHtml(cells[j]) + "</td>");
      }
      html.push("</tr>");
    }
    html.push("</tbody></table>");
    return html.join("");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function insertScriptInputHtml(html) {
    els.scriptInput.focus();
    if (document.queryCommandSupported && document.queryCommandSupported("insertHTML")) {
      document.execCommand("insertHTML", false, html);
      return;
    }
    var selection = window.getSelection ? window.getSelection() : null;
    if (!selection || !selection.rangeCount) {
      els.scriptInput.innerHTML += html;
      return;
    }
    var range = selection.getRangeAt(0);
    var holder = document.createElement("div");
    holder.innerHTML = html;
    range.deleteContents();
    while (holder.firstChild) {
      range.insertNode(holder.firstChild);
      range.collapse(false);
    }
  }

  function stripComponentsForPrompt(value) {
    if (!value || typeof value !== "object") {
      return value;
    }
    if (Object.prototype.toString.call(value) === "[object Array]") {
      var arrayCopy = [];
      for (var i = 0; i < value.length; i++) {
        arrayCopy.push(stripComponentsForPrompt(value[i]));
      }
      return arrayCopy;
    }
    var copy = {};
    for (var key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key) || key === "components") {
        continue;
      }
      copy[key] = stripComponentsForPrompt(value[key]);
    }
    return copy;
  }

  function appendMessage(role, text) {
    var message = document.createElement("article");
    message.className = "message " + role;

    var avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.setAttribute("aria-hidden", "true");
    if (role === "assistant") {
      avatar.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10h10a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3zM9 6h6M12 3v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 15h.01M15 15h.01" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
    } else if (role === "user") {
      avatar.textContent = "U";
    } else {
      avatar.textContent = "i";
    }

    var content = document.createElement("div");
    content.className = "message-content";

    var header = document.createElement("div");
    header.className = "message-header";

    var label = document.createElement("span");
    label.className = "role";
    label.textContent = role;

    var copyButton = document.createElement("button");
    copyButton.className = "copy-reply";
    copyButton.type = "button";
    copyButton.title = "Copy message";
    copyButton.setAttribute("aria-label", "Copy message");
    setCopyIcon(copyButton, false);
    copyButton.addEventListener("click", function () {
      copyText(text, copyButton);
    });

    header.appendChild(label);
    header.appendChild(copyButton);
    content.appendChild(header);
    appendMessageBody(content, role, text);
    if (role === "assistant") {
      var credit = responseCreditText();
      if (credit) {
        var meta = document.createElement("div");
        meta.className = "message-credit";
        meta.textContent = credit;
        content.appendChild(meta);
      }
    }
    message.appendChild(avatar);
    message.appendChild(content);
    els.chatLog.appendChild(message);
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
  }

  function appendMessageBody(message, role, text) {
    var bodyWrap = document.createElement("div");
    bodyWrap.className = "message-body";
    var messageInfo = getMessageInfo(role, text);

    if (messageInfo.prose) {
      var prose = document.createElement("div");
      prose.className = "message-text";
      if (role === "assistant") {
        renderMarkdown(prose, messageInfo.prose);
      } else {
        renderPlainMessage(prose, messageInfo.prose);
      }
      bodyWrap.appendChild(prose);
    }

    if (messageInfo.code) {
      var reusableActions = getReusableActions(messageInfo.code);
      var details = document.createElement("details");
      details.className = "code-details";
      details.open = messageInfo.open;
      if (reusableActions) {
        details.className += " reusable-actions";
        details.title = "Click to apply these actions again";
      }

      var summary = document.createElement("summary");
      var summaryText = document.createElement("span");
      summaryText.textContent = messageInfo.summary;
      summary.appendChild(summaryText);

      var pre = document.createElement("pre");
      pre.className = "message-code";
      pre.textContent = messageInfo.code;
      if (reusableActions) {
        pre.addEventListener("click", function () {
          stageReusableActions(reusableActions);
        });
      }

      details.appendChild(summary);
      details.appendChild(pre);
      bodyWrap.appendChild(details);
    }

    message.appendChild(bodyWrap);
  }

  function getMessageInfo(role, text) {
    var value = String(text || "");
    var lowered = value.toLowerCase();
    var codePrefixes = ["applied:\n", "preview:\n", "undid last apply:\n"];
    var isCommandOutput = role === "system" && (
      lowered.indexOf("command exited with code") === 0 ||
      lowered.indexOf("home=") === 0 ||
      lowered.indexOf("stdout:") !== -1 ||
      lowered.indexOf("stderr:") !== -1
    );

    for (var i = 0; i < codePrefixes.length; i++) {
      if (lowered.indexOf(codePrefixes[i]) === 0) {
        return {
          prose: "",
          summary: value.slice(0, value.indexOf("\n")),
          code: value.slice(value.indexOf("\n") + 1),
          open: false
        };
      }
    }

    if (isCommandOutput) {
      return {
        prose: "",
        summary: "Command output",
        code: value,
        open: false
      };
    }

    if (role === "user" && value.indexOf("\n\nScript/table input:\n") !== -1) {
      var scriptMarker = "\n\nScript/table input:\n";
      var scriptStart = value.indexOf(scriptMarker);
      var beforeScript = value.slice(0, scriptStart);
      var scriptAndAfter = value.slice(scriptStart + scriptMarker.length);
      var imagesMarker = "\n\nImages:";
      var imagesStart = scriptAndAfter.indexOf(imagesMarker);
      var scriptText = imagesStart === -1 ? scriptAndAfter : scriptAndAfter.slice(0, imagesStart);
      var afterScript = imagesStart === -1 ? "" : scriptAndAfter.slice(imagesStart);
      return {
        prose: beforeScript + "\n\nScript/table input attached." + afterScript,
        summary: "Script/table input",
        code: scriptText,
        open: false
      };
    }

    if (role === "assistant" && value.indexOf("{") !== -1 && (value.indexOf("scriptEdits") !== -1 || value.indexOf("scriptHtml") !== -1 || value.indexOf("scriptTable") !== -1) && value.indexOf("actions") === -1) {
      var scriptEditPayload = null;
      try {
        scriptEditPayload = extractJson(value);
      } catch (err) {
        scriptEditPayload = null;
      }
      return {
        prose: scriptValidationActionText(scriptEditPayload, value),
        summary: "Script edit response",
        code: value,
        open: false
      };
    }

    if (role === "assistant" && value.indexOf("{") !== -1 && (value.indexOf("actions") !== -1 || value.indexOf("scriptEdits") !== -1 || value.indexOf("scriptHtml") !== -1 || value.indexOf("scriptTable") !== -1)) {
      var split = splitProseAndCode(value);
      return {
        prose: split.prose,
        summary: split.summary,
        code: split.code,
        open: false
      };
    }

    return { prose: value, summary: "", code: "", open: false };
  }

  function renderPlainMessage(container, text) {
    var lines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    var paragraph = [];

    function flushParagraph() {
      if (!paragraph.length) {
        return;
      }
      var p = document.createElement("p");
      p.textContent = paragraph.join("\n");
      container.appendChild(p);
      paragraph = [];
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line.replace(/^\s+|\s+$/g, "")) {
        flushParagraph();
        continue;
      }
      if (line.indexOf("\t") !== -1) {
        flushParagraph();
        var tableRows = [];
        while (i < lines.length && lines[i].indexOf("\t") !== -1) {
          tableRows.push(splitDelimitedTableRow(lines[i], "\t"));
          i++;
        }
        i--;
        container.appendChild(renderPlainTable(tableRows));
        continue;
      }
      paragraph.push(line);
    }

    flushParagraph();
  }

  function splitDelimitedTableRow(line, delimiter) {
    var cells = String(line || "").split(delimiter);
    for (var i = 0; i < cells.length; i++) {
      cells[i] = cells[i].replace(/^\s+|\s+$/g, "");
    }
    return cells;
  }

  function renderPlainTable(rows) {
    var wrap = document.createElement("div");
    wrap.className = "md-table-wrap plain-table-wrap";
    var table = document.createElement("table");
    table.className = "md-table plain-table";
    var tbody = document.createElement("tbody");

    for (var r = 0; r < rows.length; r++) {
      var tr = document.createElement("tr");
      for (var c = 0; c < rows[r].length; c++) {
        var cell = document.createElement(r === 0 ? "th" : "td");
        cell.textContent = rows[r][c];
        tr.appendChild(cell);
      }
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function splitProseAndCode(value) {
    var fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      return {
        prose: value.replace(fenced[0], "").replace(/^\s+|\s+$/g, ""),
        summary: "Actions JSON",
        code: fenced[1].replace(/^\s+|\s+$/g, "")
      };
    }

    var first = value.indexOf("{");
    var last = value.lastIndexOf("}");
    if (first !== -1 && last > first) {
      return {
        prose: value.slice(0, first).replace(/^\s+|\s+$/g, ""),
        summary: "Actions JSON",
        code: value.slice(first, last + 1)
      };
    }

    return { prose: value, summary: "", code: "" };
  }

  function getReusableActions(code) {
    try {
      var parsed = JSON.parse(code);
      if (parsed && parsed.actions && parsed.actions.length) {
        return parsed;
      }
    } catch (err) {
    }
    return null;
  }

  function stageReusableActions(payload) {
    setPendingActions(payload);
    setStatus("Actions staged from previous response. Applying automatically...");
    applyJson();
  }

  function renderMarkdown(container, text) {
    var lines = String(text || "").split(/\r?\n/);
    var paragraph = [];

    function flushParagraph() {
      if (!paragraph.length) {
        return;
      }
      var p = document.createElement("p");
      appendInlineMarkdown(p, paragraph.join("\n"));
      container.appendChild(p);
      paragraph = [];
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.replace(/^\s+|\s+$/g, "");

      if (!trimmed) {
        flushParagraph();
        continue;
      }

      if (/^---+$/.test(trimmed)) {
        flushParagraph();
        container.appendChild(document.createElement("hr"));
        continue;
      }

      if (/^\*\*.+\*\*$/.test(trimmed)) {
        flushParagraph();
        var heading = document.createElement("h3");
        appendInlineMarkdown(heading, trimmed.replace(/^\*\*|\*\*$/g, ""));
        container.appendChild(heading);
        continue;
      }

      if (/^#{1,4}\s+/.test(trimmed)) {
        flushParagraph();
        var h = document.createElement("h3");
        appendInlineMarkdown(h, trimmed.replace(/^#{1,4}\s+/, ""));
        container.appendChild(h);
        continue;
      }

      if (/^>\s?/.test(trimmed)) {
        flushParagraph();
        var quote = document.createElement("blockquote");
        appendInlineMarkdown(quote, trimmed.replace(/^>\s?/, ""));
        container.appendChild(quote);
        continue;
      }

      if (isMarkdownTableStart(lines, i)) {
        flushParagraph();
        var tableInfo = collectMarkdownTable(lines, i);
        container.appendChild(renderMarkdownTable(tableInfo.rows));
        i = tableInfo.endIndex;
        continue;
      }

      if (/^[-*]\s+/.test(trimmed)) {
        flushParagraph();
        var list = document.createElement("ul");
        while (i < lines.length && /^[-*]\s+/.test(lines[i].replace(/^\s+|\s+$/g, ""))) {
          var li = document.createElement("li");
          appendInlineMarkdown(li, lines[i].replace(/^\s*[-*]\s+/, ""));
          list.appendChild(li);
          i++;
        }
        i--;
        container.appendChild(list);
        continue;
      }

      paragraph.push(trimmed);
    }

    flushParagraph();
  }

  function appendInlineMarkdown(parent, text) {
    var parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (!part) {
        continue;
      }
      if (/^\*\*[^*]+\*\*$/.test(part)) {
        var strong = document.createElement("strong");
        strong.textContent = part.slice(2, -2);
        parent.appendChild(strong);
      } else if (/^`[^`]+`$/.test(part)) {
        var code = document.createElement("code");
        code.textContent = part.slice(1, -1);
        parent.appendChild(code);
      } else {
        parent.appendChild(document.createTextNode(part));
      }
    }
  }

  function isMarkdownTableStart(lines, index) {
    if (index + 1 >= lines.length) {
      return false;
    }
    var header = lines[index].replace(/^\s+|\s+$/g, "");
    var divider = lines[index + 1].replace(/^\s+|\s+$/g, "");
    return header.indexOf("|") !== -1 && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(divider);
  }

  function collectMarkdownTable(lines, startIndex) {
    var rows = [];
    var i = startIndex;
    while (i < lines.length && lines[i].indexOf("|") !== -1 && lines[i].replace(/^\s+|\s+$/g, "")) {
      if (i !== startIndex + 1) {
        rows.push(splitMarkdownTableRow(lines[i]));
      }
      i++;
    }
    return { rows: rows, endIndex: i - 1 };
  }

  function splitMarkdownTableRow(line) {
    var trimmed = line.replace(/^\s+|\s+$/g, "");
    if (trimmed.charAt(0) === "|") {
      trimmed = trimmed.slice(1);
    }
    if (trimmed.charAt(trimmed.length - 1) === "|") {
      trimmed = trimmed.slice(0, -1);
    }
    var cells = trimmed.split("|");
    for (var i = 0; i < cells.length; i++) {
      cells[i] = cells[i].replace(/^\s+|\s+$/g, "");
    }
    return cells;
  }

  function renderMarkdownTable(rows) {
    var wrap = document.createElement("div");
    wrap.className = "md-table-wrap";
    var table = document.createElement("table");
    table.className = "md-table";
    var thead = document.createElement("thead");
    var tbody = document.createElement("tbody");

    for (var r = 0; r < rows.length; r++) {
      var tr = document.createElement("tr");
      for (var c = 0; c < rows[r].length; c++) {
        var cell = document.createElement(r === 0 ? "th" : "td");
        appendInlineMarkdown(cell, rows[r][c]);
        tr.appendChild(cell);
      }
      if (r === 0) {
        thead.appendChild(tr);
      } else {
        tbody.appendChild(tr);
      }
    }

    table.appendChild(thead);
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function copyText(text, button) {
    function copied() {
      setCopyIcon(button, true);
      window.setTimeout(function () {
        setCopyIcon(button, false);
      }, 1200);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(copied).catch(function () {
        fallbackCopyText(text);
        copied();
      });
      return;
    }
    fallbackCopyText(text);
    copied();
  }

  function setCopyIcon(button, copied) {
    if (copied) {
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      button.title = "Copied";
      return;
    }
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    button.title = "Copy message";
  }

  function fallbackCopyText(text) {
    var temp = document.createElement("textarea");
    temp.value = text;
    temp.setAttribute("readonly", "readonly");
    temp.style.position = "fixed";
    temp.style.left = "-9999px";
    document.body.appendChild(temp);
    temp.select();
    document.execCommand("copy");
    document.body.removeChild(temp);
  }

  function renderAttachments() {
    els.attachments.innerHTML = "";
    for (var i = 0; i < imageAttachments.length; i++) {
      (function (attachment, index) {
        var item = document.createElement("div");
        item.className = "attachment";

        var thumb = document.createElement("img");
        thumb.src = attachment.preview || "";
        thumb.alt = "";

        var label = document.createElement("span");
        label.textContent = attachment.name || attachment.path;

        var remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "x";
        remove.title = "Remove image";
        remove.addEventListener("click", function () {
          imageAttachments.splice(index, 1);
          renderAttachments();
        });

        item.appendChild(thumb);
        item.appendChild(label);
        item.appendChild(remove);
        els.attachments.appendChild(item);
      })(imageAttachments[i], i);
    }
  }

  function addImageFiles(files) {
    for (var i = 0; i < files.length; i++) {
      (function (file) {
        var reader = new FileReader();
        reader.onload = function (event) {
          var path = file.path || "";
          if (!path) {
            path = persistImageAttachment(file.name, event.target.result);
          }
          imageAttachments.push({
            name: file.name,
            path: path,
            preview: event.target.result
          });
          renderAttachments();
        };
        reader.readAsDataURL(file);
      })(files[i]);
    }
  }

  function persistImageAttachment(name, dataUrl) {
    var nodeRequire = getNodeRequire();
    if (!nodeRequire) {
      return "";
    }
    var fs = nodeRequire("fs");
    var os = nodeRequire("os");
    var path = nodeRequire("path");
    var extension = path.extname(name || "") || ".png";
    var safeName = "pr-ai-" + Date.now() + "-" + Math.floor(Math.random() * 100000) + extension;
    var outputPath = path.join(os.tmpdir(), safeName);
    var base64 = String(dataUrl).replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
    fs.writeFileSync(outputPath, base64, "base64");
    return outputPath;
  }

  function requestRequiresXml(text) {
    var value = String(text || "").toLowerCase();
    return /\bxml\b/.test(value) || /\bxmeml\b/.test(value) || /\bcreateStyledTextXml\b/i.test(String(text || ""));
  }

  function requestAllowsGraphicText(text) {
    var value = String(text || "").toLowerCase();
    return requestRequiresXml(text) ||
      /\bmogrt\b/.test(value) ||
      /\btemplate\b/.test(value) ||
      /\bessential graphics\b/.test(value) ||
      /\bgraphic(?:s)?\b/.test(value) ||
      /\bmask\b/.test(value) ||
      /\bfeather\b/.test(value) ||
      /\bsetGraphicText\b/i.test(String(text || "")) ||
      /\bsetGraphicProperty\b/i.test(String(text || "")) ||
      /\blistGraphicProperties\b/i.test(String(text || ""));
  }

  function requestAllowsSvg(text) {
    var value = String(text || "").toLowerCase();
    return /\bsvg\b/.test(value) || /\bnon[- ]editable\b/.test(value) || /\bvisual asset\b/.test(value) || /\bmedia asset\b/.test(value);
  }

  function guardTextAssetActions(payload) {
    var normalized = normalizeActionPayload(payload);
    if (!normalized.actions || !normalized.actions.length) {
      return normalized;
    }
    var allowSvg = requestAllowsSvg(activeUserRequest);
    var allowGraphicText = requestAllowsGraphicText(activeUserRequest);
    var filtered = [];
    var blockedSvg = 0;
    var blockedGraphics = 0;
    for (var i = 0; i < normalized.actions.length; i++) {
      if (normalized.actions[i] && normalized.actions[i].type === "createStyledTextSvg") {
        if (allowSvg) {
          filtered.push(normalized.actions[i]);
        } else {
          blockedSvg++;
        }
      } else if (normalized.actions[i] && !allowGraphicText && (
        normalized.actions[i].type === "createStyledTextXml" ||
        normalized.actions[i].type === "insertMogrt" ||
        normalized.actions[i].type === "createTextGraphic"
      )) {
        blockedGraphics++;
      } else {
        filtered.push(normalized.actions[i]);
      }
    }
    if (blockedSvg) {
      appendMessage("system", "Blocked createStyledTextSvg. SVG is opt-in only; ask for SVG/non-editable media explicitly.");
      setStatus("Blocked SVG action.", true);
    }
    if (blockedGraphics) {
      appendMessage("system", "Blocked graphic-layer text creation. Use importSrtFile/importCaptionFile for inserted text/subtitles, or explicitly ask for XML/MOGRT/graphics.");
      setStatus("Blocked graphic text action.", true);
    }
    normalized.actions = filtered;
    return normalized;
  }

  function setPendingActions(payload) {
    pendingActions = attachTextTempFolder(ensureScriptTextAction(preserveImportedSrtActions(applyAssemblyDefaults(applyRequestActionOptions(guardTextAssetActions(payload))))));
  }

  function preserveImportedSrtActions(payload) {
    if (!payload || !payload.actions || !payload.actions.length) {
      return payload;
    }
    for (var i = 0; i < payload.actions.length; i++) {
      var action = payload.actions[i];
      if (!action) {
        continue;
      }
      if (action.type === "importSrtFile" || action.type === "importCaptionFile" || action.type === "addSubtitleLayer" || action.type === "createCaptionTrack") {
        action.cleanupAfterImport = false;
        action.removeProjectItemAfterCaptionTrack = false;
        action.deleteSrtAfterImport = false;
      }
    }
    return payload;
  }

  function applyAssemblyDefaults(payload) {
    if (!payload || !payload.actions || !payload.actions.length) {
      return payload;
    }
    for (var i = 0; i < payload.actions.length; i++) {
      var action = payload.actions[i];
      if (action && action.type === "assembleFromScript") {
        action.skipMissing = true;
        action.skipInvalid = true;
        action.continueOnError = true;
        action.preserveSkippedGaps = true;
      }
    }
    return payload;
  }

  function requestWantsInvalidItemsSkipped(text) {
    var value = String(text || "").toLowerCase();
    return /\b(ignore|skip|omit|exclude|continue|proceed)\b/.test(value) &&
      /\b(missing|not found|couldn'?t find|cannot find|can't find|unresolved|invalid|couldn'?t validate|cannot validate|can't validate|unvalidated)\b/.test(value);
  }

  function applyRequestActionOptions(payload) {
    if (!payload || !payload.actions || !payload.actions.length || !requestWantsInvalidItemsSkipped(activeUserRequest)) {
      return payload;
    }
    for (var i = 0; i < payload.actions.length; i++) {
      var action = payload.actions[i];
      if (action && action.type === "assembleFromScript") {
        action.skipMissing = true;
        action.skipInvalid = true;
        action.continueOnError = true;
        action.preserveSkippedGaps = true;
      }
    }
    return payload;
  }

  function requestShouldUseScriptTextAction() {
    var value = String(activeUserRequest || "").toLowerCase();
    var modes = workflowModesForRequest(value, activeQuickModes());
    return modes.indexOf("auto-cut") !== -1 ||
      modes.indexOf("auto-cut-textbound") !== -1 ||
      modes.indexOf("auto-subtitle-layout") !== -1 ||
      /\b(text|caption|subtitle|srt|overlay)\b/.test(value);
  }

  function ensureScriptTextAction(payload) {
    if (!payload || !payload.actions || !payload.actions.length || !requestShouldUseScriptTextAction()) {
      return payload;
    }
    var hasAssembly = false;
    var hasTextAction = false;
    for (var i = 0; i < payload.actions.length; i++) {
      var type = payload.actions[i] && payload.actions[i].type;
      if (type === "assembleFromScript" || type === "insertClipRange" || type === "overwriteClipRange" || type === "insertProjectItem") {
        hasAssembly = true;
      }
      if (type === "importSrtFile" || type === "importCaptionFile" || type === "cutAudioAndTimeSubtitles" || type === "transcribeAudioTrackToSrt") {
        hasTextAction = true;
      }
    }
    if (!hasAssembly || hasTextAction) {
      return payload;
    }
    var scriptPayload = getScriptInputPayload();
    if (scriptPayload.cutTimedSrtPlan && scriptPayload.cutTimedSrtPlan.srt && scriptPayload.cutTimedSrtPlan.srt.replace(/\s+/g, "")) {
      payload.actions.push({
        type: "importSrtFile",
        contents: scriptPayload.cutTimedSrtPlan.srt,
        startAtTime: 0,
        createCaptionTrack: true,
        allowCaptionTrackCreate: true,
        suppressUI: true,
        cleanupAfterImport: false,
        removeProjectItemAfterCaptionTrack: false,
        source: "scriptAutoText"
      });
      appendMessage("system", "Added cut-timed text captions from the selected script.");
    }
    return payload;
  }

  function updateUndoButton() {
    els.undoBtn.disabled = !undoStack.length;
  }

  function toggleMaximized() {
    var app = document.querySelector(".app");
    var enabled = !app.className.match(/\bis-maximized\b/);
    app.className = enabled ? app.className + " is-maximized" : app.className.replace(/\s*\bis-maximized\b/g, "");
    if (els.maxBtn) {
      els.maxBtn.textContent = enabled ? "Exit" : "Max";
    }
    setStatus(enabled ? "Focus mode on. Press ` to exit." : "Focus mode off.");
  }

  function isBackquoteShortcut(event) {
    return !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      (event.key === "`" || event.code === "Backquote" || event.keyCode === 192 || event.which === 192);
  }

  function handleGlobalShortcutKeys(event) {
    if (els.scriptEditorOverlay && !els.scriptEditorOverlay.hidden && (sheetEditMode || isEditableTarget(event.target))) {
      return;
    }
    if (isBackquoteShortcut(event)) {
      event.preventDefault();
      if (event.stopImmediatePropagation) {
        event.stopImmediatePropagation();
      } else {
        event.stopPropagation();
      }
      toggleMaximized();
    }
  }

  function parseTrackIndex(text, fallback) {
    var vMatch = text.match(/\b[va](\d+)\b/i);
    if (vMatch) {
      return Math.max(0, Number(vMatch[1]) - 1);
    }
    var trackMatch = text.match(/\btrack\s*(\d+)\b/i);
    if (trackMatch) {
      return Number(trackMatch[1]);
    }
    var plainMatch = text.match(/\b(?:video|audio)\s+(\d+)\b/i);
    if (plainMatch) {
      return Number(plainMatch[1]);
    }
    return fallback || 0;
  }

  function parseActionString(value) {
    var text = String(value).replace(/^\s+|\s+$/g, "");
    var lower = text.toLowerCase();
    var trackType = /\baudio\b|\ba\d+\b/i.test(text) ? "audio" : "video";
    var trackIndex = parseTrackIndex(text, 0);
    var clipMatch = text.match(/\bclip\s*(\d+)\b/i);
    var clipIndex = clipMatch ? Number(clipMatch[1]) : 0;
    var secondsMatches = text.match(/-?\d+(?:\.\d+)?/g) || [];
    var lastNumber = secondsMatches.length ? Number(secondsMatches[secondsMatches.length - 1]) : 0;

    if (lower.indexOf("set") !== -1 && lower.indexOf("in") !== -1 && lower.indexOf("out") !== -1) {
      var inMatch = text.match(/\bin\s*(?:at|to)?\s*(-?\d+(?:\.\d+)?)/i);
      var outMatch = text.match(/\bout\s*(?:at|to)?\s*(-?\d+(?:\.\d+)?)/i);
      return { type: "setSequenceInOut", inSeconds: inMatch ? Number(inMatch[1]) : 0, outSeconds: outMatch ? Number(outMatch[1]) : lastNumber };
    }
    if (lower.indexOf("clear") !== -1 && lower.indexOf("in") !== -1 && lower.indexOf("out") !== -1) {
      return { type: "clearSequenceInOut" };
    }
    if (lower.indexOf("trim") !== -1) {
      var trim = { type: lower.indexOf("ripple") !== -1 ? "rippleTrimClip" : "trimClip", trackType: trackType, trackIndex: trackIndex, clipIndex: clipIndex };
      if (/\bstart\b|\bbegin/.test(lower)) {
        trim.startSeconds = lastNumber;
      } else if (/\bin\s*point\b|\binpoint\b/.test(lower)) {
        trim.inPointSeconds = lastNumber;
      } else if (/\bout\s*point\b|\bendpoint\b|\boutpoint\b/.test(lower)) {
        trim.outPointSeconds = lastNumber;
      } else {
        trim.endSeconds = lastNumber;
      }
      return trim;
    }
    if (lower.indexOf("move") !== -1) {
      return { type: "moveClip", trackType: trackType, trackIndex: trackIndex, clipIndex: clipIndex, startSeconds: lastNumber };
    }
    if (lower.indexOf("split") !== -1 || lower.indexOf("razor") !== -1) {
      return { type: "splitClip", trackType: trackType, trackIndex: trackIndex, clipIndex: clipIndex, seconds: lastNumber };
    }
    if (lower.indexOf("delete") !== -1 || lower.indexOf("remove clip") !== -1) {
      return { type: "deleteClip", trackType: trackType, trackIndex: trackIndex, clipIndex: clipIndex, ripple: lower.indexOf("ripple") !== -1 };
    }
    if (lower.indexOf("disable") !== -1 || lower.indexOf("enable") !== -1) {
      return { type: "setClipEnabled", trackType: trackType, trackIndex: trackIndex, clipIndex: clipIndex, enabled: lower.indexOf("disable") === -1 };
    }
    if (lower.indexOf("marker") !== -1) {
      return { type: "addSequenceMarker", name: text, comment: "", seconds: lastNumber };
    }
    return { type: "note", text: text };
  }

  function normalizeActionPayload(payload) {
    var actions = [];
    var source = payload && payload.actions ? payload.actions : [];

    if (typeof payload === "string") {
      source = payload.split(/\n+/);
    } else if (payload && typeof payload.action === "string") {
      source = [payload.action];
    }

    for (var i = 0; i < source.length; i++) {
      var action = source[i];
      if (typeof action === "string") {
        action = parseActionString(action);
      }
      action = normalizeActionObject(action);
      if (action && action.type && action.type !== "note") {
        actions.push(action);
      }
    }
    return { actions: actions };
  }

  function normalizeActionObject(action) {
    if (!action || !action.type) {
      return action;
    }

    if (action.trackIndex === undefined || action.trackIndex === null || action.trackIndex === "") {
      if (action.videoTrackIndex !== undefined && action.videoTrackIndex !== null && action.videoTrackIndex !== "") {
        action.trackIndex = action.videoTrackIndex;
      } else if (action.audioTrackIndex !== undefined && action.audioTrackIndex !== null && action.audioTrackIndex !== "") {
        action.trackIndex = action.audioTrackIndex;
      } else if (action.track !== undefined && action.track !== null && action.track !== "" && !/^A\s*\d+$/i.test(String(action.track))) {
        action.trackIndex = action.track;
      }
    }

    if (action.seconds === undefined && action.startSeconds !== undefined && (
      action.type === "insertProjectItem" ||
      action.type === "insertClipRange" ||
      action.type === "overwriteClipRange" ||
      action.type === "insertMogrt" ||
      action.type === "importMediaFile"
    )) {
      action.seconds = action.startSeconds;
    }

    if (action.inPointSeconds === undefined && action.in !== undefined) {
      action.inPointSeconds = action.in;
    }
    if (action.outPointSeconds === undefined && action.out !== undefined) {
      action.outPointSeconds = action.out;
    }

    if (!action.projectItemName && (action.sourceName || action.source)) {
      action.projectItemName = action.sourceName || action.source;
    }

    if (action.type === "muteAudioClip") {
      action.type = "setClipEnabled";
      action.trackType = "audio";
      action.enabled = false;
      return action;
    }

    if (action.type !== "audio") {
      return action;
    }

    var operation = String(action.operation || action.action || action.command || "").toLowerCase();
    action.trackType = "audio";

    if (operation.indexOf("gain") !== -1 || operation.indexOf("volume") !== -1 || action.gainDb !== undefined || action.levelDb !== undefined) {
      action.type = "setAudioGain";
      action.gainDb = action.gainDb !== undefined ? action.gainDb : action.levelDb;
    } else if (operation.indexOf("mute") !== -1 || operation.indexOf("disable") !== -1 || action.mute === true) {
      action.type = "setClipEnabled";
      action.enabled = false;
    } else if (operation.indexOf("delete") !== -1 || operation.indexOf("remove") !== -1) {
      action.type = "deleteClip";
    } else if (operation.indexOf("trim") !== -1) {
      action.type = "trimClip";
    } else if (operation.indexOf("split") !== -1 || operation.indexOf("razor") !== -1) {
      action.type = "splitClip";
    } else {
      action.type = "moveClip";
    }

    return action;
  }

  function summarizeApplyFailures(data) {
    var failed = data && data.failed ? data.failed : [];
    if (!failed.length) {
      return "";
    }
    var parts = [];
    for (var i = 0; i < failed.length && i < 3; i++) {
      var item = failed[i] || {};
      var type = item.type || "action";
      var error = String(item.error || "failed").replace(/^Error:\s*/i, "");
      parts.push(type + ": " + error);
    }
    if (failed.length > 3) {
      parts.push("+" + (failed.length - 3) + " more");
    }
    return parts.join(" | ");
  }

  function summarizeApplySkips(data) {
    var applied = data && data.applied ? data.applied : [];
    var total = 0;
    var examples = [];
    for (var i = 0; i < applied.length; i++) {
      var item = applied[i] || {};
      if (item.skippedCount) {
        total += Number(item.skippedCount || 0);
        var skipped = item.skipped || [];
        for (var s = 0; s < skipped.length && examples.length < 3; s++) {
          examples.push((skipped[s].source || "item") + ": " + (skipped[s].reason || "skipped"));
        }
      }
    }
    if (!total) {
      return "";
    }
    if (total > examples.length) {
      examples.push("+" + (total - examples.length) + " more");
    }
    return "Skipped " + total + " invalid/missing clip(s). " + examples.join(" | ");
  }

  function evalHost(functionName, payload) {
    return new Promise(function (resolve) {
      var safeFunctionName = String(functionName || "").replace(/[^A-Za-z0-9_]/g, "");
      var json = payload ? JSON.stringify(payload) : "";
      var script = "";
      var nodeRequire = getNodeRequire();
      var hostPath = "";
      if (nodeRequire) {
        try {
          hostPath = praiHostJsxPath(nodeRequire).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        } catch (hostPathErr) {
          hostPath = "";
        }
      }
      var ensureHost = hostPath ? "if(typeof " + safeFunctionName + "!='function'||typeof prAI_hostVersion=='undefined'||prAI_hostVersion!='20261120-agent-menu1'){$.evalFile('" + hostPath + "');}" : "";
      var errorReturn = "return '{\"ok\":false,\"data\":null,\"error\":\"' + String(err).replace(/\\\\/g,'\\\\\\\\').replace(/\"/g,'\\\\\"').replace(/\\r/g,' ').replace(/\\n/g,' ') + '\"}';";
      if (payload && nodeRequire) {
        try {
          var fs = nodeRequire("fs");
          var os = nodeRequire("os");
          var path = nodeRequire("path");
          var tempPath = path.join(os.tmpdir(), "PR_AI_eval_" + Date.now() + "_" + Math.floor(Math.random() * 1000000000) + ".json");
          fs.writeFileSync(tempPath, json, "utf8");
          var escapedPath = tempPath.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
          script = "(function(){try{" + ensureHost + "var f=new File('" + escapedPath + "');f.encoding='UTF-8';if(!f.open('r')){return '{\"ok\":false,\"data\":null,\"error\":\"Could not open host payload file.\"}';}var t=f.read();f.close();try{f.remove();}catch(e){}return " + safeFunctionName + "(t);}catch(err){" + errorReturn + "}}())";
        } catch (fileErr) {
          script = "";
        }
      }
      if (!script) {
        var arg = payload ? JSON.stringify(json).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029") : "";
        script = payload ? "(function(){try{" + ensureHost + "return " + safeFunctionName + "(" + arg + ");}catch(err){" + errorReturn + "}}())" : "(function(){try{" + ensureHost + "return " + safeFunctionName + "();}catch(err){" + errorReturn + "}}())";
      }
      cs.evalScript(script, function (result) {
        try {
          resolve(JSON.parse(result));
        } catch (err) {
          resolve({ ok: false, error: "Invalid host response: " + result });
        }
      });
    });
  }

  function getNodeRequire() {
    if (typeof window.cep_node !== "undefined") {
      return window.cep_node.require;
    }
    if (typeof require !== "undefined") {
      return require;
    }
    return null;
  }

  function shellQuote(value) {
    return "'" + String(value).replace(/'/g, "'\\''") + "'";
  }

  function buildCodexHomeCommand(nodeRequire) {
    var os = nodeRequire("os");
    var path = nodeRequire("path");
    var home = os.homedir();
    var codexHome = path.join(os.tmpdir(), "PR_AI_Codex");
    return [
      "export CODEX_HOME=" + shellQuote(codexHome),
      "mkdir -p \"$CODEX_HOME\"",
      "[ -f " + shellQuote(home + "/.codex/auth.json") + " ] && cp " + shellQuote(home + "/.codex/auth.json") + " \"$CODEX_HOME/auth.json\" || true",
      "[ -f " + shellQuote(home + "/.codex/config.toml") + " ] && cp " + shellQuote(home + "/.codex/config.toml") + " \"$CODEX_HOME/config.toml\" || true",
      "chmod 700 \"$CODEX_HOME\" || true"
    ].join("\n");
  }

  function buildImageArgs(imagePaths) {
    var args = "";
    for (var i = 0; i < imagePaths.length; i++) {
      if (imagePaths[i]) {
        args += " -i " + shellQuote(imagePaths[i]);
      }
    }
    return args;
  }

  function buildImageDirectoryArgs(nodeRequire, imagePaths) {
    var path = nodeRequire("path");
    var seen = {};
    var args = "";
    for (var i = 0; i < imagePaths.length; i++) {
      if (!imagePaths[i]) {
        continue;
      }
      var dir = path.dirname(imagePaths[i]);
      if (!seen[dir]) {
        seen[dir] = true;
        args += " --add-dir " + shellQuote(dir);
      }
    }
    return args;
  }

  function codexBundleLookupCommand(varName) {
    return varName + "=$(find \"$HOME/.vscode/extensions\" -path '*/bin/macos-aarch64/codex' -type f -perm -111 2>/dev/null | sort -r | head -n 1)";
  }

  /* Lean mode is for short structured jobs (validation, caption split): no
     tools, no MCP servers, no skills, no user settings or CLAUDE.md, a one-line
     system prompt and low effort. The model stays the user's choice. */
  var leanClaudeArgs = " --tools \"\" --strict-mcp-config --disable-slash-commands --setting-sources \"\" --effort low" +
    " --system-prompt 'You are a fast data-cleanup helper for a Premiere Pro script sheet. Reply with exactly one JSON object and nothing else.'";

  function getCliCommand(provider, nodeRequire, imagePaths, options) {
    var lean = !!(options && options.lean);
    var home = nodeRequire("os").homedir();
    var claudeFallback = home + "/.local/bin/claude";
    var codexImageArgs = buildImageArgs(imagePaths || []);
    var codexImageDirectoryArgs = buildImageDirectoryArgs(nodeRequire, imagePaths || []);
    var codexHomeCommand = buildCodexHomeCommand(nodeRequire);
    var model = getAiModel(provider);
    var mode = getAiMode(provider);
    var claudeModelArgs = model ? " --model " + shellQuote(model) : "";
    var claudeModeArgs = "";
    if (lean) {
      claudeModeArgs = leanClaudeArgs;
    } else if (mode && mode.indexOf("effort:") === 0) {
      claudeModeArgs = " --effort " + shellQuote(mode.replace(/^effort:/, ""));
    } else if (mode && mode.indexOf("permission:") === 0) {
      claudeModeArgs = " --permission-mode " + shellQuote(mode.replace(/^permission:/, ""));
    }
    var codexModelArgs = model ? " -m " + shellQuote(model) : "";

    if (provider === "claude") {
      return [
        "export PATH=\"$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH\"",
        "unset ANTHROPIC_API_KEY",
        "unset ANTHROPIC_AUTH_TOKEN",
        "unset ANTHROPIC_BASE_URL",
        "unset ANTHROPIC_BEDROCK_BASE_URL",
        "unset ANTHROPIC_VERTEX_BASE_URL",
        "if command -v claude >/dev/null 2>&1; then",
        "  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 claude -p --no-session-persistence" + claudeModelArgs + claudeModeArgs,
        "elif [ -x " + shellQuote(claudeFallback) + " ]; then",
        "  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 " + shellQuote(claudeFallback) + " -p --no-session-persistence" + claudeModelArgs + claudeModeArgs,
        "else",
        "  echo 'claude command not found. Install Claude Code or add it to PATH.' >&2",
        "  exit 127",
        "fi"
      ].join("\n");
    }

    return [
      "export PATH=\"$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH\"",
      codexHomeCommand,
      codexBundleLookupCommand("CODEX_BUNDLE"),
      "if command -v codex >/dev/null 2>&1; then",
      "  codex exec --skip-git-repo-check --ephemeral -s workspace-write -C \"$HOME\"" + codexModelArgs + codexImageDirectoryArgs + codexImageArgs + " -",
      "elif [ -n \"$CODEX_BUNDLE\" ] && [ -x \"$CODEX_BUNDLE\" ]; then",
      "  \"$CODEX_BUNDLE\" exec --skip-git-repo-check --ephemeral -s workspace-write -C \"$HOME\"" + codexModelArgs + codexImageDirectoryArgs + codexImageArgs + " -",
      "else",
      "  echo 'codex command not found. Install Codex CLI, add it to PATH, or install/update the OpenAI ChatGPT VS Code extension.' >&2",
      "  exit 127",
      "fi"
    ].join("\n");
  }

  /* PR AI agent chat (agent/chat.js builds args): one streamed, resumable turn
     with the prai MCP server attached. Same PATH, env scrubbing and CLI lookup
     as getCliCommand; that function and the one-shot path stay unchanged. */
  function getChatCliCommand(provider, args, cwd) {
    var nodeRequire = getNodeRequire();
    var home = nodeRequire("os").homedir();
    var claudeFallback = home + "/.local/bin/claude";
    var quoted = [];
    for (var i = 0; i < args.length; i++) {
      quoted.push(shellQuote(args[i]));
    }
    var argText = quoted.join(" ");
    var cd = cwd ? "cd " + shellQuote(cwd) + " || exit 1" : "true";
    if (provider === "claude") {
      return [
        "export PATH=\"$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH\"",
        "unset ANTHROPIC_API_KEY",
        "unset ANTHROPIC_AUTH_TOKEN",
        "unset ANTHROPIC_BASE_URL",
        "unset ANTHROPIC_BEDROCK_BASE_URL",
        "unset ANTHROPIC_VERTEX_BASE_URL",
        "export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1",
        "export MCP_TOOL_TIMEOUT=1800000",
        "export MCP_TIMEOUT=30000",
        cd,
        "if command -v claude >/dev/null 2>&1; then",
        "  exec claude " + argText,
        "elif [ -x " + shellQuote(claudeFallback) + " ]; then",
        "  exec " + shellQuote(claudeFallback) + " " + argText,
        "else",
        "  echo 'claude command not found. Install Claude Code or add it to PATH.' >&2",
        "  exit 127",
        "fi"
      ].join("\n");
    }
    return [
      "export PATH=\"$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH\"",
      buildCodexHomeCommand(nodeRequire),
      codexBundleLookupCommand("CODEX_BUNDLE"),
      cd,
      "if command -v codex >/dev/null 2>&1; then",
      "  exec codex " + argText,
      "elif [ -n \"$CODEX_BUNDLE\" ] && [ -x \"$CODEX_BUNDLE\" ]; then",
      "  exec \"$CODEX_BUNDLE\" " + argText,
      "else",
      "  echo 'codex command not found. Install Codex CLI, add it to PATH, or install/update the OpenAI ChatGPT VS Code extension.' >&2",
      "  exit 127",
      "fi"
    ].join("\n");
  }

  function providerStageName(provider) {
    return provider === "claude" ? "claudeTest" : "codexTest";
  }

  function selectedAiTestProvider() {
    var value = String(els.aiTestProvider && els.aiTestProvider.value ? els.aiTestProvider.value : "selected");
    if (value === "claude" || value === "codex") {
      return value;
    }
    return els.provider && els.provider.value ? els.provider.value : "claude";
  }

  function detectAiTools() {
    var command = [
      "set +e",
      "export PATH=\"$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH\"",
      "echo 'PATH='\"$PATH\"",
      "echo ''",
      "echo 'Claude lookup:'",
      "CLAUDE=$(command -v claude || true)",
      "if [ -z \"$CLAUDE\" ] && [ -x \"$HOME/.local/bin/claude\" ]; then CLAUDE=\"$HOME/.local/bin/claude\"; fi",
      "echo \"claude=$CLAUDE\"",
      "if [ -n \"$CLAUDE\" ]; then \"$CLAUDE\" --version 2>&1 | head -n 3; else echo 'claude not found'; fi",
      "echo ''",
      "echo 'Codex lookup:'",
      "CODEX=$(command -v codex || true)",
      codexBundleLookupCommand("CODEX_BUNDLE"),
      "echo \"codex=$CODEX\"",
      "echo \"codex_bundle=$CODEX_BUNDLE\"",
      "if [ -n \"$CODEX\" ]; then \"$CODEX\" --version 2>&1 | head -n 3; elif [ -n \"$CODEX_BUNDLE\" ]; then \"$CODEX_BUNDLE\" --version 2>&1 | head -n 3; else echo 'codex not found'; fi"
    ].join("\n");
    setInstallStage("aiDetect", "running", "Detecting Claude and Codex...\n");
    setSettingsStatus("Detecting AI agent CLIs...");
    runShell(command).then(function (output) {
      setInstallStage("aiDetect", "done", output || "Detection finished.");
      setSettingsStatus("AI detection finished.");
    }).catch(function (err) {
      var message = String(err && err.message ? err.message : err);
      setInstallStage("aiDetect", "error", message);
      setSettingsStatus(message, true);
    });
  }

  function parseAiModelSuggestions(provider, output) {
    var suggestions = [];
    var seen = {};
    function add(value) {
      value = String(value || "").replace(/['"`.,)]/g, "").replace(/^\s+|\s+$/g, "");
      if (value && value.length < 80 && !seen[value]) {
        seen[value] = true;
        suggestions.push(value);
      }
    }
    var text = String(output || "");
    if (provider === "codex") {
      text.replace(/^\s*(?:model|default_model)\s*=\s*["']?([A-Za-z0-9._:-]+)["']?/gm, function (match, value) {
        add(value);
        return match;
      });
      return suggestions;
    }
    text.replace(/(?:--model|-m|model)\s*[= ]\s*["']?([A-Za-z0-9._:-]+)["']?/g, function (match, value) {
      if (!/^MODEL$/i.test(value) && !/^model$/i.test(value)) {
        add(value);
      }
      return match;
    });
    text.replace(/\b(claude-[A-Za-z0-9._-]+|gpt-[A-Za-z0-9._-]+|o[0-9][A-Za-z0-9._-]*|fable|opus|sonnet)\b/g, function (match, value) {
      add(value);
      return match;
    });
    return suggestions;
  }

  function parseAiModeOptions(provider, output) {
    if (provider !== "claude") {
      return defaultAiModeOptions(provider);
    }
    var options = defaultAiModeOptions(provider);
    var text = String(output || "");
    var permissionMatch = text.match(/--permission-mode[\s\S]{0,260}?choices:\s*([^\)\n]+)/i);
    if (permissionMatch) {
      var parts = permissionMatch[1].split(/[, ]+/);
      for (var i = 0; i < parts.length; i++) {
        var value = parts[i].replace(/[^A-Za-z]/g, "");
        if (value) {
          options.push({ value: "permission:" + value, label: "Permission: " + value });
        }
      }
    }
    return options;
  }

  function aiModelRefreshCommand(provider) {
    return provider === "claude" ? [
      "set +e",
      "export PATH=\"$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH\"",
      "CLAUDE=$(command -v claude || true)",
      "if [ -z \"$CLAUDE\" ] && [ -x \"$HOME/.local/bin/claude\" ]; then CLAUDE=\"$HOME/.local/bin/claude\"; fi",
      "if [ -z \"$CLAUDE\" ]; then echo 'claude not found'; exit 0; fi",
      "\"$CLAUDE\" --help 2>&1"
    ].join("\n") : [
      "set +e",
      "export PATH=\"$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH\"",
      codexBundleLookupCommand("CODEX_BUNDLE"),
      "CODEX=$(command -v codex || true)",
      "if [ -z \"$CODEX\" ] && [ -n \"$CODEX_BUNDLE\" ]; then CODEX=\"$CODEX_BUNDLE\"; fi",
      "if [ -z \"$CODEX\" ]; then echo 'codex not found'; exit 0; fi",
      "\"$CODEX\" exec --help 2>&1",
      "echo ''",
      "echo 'Config model hints:'",
      "grep -hE '^model\\s*=|^default_model\\s*=' \"$HOME/.codex/config.toml\" 2>/dev/null || true"
    ].join("\n");
  }

  function refreshAiModelsForProvider(provider) {
    var command = aiModelRefreshCommand(provider);
    setInstallStage("aiDetect", "running", "Refreshing " + provider + " model and mode hints...\n");
    return runShell(command).then(function (output) {
      var models = parseAiModelSuggestions(provider, output);
      setAiModelSuggestions(provider, models);
      setAiModeOptions(provider, parseAiModeOptions(provider, output));
      return provider + " model suggestions: " + (models.length ? models.join(", ") : "(CLI did not list models)") + "\n\n" + output;
    });
  }

  function refreshAiModels() {
    setInstallStage("aiDetect", "running", "Refreshing Claude and Codex model/mode hints...\n");
    setSettingsStatus("Refreshing AI model hints...");
    refreshAiModelsForProvider("claude").then(function (claudeOutput) {
      return refreshAiModelsForProvider("codex").then(function (codexOutput) {
        return claudeOutput + "\n\n---\n\n" + codexOutput;
      });
    }).then(function (output) {
      setInstallStage("aiDetect", "done", output || "Model hints refreshed.");
      setSettingsStatus("AI model hints refreshed.");
    }).catch(function (err) {
      var message = String(err && err.message ? err.message : err);
      setInstallStage("aiDetect", "error", message);
      setSettingsStatus(message, true);
    });
  }

  function aiTestPrompt(provider) {
    return [
      "Reply with exactly this JSON and nothing else:",
      "{\"ok\":true,\"provider\":\"" + provider + "\",\"message\":\"PR AI connection test\"}"
    ].join("\n");
  }

  function clearAiModelSelection(provider) {
    provider = provider === "codex" ? "codex" : "claude";
    var select = provider === "codex" ? els.codexModelSelect : els.claudeModelSelect;
    if (select) {
      select.value = "";
    }
    try {
      window.localStorage.setItem(aiModelStorageKey(provider), "");
    } catch (err) {
    }
  }

  function selectedModelFailureLooksRecoverable(message) {
    return /\b(model|metadata)\b/i.test(String(message || "")) &&
      /\b(not supported|not found|unknown|invalid|unsupported)\b/i.test(String(message || ""));
  }

  function testAiProvider(provider) {
    provider = provider === "codex" ? "codex" : "claude";
    var stage = providerStageName(provider);
    var selectedModel = getAiModel(provider);
    var model = selectedModel || "(CLI default)";
    var mode = getAiMode(provider) || "(default)";
    setInstallStage(stage, "running", "Testing " + (provider === "claude" ? "Claude Code" : "Codex CLI") + "...\nModel: " + model + "\nMode: " + mode + "\n");
    setSettingsStatus("Testing " + (provider === "claude" ? "Claude Code" : "Codex CLI") + " connection...");
    runAgent(provider, aiTestPrompt(provider), []).then(function (output) {
      var text = String(output || "").replace(/^\s+|\s+$/g, "");
      var ok = text.indexOf("\"ok\"") !== -1 || text.indexOf("PR AI connection test") !== -1;
      setInstallStage(stage, ok ? "done" : "error", text || "(empty response)");
      setSettingsStatus(ok ? "AI test passed for " + provider + "." : "AI test returned an unexpected response for " + provider + ".", !ok);
    }).catch(function (err) {
      var message = String(err && err.message ? err.message : err);
      if (provider === "codex" && selectedModel && selectedModelFailureLooksRecoverable(message)) {
        clearAiModelSelection(provider);
        setInstallStage(stage, "running", "Selected Codex model failed, retrying Codex default...\n\nFailed model: " + selectedModel + "\n\n" + message);
        runAgent(provider, aiTestPrompt(provider), []).then(function (output) {
          var text = String(output || "").replace(/^\s+|\s+$/g, "");
          var ok = text.indexOf("\"ok\"") !== -1 || text.indexOf("PR AI connection test") !== -1;
          var detail = "Cleared unsupported Codex model: " + selectedModel + "\nUsing Codex CLI default now.\n\n" + (text || "(empty response)");
          setInstallStage(stage, ok ? "done" : "error", detail);
          setSettingsStatus(ok ? "Codex default works; unsupported model selection was cleared." : "Codex default returned an unexpected response.", !ok);
        }).catch(function (fallbackErr) {
          var fallbackMessage = String(fallbackErr && fallbackErr.message ? fallbackErr.message : fallbackErr);
          setInstallStage(stage, "error", "Selected model failed and Codex default retry also failed.\n\nSelected model: " + selectedModel + "\n\nSelected model error:\n" + message + "\n\nDefault retry error:\n" + fallbackMessage);
          setSettingsStatus("codex test failed.", true);
        });
        return;
      }
      setInstallStage(stage, "error", message);
      setSettingsStatus(provider + " test failed.", true);
    });
  }

  // Shells start in one place, platform-shell.js (window.prfxShell): zsh on the Mac, Git Bash on Windows.
  function isWindowsPlatform() {
    return window.prfxShell.isWindows(getNodeRequire());
  }
  function shellSpawn(nodeRequire, command, extra) {
    return window.prfxShell.spawn(nodeRequire, command, extra);
  }
  function endProcessTree(nodeRequire, child, hard) {
    window.prfxShell.endTree(nodeRequire, child, hard);
  }

  function runShell(command, input) {
    return new Promise(function (resolve, reject) {
      var nodeRequire = getNodeRequire();
      if (!nodeRequire) {
        reject(new Error("Node.js is not available in this CEP panel. Check manifest CEFCommandLine."));
        return;
      }

      var child;
      try {
        child = shellSpawn(nodeRequire, command);
      } catch (spawnErr) {
        reject(spawnErr);
        return;
      }

      var stdout = "";
      var stderr = "";

      child.stdout.on("data", function (chunk) {
        stdout += chunk.toString();
      });
      child.stderr.on("data", function (chunk) {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", function (code) {
        if (code !== 0) {
          reject(new Error(formatCommandFailure(code, stderr, stdout)));
          return;
        }
        resolve(stdout.trim());
      });

      child.stdin.write(input || "");
      child.stdin.end();
    });
  }

  function cancelActiveAgentResponse() {
    if (!isAgentRunning) {
      return;
    }
    agentCancelRequested = true;
    setRunPhase("Canceling response");
    setStatus("Canceling response...");
    if (!activeAgentChild) {
      return;
    }
    try {
      var nodeRequire = getNodeRequire();
      if (nodeRequire && activeAgentChild.pid) {
        endProcessTree(nodeRequire, activeAgentChild, false);
        window.setTimeout(function (childRef) {
          if (childRef && !childRef.killed) {
            endProcessTree(nodeRequire, childRef, true);
          }
        }, 1200, activeAgentChild);
      } else {
        activeAgentChild.kill("SIGTERM");
      }
    } catch (err) {
      setStatus("Could not cancel response: " + String(err && err.message ? err.message : err), true);
    }
  }

  function runAgentShell(command, input, runId) {
    return new Promise(function (resolve, reject) {
      var nodeRequire = getNodeRequire();
      if (!nodeRequire) {
        reject(new Error("Node.js is not available in this CEP panel. Check manifest CEFCommandLine."));
        return;
      }

      var child;
      try {
        child = shellSpawn(nodeRequire, command, { detached: true });
      } catch (spawnErr) {
        reject(spawnErr);
        return;
      }

      activeAgentChild = child;
      var stdout = "";
      var stderr = "";
      var settled = false;
      var hasRunId = typeof runId === "number";

      function finish(fn, value) {
        if (settled) {
          return;
        }
        settled = true;
        if (activeAgentChild === child) {
          activeAgentChild = null;
        }
        fn(value);
      }

      child.stdout.on("data", function (chunk) {
        stdout += chunk.toString();
      });
      child.stderr.on("data", function (chunk) {
        stderr += chunk.toString();
      });
      child.on("error", function (err) {
        finish(reject, err);
      });
      child.on("close", function (code) {
        if (agentCancelRequested || (hasRunId && runId !== activeAgentRunId)) {
          finish(reject, new Error("Response canceled."));
          return;
        }
        if (code !== 0) {
          finish(reject, new Error(formatCommandFailure(code, stderr, stdout)));
          return;
        }
        finish(resolve, stdout.trim());
      });

      child.stdin.write(input || "");
      child.stdin.end();
    });
  }

  function runShellStreaming(command, options) {
    options = options || {};
    return new Promise(function (resolve, reject) {
      var nodeRequire = getNodeRequire();
      if (!nodeRequire) {
        reject(new Error("Node.js is not available in this CEP panel. Check manifest CEFCommandLine."));
        return;
      }

      var child;
      try {
        child = shellSpawn(nodeRequire, command);
      } catch (spawnErr) {
        reject(spawnErr);
        return;
      }

      var stdout = "";
      var stderr = "";
      function onData(chunk, isError) {
        var text = chunk.toString();
        if (isError) {
          stderr += text;
        } else {
          stdout += text;
        }
        if (options.onData) {
          options.onData(text, isError);
        }
      }

      child.stdout.on("data", function (chunk) {
        onData(chunk, false);
      });
      child.stderr.on("data", function (chunk) {
        onData(chunk, true);
      });
      child.on("error", reject);
      child.on("close", function (code) {
        if (code !== 0) {
          reject(new Error(formatCommandFailure(code, stderr, stdout)));
          return;
        }
        resolve(stdout.trim());
      });
      child.stdin.write(options.input || "");
      child.stdin.end();
    });
  }

  function tailText(value, limit) {
    var text = String(value || "");
    if (text.length <= limit) {
      return text || "(empty)";
    }
    return "...(showing last " + limit + " chars)\n" + text.slice(text.length - limit);
  }

  // The cause first (2026-11-22): the engine log and the banner keep only the start of this message, and WhisperX
  // prints long harmless warnings (torchcodec, pyannote) before its real error, so "Command exited with code 1" was
  // followed by a warning and the error was cut off. The last error-looking line leads; the tails follow as before.
  function commandFailureCause(stderr, stdout) {
    var lines = String(stderr || "").concat("\n", String(stdout || "")).split(/\r?\n/).map(function (l) { return l.replace(/^\s+|\s+$/g, ""); }).filter(Boolean);
    var noise = /UserWarning|warnings\.warn|torchcodec|^\*|^Lightning automatically upgraded|^Model was trained with|^Bad things might happen/i;
    for (var i = lines.length - 1; i >= 0; i--) {
      if (!noise.test(lines[i]) && /(Error|Exception|error:|failed|No such file|not found|Killed|MemoryError)/.test(lines[i])) {
        return lines[i].slice(0, 400);
      }
    }
    return "";
  }

  function formatCommandFailure(code, stderr, stdout) {
    var cause = commandFailureCause(stderr, stdout);
    return [
      "Command exited with code " + code + (cause ? ": " + cause : ""),
      "",
      "STDERR tail:",
      tailText(stderr, 5000),
      "",
      "STDOUT tail:",
      tailText(stdout, 2500)
    ].join("\n");
  }

  function runAgent(provider, prompt, imagePaths, runId, options) {
    var nodeRequire = getNodeRequire();
    if (!nodeRequire) {
      return Promise.reject(new Error("Node.js is not available in this CEP panel. Check manifest CEFCommandLine."));
    }
    return runAgentShell(getCliCommand(provider, nodeRequire, imagePaths || [], options), prompt, runId);
  }

  function hasQuickMode(modes, id) {
    for (var i = 0; i < modes.length; i++) {
      if (modes[i] === id) {
        return true;
      }
    }
    return false;
  }

  function requestLooksLikeAutocut(text, modes, scriptPayload) {
    if (hasQuickMode(modes, "auto-cut") || hasQuickMode(modes, "auto-cut-textbound") || hasQuickMode(modes, "auto-cut-clipbound")) {
      return true;
    }
    var value = String(text || "").toLowerCase();
    if (/\b(auto[- ]?cut|assemble|cut\s+from\s+source|source\s+file|script\s+to\s+timeline|edit\s+from\s+script)\b/.test(value)) {
      return true;
    }
    if (scriptPayload && scriptPayload.tableRows && scriptPayload.tableRows.length) {
      var scriptText = String(scriptPayload.text || "").toLowerCase();
      return /\b(source\s+file|cut\s+from\s+source|overlay\s+text)\b/.test(scriptText);
    }
    return false;
  }

  function requestNeedsAudioSettings(text, modes) {
    if (hasQuickMode(modes, "auto-cut") || hasQuickMode(modes, "audio-subtitles") || hasQuickMode(modes, "audio-text-cuts") || hasQuickMode(modes, "full-processing")) {
      return true;
    }
    return /\b(audio|whisper|whisperx|transcrib|subtitle|caption|srt)\b/i.test(String(text || ""));
  }

  function requestNeedsVideoAiSettings(text) {
    return false;
  }

  function requestLooksLikeRemovedVideoAi(text) {
    return /\b(comfy|inpaint|paint[- ]?out|remove\s+text|video\s+ai|wan|vace)\b/i.test(String(text || ""));
  }

  function requestNeedsTextInstructions(text, modes, isAutocut) {
    if (hasQuickMode(modes, "auto-cut") || hasQuickMode(modes, "auto-cut-textbound") || hasQuickMode(modes, "auto-subtitle-layout") || hasQuickMode(modes, "audio-subtitles") || hasQuickMode(modes, "audio-text-cuts") || hasQuickMode(modes, "full-processing")) {
      return true;
    }
    if (/\b(text|subtitle|caption|srt|xml|mogrt|graphic|essential graphics)\b/i.test(String(text || ""))) {
      return true;
    }
    return !isAutocut;
  }

  function requestAllowsNewSequence(text, modes) {
    return hasQuickMode(modes, "create-new-sequence") || /\b(new|fresh|another|duplicate)\s+sequence\b/i.test(String(text || ""));
  }

  function actionCatalogForPrompt(userPrompt, modes, graphicTextAllowed, isAutocut, includeTextActions, includeAudioActions) {
    var allowed = null;
    var allowNewSequence = requestAllowsNewSequence(userPrompt, modes);
    if (hasQuickMode(modes, "audio-text-cuts")) {
      allowed = {
        importSrtFile: true,
        importCaptionFile: true,
        writeTempTextFile: true,
        transcribeAudioTrackToSrt: true,
        cutAudioAndTimeSubtitles: true,
        splitTrackAtTimes: true,
        checkFilePath: true
      };
    } else if (hasQuickMode(modes, "full-processing")) {
      allowed = {
        fullProcessScriptRows: true,
        checkFilePath: true
      };
    } else if (isAutocut) {
      allowed = {
        addSequenceMarker: true,
        assembleFromScript: true,
        insertProjectItem: true,
        insertClipRange: true,
        overwriteClipRange: true,
        clearTrack: true,
        deleteTrackRange: true,
        trimClip: true,
        rippleTrimClip: true,
        moveClip: true,
        deleteClip: true,
        splitClip: true,
        splitTrackAtTimes: true,
        setClipEnabled: true,
        setAudioGain: true,
        setTrackMute: true,
        setTrackVisibility: true,
        setTrackLock: true,
        checkFilePath: true
      };
      if (includeTextActions) {
        allowed.importSrtFile = true;
        allowed.importCaptionFile = true;
        allowed.writeTempTextFile = true;
      }
      if (includeAudioActions) {
        if (!hasQuickMode(modes, "auto-cut-textbound")) {
          allowed.transcribeAudioTrackToSrt = true;
          allowed.cutAudioAndTimeSubtitles = true;
        }
      }
    } else if (requestLooksLikeTimelineEdit(userPrompt, modes) && !graphicTextAllowed) {
      allowed = {
        addSequenceMarker: true,
        setSequenceInOut: true,
        clearSequenceInOut: true,
        assembleFromScript: true,
        insertProjectItem: true,
        insertClipRange: true,
        overwriteClipRange: true,
        clearTrack: true,
        deleteTrackRange: true,
        trimClip: true,
        rippleTrimClip: true,
        moveClip: true,
        deleteClip: true,
        splitClip: true,
        splitTrackAtTimes: true,
        setClipEnabled: true,
        setAudioGain: true,
        setTrackMute: true,
        setTrackVisibility: true,
        setTrackLock: true,
        checkFilePath: true
      };
      if (includeTextActions) {
        allowed.importSrtFile = true;
        allowed.importCaptionFile = true;
        allowed.writeTempTextFile = true;
      }
      if (includeAudioActions) {
        allowed.transcribeAudioTrackToSrt = true;
        allowed.cutAudioAndTimeSubtitles = true;
      }
    }
    if (allowed && allowNewSequence) {
      allowed.createSequence = true;
    }
    var visible = [];
    for (var a = 0; a < supportedActions.length; a++) {
      var action = supportedActions[a];
      var actionType = action.type;
      if (allowed && !allowed[actionType]) {
        continue;
      }
      var isSvgAction = actionType === "createStyledTextSvg";
      var isGraphicTextAction = actionType === "createStyledTextXml" ||
        actionType === "insertMogrt" ||
        actionType === "setGraphicText" ||
        actionType === "setGraphicProperty" ||
        actionType === "listGraphicProperties";
      if ((!isSvgAction || requestAllowsSvg(userPrompt)) && (!isGraphicTextAction || graphicTextAllowed)) {
        visible.push(action);
      }
    }
    return visible;
  }

  function diagnoseCli() {
    var nodeRequire = getNodeRequire();
    if (!nodeRequire) {
      appendMessage("system", "Node.js is not available in this CEP panel. Check manifest CEFCommandLine.");
      setStatus("CEP Node unavailable.", true);
      return;
    }

    var command = [
      "export PATH=\"$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH\"",
      "echo HOME=$HOME",
      "echo SHELL=$SHELL",
      "echo PATH=$PATH",
      "echo",
      "echo 'codex lookup:'",
      "command -v codex || true",
      codexBundleLookupCommand("CODEX_BUNDLE"),
      "[ -n \"$CODEX_BUNDLE\" ] && echo \"bundle $CODEX_BUNDLE\" || true",
      "codex --version 2>&1 || \"$CODEX_BUNDLE\" --version 2>&1 || true",
      "echo",
      "echo 'claude lookup:'",
      "command -v claude || true",
      "claude --version 2>&1 || true",
      "echo",
      "echo 'Claude/Anthropic auth env seen by Premiere:'",
      "env | grep -E '^(ANTHROPIC|CLAUDE)_' | sed -E 's/=.*/=<redacted>/' || true"
    ].join("\n");

    els.diagnoseBtn.disabled = true;
    setStatus("Diagnosing CLI...");
    rawHostDiagnostic()
      .then(function (hostOutput) {
        return runShell(command, "").then(function (cliOutput) {
          return hostOutput + "\n\n" + cliOutput;
        });
      })
      .then(function (output) {
        appendMessage("system", output);
        setStatus("CLI diagnostics complete.");
      })
      .catch(function (err) {
        appendMessage("system", String(err && err.message ? err.message : err));
        setStatus("CLI diagnostics failed.", true);
      })
      .then(function () {
        els.diagnoseBtn.disabled = false;
      });
  }

  function rawHostDiagnostic() {
    return new Promise(function (resolve) {
      var hostPath = "";
      var nodeRequire = getNodeRequire();
      if (nodeRequire) {
        try {
          hostPath = praiHostJsxPath(nodeRequire).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        } catch (err) {
          hostPath = "";
        }
      }
      var script = "(function(){function q(v){return String(v).replace(/\\\\/g,'\\\\\\\\').replace(/\"/g,'\\\\\"').replace(/\\r/g,' ').replace(/\\n/g,' ');}try{var out={evalScript:true,hasDollar:typeof $!='undefined',hasApp:typeof app!='undefined',hasProject:typeof app!='undefined'&&!!app.project,hasSnapshot:typeof prAI_getProjectSnapshot=='function',hostVersion:typeof prAI_hostVersion=='undefined'?'':prAI_hostVersion};";
      if (hostPath) {
        script += "if(!out.hasSnapshot||out.hostVersion!='20261120-agent-menu1'){try{$.evalFile('" + hostPath + "');out.reloadedHost=true;}catch(loadErr){out.reloadError=String(loadErr);}}out.hasSnapshotAfterReload=typeof prAI_getProjectSnapshot==='function';out.hostVersionAfterReload=typeof prAI_hostVersion==='undefined'?'':prAI_hostVersion;";
      }
      script += "if(typeof JSON!='undefined'&&JSON.stringify){return JSON.stringify({ok:true,data:out,error:null});}return '{\"ok\":true,\"data\":{\"evalScript\":'+out.evalScript+',\"hasDollar\":'+out.hasDollar+',\"hasApp\":'+out.hasApp+',\"hasProject\":'+out.hasProject+',\"hasSnapshot\":'+out.hasSnapshot+',\"hostVersion\":\"'+q(out.hostVersion)+'\",\"reloadedHost\":'+(out.reloadedHost?true:false)+',\"reloadError\":\"'+q(out.reloadError||'')+'\",\"hasSnapshotAfterReload\":'+(out.hasSnapshotAfterReload?true:false)+',\"hostVersionAfterReload\":\"'+q(out.hostVersionAfterReload||'')+'\"},\"error\":null}';}catch(err){return '{\"ok\":false,\"data\":null,\"error\":\"'+q(err)+'\"}';}}())";
      cs.evalScript(script, function (result) {
        resolve("Host diagnostic:\n" + String(result || ""));
      });
    });
  }

  function buildAgentPrompt(userPrompt, images, scriptInput) {
    var imageLines = [];
    for (var i = 0; i < images.length; i++) {
      imageLines.push({ name: images[i].name, path: images[i].path });
    }
    var quickModes = workflowModesForRequest(userPrompt, activeQuickModes(), images);
    var imageScriptRequest = requestLooksLikeImageScriptImport(userPrompt, images, quickModes);
    var quickInstructions = imageScriptRequest ? ["The panel will run the selected workflow after it installs and parses the transcribed scriptTable. Return only scriptTable and do not emit workflow actions."] : quickModeInstructions(quickModes);
    var scriptPayload = scriptInput || { text: "", html: "" };
    var graphicTextAllowed = requestAllowsGraphicText(userPrompt);
    var isAutocut = requestLooksLikeAutocut(userPrompt, quickModes, scriptPayload);
    var includeAudioSettings = requestNeedsAudioSettings(userPrompt, quickModes);
    var includeTextInstructions = requestNeedsTextInstructions(userPrompt, quickModes, isAutocut);
    var audioTextCutsMode = hasQuickMode(quickModes, "audio-text-cuts");
    var fullProcessingMode = hasQuickMode(quickModes, "full-processing");
    var contextProfile = projectContextProfile(userPrompt, quickModes, images, scriptPayload, isAutocut, graphicTextAllowed);
    if (contextProfile === "none") {
      return [
        "You are the PR AI panel assistant.",
        "This is a normal chat request. Do not assume a Premiere edit is requested.",
        "Do not include an actions JSON object unless the user explicitly asks to modify Premiere. Vague requests like optimize, improve, fix it, thoughts, advice, or recommendations are chat only unless paired with apply/run/change/modify or another concrete edit command.",
        "For ambiguous optimization requests, answer conversationally and ask what changed or what target to optimize if needed.",
        "Recent chat:",
        JSON.stringify(chatHistory.slice(-1), null, 2),
        "User request:",
        userPrompt
      ].join("\n\n");
    }
    var visibleSupportedActions = actionCatalogForPrompt(userPrompt, quickModes, graphicTextAllowed, isAutocut, includeTextInstructions, includeAudioSettings);
    var promptProjectContext = projectContextForPromptProfile(contextProfile, userPrompt);
    var promptProfile = isAutocut ? "autocut-slim" : contextProfile + "-context";
    var fullRowAutocut = hasQuickMode(quickModes, "auto-cut") || fullProcessingMode;
    var textBoundAutocut = hasQuickMode(quickModes, "auto-cut-textbound");
    var autocutMode = fullProcessingMode ? "full-processing" : (textBoundAutocut ? "text-bound" : (hasQuickMode(quickModes, "auto-cut-clipbound") ? "clip-bound" : (hasQuickMode(quickModes, "auto-cut") ? "legacy" : "(none)")));
    var recentChat = (isAutocut || contextProfile !== "full") ? [] : chatHistory.slice(-4);
    var scriptHtmlPrompt = (!isAutocut && scriptPayload.html) ? scriptPayload.html : (scriptPayload.html ? "(omitted for autocut; use plain text/table rows above)" : "(none)");
    var audioTranscriptPrompt = audioTextCutsMode ? scriptTranscriptTextForAudioAlignment(scriptPayload) : "";
    var lines = [
      "You are controlling a Premiere Pro CEP prototype.",
      "Answer conversationally, then include one JSON object when you want edits applied.",
      "The JSON object must be shaped as {\"actions\":[...]} and can contain multiple actions in order.",
      "Prompt profile: " + promptProfile + ".",
      contextProfile === "inspect" ? "This is an inspection/read-only request. Use the supplied Project context to summarize active timeline clips, tracks, sequences, bins, and project items. Do not say you lack a direct Premiere connection unless Project context is omitted or empty." : "",
      isAutocut ? "Autocut mode: " + autocutMode + "." : "",
      "Do not invent action types. You may include targetStartSeconds, originalStartSeconds, or clipStartSeconds on clip actions to identify the clip's current timeline start before the action runs.",
      "For multi-step timeline edits, prefer clipName plus targetStartSeconds over clipIndex because split, trim, ripple, and delete actions can change later clip indexes.",
      "If you use clipIndex, also include clipName and targetStartSeconds when available so the host can recover after earlier timeline mutations.",
      "For source media, prefer projectItemId over projectItemName when available. Use sourcePath if the ID is unavailable. Plain numeric source cells like 18 or 30 are source labels, not durations; match them to a unique project item whose filename contains that number token, such as H18.mp4 or 30.mp4.",
      "You may use simple string shorthand inside actions only when obvious, for example \"trim V1 clip 0 end 8\", but structured objects are preferred.",
      "Seconds are timeline seconds. Track indexes and clip indexes are zero-based.",
      fullProcessingMode ? (imageScriptRequest ? "Image transcription precedes Full Process. Return only scriptTable; the panel will create fullProcessScriptRows after installing it." : "Full Process rule: emit exactly {\"actions\":[{\"type\":\"fullProcessScriptRows\"}]} unless the user gave explicit track/start overrides. Original Text/Overlay defines Whisper alignment and one audio section per row. Optimized Text defines smaller caption chunks inside that row and never changes audio or media spacing. Preserve the existing configured-track audio and the imported SRT project item.") : (fullRowAutocut ? "Full-row Auto cut rule: every script row can contain Text + footage + audio. Use only the row Text/Overlay cells as the provided transcript, one row per line/block, preserving row boundaries. Never use the full flattened table text as scriptText, because that includes source/cut cells and will spread the whole block into tiny audio slices. Use row source/cut cells as footage, and the configured audio track as voice/audio. Use Whisper to align the provided row text to the audio and pay close attention to each row's starting and ending words. The final text/subtitle/window duration for each row is the longer of: (1) that row's Whisper-aligned audio speech duration, or (2) that row's combined footage/cut duration. cutAudioAndTimeSubtitles only splits audio in place for manual editing/testing; it must not be used as a footage assembly workflow. Assemble footage separately to match the row order." : ""),
      audioTextCutsMode ? "Audio + Text rule: emit cutAudioAndTimeSubtitles using only ordered original Text/Overlay rows as scriptText. Original rows define audio cuts. The selected script's Optimized Text may create multiple word-timed captions inside a row, but must not create additional audio cuts." : "",
      textBoundAutocut ? "For text-bound autocut, use explicit insertClipRange/overwriteClipRange actions when clips must be stacked, clipped to a text segment boundary, or centered in a no-text cut window. Use assembleFromScript only for simple one-track runs that do not need stacking or centering." : (audioTextCutsMode ? "" : "When assembling from a script, prefer one assembleFromScript action instead of many insertClipRange/overwriteClipRange actions. The host will accumulate timeline start times from each clip duration."),
      "If the user says to ignore, skip, omit, continue past, or proceed without missing/unresolved/unvalidated footage, set skipMissing:true, skipInvalid:true, continueOnError:true, and preserveSkippedGaps:true on assembleFromScript. Missing footage must leave a blank timeline gap matching that row/range duration so subtitles still align to the source plan.",
      "For script tables like '5s dau Source 3' or '15s dau Source 8', map 'dau'/'đầu' to source in 0 and source out N. For note ranges like '5-8s', do not blindly add one second. If the note clearly means through the whole 8th second and the media is long enough, the visible last frame at 30fps is 8:29 with technical exclusive outPointSeconds 9.0; otherwise preserve the explicit end or the available source/layer out point.",
      "Use splitClip before deleting or replacing a middle section of an existing clip. When deleting multiple existing timeline clips, order deletes from the highest timeline start to the lowest timeline start on each track unless ripple timing requires another order.",
      "For cut-and-remove requests on one source clip, split at all needed boundaries first, from later times to earlier times when possible, then delete the unwanted resulting segments by clipName and targetStartSeconds.",
      "For audio timeline edits, use the normal clip actions with trackType:\"audio\". For gain, use setAudioGain. For muting, use setClipEnabled with trackType:\"audio\" and enabled:false.",
      "Avoid type:\"audio\" unless you are translating an old request; explicit audio clip actions are preferred.",
      includeAudioSettings ? "For audio alignment, original Text/Overlay rows are authoritative and define audio sections. Optimized Text is subtitle-only and may subdivide each section with Whisper word timing without adding audio cuts. If no transcript is supplied, omit useProvidedText and let Whisper transcribe the audio." : "",
      includeTextInstructions ? "For insert text, add text, text overlay, subtitle, caption, or SRT requests, emit one importSrtFile action with inline SRT contents, createCaptionTrack:true, allowCaptionTrackCreate:true, suppressUI:true, cleanupAfterImport:false, and removeProjectItemAfterCaptionTrack:false. Keep the imported SRT in the Project panel after creating captions. Do not provide suggestedName; the host will use the AutoEdit SRT naming scheme. Do not create a graphic layer for these requests." : "",
      includeTextInstructions ? "When plain text is provided without SRT timing, convert each non-empty line into an SRT block using reasonable sequential timing from the request; default to startAtTime 0, 3 seconds per line, and 0.2 seconds gap when unspecified." : "",
      includeTextInstructions ? "When Script/table input has an Overlay Text column and a Cut from Source column, place subtitles by the cut timing, not by equal default durations. For each row, sum the durations of that row's source cuts using out-in seconds, advance the subtitle cursor by that row duration, and create an SRT caption only when Overlay Text is not blank, '(none)', or dashes. Rows with no overlay still consume timeline duration. For multiple cuts in one row, the overlay caption spans the combined row duration unless the user asks to split it." : "",
      textBoundAutocut ? "Text-bound no-text row rule: if a row has Source/Cut values but Overlay Text is blank, '(none)', or dashes, do not skip it and do not attach it to the previous or next subtitle. Compute that row's cut-duration window from its Cut from Source ranges, place the clip centered in that window, and trim/move linked audio to match the centered video. If the clip is longer than the no-text window, keep the source in-point and trim the out-point to fit." : "",
      includeTextInstructions ? "If a Cut from Source cell has integer source ranges like 5-8 or 14-16, choose the out-point situationally: use the explicit end for normal in/out notation, use end+1 only for notes that clearly mean the full end second, and never exceed the actual source/layer out. Single-second source notes like 'giay 9', 'giây 11', or 'sec 15' mean the full selected second: source in at that second's first frame and source out at the next second boundary, so 30fps displays 11:00 through 11:29 while the technical exclusive out point is 12.0. If a row's cut duration is represented in assembleFromScript results, use those assembled durations as the source of truth." : "",
      includeTextInstructions ? "Script Cut from Source values are offsets from the beginning of the referenced media, not absolute embedded timecode. Set sourceRangeMode:'offset' on script-derived insertClipRange/overwriteClipRange actions; offset values are passed to Premiere unchanged. Use sourceRangeMode:'timecode' only when the script explicitly contains an embedded source timecode; the host then subtracts ProjectItem.startTime() once." : "",
      isAutocut ? "Flexible multi-source Cut rule: one Cut cell may contain annotations and multiple selections while the neighboring Source cell contains source IDs line-by-line. Pair meaningful Cut lines to Source lines by order, ignoring annotation-only lines. Multiple selections written on one Cut line, such as 'Giây 6, giây 17', all belong to that one paired Source line. Decimal commas are decimal seconds." : "",
      includeTextInstructions ? "For real SRT or text-file workflows, prefer importSrtFile/importCaptionFile with inline contents or filePath. Inline contents is preferred because it avoids missing-path failures. The panel will inject the selected text temp folder into text/caption actions. Use suppressUI:false only when the user explicitly wants to confirm caption import settings in Premiere. Use checkFilePath before importing a user-provided filePath if existence is uncertain." : "",
      includeTextInstructions ? "Do not use createStyledTextXml, insertMogrt, createTextGraphic, or SVG for normal text/subtitle insertion. Graphic-layer actions are allowed only when the user explicitly asks for XML, XMEML, MOGRT/template, Essential Graphics, or an existing graphics clip/property edit." : "",
      includeTextInstructions ? "If the user explicitly asks for a graphic layer, Premiere graphic, Essential Graphics, XML, or MOGRT, prefer setGraphicText/setGraphicProperty on an existing Graphic clip, insertMogrt with a real .mogrt/template path, or createStyledTextXml when the fixed capsule fits. Never answer a graphic-layer request with createStyledTextSvg unless the user explicitly asks for SVG/non-editable/visual asset or accepts that fallback after you explain the limitation." : "",
      includeTextInstructions ? "For arbitrary rich styled text with unlimited length and unlimited style switches, createStyledTextSvg exists only as an opt-in visual asset route. It is hidden unless the user explicitly asks for SVG, non-editable media, visual asset, or media asset. Do not offer or emit SVG otherwise." : "",
      includeTextInstructions ? (graphicTextAllowed ? "Hard rule: XML can encode exported Premiere graphic details. Never say XML cannot encode styled graphics. If you cannot emit the requested XML yet, say the current Source Text blob builder is missing variable-length/run-count rewriting, then use createStyledTextXml with an existing capsule or ask for the needed capsule/template. Do not switch to SVG." : "XML/MOGRT/graphic-layer actions are hidden for this request; use importSrtFile/importCaptionFile for text/subtitle insertion.") : "",
      graphicTextAllowed ? "For styled XML text graphics, do not hand-write XML, do not use writeTempTextFile for XML, do not use duplicateClip to create XML text frames, and do not invent a GraphicAndType structure. Always emit createStyledTextXml using the matching saved templateId so the host clones a proven Source Text blob. Use templateId:\"text-xml-two-style-graphic\" for the original 3-span yellow/white capsule, or templateId:\"text-xml-five-run-switching\" for the 5-run A/B/A/B/A switching capsule. The host supports multiple XML text frames in one action via frames:[...]. Each frame can include replacements/startFrame/startSeconds/durationFrames/effectName/clipName/templateId. Use stackFrames:true only when frames should layer at the same start time." : "",
      graphicTextAllowed ? "The saved XML example/template has these source spans and byte lengths for every frame: \"Best Selling\" = 12 bytes with yellowGradient, \"pants\" = 5 bytes with defaultWhite, \"in 2026\" = 7 bytes with defaultWhite. Valid frame replacement example: {\"replacements\":[{\"from\":\"Best Selling\",\"to\":\"Second Layer\"},{\"from\":\"pants\",\"to\":\"style\"},{\"from\":\"in 2026\",\"to\":\"in 2027\"}],\"startFrame\":0,\"durationFrames\":114}. If a requested frame's text does not match these byte lengths, createStyledTextXml cannot create that frame until a matching template/capsule or variable-length blob editing exists." : "",
      graphicTextAllowed ? "A second XML component capsule is available for word-by-word switching: templateId:\"text-xml-five-run-switching\" from /Users/crossianllc/Documents/Text style PR.xml. It has five Source Text run components in one graphic layer: \"one \" = 4 bytes switchA, \"two\" = 3 bytes switchB, \" three \" = 7 bytes switchA, \"four\" = 4 bytes switchB, \" give\" = 5 bytes switchA. Use this template when the user wants to copy the alternating style components. Preserve leading/trailing spaces in replacements and keep each replacement the same byte length for now." : "",
      graphicTextAllowed ? "Say byte lengths, not character lengths, when explaining styled XML replacement limits." : "",
      graphicTextAllowed ? "Do not provide suggestedName or name for createStyledTextXml. The host enforces the XML filename as 'YYYY-MM-DD-HH-mm - AutoEdit - Function.xml'. Use functionName:\"Text\", \"Cut\", or \"Both\" only to select the Function part of the filename." : "",
      graphicTextAllowed ? "Do not silently abandon XML or editable graphic intent. If the user asked specifically for editable Premiere XML/Essential Graphics text and the saved capsule cannot fit the text, state that XML settings apply to createStyledTextXml only and a matching capsule/template or variable-length blob encoder is needed. Do not offer createStyledTextSvg unless the user explicitly asks for SVG/non-editable/visual asset/media asset." : "",
      graphicTextAllowed ? "Do not stop at the fixed-span limitation when the user wants XML. For a graphic-layer/XML request, first try editable component/MOGRT/XML paths. SVG is not a fallback unless explicitly requested. Only say it cannot be done when neither XML frames, component editing, nor a real text template is acceptable." : "",
      graphicTextAllowed ? "Mask edit rule: Premiere's Mask Feather should be treated as one linked value by default, even if the host exposes an underlying two-number array. For setGraphicProperty on Mask Feather, send one value or linked:true; use linked:false/unlinkFeather:true only when the user explicitly asks for separate X/Y feather axes." : "",
      graphicTextAllowed ? "createStyledTextXml storage/action behavior: by default it writes next to the Premiere project in an XML folder, names the file 'YYYY-MM-DD-HH-mm - AutoEdit - Function.xml', follows the panel XML action setting, and reports the filePath/import/open status. Use functionName:\"Text\" for text-only XML, \"Cut\" for cut-only XML, and \"Both\" for mixed XML/cut workflows." : "",
      graphicTextAllowed ? "XML settings from the panel: output folder = " + (getXmlOutputFolder() || "(default project folder/XML)") + "; action when done = " + getXmlAfterCreateAction() + ". The panel injects these into createStyledTextXml actions." : "",
      graphicTextAllowed ? "For auto text using styled XML, default mapping is normal text = defaultWhite and bold/emphasis text = yellowGradient. Do not ask the user to confirm that default mapping unless they explicitly request a different mapping or the script markup is genuinely ambiguous." : "",
      graphicTextAllowed ? "If the user asks whether styled XML creation is ready, answer with readiness/status only. Do not ask for replacement strings or style mapping until the user asks you to create a specific XML." : "",
      "Never delete project panel items or media files. No project item delete action is supported.",
      "Some Premiere features are best-effort because CEP scripting exposes them inconsistently. If an action is unsupported, return the closest supported action plan and explain the limitation.",
      audioTextCutsMode ? "Efficiency rules: emit one cutAudioAndTimeSubtitles action, skip summary tables unless asked, and keep prose minimal." : (textBoundAutocut ? "Efficiency rules: batch all requested tracks in this single response, group text-bound clip actions by text segment, skip summary tables unless asked, and keep prose minimal." : "Efficiency rules: batch all requested tracks in this single response, use assembleFromScript for script-to-timeline work, skip summary tables unless asked, and keep prose minimal."),
      "Persistent edit guide:",
      getEditGuide() || "(none)",
      "Text temp folder setting:",
      getTextTempFolder() || "(default PR AI temp folder)",
      "Audio alignment settings:",
      includeAudioSettings ? JSON.stringify(getWhisperSettings(), null, 2) : "(omitted for this request)",
      includeAudioSettings && !getWhisperSettings().command ? "Whisper is not configured or the command field contains only a placeholder. Do not emit cutAudioAndTimeSubtitles or transcribeAudioTrackToSrt. You may still emit non-audio Text + Footage and Add text actions if the user asked to proceed without audio timing." : "",
      "Requested workflow modes (detected from the prompt and optional shortcut buttons):",
      quickModes.length ? quickModes.map(quickModeLabel).join(", ") : "(none)",
      "Workflow instructions:",
      quickInstructions.length ? quickInstructions.join("\n") : "(none)",
      "Shortcut buttons are optional. A concrete user command in the prompt is sufficient authorization to emit supported Premiere actions; do not ask the user to toggle a workflow button first.",
      "Attached images:",
      JSON.stringify(imageLines, null, 2),
      "Attached image files are already authorized for this request. Read them directly from the provided paths or from the attached image inputs; do not ask the user to approve image file access again.",
      imageScriptRequest ? "IMAGE-TO-SCRIPT MODE: inspect every attached image and transcribe the visible spreadsheet/script into the active script before any workflow runs. Return exactly one JSON object containing scriptTable. Do not return scriptEdits, scriptHtml, insertClipRange, overwriteClipRange, assembleFromScript, or any other timeline actions; the panel will generate workflow actions from the installed table after transcription." : "",
      imageScriptRequest ? "Use this shape: {\"scriptTable\":{\"columns\":[{\"name\":\"Text\",\"role\":\"text\"},{\"name\":\"Cut\",\"role\":\"cut\"},{\"name\":\"Source\",\"role\":\"source\"}],\"rows\":[[\"Spoken text\",\"00-02\",\"K1.mp4\"]]}}. Allowed roles are text, optimizedText, cut, source, notes, and skip. A cell may instead be {\"text\":\"value\",\"rowspan\":2,\"colspan\":1} when the image visibly contains merged cells." : "",
      imageScriptRequest ? "Transcription rules: preserve visible row order, column order, empty cells, line breaks, punctuation, capitalization, filenames, extensions, decimal commas, timecodes, and all source selections. Do not correct, optimize, summarize, deduplicate, invent, or resolve filenames. Ignore decorative spreadsheet UI outside the table. Infer column roles only from visible headers and consistent cell content; use role notes when uncertain. Include one output row for every visible logical data row." : "",
      imageScriptRequest ? "When a merged Text, Cut, or Source cell spans rows, represent it once with rowspan rather than copying or deleting neighboring values. Several cut ranges or filenames inside one visible cell remain newline-separated inside that one cell. Notes in parentheses remain text in their original cell." : "",
      "When Script/table input is provided, treat it as pasted spreadsheet/script data. Preserve row order, tabs, spacing, line breaks, and visible table structure. Use it together with the command; do not act on it by itself when the command is empty.",
      "When Script/table structured rows are present, they are authoritative. Never claim the script was flattened, never ask the user to re-paste it, and never ask for a screenshot merely to recover columns already present in those row arrays. Use columnRoles and the merged-cell map to interpret Source File, Cut from Source, Text/Overlay, and merged row groups.",
      "If the user asks to validate, repair, rename, normalize, or otherwise edit only the Script/table input, do not emit Premiere timeline actions. Return {\"scriptEdits\":[{\"row\":2,\"column\":3,\"value\":\"Corrected value\",\"reason\":\"Why\"}],\"missingSources\":[],\"ambiguousMatches\":[],\"unresolvedSources\":[]} or {\"scriptHtml\":\"<table>...</table>\"}. Rows and columns are 1-based and include the header row. The panel will render these fields as an icon action list, so keep them accurate.",
      "Efficiency actions: use clearTrack or deleteTrackRange for bulk cleanup instead of emitting many deleteClip actions. Use linked:true on video cleanup when matching linked audio should be removed with the video.",
      "Supported actions:",
      JSON.stringify(visibleSupportedActions, null, 2),
      "Recent chat:",
      JSON.stringify(recentChat, null, 2),
      "Project context:",
      JSON.stringify(promptProjectContext, null, 2),
      "Project context diagnostics:",
      JSON.stringify(state && state.diagnostics ? state.diagnostics : {}, null, 2),
      "PR AI target sequence:",
      targetSequenceLabel(),
      "Script/table input plain text:",
      audioTextCutsMode ? (audioTranscriptPrompt || "(none)") : (scriptPayload.text || "(none)"),
      "Script/table structured rows (authoritative; preserve row and column boundaries):",
      scriptPayload.tableRows && scriptPayload.tableRows.length ? JSON.stringify(scriptPayload.tableRows, null, 2) : "(none)",
      "Script/table merged-cell map (originRow/originCol identify one merged source spanning rows):",
      scriptPayload.tableCells && scriptPayload.tableCells.length ? JSON.stringify(scriptPayload.tableCells, null, 2) : "(none)",
      "Active script name:",
      scriptPayload.scriptName || "(unnamed)",
      "Active product/project name:",
      scriptPayload.projectName || "(unnamed)",
      "Script/table column roles:",
      scriptPayload.columnRoles && scriptPayload.columnRoles.length ? JSON.stringify(scriptPayload.columnRoles, null, 2) : "(none)",
      "Derived cut-timed SRT plan from Script/table input:",
      audioTextCutsMode ? "(omitted for Audio + Text)" : (scriptPayload.cutTimedSrtPlan ? JSON.stringify(scriptPayload.cutTimedSrtPlan, null, 2) : "(none)"),
      "Script/table input HTML:",
      audioTextCutsMode ? "(omitted for Audio + Text)" : scriptHtmlPrompt,
      "User request:",
      userPrompt
    ];
    var filtered = [];
    for (var lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      if (lines[lineIndex] !== "") {
        filtered.push(lines[lineIndex]);
      }
    }
    return filtered.join("\n\n");
  }

  function scriptTablePayloadToHtml(payload) {
    var tablePayload = payload && payload.scriptTable ? payload.scriptTable : null;
    var rows = tablePayload && tablePayload.rows ? tablePayload.rows : (payload && payload.scriptRows ? payload.scriptRows : []);
    var columns = tablePayload && tablePayload.columns ? tablePayload.columns : [];
    if (!rows || !rows.length) {
      return "";
    }
    var allowedRoles = {
      text: true,
      optimizedText: true,
      cut: true,
      source: true,
      notes: true,
      skip: true
    };
    var table = document.createElement("table");
    var tbody = document.createElement("tbody");

    function appendCell(row, value, header, fallbackRole) {
      var descriptor = value && typeof value === "object" ? value : null;
      var cell = document.createElement(header ? "th" : "td");
      var text = descriptor ? (descriptor.text !== undefined ? descriptor.text : descriptor.value) : value;
      setCellText(cell, text === undefined || text === null ? "" : String(text));
      var rowspan = descriptor ? Number(descriptor.rowspan || 1) : 1;
      var colspan = descriptor ? Number(descriptor.colspan || 1) : 1;
      rowspan = isNaN(rowspan) ? 1 : Math.max(1, Math.min(500, Math.floor(rowspan)));
      colspan = isNaN(colspan) ? 1 : Math.max(1, Math.min(100, Math.floor(colspan)));
      if (rowspan > 1) {
        cell.setAttribute("rowspan", String(rowspan));
      }
      if (colspan > 1) {
        cell.setAttribute("colspan", String(colspan));
      }
      var role = descriptor && descriptor.role ? String(descriptor.role) : String(fallbackRole || "");
      if (allowedRoles[role]) {
        cell.setAttribute("data-column-role", role);
      }
      row.appendChild(cell);
    }

    if (columns.length) {
      var headerRow = document.createElement("tr");
      for (var c = 0; c < columns.length; c++) {
        var column = columns[c];
        var columnName = column && typeof column === "object" ? (column.name || column.label || column.role || "") : column;
        var columnRole = column && typeof column === "object" ? column.role : "";
        appendCell(headerRow, { text: columnName, role: columnRole }, true, columnRole);
      }
      tbody.appendChild(headerRow);
    }
    for (var r = 0; r < rows.length; r++) {
      if (Object.prototype.toString.call(rows[r]) !== "[object Array]") {
        continue;
      }
      var bodyRow = document.createElement("tr");
      for (var cellIndex = 0; cellIndex < rows[r].length; cellIndex++) {
        appendCell(bodyRow, rows[r][cellIndex], false, "");
      }
      if (bodyRow.children.length) {
        tbody.appendChild(bodyRow);
      }
    }
    table.appendChild(tbody);
    return tbody.querySelectorAll("tr").length ? table.outerHTML : "";
  }

  function normalizeAgentScriptPayload(payload) {
    if (!payload || payload.scriptHtml) {
      return payload;
    }
    var html = scriptTablePayloadToHtml(payload);
    if (html) {
      payload.scriptHtml = html;
    }
    return payload;
  }

  function extractJson(text) {
    var fenced = text.match(/```json\s*([\s\S]*?)```/i);
    var source = fenced ? fenced[1] : text;
    var first = source.indexOf("{");
    var last = source.lastIndexOf("}");
    if (first === -1 || last === -1 || last <= first) {
      return extractStringActions(text);
    }
    return JSON.parse(source.slice(first, last + 1));
  }

  function extractStringActions(text) {
    var lines = String(text).split(/\n+/);
    var candidates = [];
    var actionStart = /^\s*(?:[-*]\s*)?(?:trim|move|delete|remove clip|disable|enable|marker|set\s+in|clear\s+in)/i;
    for (var i = 0; i < lines.length; i++) {
      if (actionStart.test(lines[i])) {
        candidates.push(lines[i].replace(/^\s*[-*]\s*/, ""));
      }
    }
    return normalizeActionPayload(candidates.join("\n"));
  }

  function refreshProject(options) {
    options = options || {};
    setStatus("Reading Premiere project...");
    var payload = targetSequenceId ? { targetSequenceId: targetSequenceId } : null;
    /* Clip effect components are only needed for style/graphics work; reading
       them walks every clip's component chain and dominates refresh time. */
    if (options.skipComponents) {
      payload = payload || {};
      payload.skipComponents = true;
    }
    return evalHost("prAI_getProjectSnapshot", payload).then(function (result) {
      if (!result.ok) {
        var fullError = result.error || "Could not read project.";
        lastProjectContextError = fullError;
        return evalHost("prAI_getProjectSnapshotLite", payload).then(function (liteResult) {
          if (!liteResult.ok) {
            lastProjectContextError = fullError + " | Lite refresh failed: " + (liteResult.error || "Unknown lite refresh error.");
            if (!options.quiet) {
              setStatus(lastProjectContextError, true);
              appendMessage("system", lastProjectContextError);
            } else {
              setStatus("Ready to send");
            }
            return false;
          }
          state = liteResult.data || {};
          state.diagnostics = state.diagnostics || {};
          state.diagnostics.fullSnapshotError = fullError;
          lastProjectContextError = fullError;
          renderTargetSequenceOptions();
          setStatus("Loaded lite Premiere context: " + ((state.projectItems && state.projectItems.length) || 0) + " item(s), " + ((state.sequences && state.sequences.length) || 0) + " sequence(s).");
          return true;
        });
      }
      state = result.data;
      lastProjectContextError = "";
      renderTargetSequenceOptions();
      if (!state.activeSequence && state.sequences && state.sequences.length && !targetSequenceId) {
        targetSequenceId = state.sequences[0].sequenceId || "";
        try {
          window.localStorage.setItem(targetSequenceStorageKey, targetSequenceId);
        } catch (storageErr) {
        }
        renderTargetSequenceOptions();
        if (targetSequenceId) {
          setStatus("Target sequence selected from project list.");
          return true;
        }
      }
      var diagnostics = state.diagnostics || {};
      var itemCount = diagnostics.projectItemCount !== undefined ? diagnostics.projectItemCount : (state.projectItems ? state.projectItems.length : 0);
      var sequenceCount = diagnostics.sequenceCount !== undefined ? diagnostics.sequenceCount : (state.sequences ? state.sequences.length : 0);
      setStatus("Project context loaded: " + itemCount + " item(s), " + sequenceCount + " sequence(s).");
      return true;
    });
  }

  function hasUsableProjectContext() {
    var itemCount = state && state.projectItems ? state.projectItems.length : 0;
    var sequenceCount = state && state.sequences ? state.sequences.length : 0;
    return itemCount > 0 || sequenceCount > 0 || !!(state && state.activeSequence);
  }

  function hasProjectItemContext() {
    return !!(state && state.projectItems && state.projectItems.length);
  }

  function refreshProjectContextForWork(options) {
    options = options || {};
    var refreshOptions = { quiet: options.quiet !== false, skipComponents: options.skipComponents === true };
    return refreshProject(refreshOptions).then(function (refreshed) {
      if (!refreshed && hasUsableProjectContext() && options.requireFresh !== true) {
        return true;
      }
      if (!refreshed) {
        return false;
      }
      if (!state.activeSequence && targetSequenceId) {
        return refreshProject(refreshOptions).then(function (secondRefresh) {
          return secondRefresh || hasUsableProjectContext();
        });
      }
      return true;
    });
  }

  function deferStartupWork(callback) {
    var run = function () {
      window.setTimeout(callback, 0);
    };
    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(run);
    } else {
      run();
    }
  }

  function normalizedVisibleText(node) {
    return String(node && node.textContent ? node.textContent : "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
  }

  function elementLooksLikeMaskControl(node) {
    if (!node || node.nodeType !== 1) {
      return false;
    }
    var text = normalizedVisibleText(node);
    return text.indexOf("Mask Control") !== -1 && text.indexOf("Mass Edit") !== -1 && text.indexOf("Mask Groups") !== -1;
  }

  function smallestMaskControlRoot() {
    var nodes = document.querySelectorAll("section, dialog, article, main, div");
    var best = null;
    for (var i = 0; i < nodes.length; i++) {
      if (!elementLooksLikeMaskControl(nodes[i])) {
        continue;
      }
      if (!best || normalizedVisibleText(nodes[i]).length < normalizedVisibleText(best).length) {
        best = nodes[i];
      }
    }
    return best;
  }

  function findElementByExactText(root, label) {
    var nodes = root ? root.querySelectorAll("*") : [];
    for (var i = 0; i < nodes.length; i++) {
      if (normalizedVisibleText(nodes[i]) === label) {
        return nodes[i];
      }
    }
    return null;
  }

  function findSmallestElementContainingText(root, label) {
    var nodes = root ? root.querySelectorAll("*") : [];
    var best = null;
    for (var i = 0; i < nodes.length; i++) {
      var text = normalizedVisibleText(nodes[i]);
      if (text.indexOf(label) === -1) {
        continue;
      }
      if (!best || text.length < normalizedVisibleText(best).length) {
        best = nodes[i];
      }
    }
    return best;
  }

  function textContainsAll(text, labels) {
    for (var i = 0; i < labels.length; i++) {
      if (text.indexOf(labels[i]) === -1) {
        return false;
      }
    }
    return true;
  }

  function sectionForMassEdit(root, heading) {
    var labels = ["MODE", "INVERTED", "OPACITY", "FEATHER", "EXPANSION"];
    var current = heading;
    var best = null;
    while (current && current !== root) {
      var text = normalizedVisibleText(current);
      if (textContainsAll(text, labels) && text.indexOf("Mask Groups") === -1) {
        best = current;
      }
      current = current.parentElement;
    }
    return best || heading;
  }

  function sectionForMaskGroups(root, heading) {
    var current = heading;
    var best = null;
    while (current && current !== root) {
      var text = normalizedVisibleText(current);
      if (text.indexOf("Mask Groups") !== -1 && text.indexOf("Mass Edit") === -1) {
        best = current;
      }
      current = current.parentElement;
    }
    return best || heading;
  }

  function commonParent(elements) {
    if (!elements.length) {
      return null;
    }
    var parent = elements[0].parentElement;
    while (parent) {
      var allInside = true;
      for (var i = 1; i < elements.length; i++) {
        if (!parent.contains(elements[i])) {
          allInside = false;
          break;
        }
      }
      if (allInside) {
        return parent;
      }
      parent = parent.parentElement;
    }
    return null;
  }

  function tagMaskControlCards(section) {
    if (!section) {
      return;
    }
    var controls = [
      { label: "MODE", cls: "pr-ai-mask-card-mode" },
      { label: "INVERTED", cls: "pr-ai-mask-card-inverted" },
      { label: "OPACITY", cls: "pr-ai-mask-card-opacity" },
      { label: "FEATHER", cls: "pr-ai-mask-card-feather" },
      { label: "EXPANSION", cls: "pr-ai-mask-card-expansion" }
    ];
    var cards = [];
    for (var i = 0; i < controls.length; i++) {
      var labelNode = findElementByExactText(section, controls[i].label) || findSmallestElementContainingText(section, controls[i].label);
      if (!labelNode) {
        continue;
      }
      var card = labelNode;
      while (card && card.parentElement && card.parentElement !== section) {
        var cardText = normalizedVisibleText(card);
        var parentText = normalizedVisibleText(card.parentElement);
        if (cardText.indexOf(controls[i].label) !== -1 && cardText.indexOf("Apply") !== -1 && textContainsAll(parentText, ["MODE", "INVERTED", "OPACITY", "FEATHER", "EXPANSION"])) {
          break;
        }
        card = card.parentElement;
      }
      if (card && card !== section) {
        card.className += card.className.indexOf("pr-ai-mask-mass-card") === -1 ? " pr-ai-mask-mass-card " + controls[i].cls : "";
        cards.push(card);
      }
    }
    var row = commonParent(cards);
    if (row && row !== section) {
      row.className += row.className.indexOf("pr-ai-mask-mass-row") === -1 ? " pr-ai-mask-mass-row" : "";
    }
  }

  function normalizeMaskControlLayout() {
    var root = smallestMaskControlRoot();
    if (!root) {
      return;
    }
    if (root.className.indexOf("pr-ai-mask-control-root") === -1) {
      root.className += " pr-ai-mask-control-root";
    }
    var massHeading = findElementByExactText(root, "Mass Edit") || findSmallestElementContainingText(root, "Mass Edit");
    var groupsHeading = findElementByExactText(root, "Mask Groups") || findSmallestElementContainingText(root, "Mask Groups");
    var massSection = sectionForMassEdit(root, massHeading);
    var groupsSection = sectionForMaskGroups(root, groupsHeading);
    if (massSection && groupsSection && massSection.parentElement && massSection.parentElement === groupsSection.parentElement) {
      var rowParent = massSection.parentElement;
      rowParent.className += rowParent.className.indexOf("pr-ai-mask-sections-row") === -1 ? " pr-ai-mask-sections-row" : "";
    }
    if (massSection) {
      massSection.className += massSection.className.indexOf("pr-ai-mask-mass-section") === -1 ? " pr-ai-mask-mass-section" : "";
      tagMaskControlCards(massSection);
    }
    if (groupsSection) {
      groupsSection.className += groupsSection.className.indexOf("pr-ai-mask-groups-section") === -1 ? " pr-ai-mask-groups-section" : "";
    }
  }

  function installMaskControlLayoutObserver() {
    normalizeMaskControlLayout();
    if (!window.MutationObserver) {
      return;
    }
    var pending = false;
    var observer = new MutationObserver(function () {
      if (pending) {
        return;
      }
      pending = true;
      window.setTimeout(function () {
        pending = false;
        normalizeMaskControlLayout();
      }, 60);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function askAgent() {
    if (window.PRAIChatUI && window.PRAIChatUI.isRunning()) {
      window.PRAIChatUI.stop();
      return;
    }
    if (isAgentRunning) {
      cancelActiveAgentResponse();
      return;
    }
    var request = els.prompt.value.replace(/^\s+|\s+$/g, "");
    closeScriptMentionMenu();
    var mentionedScript = applyScriptMentionSelection(request);
    request = request.split(scriptMentionMarker).join("");
    var selectedQuickModes = activeQuickModes();
    var imagesForRequest = imageAttachments.slice(0);
    var requestForRouting = request || (imagesForRequest.length ? "Convert the attached script image into the active script table." : "");
    var quickModes = workflowModesForRequest(requestForRouting, selectedQuickModes, imagesForRequest);
    var imageScriptRequest = requestLooksLikeImageScriptImport(requestForRouting, imagesForRequest, quickModes);
    if (!selectedQuickModes.length && !imageScriptRequest && (request || imagesForRequest.length) && window.PRAIChatUI && window.PRAIChatUI.wants()) {
      var chatImagePaths = [];
      for (var chatImageIndex = 0; chatImageIndex < imagesForRequest.length; chatImageIndex++) {
        if (imagesForRequest[chatImageIndex].path) {
          chatImagePaths.push(imagesForRequest[chatImageIndex].path);
        }
      }
      if (window.PRAIChatUI.send(request || "Look at the attached image(s).", chatImagePaths)) {
        els.prompt.value = "";
        renderPromptHighlight();
        imageAttachments = [];
        renderAttachments();
        return;
      }
    }
    if (!mentionedScript && (shouldUseDeterministicQuickMode(requestForRouting, quickModes) || imageScriptRequest)) {
      selectActiveScriptForWorkflow();
    }
    var scriptInput = getScriptInputPayload();
    var quickLabels = quickModes.map(quickModeLabel);
    var quickRequest = quickModes.length ? "Run requested workflow: " + quickLabels.join(", ") + "." : "";
    var workflowSummaryText = quickModes.length ? "\n\nWorkflow: " + quickLabels.join(", ") : "";
    var scriptWorkflowRequested = quickModes.indexOf("auto-cut") !== -1 || quickModes.indexOf("auto-cut-textbound") !== -1 || quickModes.indexOf("auto-cut-clipbound") !== -1 || quickModes.indexOf("auto-subtitle-layout") !== -1 || quickModes.indexOf("audio-text-cuts") !== -1 || quickModes.indexOf("full-processing") !== -1;
    if (scriptWorkflowRequested && !scriptInput.text && !imageScriptRequest) {
      appendMessage("system", "The active script is empty. Open or paste a script before running " + quickLabels.join(", ") + ".");
      setStatus("Active script is empty.", true);
      return;
    }
    var effectiveRequest = requestForRouting || quickRequest;
    if (requestLooksLikeRemovedVideoAi(effectiveRequest)) {
      appendMessage("system", "AI video text removal has been removed from this panel because the ComfyUI inpaint workflow was unstable. Use manual cover/caption workflows or an external video cleanup tool instead.");
      setStatus("AI text removal is disabled.", true);
      return;
    }
    if (!effectiveRequest) {
      return;
    }
    var scriptSummary = scriptInputSummary(scriptInput);
    var scriptSummaryText = scriptSummary ? "\n\nScript/table input: " + scriptSummary : "";
    activeUserRequest = effectiveRequest + scriptSummaryText;
    if (shouldUseDeterministicQuickMode(requestForRouting, quickModes) && !imageScriptRequest) {
      appendMessage("user", effectiveRequest + workflowSummaryText + scriptSummaryText);
      els.prompt.value = "";
      renderPromptHighlight();
      imageAttachments = [];
      renderAttachments();
      isAgentRunning = true;
      agentCancelRequested = false;
      var deterministicRunId = activeAgentRunId + 1;
      activeAgentRunId = deterministicRunId;
      startRequestTimer("Preparing workflow");
      setPendingActions({ actions: [] });
      setRunPhase("Refreshing project");
      setStatus("Refreshing Premiere context...");
      refreshProjectContextForWork({ quiet: true, requireFresh: true })
        .then(function (refreshed) {
          if (agentCancelRequested || deterministicRunId !== activeAgentRunId) {
            throw new Error("Response canceled.");
          }
          if (!refreshed) {
            throw new Error("Could not refresh the Premiere project. Full Process stopped before editing so newly imported sources are not missed.");
          }
          var refreshedScriptInput = getScriptInputPayload();
          var actions = deterministicQuickModeActions(refreshedScriptInput, quickModes);
          if (!actions.length) {
            throw new Error("Could not build local workflow actions from the selected script.");
          }
          var captionCount = refreshedScriptInput.cutTimedSrtPlan && refreshedScriptInput.cutTimedSrtPlan.captions ? refreshedScriptInput.cutTimedSrtPlan.captions.length : 0;
          var workflowMessage = "Running " + quickLabels.join(", ") + " from structured script rows.";
          if (quickModes.indexOf("auto-cut-textbound") !== -1) {
            workflowMessage += " Placing footage and " + captionCount + " text caption" + (captionCount === 1 ? "" : "s") + ".";
          }
          appendMessage("assistant", workflowMessage);
          setPendingActions({ actions: actions });
          setRunPhase("Applying edits");
          setStatus("Applying local workflow...");
          return applyJson();
        })
        .catch(function (err) {
          var message = String(err && err.message ? err.message : err);
          if (message === "Response canceled." || agentCancelRequested) {
            appendMessage("system", "Response canceled.");
            setStatus("Response canceled.");
            return;
          }
          appendMessage("system", message);
          setStatus("Local workflow failed.", true);
        })
        .then(function () {
          if (deterministicRunId === activeAgentRunId) {
            isAgentRunning = false;
            agentCancelRequested = false;
            activeAgentChild = null;
            stopRequestTimer(true, "ready", "Ready to send");
          }
        });
      return;
    }
    if (!imageScriptRequest && shouldUseValidatedActionCache(requestForRouting, quickModes) && applyCachedValidatedActions(scriptInput, quickModes)) {
      appendMessage("user", effectiveRequest + workflowSummaryText + scriptSummaryText);
      els.prompt.value = "";
      renderPromptHighlight();
      imageAttachments = [];
      renderAttachments();
      return;
    }

    chatHistory.push({ role: "user", content: effectiveRequest + scriptSummaryText });
    var imagePaths = [];
    for (var i = 0; i < imagesForRequest.length; i++) {
      if (imagesForRequest[i].path) {
        imagePaths.push(imagesForRequest[i].path);
      }
    }
    appendMessage("user", effectiveRequest + workflowSummaryText + scriptSummaryText + (imagesForRequest.length ? "\n\nImages: " + imagePaths.join(", ") : ""));
    els.prompt.value = "";
    renderPromptHighlight();
    imageAttachments = [];
    renderAttachments();
    var provider = els.provider.value;
    if (provider === "claude" && imagePaths.length) {
      provider = "codex";
      appendMessage("system", "Image attachments are being routed through Codex CLI so the files are available to the agent without another permission step.");
    }
    isAgentRunning = true;
    agentCancelRequested = false;
    var runId = activeAgentRunId + 1;
    activeAgentRunId = runId;
    startRequestTimer("Waiting for reply");
    setPendingActions({ actions: [] });
    setStatus("Running " + provider + "...");

    setRunPhase("Refreshing project");
    setStatus("Refreshing Premiere context...");

    refreshProjectContextForWork({ quiet: true })
      .then(function (refreshed) {
        if (agentCancelRequested || runId !== activeAgentRunId) {
          throw new Error("Response canceled.");
        }
        if (!refreshed) {
          appendMessage("system", "Could not refresh Premiere context. Proceeding with the last loaded context. Error: " + (lastProjectContextError || "Unknown refresh error.") + "\nDiagnostics: " + JSON.stringify(state && state.diagnostics ? state.diagnostics : {}, null, 2));
        }
        var agentPrompt = buildAgentPrompt(effectiveRequest, imagesForRequest, scriptInput);
        var estimatedTokens = Math.max(1, Math.round(agentPrompt.length / 4));
        setRunPhase("Waiting for reply");
        setStatus("Running " + provider + "... (~" + estimatedTokens + " input tokens)");
        return runAgent(provider, agentPrompt, imagePaths, runId);
      })
      .then(function (output) {
        if (agentCancelRequested || runId !== activeAgentRunId) {
          throw new Error("Response canceled.");
        }
        chatHistory.push({ role: "assistant", content: output });
        appendMessage("assistant", output);
        var actions = normalizeAgentScriptPayload(extractJson(output));
        if (imageScriptRequest && (!actions || !actions.scriptHtml)) {
          appendMessage("system", "The image response did not contain a usable script table, so nothing was added or assembled.");
          setPendingActions({ actions: [] });
          setStatus("Image could not be converted to a script.", true);
          return;
        }
        var imageScriptInstalled = false;
        if (actions && (actions.scriptEdits || actions.edits || actions.scriptHtml)) {
          var scriptEditCount = applyScriptValidationPayload(actions);
          imageScriptInstalled = imageScriptRequest && scriptEditCount > 0;
          updateSheetDiagnostics();
          if (imageScriptInstalled) {
            if (requestWantsImageScriptAssembly(effectiveRequest, quickModes, imagesForRequest)) {
              actions.actions = deterministicQuickModeActions(getScriptInputPayload(), quickModes);
            } else {
              actions.actions = [];
            }
          }
          if (!actions.actions || !actions.actions.length) {
            setPendingActions({ actions: [] });
            setStatus(imageScriptInstalled ? "Image converted to the active script." : (scriptEditCount ? "Script updated." : "Agent response ready."));
            return;
          }
        }
        if (actions && actions.actions && actions.actions.length && !requestExplicitlyAllowsPremiereActions(effectiveRequest, quickModes)) {
          appendMessage("system", "Ignored action JSON because the request did not explicitly ask to modify Premiere.");
          setPendingActions({ actions: [] });
          setStatus("Agent response ready. No edits applied.");
          return;
        }
        setPendingActions(actions);
        if (pendingActions.actions.length) {
          setRunPhase("Applying edits");
          setStatus("Actions ready. Applying automatically...");
          return applyJson();
        }
        setStatus("Agent response ready.");
      })
      .catch(function (err) {
        var message = String(err && err.message ? err.message : err);
        if (message === "Response canceled." || agentCancelRequested) {
          appendMessage("system", "Response canceled.");
          setStatus("Response canceled.");
          return;
        }
        appendMessage("system", message);
        setStatus("Agent command failed.", true);
      })
      .then(function () {
        if (runId === activeAgentRunId) {
          isAgentRunning = false;
          agentCancelRequested = false;
          activeAgentChild = null;
          stopRequestTimer(true, "ready", "Ready to send");
        }
      });
  }

  function applyJson() {
    if (!pendingActions.actions.length) {
      setStatus("No pending actions to apply.", true);
      return Promise.resolve();
    }

    setStatus("Applying actions...");
    return applyLocalAndHostActions(pendingActions).then(function (result) {
      if (!result.ok) {
        appendMessage("system", result.error || "Apply failed.");
        setStatus(result.error || "Apply failed.", true);
        return;
      }
      appendMessage("system", "Applied:\n" + JSON.stringify(result.data, null, 2));
      if (result.data && result.data.undoActions && result.data.undoActions.length) {
        undoStack.push({ actions: result.data.undoActions });
        updateUndoButton();
      }
      setPendingActions({ actions: [] });
      return refreshProject().then(function () {
        if (result.data && result.data.failed && result.data.failed.length) {
          setStatus("Applied " + (result.data.applied ? result.data.applied.length : 0) + " action(s); " + result.data.failed.length + " failed. " + summarizeApplyFailures(result.data), true);
        } else {
          var skipSummary = summarizeApplySkips(result.data);
          if (skipSummary) {
            setStatus("Applied " + (result.data && result.data.applied ? result.data.applied.length : 0) + " action(s). " + skipSummary);
          }
        }
      });
    }).catch(function (err) {
      var message = String(err && err.message ? err.message : err);
      appendMessage("system", message);
      setStatus(message, true);
    });
  }

  function undoLast() {
    if (!undoStack.length) {
      setStatus("Nothing to undo.", true);
      return;
    }

    var undoPayload = undoStack.pop();
    updateUndoButton();
    setStatus("Undoing last applied actions...");
    evalHost("prAI_applyActions", attachTargetSequence(undoPayload)).then(function (result) {
      if (!result.ok) {
        undoStack.push(undoPayload);
        updateUndoButton();
        appendMessage("system", result.error || "Undo failed.");
        setStatus(result.error || "Undo failed.", true);
        return;
      }
      appendMessage("system", "Undid last apply:\n" + JSON.stringify(result.data, null, 2));
      refreshProject();
    });
  }

  function isEditableTarget(target) {
    if (!target || !target.tagName) {
      return false;
    }
    var tag = target.tagName.toLowerCase();
    return tag === "textarea" || tag === "select" || tag === "input" || target.isContentEditable === true;
  }

  function stopEditableEvent(event) {
    if (isEditableTarget(event.target)) {
      event.stopPropagation();
      if (event.stopImmediatePropagation) {
        event.stopImmediatePropagation();
      }
      if ((event.type === "input" || event.type === "change") && event.target.focus) {
        event.target.focus();
      }
    }
  }

  function bindEditableTarget(target) {
    if (!isEditableTarget(target) || (els.scriptInput && els.scriptInput.contains(target)) || target.getAttribute("data-pr-ai-input-guard") === "1") {
      return;
    }
    target.setAttribute("data-pr-ai-input-guard", "1");
    target.addEventListener("keydown", stopEditableEvent);
    target.addEventListener("keypress", stopEditableEvent);
    target.addEventListener("keyup", stopEditableEvent);
    target.addEventListener("beforeinput", stopEditableEvent);
    target.addEventListener("input", stopEditableEvent);
    target.addEventListener("change", stopEditableEvent);
  }

  function scriptEditorKeyInterests() {
    var interests = [];
    var isMac = /Mac/i.test(String(navigator.platform || navigator.userAgent || ""));
    var plainKeys = isMac
      ? [51, 48, 36, 53, 49, 116, 121, 119, 115, 123, 126, 124, 125, 117]
      : [8, 9, 13, 27, 32, 33, 34, 35, 36, 37, 38, 39, 40, 46];
    var shortcutKeys = isMac ? [0, 8, 9, 7, 16, 6] : [65, 67, 86, 88, 89, 90];
    var editingNavigationKeys = isMac
      ? [51, 116, 121, 119, 115, 123, 126, 124, 125, 117]
      : [8, 33, 34, 35, 36, 37, 38, 39, 40, 46];
    var redoKey = isMac ? 6 : 90;
    var i;
    for (i = 0; i < plainKeys.length; i++) {
      interests.push({ keyCode: plainKeys[i], ctrlKey: false, altKey: false, shiftKey: false, metaKey: false });
    }
    for (i = 0; i < shortcutKeys.length; i++) {
      interests.push({ keyCode: shortcutKeys[i], ctrlKey: true, altKey: false, shiftKey: false, metaKey: false });
      interests.push({ keyCode: shortcutKeys[i], ctrlKey: false, altKey: false, shiftKey: false, metaKey: true });
    }
    for (i = 0; i < editingNavigationKeys.length; i++) {
      interests.push({ keyCode: editingNavigationKeys[i], ctrlKey: false, altKey: false, shiftKey: true, metaKey: false });
      interests.push({ keyCode: editingNavigationKeys[i], ctrlKey: true, altKey: false, shiftKey: false, metaKey: false });
      interests.push({ keyCode: editingNavigationKeys[i], ctrlKey: true, altKey: false, shiftKey: true, metaKey: false });
      interests.push({ keyCode: editingNavigationKeys[i], ctrlKey: false, altKey: true, shiftKey: false, metaKey: false });
      interests.push({ keyCode: editingNavigationKeys[i], ctrlKey: false, altKey: true, shiftKey: true, metaKey: false });
    }
    interests.push({ keyCode: redoKey, ctrlKey: true, altKey: false, shiftKey: true, metaKey: false });
    interests.push({ keyCode: redoKey, ctrlKey: false, altKey: false, shiftKey: true, metaKey: true });
    return interests;
  }

  function setScriptEditorKeyIsolation(enabled) {
    var cep = window.__adobe_cep__;
    if (!cep || typeof cep.registerKeyEventsInterest !== "function") {
      return;
    }
    try {
      cep.registerKeyEventsInterest(enabled ? JSON.stringify(scriptEditorKeyInterests()) : null);
    } catch (error) {
      setStatus("Could not isolate panel keyboard shortcuts: " + error.message, true);
    }
  }

  /* CEP/CEF routes keys like arrows, Home/End, Delete and Ctrl+A/C/V/X/Z to
     Premiere's own accelerator table (moving the playhead, rippling the
     timeline, etc.) unless the panel calls registerKeyEventsInterest for that
     exact key combo. That was only ever requested while the script editor
     overlay or its sheet had focus, so every other text field in the panel -
     above all the main composer prompt, but also every Settings/Styles input
     and the project-name field - left the timeline eating keystrokes meant
     for the field. This decides, for any focus target anywhere in the panel,
     whether the panel should be claiming that key surface right now. */
  function shouldIsolateKeysForFocus(target) {
    if (!target) {
      return false;
    }
    if (els.scriptEditorOverlay && !els.scriptEditorOverlay.hidden && els.scriptEditorOverlay.contains(target)) {
      return true;
    }
    if (els.scriptInput && els.scriptInput.contains(target)) {
      return true;
    }
    return isEditableTarget(target);
  }

  function syncKeyIsolationForFocus(target) {
    setScriptEditorKeyIsolation(shouldIsolateKeysForFocus(target));
  }

  els.refreshBtn.addEventListener("click", refreshProject);
  els.stylesBtn.addEventListener("click", openStylesOverlay);
  if (els.styleBrowserBtn) {
    els.styleBrowserBtn.addEventListener("click", openNativeStyleBrowserOverlay);
  }
  if (els.refreshStyleBrowserBtn) {
    els.refreshStyleBrowserBtn.addEventListener("click", refreshNativeStyleBrowser);
  }
  if (els.closeStyleBrowserBtn) {
    els.closeStyleBrowserBtn.addEventListener("click", closeNativeStyleBrowserOverlay);
  }
  if (els.styleBrowserOverlay) {
    els.styleBrowserOverlay.addEventListener("click", function (event) {
      if (event.target === els.styleBrowserOverlay) {
        closeNativeStyleBrowserOverlay();
      }
    });
  }
  if (els.workflowMapBtn) {
    els.workflowMapBtn.addEventListener("click", openWorkflowMap);
  }
  if (els.workflowMapSelect) {
    els.workflowMapSelect.addEventListener("change", function () {
      currentWorkflowMapId = els.workflowMapSelect.value || "functions";
      selectedWorkflowNodeId = activeWorkflowMap().nodes[0].id;
      drawWorkflowMap();
    });
  }
  if (els.closeWorkflowMapBtn) {
    els.closeWorkflowMapBtn.addEventListener("click", closeWorkflowMap);
  }
  if (els.workflowMapOverlay) {
    els.workflowMapOverlay.addEventListener("click", function (event) {
      if (event.target === els.workflowMapOverlay) {
        closeWorkflowMap();
      }
    });
  }
  if (els.workflowMapCanvas) {
    els.workflowMapCanvas.addEventListener("click", function (event) {
      var node = workflowMapNodeAt(event);
      if (node) {
        selectedWorkflowNodeId = node.id;
        drawWorkflowMap();
      }
    });
    els.workflowMapCanvas.addEventListener("mousemove", function (event) {
      els.workflowMapCanvas.style.cursor = workflowMapNodeAt(event) ? "pointer" : "default";
    });
  }
  if (els.insertWorkflowGuideBtn) {
    els.insertWorkflowGuideBtn.addEventListener("click", insertWorkflowGuide);
  }
  els.closeStylesBtn.addEventListener("click", closeStylesOverlay);
  els.stylesOverlay.addEventListener("click", function (event) {
    if (event.target === els.stylesOverlay) {
      closeStylesOverlay();
    }
  });
  els.addStyleBtn.addEventListener("click", addStyle);
  els.insertStylePromptBtn.addEventListener("click", insertStylePrompt);
  els.captionsBtn.addEventListener("click", openCaptionOverlay);
  els.closeCaptionBtn.addEventListener("click", closeCaptionOverlay);
  els.captionOverlay.addEventListener("click", function (event) {
    if (event.target === els.captionOverlay) {
      closeCaptionOverlay();
    }
  });
  els.importCaptionsBtn.addEventListener("click", importCaptionsFromOverlay);
  els.clearCaptionsBtn.addEventListener("click", function () {
    els.captionText.value = "";
    setCaptionStatus("Caption input cleared.");
  });
  els.settingsBtn.addEventListener("click", function () {
    openSettings();
  });
  els.editGuideBtn.addEventListener("click", openEditGuideOverlay);
  els.closeEditGuideBtn.addEventListener("click", closeEditGuideOverlay);
  els.editGuideOverlay.addEventListener("click", function (event) {
    if (event.target === els.editGuideOverlay) {
      closeEditGuideOverlay();
    }
  });
  els.closeSettingsBtn.addEventListener("click", closeSettings);
  var settingsTabButtons = document.querySelectorAll(".settings-tab");
  for (var settingsTabIndex = 0; settingsTabIndex < settingsTabButtons.length; settingsTabIndex++) {
    settingsTabButtons[settingsTabIndex].addEventListener("click", function (event) {
      setSettingsTab(event.currentTarget.getAttribute("data-settings-tab"));
    });
  }
  els.settingsOverlay.addEventListener("click", function (event) {
    if (event.target === els.settingsOverlay) {
      closeSettings();
    }
  });
  els.textTempFolder.addEventListener("input", saveSettings);
  els.xmlOutputFolder.addEventListener("input", saveSettings);
  els.xmlAfterCreateAction.addEventListener("change", saveSettings);
  els.includeComponents.addEventListener("change", saveSettings);
  if (els.ffmpegPath) {
    els.ffmpegPath.addEventListener("input", saveSettings);
  }
  if (els.whisperCommand) {
    els.whisperCommand.addEventListener("input", saveSettings);
  }
  if (els.whisperModel) {
    els.whisperModel.addEventListener("change", saveSettings);
  }
  if (els.whisperDevice) {
    els.whisperDevice.addEventListener("change", saveSettings);
  }
  if (els.defaultAudioTrack) {
    els.defaultAudioTrack.addEventListener("input", saveSettings);
  }
  if (els.audioHeadPad) {
    els.audioHeadPad.addEventListener("input", saveSettings);
  }
  if (els.audioTailPad) {
    els.audioTailPad.addEventListener("input", saveSettings);
  }
  if (els.captionMaxWords) {
    els.captionMaxWords.addEventListener("input", saveSettings);
  }
  if (els.captionMaxChars) {
    els.captionMaxChars.addEventListener("input", saveSettings);
  }
  if (els.captionSplitMode) {
    els.captionSplitMode.addEventListener("change", saveSettings);
  }
  if (els.captionTrimEndPunctuation) {
    els.captionTrimEndPunctuation.addEventListener("change", saveSettings);
  }
  if (els.detectAiBtn) {
    els.detectAiBtn.addEventListener("click", detectAiTools);
  }
  if (els.refreshAiModelsBtn) {
    els.refreshAiModelsBtn.addEventListener("click", refreshAiModels);
  }
  if (els.aiTestProvider) {
    els.aiTestProvider.addEventListener("change", function () {
      saveSettings();
      syncAiSettingsControls();
    });
  }
  if (els.claudeModelSelect) {
    els.claudeModelSelect.addEventListener("change", function () {
      saveSettings();
      renderAgentMenu("claude");
      syncComposerAiControls();
    });
  }
  if (els.claudeModeSelect) {
    els.claudeModeSelect.addEventListener("change", function () {
      saveSettings();
      renderAgentMenu("claude");
      syncComposerAiControls();
    });
  }
  if (els.codexModelSelect) {
    els.codexModelSelect.addEventListener("change", function () {
      saveSettings();
      renderAgentMenu("codex");
      syncComposerAiControls();
    });
  }
  if (els.codexModeSelect) {
    els.codexModeSelect.addEventListener("change", function () {
      saveSettings();
      renderAgentMenu("codex");
      syncComposerAiControls();
    });
  }
  if (els.provider) {
    els.provider.addEventListener("change", function () {
      if (els.aiTestProvider && els.aiTestProvider.value === "selected") {
        syncAiSettingsControls();
      }
      syncComposerAiControls();
    });
  }
  if (els.composerModelSelect) {
    els.composerModelSelect.addEventListener("change", applyComposerAiModel);
  }
  if (els.composerModeSelect) {
    els.composerModeSelect.addEventListener("change", applyComposerAiMode);
  }
  if (els.testAiBtn) {
    els.testAiBtn.addEventListener("click", function () {
      testAiProvider(selectedAiTestProvider());
    });
  }
  if (els.testClaudeBtn) {
    els.testClaudeBtn.addEventListener("click", function () {
      testAiProvider("claude");
    });
  }
  if (els.testCodexBtn) {
    els.testCodexBtn.addEventListener("click", function () {
      testAiProvider("codex");
    });
  }
	  if (els.detectWhisperBtn) {
    els.detectWhisperBtn.addEventListener("click", detectWhisperTools);
  }
  if (els.testWhisperBtn) {
    els.testWhisperBtn.addEventListener("click", testWhisperTools);
  }
  if (els.installFfmpegBtn) {
    els.installFfmpegBtn.addEventListener("click", installFfmpegTool);
  }
  if (els.installWhisperBtn) {
    els.installWhisperBtn.addEventListener("click", installWhisperTool);
  }
  if (els.testWhisperModelBtn) {
    els.testWhisperModelBtn.addEventListener("click", testWhisperModel);
  }
  if (els.downloadWhisperModelBtn) {
    els.downloadWhisperModelBtn.addEventListener("click", downloadWhisperModel);
  }
  if (els.generateAudioCaptionsBtn) {
    els.generateAudioCaptionsBtn.addEventListener("click", generateCaptionsFromAudioOnly);
  }
  if (els.generateAudioCaptionsQuickBtn) {
    els.generateAudioCaptionsQuickBtn.addEventListener("click", generateCaptionsFromAudioOnly);
  }
  els.browseTextFolderBtn.addEventListener("click", browseTextFolder);
  els.browseXmlFolderBtn.addEventListener("click", browseXmlFolder);
  els.resetTextFolderBtn.addEventListener("click", function () {
    els.textTempFolder.value = "";
    saveSettings();
    setSettingsStatus("Text file folder reset to default.");
    setStatus("Text file folder reset to default.");
  });
  els.resetXmlFolderBtn.addEventListener("click", function () {
    els.xmlOutputFolder.value = "";
    saveSettings();
    setSettingsStatus("XML export folder reset to project/XML default.");
    setStatus("XML export folder reset to project/XML default.");
  });
  if (els.maxBtn) {
    els.maxBtn.addEventListener("click", toggleMaximized);
  }
  els.attachBtn.addEventListener("click", function () {
    els.imageInput.click();
  });
  els.imageInput.addEventListener("change", function () {
    addImageFiles(els.imageInput.files || []);
    els.imageInput.value = "";
  });
  els.diagnoseBtn.addEventListener("click", diagnoseCli);
  els.undoBtn.addEventListener("click", undoLast);
  els.editGuide.addEventListener("input", saveEditGuide);
  if (els.targetSequence) {
    els.targetSequence.addEventListener("change", function () {
      saveTargetSequenceSetting();
      refreshProject();
    });
  }
  if (els.scriptProjectSelect) {
    els.scriptProjectSelect.addEventListener("change", function () {
      if (els.scriptProjectSelect.value === "__new_script_project__") {
        addScriptProject(true);
        return;
      }
      switchScriptProject(els.scriptProjectSelect.value);
    });
  }
  if (els.scriptProjectSettingsBtn) {
    els.scriptProjectSettingsBtn.addEventListener("click", function () {
      openScriptProjectOverlay();
    });
  }
  if (els.closeScriptProjectBtn) {
    els.closeScriptProjectBtn.addEventListener("click", closeScriptProjectOverlay);
  }
  if (els.addScriptProjectPanelBtn) {
    els.addScriptProjectPanelBtn.addEventListener("click", function () {
      addScriptProject(true);
      openScriptProjectOverlay();
    });
  }
  if (els.scriptProjectOverlay) {
    els.scriptProjectOverlay.addEventListener("click", function (event) {
      if (event.target === els.scriptProjectOverlay) {
        closeScriptProjectOverlay();
      }
    });
    els.scriptProjectOverlay.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeScriptProjectOverlay();
      }
    });
  }
  if (els.renameScriptProjectBtn) {
    els.renameScriptProjectBtn.addEventListener("click", renameScriptProject);
  }
  if (els.deleteScriptProjectBtn) {
    els.deleteScriptProjectBtn.addEventListener("click", deleteScriptProject);
  }
  if (els.scriptProjectNameInput) {
    els.scriptProjectNameInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        renameScriptProject();
      }
    });
  }
  els.addSheetRowBtn.addEventListener("click", addSheetRow);
  els.addSheetColumnBtn.addEventListener("click", addSheetColumn);
  if (els.undoSheetBtn) {
    els.undoSheetBtn.addEventListener("click", undoSheetChange);
  }
  if (els.redoSheetBtn) {
    els.redoSheetBtn.addEventListener("click", redoSheetChange);
  }
  if (els.sheetColumnRole) {
    els.sheetColumnRole.addEventListener("pointerdown", function (event) {
      event.stopPropagation();
    });
    els.sheetColumnRole.addEventListener("mousedown", function (event) {
      event.stopPropagation();
    });
    els.sheetColumnRole.addEventListener("click", function (event) {
      event.stopPropagation();
    });
    els.sheetColumnRole.addEventListener("input", setSelectedColumnRole);
    els.sheetColumnRole.addEventListener("change", setSelectedColumnRole);
  }
  els.clearSheetBtn.addEventListener("click", clearSheetInput);
  if (els.clearScriptBtn) {
    els.clearScriptBtn.addEventListener("click", clearSheetInput);
  }
  if (els.validateScriptBtn) {
    els.validateScriptBtn.addEventListener("click", function () {
      validateScriptWithAgent({ useAgent: false });
    });
  }
  if (els.validateScriptAiBtn) {
    els.validateScriptAiBtn.addEventListener("click", function () {
      validateScriptWithAgent({ useAgent: true });
    });
  }
  if (els.splitScriptTextBtn) {
    els.splitScriptTextBtn.addEventListener("click", splitScriptTextWithAgent);
  }
  if (els.scriptNotesTrackToggle) {
    els.scriptNotesTrackToggle.addEventListener("change", function () {
      saveActiveScriptDocument();
      setStatus(scriptWantsNotesTrack()
        ? "Notes caption track will be created alongside captions."
        : "Notes caption track is off for this script.");
    });
  }
  if (els.scriptSplitTextToggle) {
    els.scriptSplitTextToggle.addEventListener("change", function () {
      saveActiveScriptDocument();
      if (!scriptWantsSplitText()) {
        var removed = removeAutoGeneratedOptimizedTextColumn();
        updateSheetDiagnostics();
        setStatus(removed ? "Split text off; removed the generated Optimized Text column." : "Split text off for this script.");
        return;
      }
      setStatus("Split text on. Press Split Text, or Validate with AI, to have the agent read the columns and split.");
    });
  }
  if (els.applyValidatedScriptBtn) {
    els.applyValidatedScriptBtn.addEventListener("click", applyValidatedScriptToTimeline);
  }
  els.addScriptBtn.addEventListener("click", addScriptDocument);
  if (els.importScriptCsvBtn) {
    els.importScriptCsvBtn.addEventListener("click", importScriptCsvFile);
  }
  els.duplicateScriptBtn.addEventListener("click", duplicateScriptDocument);
  els.renameScriptBtn.addEventListener("click", renameScriptDocument);
  els.deleteScriptBtn.addEventListener("click", deleteScriptDocument);
  els.closeScriptEditorBtn.addEventListener("click", closeScriptEditor);
  if (els.cancelScriptEditorBtn) {
    els.cancelScriptEditorBtn.addEventListener("click", cancelScriptEditor);
  }
  els.scriptEditorOverlay.addEventListener("click", function (event) {
    if (event.target === els.scriptEditorOverlay) {
      cancelScriptEditor();
    }
  });
  if (els.closeScriptValidationBtn) {
    els.closeScriptValidationBtn.addEventListener("click", closeScriptValidationOverlay);
  }
  if (els.scriptValidationOverlay) {
    els.scriptValidationOverlay.addEventListener("click", function (event) {
      if (event.target === els.scriptValidationOverlay) {
        closeScriptValidationOverlay();
      }
    });
  }
  els.scriptNameInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      renameScriptDocument();
    }
  });
  if (els.scriptValidationPrompt) {
    els.scriptValidationPrompt.addEventListener("input", function () {
      activeScriptDocument().validationPrompt = String(els.scriptValidationPrompt.value || "");
      saveScriptDocuments();
    });
  }
  els.deleteSheetRowBtn.addEventListener("click", function () {
    deleteSheetRow();
  });
  if (els.insertSheetRowAboveBtn) {
    els.insertSheetRowAboveBtn.addEventListener("click", function () {
      insertSheetRowAt(sheetContextRowIndex);
    });
  }
  if (els.insertSheetRowBelowBtn) {
    els.insertSheetRowBelowBtn.addEventListener("click", function () {
      insertSheetRowAt(Number(sheetContextRowIndex || 0) + 1);
    });
  }
  if (els.insertSheetColumnLeftBtn) {
    els.insertSheetColumnLeftBtn.addEventListener("click", function () {
      insertSheetColumnAt(sheetContextColumnIndex);
    });
  }
  if (els.insertSheetColumnRightBtn) {
    els.insertSheetColumnRightBtn.addEventListener("click", function () {
      insertSheetColumnAt(Number(sheetContextColumnIndex || 0) + 1);
    });
  }
  if (els.deleteSheetColumnBtn) {
    els.deleteSheetColumnBtn.addEventListener("click", function () {
      deleteSheetColumn();
    });
  }
  els.scriptInput.addEventListener("focus", function () {
    setScriptEditorKeyIsolation(true);
    if (!els.scriptInput.querySelector("table")) {
      var createdTable = ensureScriptTable();
      enterSheetEdit(createdTable.querySelector("td,th"));
    } else if (!sheetSelection) {
      focusSheetCell(activeSheetCell() || els.scriptInput.querySelector("td,th"));
    }
  });
  els.scriptInput.addEventListener("click", function (event) {
    var table = els.scriptInput.querySelector("table") || ensureScriptTable();
    var clickedCell = sheetCellFromEventTarget(event.target);
    var targetCell = clickedCell || activeSheetCell() || table.querySelector("td,th");
    if (!targetCell) {
      return;
    }
    if (!clickedCell) {
      focusSheetCell(targetCell);
    }
    if (!sheetEditMode && !sheetCellText(targetCell).replace(/\s+/g, "")) {
      enterSheetEdit(targetCell);
    }
  });
  els.scriptInput.addEventListener("input", handleSheetInput);
  els.scriptInput.addEventListener("beforeinput", handleSheetBeforeInput, true);
  els.scriptInput.addEventListener("keydown", handleSheetKeyDown, true);
  els.scriptInput.addEventListener("mousedown", handleSheetCellMouseDown);
  els.scriptInput.addEventListener("mouseover", handleSheetCellMouseOver);
  els.scriptInput.addEventListener("scroll", function () {
    if (els.sheetRowRail) {
      els.sheetRowRail.scrollTop = els.scriptInput.scrollTop;
    }
    if (els.sheetColumnRail) {
      els.sheetColumnRail.scrollLeft = els.scriptInput.scrollLeft;
    }
  });
  els.scriptInput.addEventListener("dblclick", function (event) {
    var cell = sheetCellFromEventTarget(event.target);
    if (cell) {
      event.preventDefault();
      enterSheetEdit(cell);
      placeCaretFromPoint(cell, event.clientX, event.clientY);
    }
  });
  els.scriptInput.addEventListener("copy", handleSheetCopy);
  els.scriptInput.addEventListener("cut", handleSheetCut);
  els.scriptInput.addEventListener("contextmenu", openSheetCellMenu);
  document.addEventListener("mouseup", handleSheetCellMouseUp);
  document.addEventListener("mousemove", handleSheetPointerMove);
  document.addEventListener("mousedown", function (event) {
    if (sheetEditMode && sheetEditingCell && !sheetEditingCell.contains(event.target)) {
      finishSheetEdit(true);
    }
  }, true);
  window.addEventListener("keydown", handleScriptEditorControlArrow, true);
  document.addEventListener("keydown", handleGlobalShortcutKeys, true);
  document.addEventListener("keydown", blockSheetNavigationLeak, true);
  document.addEventListener("click", function (event) {
    if (els.sheetContextMenu && !els.sheetContextMenu.hidden && !els.sheetContextMenu.contains(event.target)) {
      closeSheetRowMenu();
    }
  });
  var quickActionButtons = document.querySelectorAll(".quick-action");
  for (var quickIndex = 0; quickIndex < quickActionButtons.length; quickIndex++) {
    quickActionButtons[quickIndex].addEventListener("click", handleQuickAction);
  }
  document.addEventListener("keydown", stopEditableEvent);
  document.addEventListener("keypress", stopEditableEvent);
  document.addEventListener("keyup", stopEditableEvent);
  document.addEventListener("beforeinput", stopEditableEvent);
  document.addEventListener("input", stopEditableEvent);
  document.addEventListener("change", stopEditableEvent);
  document.addEventListener("focusin", function (event) {
    bindEditableTarget(event.target);
    syncKeyIsolationForFocus(event.target);
  });
  /* A field losing focus does not itself mean no field has focus - the browser
     is usually about to focus whatever was just clicked or tabbed to. Check
     document.activeElement once that has settled instead of assuming this
     event's target is where focus ends up. */
  document.addEventListener("focusout", function () {
    window.setTimeout(function () {
      syncKeyIsolationForFocus(document.activeElement);
    }, 0);
  });
  els.prompt.addEventListener("keydown", function (event) {
    if (handleScriptMentionKeydown(event)) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      askAgent();
    }
  });
  els.prompt.addEventListener("input", function () {
    updateScriptMentionMenu();
    renderPromptHighlight();
  });
  els.prompt.addEventListener("scroll", function () {
    if (els.promptHighlight) {
      els.promptHighlight.scrollTop = els.prompt.scrollTop;
      els.promptHighlight.scrollLeft = els.prompt.scrollLeft;
    }
  });
  els.prompt.addEventListener("click", updateScriptMentionMenu);
  els.prompt.addEventListener("keyup", function (event) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") {
      updateScriptMentionMenu();
    }
  });
  els.prompt.addEventListener("blur", closeScriptMentionMenu);

  /* Diagnostics for the CEP arrow-key/timeline conflict. registerKeyEventsInterest
     is the only sanctioned way to claim a key combo away from Premiere's own
     accelerator table, but Adobe's hosts have shipped versions where it is
     missing entirely, or where it is accepted without error yet still fails to
     stop Premiere's own handling of certain keys - arrow-key timeline/frame
     stepping is the most frequently reported case of the latter, and no
     JS-only workaround can substitute for a native routing decision the host
     itself made before the keydown ever reached this page. These checks turn
     "still doesn't work" into a concrete yes/no on which situation this is. */
  (function reportKeyIsolationCapability() {
    var cep = window.__adobe_cep__;
    if (!cep || typeof cep.registerKeyEventsInterest !== "function") {
      appendMessage("system", "Keyboard isolation is unavailable in this Premiere/CEP host (window.__adobe_cep__.registerKeyEventsInterest is missing). Typing arrows, Home/End, Delete, or Ctrl+A/C/V/X/Z into any panel field can still reach Premiere's timeline; this is a host limitation this extension cannot work around from script.");
    }
  })();

  var reportedKeyDeliveryOnce = false;
  window.addEventListener("keydown", function (event) {
    if (reportedKeyDeliveryOnce || !isEditableTarget(document.activeElement)) {
      return;
    }
    var watchedKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", "Backspace", "Delete"];
    if (watchedKeys.indexOf(event.key) === -1) {
      return;
    }
    reportedKeyDeliveryOnce = true;
    setStatus("Panel received " + event.key + " while typing (isolation " + (shouldIsolateKeysForFocus(document.activeElement) ? "ON" : "OFF") + "). If the Premiere timeline also moved just now, registerKeyEventsInterest is not suppressing that key in this host - see the system message log for next steps.");
  }, true);
  if (els.sendBtn) {
    els.sendBtn.addEventListener("click", askAgent);
  }
  els.scriptInput.addEventListener("keydown", function (event) {
    if (currentSheetCell()) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      askAgent();
    }
  });
  els.scriptEditorOverlay.addEventListener("paste", handleScriptOverlayPaste, true);
  els.scriptInput.addEventListener("paste", handleScriptInputPaste);
  els.prompt.addEventListener("paste", function (event) {
    var items = event.clipboardData && event.clipboardData.items ? event.clipboardData.items : [];
    var files = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf("image/") === 0) {
        files.push(items[i].getAsFile());
      }
    }
    if (files.length) {
      addImageFiles(files);
      event.preventDefault();
    }
  });
  els.prompt.addEventListener("dragover", function (event) {
    event.preventDefault();
  });
  els.prompt.addEventListener("drop", function (event) {
    event.preventDefault();
    if (event.dataTransfer && event.dataTransfer.files) {
      addImageFiles(event.dataTransfer.files);
    }
  });
  document.addEventListener("click", function (event) {
    var openMenus = document.querySelectorAll(".agent-choice-menu[open]");
    for (var menuIndex = 0; menuIndex < openMenus.length; menuIndex++) {
      if (!openMenus[menuIndex].contains(event.target)) {
        openMenus[menuIndex].removeAttribute("open");
      }
    }
  });
  document.addEventListener("keydown", function (event) {
    if (isEditableTarget(event.target)) {
      return;
    }
    var isUndo = (event.metaKey || event.ctrlKey) && !event.shiftKey && String(event.key).toLowerCase() === "z";
    if (isUndo && undoStack.length) {
      event.preventDefault();
      undoLast();
    }
    var openAgentMenu = document.querySelector(".agent-choice-menu[open]");
    if (event.key === "Escape" && openAgentMenu) {
      event.preventDefault();
      openAgentMenu.removeAttribute("open");
      var summary = openAgentMenu.querySelector("summary");
      if (summary) summary.focus();
    } else if (event.key === "Escape" && els.scriptValidationOverlay && !els.scriptValidationOverlay.hidden) {
      event.preventDefault();
      closeScriptValidationOverlay();
    } else if (event.key === "Escape" && els.scriptEditorOverlay && !els.scriptEditorOverlay.hidden) {
      event.preventDefault();
      cancelScriptEditor();
    } else if (event.key === "Escape" && els.styleBrowserOverlay && !els.styleBrowserOverlay.hidden) {
      event.preventDefault();
      closeNativeStyleBrowserOverlay();
    } else if (event.key === "Escape" && els.workflowMapOverlay && !els.workflowMapOverlay.hidden) {
      event.preventDefault();
      closeWorkflowMap();
    } else if (event.key === "Escape" && els.editGuideOverlay && !els.editGuideOverlay.hidden) {
      event.preventDefault();
      closeEditGuideOverlay();
    } else if (event.key === "Escape" && !els.stylesOverlay.hidden) {
      event.preventDefault();
      closeStylesOverlay();
    } else if (event.key === "Escape" && !els.captionOverlay.hidden) {
      event.preventDefault();
      closeCaptionOverlay();
    } else if (event.key === "Escape" && els.scriptProjectOverlay && !els.scriptProjectOverlay.hidden) {
      event.preventDefault();
      closeScriptProjectOverlay();
    } else if (event.key === "Escape" && !els.settingsOverlay.hidden) {
      event.preventDefault();
      closeSettings();
    }
  });

  if (els.scriptTabs) {
    els.scriptTabs.addEventListener("scroll", updateScriptTabOverflowFade);
  }
  window.addEventListener("resize", updateScriptTabOverflowFade);

  appendMessage("assistant", "Tell me what to change in the active sequence. I can prepare markers, in/out points, trims, moves, deletes, clip enable toggles, project item inserts, and project item renames for review before applying.");
  loadSettings();
  loadEditGuide();
  loadTargetSequenceSetting();
  loadScriptDocuments();
  els.scriptInput.innerHTML = activeScriptDocument().html || "";
  renderScriptTabs();
  installMaskControlLayoutObserver();
  bindRemoveMaskEditor();
  syncRemoveMaskFromInputs();
  setPendingActions({ actions: [] });
  updateUndoButton();
  renderRunStatus("ready", "Ready to send");
  deferStartupWork(function () {
    updateSheetRails();
    refreshProject({ quiet: true });
  });

  /* ---------- PR AI agent chat bridge (agent/chat-ui.js) ---------- */
  function agentApplyTracked(actions) {
    return applyLocalAndHostActions({ actions: actions }).then(function (result) {
      if (!result.ok) {
        throw new Error(result.error || "Apply failed.");
      }
      var data = result.data || {};
      if (data.undoActions && data.undoActions.length) {
        undoStack.push({ actions: data.undoActions });
        updateUndoButton();
      }
      return refreshProject({ quiet: true, skipComponents: true }).then(function () {
        return {
          applied: (data.applied || []).length,
          failed: (data.failed || []).map(function (f) { return { type: f && f.type, error: f && f.error }; }),
          undoable: !!(data.undoActions && data.undoActions.length)
        };
      });
    });
  }

  function agentClipList(clips) {
    var out = [];
    for (var i = 0; clips && i < clips.length && i < 80; i++) {
      out.push({ name: clips[i].name, start: clips[i].startSeconds, end: clips[i].endSeconds, disabled: clips[i].disabled || undefined });
    }
    if (clips && clips.length > out.length) {
      out.push({ more: clips.length - out.length });
    }
    return out;
  }

  function agentTracks(tracks, prefix) {
    var out = [];
    for (var i = 0; tracks && i < tracks.length; i++) {
      out.push({ track: prefix + ((tracks[i].index !== undefined ? tracks[i].index : i) + 1), clips: agentClipList(tracks[i].clips) });
    }
    return out;
  }

  window.prAIAgentHost = {
    els: els,
    nodeRequire: getNodeRequire,
    renderMarkdown: renderMarkdown,
    copyText: copyText,
    setCopyIcon: setCopyIcon,
    setStatus: setStatus,
    provider: function () {
      return els.provider && els.provider.value === "codex" ? "codex" : "claude";
    },
    aiModel: getAiModel,
    aiEffort: function (provider) {
      var mode = getAiMode(provider);
      return provider === "claude" && mode && mode.indexOf("effort:") === 0 ? mode.replace(/^effort:/, "") : "";
    },
    chatCommand: getChatCliCommand,
    runStarted: function (label) {
      startRequestTimer(label || "Waiting for reply");
    },
    runPhase: setRunPhase,
    runEnded: function () {
      stopRequestTimer(true, "ready", "Ready to send");
    },
    srt: {
      parseSrtBlocks: parseSrtBlocks,
      buildSrtFromBlocks: buildSrtFromBlocks,
      optimizedCaptionItemsFromTimedBlocks: optimizedCaptionItemsFromTimedBlocks,
      whisperWordsFromJsonText: whisperWordsFromJsonText,
      captionSettings: getCaptionChunkSettings
    },
    projectContext: function (includeItems) {
      return refreshProject({ quiet: true, skipComponents: true }).then(function () {
        return evalHost("prAI_getSelectedTimelineClips");
      }).then(function (selection) {
        var seq = state && state.activeSequence;
        var ctx = {
          project_name: state && state.projectName || "",
          project_path: state && state.projectPath || "",
          active_sequence: seq ? {
            name: seq.name,
            fps: seq.sequenceFps,
            video_tracks: agentTracks(seq.videoTracks, "V"),
            audio_tracks: agentTracks(seq.audioTracks, "A")
          } : null,
          sequences: (state && state.sequences || []).map(function (s) { return s.name; }),
          selected_clips: selection && selection.ok && selection.data ? agentClipList(selection.data.clips) : [],
          whisper_configured: !!getWhisperSettings().command,
          caption_settings: getCaptionChunkSettings()
        };
        if (lastProjectContextError) {
          ctx.warning = lastProjectContextError;
        }
        if (includeItems) {
          ctx.project_items = (state && state.projectItems || []).slice(0, 400).map(function (item) {
            return { name: item.name, type: item.type, path: item.mediaPath || item.sourcePath || undefined };
          });
        }
        return ctx;
      });
    },
    selectedClips: function () {
      return evalHost("prAI_getSelectedTimelineClips").then(function (result) {
        if (!result.ok) {
          throw new Error(result.error || "Could not read the Timeline selection.");
        }
        return (result.data && result.data.clips) || [];
      });
    },
    activeScript: function () {
      if (window.__edieExternalScript && window.__edieExternalScript.text) {
        return { name: window.__edieExternalScript.name || "Attached script", text: window.__edieExternalScript.text };
      }
      var payload = getScriptInputPayload() || {};
      var doc = activeScriptDocument();
      return { name: doc && (doc.name || doc.title) || "", text: payload.text || "" };
    },
    transcribe: function (action) {
      return refreshProject({ quiet: true, skipComponents: true }).then(function () {
        return runLocalAudioSubtitleAction(action);
      });
    },
    importSrt: function (contents, startAt) {
      var payload = attachTextTempFolder({ actions: [{
        type: "importSrtFile",
        contents: contents,
        startAtTime: startAt || 0,
        createCaptionTrack: true,
        allowCaptionTrackCreate: true,
        suppressUI: true,
        cleanupAfterImport: false,
        removeProjectItemAfterCaptionTrack: false,
        source: "praiAgentChat"
      }] });
      attachTargetSequence(payload);
      return evalHost("prAI_applyActions", payload).then(function (result) {
        if (!result.ok) {
          throw new Error(result.error || "Caption import failed.");
        }
        var data = result.data || {};
        if (data.failed && data.failed.length) {
          throw new Error((data.failed[0] && data.failed[0].error) || "Caption import failed.");
        }
        refreshProject({ quiet: true, skipComponents: true });
        return { imported: true, note: "Premiere's scripting API cannot remove a caption track; delete it by hand if unwanted." };
      });
    },
    runPreset: function (id) {
      if (id === "auto-captions") {
        return refreshProject({ quiet: true, skipComponents: true }).then(function () {
          return runLocalAudioSubtitleAction({ type: "transcribeAudioTrackToSrt", optimizeCaptions: true, createCaptionTrack: true, allowCaptionTrackCreate: true, suppressUI: true });
        }).then(function (result) {
          refreshProject({ quiet: true, skipComponents: true });
          return { captions: result.subtitleCount, audio: result.track, srt_path: result.srtPath };
        });
      }
      return refreshProjectContextForWork({ quiet: true, requireFresh: true }).then(function (refreshed) {
        if (!refreshed) {
          throw new Error("Could not refresh the Premiere project, so the workflow did not start.");
        }
        selectActiveScriptForWorkflow();
        var scriptInput = window.__edieExternalScript && window.__edieExternalScript.text
          ? { text: window.__edieExternalScript.text, source: "edieAttachment" }
          : getScriptInputPayload();
        if (id !== "create-new-sequence" && !scriptInput.text) {
          throw new Error("The active script is empty. Open or paste a script in the Script tab first.");
        }
        var actions = deterministicQuickModeActions(scriptInput, [id]);
        if (!actions.length) {
          throw new Error("Could not build workflow actions from the active script.");
        }
        return agentApplyTracked(actions);
      });
    },
    legacyActions: function () {
      return supportedActions;
    },
    applyActions: function (actions) {
      var normalized = normalizeActionPayload({ actions: actions });
      return agentApplyTracked((normalized && normalized.actions) || actions);
    },
    undoLast: function () {
      if (!undoStack.length) {
        return Promise.reject(new Error("There is nothing of PR AI's to undo."));
      }
      var undoPayload = undoStack.pop();
      updateUndoButton();
      return evalHost("prAI_applyActions", attachTargetSequence(undoPayload)).then(function (result) {
        if (!result.ok) {
          undoStack.push(undoPayload);
          updateUndoButton();
          throw new Error(result.error || "Undo failed.");
        }
        refreshProject({ quiet: true, skipComponents: true });
        return { undone: true };
      });
    }
  };
  if (window.PRAIAgentTools && window.PRAIAgentTools.createHandlers) {
    var paletteToolCall = window.PRAIAgentTools.createHandlers({
      nodeRequire: getNodeRequire(),
      srt: window.prAIAgentHost.srt,
      projectContext: window.prAIAgentHost.projectContext,
      selectedClips: window.prAIAgentHost.selectedClips,
      activeScript: window.prAIAgentHost.activeScript,
      transcribe: window.prAIAgentHost.transcribe,
      importSrt: window.prAIAgentHost.importSrt,
      runPreset: window.prAIAgentHost.runPreset,
      legacyActions: window.prAIAgentHost.legacyActions,
      applyActions: window.prAIAgentHost.applyActions,
      undoLast: window.prAIAgentHost.undoLast,
      confirm: function () { return true; }
    });
    window.prAIAgentHost.runAIFunction = function (id, args) {
      var workflowIds = {
        "ai-auto-captions": "auto-captions",
        "ai-full-processing": "full-processing",
        "ai-layout": "auto-cut-textbound",
        "ai-audio-text": "audio-text-cuts",
        "ai-add-text": "auto-subtitle-layout",
        "ai-new-sequence": "create-new-sequence"
      };
      if (id === "ai-create-optimized-subtitles") {
        return paletteToolCall("create_optimized_subtitles", args || {});
      }
      if (id === "ai-transcribe-optimized-srt") {
        var onlyFileArgs = args || {};
        onlyFileArgs.import_to_timeline = false;
        return paletteToolCall("create_optimized_subtitles", onlyFileArgs);
      }
      if (workflowIds[id]) {
        return window.prAIAgentHost.runPreset(workflowIds[id]);
      }
      return Promise.reject(new Error("Unknown Edie AI function: " + id));
    };
  }
  if (window.PRAIChatUI && window.PRAIChatUI.attach) {
    window.PRAIChatUI.attach(window.prAIAgentHost);
  }
})();
