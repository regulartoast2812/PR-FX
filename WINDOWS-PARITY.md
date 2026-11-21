# Windows parity checklist

Updated 2026-11-21, on a real Windows 11 machine with Premiere 26.0.1. Premiere 2025 (25.x) and later are the target
on both platforms: the CEP panel runs on CEP 12 in both 2025 and 2026, and host.jsx checks every newer call before
using it.

## Seen working on Windows (2026-11-21)

- **The listener starts by itself.** The hidden engine (`client/engine.js`) installs it when it's missing or from
  another build: it copies `native/windows/build/PRFXShortcutListener.exe` to `%LOCALAPPDATA%\PR FX Palette\bin\`
  with its `listener-build.txt`, registers the HKCU Run value "PR FX Shortcut Listener" if it isn't there, and starts
  it, at most once a minute while the bridge is down. Before this, the listener only got installed by pressing
  Install in the panel, so a panel that was never opened (or drew blank) meant no Ctrl+Space at all. Creative
  Assist's Start (`app/src/core.mjs` `startListener`) puts the same copy in place.
- **Timeline detection** (`native/windows/Win/TimelinePanel.cs`). Premiere names no panel to UI Automation, but each
  panel is its own child window ("DroverLord - TabPanel Window", one per tab) and Premiere gives keyboard focus to
  the panel you click. The focused window's TabPanel ancestor is the panel in use. The Timeline is told apart by its
  playhead: a 1-2 px blue line (64,150,243) running down most of the panel, measured at 80% of the Timeline's height
  and at most 6% in any other panel. Each panel is captured with PrintWindow (works while Premiere is covered, about
  50 ms), only when it's new, never on the keyboard path. Rules as on macOS: plain keys only in the Timeline, Ctrl or
  Alt shortcuts and Ctrl+Space in any panel, nothing in a menu, no plain keys while a text caret shows.
  - It also goes by how the panel looks, the port of macOS `PanelPixels.timelineLook` (2026-11-21): the blue time
    in its top-left corner, the time ruler's ticks, the yellow work-area bar and the blue V1/A1 track buttons. Two
    signs or more make it the Timeline, so it's found with the playhead scrolled out of view. Sizes are the macOS
    points times the display scale. On this machine: Timeline 5 signs, every other panel 0.
  - A panel that shows neither reads as "not the Timeline" until it's looked at again (every 3 s while focused). A
    Timeline verdict stays for as long as the panel's window exists.
- **Timeline highlight with Edie sitting on it** (`Win/TimelineHighlight.cs`, setting `timelineHighlight`, off by
  default), with his moods: awake and armed, dozing with "Click the Timeline to arm", grinning when a key fires,
  startled when one is passed on, and "Working on …" for AI functions. The stroke lies on Premiere's own panel border: the panel's frame window (tab row included), where Premiere draws a 1 px line 2 px in, blue on the focused panel, with black gutter around it; the stroke covers that line and the gutter pixel beside it. He stays on the Timeline whenever Premiere's
  window is open, in front or not (hidden only when Premiere is minimised, the Timeline isn't showing, or a Premiere
  dialog is in front). A click-through layered window kept directly above Premiere's in the z-order, so other apps
  in front cover it. **Never make Premiere its owner:** an owner in another process joins the two programs' input
  queues, and clicks in the Timeline then fell through to the app behind Premiere, which took the front, so Edie
  vanished and no shortcut fired (seen 2026-11-21).
- **Which app is in front is checked, not only announced.** Alt+Tab into Premiere fires the foreground event for
  Premiere and then, 1-4 ms later, for the closing switcher ("Task Switching", explorer.exe), and nothing after it:
  the listener took Premiere for being behind and ignored every shortcut and Ctrl+Space until another app was
  clicked (2026-11-21). The hook now reads the real foreground window on every keydown and housekeeping tick.
- The listener logs which window takes the front whenever "Premiere is in front" changes. For key problems, create
  `%APPDATA%\PR FX Palette\log-keys` (logs keys pressed in Premiere only) and restart the listener.
- **Edie's nudges** (`Core/EdieNudges.cs`, settings `edieNudges` and `edieNudgeMinutes`): "Still with me?" after a
  quiet stretch and "Welcome back!" after being away, in a speech bubble beside him on the highlight.
- Edie's sprite is one port of the macOS `EdieSprite` (`Win/EdieSprite.cs`); the palette draws from it too.
- Edie's pace (`Core/EdiePace.cs`, 2026-11-22) is the port of the macOS `EdiePace`: human timings for his blink, leg swing and
  talking, and typing on a laptop during "Working on …". Built and installed on Windows; the Swift side is not compiled here.
- **Connectors** (`connectors.json`, `app/src/connectors.mjs`, 2026-11-21, built on the Mac, not yet run here):
  Creative Assist and Edie detect the OS and find this OS's pieces from one table (the exe and its installed copy,
  the HKCU Run value, the `%APPDATA%` folders, the CSXS registry keys, Premiere 2025+ under `%ProgramFiles%\Adobe`),
  show each as found or missing on the PR FX page, and put the copy in place and start it when the bridge is down.
- The palette (Ctrl+Space) opens and runs commands, again and again; the catalog CEP pushes is cached. **No listener
  window but the palette may take the front:** the listener acts on keys only while Premiere is in front, and a
  banner made TopMost through WinForms became the active window when it showed (after every command run from the
  palette), so Ctrl+Space worked once and never again (2026-11-21). The banner is topmost through WS_EX_TOPMOST
  only, and gives the front back to Premiere if it's ever activated.
- The CEP panel ("Edie" in Window ▸ Extensions) draws and runs commands when docked. Floating on its own it can come
  up blank on this machine: dock it, or close and reopen it.

- **AI functions run on Windows through one shell layer** (`client/prai/js/platform-shell.js`, 2026-11-21). Every AI
  function, the panel's agent chat and its lookups are POSIX shell scripts of small steps (ffmpeg, WhisperX, sed, curl).
  They ran only in `/bin/zsh`. Now every shell starts in that one file: zsh on the Mac, Git for Windows' bash on
  Windows, so each function works there without being rewritten; Stop ends the whole tree (taskkill on Windows).
  The few truly Mac-only lines sit in branches Windows never takes, each marked `mac-only:`; `stat -f%z` became
  `wc -c`. `app/tools/check.js` fails on any Mac-only command (`/bin/zsh`, `osascript`, `open -a`, `stat -f`,
  `pbcopy`, `launchctl`, `defaults`) outside the layer or a marked branch, so new functions can't quietly be Mac-only.
  Git Bash is a card on Edie's board in Creative Assist, with Install (winget, with progress) when it's missing.
  Seen in Git Bash: ffmpeg found from its Windows path, a WAV written to bash's temp folder, WhisperX answering.
- **WhisperX and ffmpeg install with real progress** (`app/src/media-setup.mjs`): WhisperX in its own Python 3.12
  environment (it doesn't support 3.14), ffmpeg from winget, as steps with the bytes downloaded.
- **Every AI function's project read failed on Windows; fixed 2026-11-22.** "No active sequence audio tracks are
  available" with audio on A1 was not about the sequence. The AI runtime (`client/prai`) loads its own ExtendScript,
  `jsx/prai/host.jsx`, with `$.evalFile` before each host call, from a path built out of `location.pathname`
  (`extensionRootPath()` in `client/prai/js/main.js`). On Windows that is `/C:/Users/...`, and `path.join` turned it
  into `\C:\Users\...\jsx\prai\host.jsx`, a path that doesn't exist (Node agrees: `existsSync` false), so
  `prAI_getProjectSnapshot` and the lite read both failed, quietly, and the subtitle step found no tracks. The leading
  slash before a drive letter is now dropped, as `engine.js` and `app.js` already did for PR FX's own host. This hit
  the palette, shortcuts and the panel's Edie tab alike. A failed read now says why ("Could not read the Premiere
  project: ...") instead of "No active sequence audio tracks". The earlier note here (the hidden runtime "had never
  read the project") was wrong: `transcribe` always read it first; the read itself failed. Premiere hadn't been
  restarted since that change either (engine log: one start, 14:46Z, before it), so the runs at 17:41Z used old code.
- **The rest of the Whisper pipeline, seen in Git Bash on this machine (2026-11-22)** with PR FX's own builders taken
  from `main.js` and run through `platform-shell.js`: a WAV at a path with spaces cut by ffmpeg, joined through the
  concat list (Windows paths in `file '...'` lines), copied to `sequence_mix.wav` in `%TEMP%\PR_AI_Whisper_*`, then
  `whisperx.exe` (quoted Windows path from settings) wrote `.srt` and `.json`, read back with the right text. Run with
  `--model small --no_align` (the cached model; see below). WhisperX's "torchcodec is not installed" warning is
  harmless: it decodes with the ffmpeg program. The ffmpeg found is now also put on PATH for WhisperX.
- Without a saved project, the SRT is saved in `~\Videos\Edie Captions` on Windows (it was `~/Movies/...`).

- **WhisperX crashed on non-English speech** (2026-11-22): Python on Windows writes to a pipe in cp1252, and WhisperX
  prints each transcribed line, so the first Chinese line ended the run ("UnicodeEncodeError: 'charmap' codec") after
  minutes of work, and the failure message showed only a torchcodec warning. The shell layer now sets PYTHONUTF8=1 and
  PYTHONIOENCODING=utf-8 on Windows, and a failed command leads with its last real error line. Seen: the first minute of the user's own
  sequence audio transcribed to SRT with the configured large-v3-turbo; the whole 31 minutes not yet.

## Checks

- `tools\check-windows-bridge.cmd` (or `.sh` on the Mac): the platform-neutral core, nudges, settings, scoping reasons.
- `tools\check-windows-listener.cmd` (Windows only): Edie's sprite matches the macOS one, the playhead detector and the Timeline look.

## Still to verify on Windows

- Plain-key shortcuts end to end with real key presses (the hook ignores synthesised keys, so this needs a person).
- Effect, video and audio transition, custom Function, selection errors and repeated bulk applies.
- Bundled-preset roots (`prfx.bundledPresetFiles`) are guessed.
- `detect()` on Windows: the `reg.exe` queries for CSXS and the Run value, and Premiere's install path.
- Connectors `detect()` here: the `reg.exe` queries for CSXS and the Run value, and Premiere's install path.
- A Windows CI build and a code-signed exe before distributing.
- The Edie UXP demo needs Premiere 26.3 or later; it was refused on 26.0.1, as expected.
- A whole AI function run in Premiere on Windows (needs Premiere restarted after 2026-11-22): the project read with
  the fixed host path, the SRT import as a caption track (`prAI_applyActions` `importSrtFile`). The first real
  Subtitles run downloads the configured model (large-v3-turbo, about 1.6 GB) and WhisperX's English alignment model
  (about 360 MB); only `faster-whisper-small` is cached here. The engine gives an AI function 10 minutes, so a first
  run on a long sequence on CPU may time out while the work goes on.
