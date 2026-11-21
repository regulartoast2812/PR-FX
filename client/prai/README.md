# PR AI CEP Prototype

This is a local Premiere Pro CEP panel prototype. It reads project and active sequence data through ExtendScript, sends that context to a local CLI agent, then applies a small allowlisted set of edit actions back into Premiere.

It does not store API keys. It expects the user to already be authenticated in either `codex` or `claude` on the same machine.

## Files

- `CSXS/manifest.xml` registers the Premiere Pro panel.
- `index.html`, `css/styles.css`, `js/main.js` implement the panel UI and local CLI bridge.
- `jsx/host.jsx` reads Premiere project state and applies edit actions.
- `.debug` enables Chrome remote inspection on port `8088` while developing.

## Install

This folder is already in:

```txt
/Library/Application Support/Adobe/CEP/extensions/PR AI
```

For unsigned CEP extensions, enable debug mode on macOS:

```sh
defaults write com.adobe.CSXS.9 PlayerDebugMode 1
defaults write com.adobe.CSXS.10 PlayerDebugMode 1
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
```

Restart Premiere Pro, then open `Window > Extensions > PR AI`.

Codex is available on this machine through the VS Code extension bundle. Claude Code is available at `~/.local/bin/claude`.

## Usage

1. Open a Premiere project and an active sequence.
2. Click `Refresh` to load the project context.
3. Click `Diagnose CLI` if the agent command fails.
4. Choose `Codex CLI` or `Claude Code`.
5. Ask for an edit.
6. Returned actions are applied automatically.

The panel does not attach to an already-open Terminal window. CEP launches a background `/bin/zsh` process and runs either `codex exec ...` or `claude -p ...` inside it. That means the CLI must be authenticated and runnable non-interactively.
Settings > AI can detect/test Claude and Codex, refresh provider-specific model/mode dropdowns from the installed CLI help/config, and save separate model choices per provider. Claude and Codex each have their own row so models and modes stay scoped to the agent that supports them. Codex CLI does not expose a full live model catalog; use **Default from Codex** unless a model is present in your Codex config or the test confirms it works.

Applied actions are tracked in the panel's own undo stack. Use the `Undo` button or press `Cmd+Z`/`Ctrl+Z` while the panel is focused. Premiere's native undo stack may not see CEP script changes.

Every chat message has an icon-only copy button.
System command output and action/apply payloads render inside collapsible code boxes so long lines do not push outside the chat bubble.
Press `` ` `` or click `Max` to toggle focus mode inside the panel. Clicking a previous action JSON block stages and applies those actions again.

The `Edit Guide` field is saved locally in the panel and sent with each request. Use it for standing editing rules, style preferences, removal criteria, and timeline targeting preferences so the agent does not need to infer them every time.
For faster rebuilds, the guide defaults now tell the agent to prefer overwrite assembly and bulk cleanup actions (`clearTrack`, `deleteTrackRange`) instead of emitting one delete action per clip.
For frequent script-to-timeline cuts, use `assembleFromScript` to send one compact action with an ordered `clips` array. The host accumulates timeline start times internally and overwrites/inserts each source range in sequence.
For token control, the panel omits clip `components` from the agent context by default. Enable `Include clip component details` in Settings only when working on Essential Graphics/effects where component properties matter. Batch all tracks for one video into one request and ask for no summary table when you only need actions.

Graphic XML style capsules can preserve Premiere Essential Graphics styling that is otherwise hidden inside the encoded `Source Text` value. The first captured capsule is `templates/text-graphics/text-xml-style-capsule.json`; it stores readable span metadata for the agent plus the original encoded blob that must be cloned to preserve the real fill/stroke/gradient styling. Same-byte-length text replacement has been tested successfully on import. The saved style names are `yellowGradient` for Style A and `defaultWhite` for the shared white styling.
Use `createStyledTextXml` to generate a Premiere XML file from the saved capsule/template. Do not hand-write XML, do not use `writeTempTextFile` for styled XML, and do not invent custom XML structures. Do not provide `suggestedName` or `name` for styled XML; the host enforces `YYYY-MM-DD-HH-mm - AutoEdit - Function.xml`, where `functionName` is `Text`, `Cut`, or `Both`. The host clones the captured Source Text blob from `text-xml-two-style-graphic`, applies same-byte replacements, writes to the project-adjacent `XML` folder by default, and then follows the panel's XML action setting: import, open folder, or open. It supports multiple XML text clipitems in one file via `frames:[{ replacements, startFrame/startSeconds, durationFrames, effectName, clipName }]`; use `stackFrames:true` only when those frames should layer at the same start time. Each frame currently supports same-byte-length replacements only, for example `{ "Best Selling": "Second Layer", "pants": "style", "in 2026": "in 2027" }`.
The second captured capsule is `templates/text-graphics/text-xml-five-run-switching-capsule.json` with `templateId:"text-xml-five-run-switching"`. It comes from `/Users/crossianllc/Documents/Text style PR.xml` and stores five run components in one graphic layer: `"one "` switchA, `"two"` switchB, `" three "` switchA, `"four"` switchB, and `" give"` switchA. This is the component source for copying A/B/A/B/A word-style switching. Current host support still requires same-byte replacements for those captured strings; arbitrary run-count rebuilding is the next step.
Use `createStyledTextSvg` only when the user wants a visual asset/SVG/non-editable media, or explicitly accepts that fallback. It supports CSS-like rich text: arbitrary text length, unlimited style switches, and per-run fill/stroke/font-weight/font-style/opacity. It writes an SVG into the XML export folder, imports it, and can insert it into the timeline. This is not an editable Essential Graphics text layer, so do not use it as the default answer when the user asks for a graphic layer.

Text and caption workflows use the same reliable path as the Captions overlay: `importSrtFile`/`importCaptionFile` with inline SRT contents or file paths, plus `writeTempTextFile` for controlled temp `.txt`, `.srt`, `.csv`, or `.json` files. Agent prompts advertise `importSrtFile` for caption creation, with `createCaptionTrack:true`, `suppressUI:true`, and inline contents. Legacy `addSubtitleLayer`/`createCaptionTrack` host actions remain for backwards compatibility but are not advertised to the agent. Inline SRT contents are preferred when possible because they avoid missing-path failures; `checkFilePath` can diagnose user-supplied paths before import. Generated SRT files use the AutoEdit naming scheme, `YYYY-MM-DD-HH-mm-ss - AutoEdit - Subtitle.srt`, so Premiere imports the latest caption file instead of reusing an older static name. Temp files are written under the selected PR AI text folder when configured, otherwise the default PR AI temp folder, and `deleteTempFile` is restricted to those folders.
Audio text cuts use `cutAudioAndTimeSubtitles`: the panel exports the configured audio track, runs WhisperX with word-level JSON output when available, aligns punctuation-normalized script tokens to detected word tokens, imports matching captions, and razors the audio track in place slightly before each next line start. The default pre-roll is `cutLeadSeconds:0.16`, or `silenceLeadSeconds:0.12` when a detected gap is available. It falls back to script word counts only when token matching is weak. Caption inpoints are rebuilt from the same split plan, so subtitle starts line up with the matching audio cut boundaries. This is for manual edit prep/testing, not a full footage assembly workflow, so existing timeline positions stay put and only audio cuts/captions are added. Provided script lines are preserved as one subtitle item each by default; word-by-word or reflowed subtitles are opt-in only. This is designed for cases where the VO follows the provided script but Whisper mishears individual words, especially near line starts/ends.
The `Full Process` quick action is the row-based full workflow target: cut/align audio, place one subtitle per script row, and place media from the row source ranges on one media track. Each row window uses `max(audio/subtitle duration, combined media duration)` so longer media pushes later rows later, while shorter media leaves blank video space.
When pasted script/table input contains `Overlay Text [5]` and `Cut from Source [7]`, the panel derives a cut-timed SRT plan for the agent: each row advances by the summed source cut durations, rows with `(none)` overlay still consume time, and non-empty overlay text becomes a caption spanning that row's assembled duration.
Use `Settings` to set a custom text file folder. If blank, the panel uses the default PR AI folder inside the system temp directory.

Images can be attached with `Attach Image`, pasted into the prompt box, or dropped onto the prompt box. Codex CLI receives image attachments directly, and the panel adds attached image directories to the Codex run so image reads do not require another approval. If Claude Code is selected with images attached, the request is routed through Codex for direct image access.

Supported action JSON examples:

```json
{
  "actions": [
    { "type": "addSequenceMarker", "name": "Review", "comment": "Check pacing", "seconds": 12 },
    { "type": "setSequenceInOut", "inSeconds": 2, "outSeconds": 15 },
    { "type": "trimClip", "trackType": "video", "trackIndex": 0, "clipIndex": 0, "endSeconds": 8 },
    { "type": "rippleTrimClip", "trackType": "video", "trackIndex": 0, "clipIndex": 0, "endSeconds": 8 },
    { "type": "splitClip", "trackType": "video", "trackIndex": 0, "clipIndex": 0, "seconds": 6.5 },
    { "type": "moveClip", "trackType": "video", "trackIndex": 0, "clipIndex": 0, "startSeconds": 10 },
    { "type": "deleteClip", "trackType": "audio", "trackIndex": 0, "clipIndex": 1, "ripple": false },
    { "type": "setAudioGain", "trackIndex": 0, "clipIndex": 1, "gainDb": -6 },
    { "type": "setClipEnabled", "trackType": "audio", "trackIndex": 0, "clipIndex": 1, "enabled": false },
    { "type": "setClipEnabled", "trackType": "video", "trackIndex": 0, "clipIndex": 2, "enabled": false },
    { "type": "duplicateClip", "trackType": "video", "trackIndex": 0, "clipIndex": 2, "offsetSeconds": 1 },
    { "type": "slipClip", "trackType": "video", "trackIndex": 0, "clipIndex": 2, "deltaSeconds": 1.5 },
    { "type": "slideClip", "trackType": "video", "trackIndex": 0, "clipIndex": 2, "deltaSeconds": 2 },
    { "type": "setClipDuration", "trackType": "video", "trackIndex": 0, "clipIndex": 2, "durationSeconds": 4 },
    { "type": "setClipMotion", "trackType": "video", "trackIndex": 0, "clipIndex": 2, "scale": 110, "position": [960, 540] },
    { "type": "insertMogrt", "mogrtPath": "/path/to/template.mogrt", "seconds": 12, "videoTrackIndex": 1, "textValues": { "Title": "New title" } },
    { "type": "setGraphicText", "trackType": "video", "trackIndex": 1, "clipIndex": 0, "propertyName": "Title", "text": "Updated title" },
    { "type": "setGraphicProperty", "trackType": "video", "trackIndex": 1, "clipIndex": 0, "propertyName": "Fill Color", "value": [1, 1, 1, 1] },
    { "type": "listGraphicProperties", "trackType": "video", "trackIndex": 1, "clipIndex": 0 },
    { "type": "fadeClip", "trackType": "audio", "trackIndex": 0, "clipIndex": 1, "fadeInSeconds": 0.5, "fadeOutSeconds": 1 },
    { "type": "importSrtFile", "contents": "1\n00:00:00,000 --> 00:00:02,500\nFirst line\n", "createCaptionTrack": true, "suppressUI": true, "cleanupAfterImport": false },
    { "type": "insertClipRange", "projectItemId": "abc123", "projectItemName": "B-roll.mov", "trackType": "video", "trackIndex": 1, "seconds": 20, "inPointSeconds": 80, "outPointSeconds": 84 },
    { "type": "overwriteClipRange", "projectItemName": "B-roll.mov", "trackType": "video", "trackIndex": 1, "seconds": 24, "inPointSeconds": 90, "outPointSeconds": 93 },
    { "type": "replaceClipRange", "trackType": "video", "trackIndex": 0, "clipIndex": 2, "projectItemName": "Replacement.mov", "inPointSeconds": 3, "outPointSeconds": 7 },
    { "type": "createBin", "name": "AI Selects" },
    { "type": "moveProjectItemToBin", "projectItemName": "B-roll.mov", "binName": "AI Selects" },
    { "type": "setProjectItemLabel", "projectItemName": "B-roll.mov", "labelIndex": 3 },
    { "type": "setProjectItemInOut", "projectItemName": "B-roll.mov", "inPointSeconds": 2, "outPointSeconds": 8 },
    { "type": "renameSequence", "to": "AI Rough Cut" },
    { "type": "setTrackMute", "trackType": "audio", "trackIndex": 1, "muted": true },
    { "type": "setTrackVisibility", "trackType": "video", "trackIndex": 1, "visible": false },
    { "type": "addClipMarker", "trackType": "video", "trackIndex": 0, "clipIndex": 2, "seconds": 12, "name": "Use this line" },
    { "type": "renameProjectItem", "from": "Old Name", "to": "New Name" }
  ]
}
```

String shorthand is also accepted inside the `actions` array for simple operations:

```json
{
  "actions": [
    "set in 3 out 20",
    "trim V1 clip 0 end 12",
    "move A1 clip 0 to 5",
    "split V1 clip 0 at 6.5",
    "disable V1 clip 2"
  ]
}
```

The project context includes project item `nodeId`, media paths where Premiere exposes them, generated timeline `clipId`, track/index, timeline start/end, and source in/out. Thumbnail and transcript fields are currently exposed as capability flags/placeholders; actual frame export and transcription still need a media-processing backend.

Caption actions create a new timed caption/subtitle track by writing/importing an SRT and then using Premiere's `createCaptionTrack()` scripting path when requested. CEP scripting does not expose reliable direct editing of individual caption segments after creation, so undo for created subtitle tracks is manual.

The expanded action surface is intentionally allowlisted. It includes best-effort support for bins, project item labels/in-out, track mute/visibility/lock, duplicate/slip/slide/duration/replace clip operations, clip markers, motion/opacity values, fades, still-frame export, and AME queue export. Essential Graphics support is template-first: use `insertMogrt` with a `.mogrt` path, then `setGraphicText`, `setGraphicProperty`, or `listGraphicProperties` on the resulting graphics clip. Freeform `createTextGraphic` without a template is deliberately not advertised to the agent because many Premiere CEP builds do not expose it reliably. Project panel item deletion and media-file deletion are deliberately blocked.

## Notes

This is intentionally narrow. Premiere's ExtendScript API can do more, but edit operations should be added behind explicit action types so the agent cannot run arbitrary project mutations.
## Regression Gate

Run this before handing off any panel or host change:

```sh
./scripts/check_regressions.sh
```

The gate verifies JavaScript syntax, synchronized CEP/host cache versions, preserved source audio and SRT behavior, Full Process action protections, subtitle/audio timing coupling, and merged-cell script support.

This repository includes the same gate as `.githooks/pre-commit`. Enable it in a fresh clone with:

```sh
git config core.hooksPath .githooks
```
