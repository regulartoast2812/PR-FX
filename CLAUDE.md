# PR FX — working notes

Premiere Pro command palette. Three layers, all of which must agree:

| Layer | File | Role |
|---|---|---|
| Host | `jsx/host.jsx` | ExtendScript; every function actually lives here |
| Panel | `client/app.js` | CEP settings panel + its own palette; owns the command catalog |
| Listener | `native/PRFXShortcutListener.swift` | standalone palette + global hotkeys |

Windows replaces the third layer with `native/windows/` (C#, .NET Framework 4.8).
It speaks the same bridge protocol on 127.0.0.1:27389, so host and panel are shared
unchanged. See **Windows listener** below.

Adding a function means an entry in **all three**: `prfx.functions` in the host, the
`commands` array in `app.js`, and `prfxFunctionCommands` in the Swift listener.

---

## UXP plugin is a demo

`uxp/` (com.prfx.edie, shown as "Edie (Demo)") is a demo only. The CEP panel
and Edie in Creative Assist are the main product; new functions go to
`jsx/host.jsx` as always. The UXP command runtime defaults to CEP. See
`uxp/MIGRATION.md` for what the demo covers and why CEP stays main.

---

## Parked for later

- `Stretch Speed to Playhead` is intentionally hidden from the CEP command list
  and native palette as of `20260825-speed-stretch-12`. Retract speed works, but
  stretch still fails because Premiere accepts the operation then does not extend
  the clip to the requested slower-speed duration. The host implementation and
  diagnostics are left in `jsx/host.jsx` for a later rebuild, but the command id
  `stretch-speed-to-playhead` is retired in `client/app.js` and
  `native/PRFXShortcutListener.swift` so stale shortcuts/catalog caches do not
  expose it during soft launch.

---

## Traps that cost real debugging time

### The host build stamp
`evalPremiere` in `app.js` only re-reads `host.jsx` from disk when
`prfx.HOST_BUILD !== PRFX_HOST_BUILD`. **Edit `host.jsx` without bumping both
stamps and your change silently does not load** — Premiere keeps serving the
cached `prfx` object. Symptom: edits "work sometimes", depending on whether the
ExtendScript engine happened to be empty.

Bump both on every host edit:
- `jsx/host.jsx` → `prfx.HOST_BUILD`
- `client/app.js` → `PRFX_HOST_BUILD`

**Reopening the panel is not always enough.** CEP caches the panel page, so a
stale `app.js` keeps sending the *old* stamp — which matches the old
`prfx.HOST_BUILD` still in the engine, the check passes, and `host.jsx` is never
re-read. Both halves agree and both are wrong. **Quit Premiere entirely** to be
certain. `[System] Dump QE + DOM API` prints the live host build and Premiere
version on line 1; check it before trusting any dump.

### host.jsx is ES3 + E4X, not modern JS

A parse error in `host.jsx` takes down **every** command, and CEP reports only
`EvalScript error.` with no line number and nothing in `~/Library/Logs/CSXS/`.
The giveaway is that unrelated commands — including `[System] Dump QE + DOM API`
— stop working at the same time. That is a signal about the *file*, not about
the feature being tested.

Checking with `node`/JavaScriptCore proves nothing: ES5 dropped the ES3 reserved
words and no modern engine implements E4X. Run this instead, on every host edit:

```sh
./tools/check-extendscript.sh jsx/host.jsx
```

Use the shell wrapper, not the Python file. Accepting an Xcode licence update
can disable `/usr/bin/python3` outright (and `swiftc` with it), which silently
killed this check — and editing `host.jsx` without it is how a parse error takes
down every command. The wrapper runs a JXA port via `osascript`, which has no
Xcode dependency. `tools/check-extendscript.py` is kept as the reference
implementation. If Swift will not build, this is why:

```sh
sudo xcodebuild -license
```

Known killers:
- **ES3 FutureReservedWords as identifiers** — `byte`, `char`, `int`, `float`,
  `short`, `long`, `final`, `public`, `static`, `class`, `enum`… `var byte` cost
  a full debugging round.
- **Regex literals containing `<`** — E4X reads `<` as the start of an XML
  literal. Scan with `indexOf`/`substring` instead.
- Anything ES5+: `let`, `const`, arrow functions, template literals, spread.

### CEP localStorage is not durable — settings.json is the source of truth
If the previous Premiere's CEP helper still holds the leveldb lock at launch,
Chromium silently gives the panel an empty in-memory localStorage. The panel
then wrote defaults over `settings.json` and all shortcuts vanished
(2026-10-28). `loadSettings()` now reads `settings.json` first and only falls
back to localStorage; `syncListenerSettings()` copies the old file to
`settings.backup.json` before writing one with fewer bindings. Old values can
be recovered from `~/Library/Caches/CSXS/cep_cache/PPRO_*_com.prfx.palette.settings/Local Storage/leveldb`
(snappy-compressed `.ldb`, key `prfx.palette.settings.v1`).

### Display name is "Edie" (2026-11-19)
The user-facing brand is **Edie** (planned as one tool across PR, AE, Illustrator). Only visible text
changed: panel menu/title, palette title `EDIE`, toasts, status lines, the four `Undo/Redo Last Edie …`
commands (normalized by id in app.js, Swift and C#). Internals keep `PR FX`/`prfx`: bundle id
`com.prfx.palette`, support dir `PR FX Palette`, log names, `PR FX Shortcut Listener.app` (renaming the
app would lose the Accessibility grant), and the repo folder. New user-facing strings say Edie.

### Renaming a command orphans its shortcut
`commandKey()` joins type, id, moveMode **and name**. Renaming a command breaks
the association with any saved binding. Add a normalization line in
`loadSettings()` keyed on the id, as the existing renames do.

### Ad-hoc signing breaks Accessibility on every build
The listener needs Accessibility permission. Ad-hoc signatures (`--sign -`) change
the code hash every build, so macOS treats each build as a new app and discards
the grant. `build-macos.sh` now signs with a local self-signed certificate
(`PR FX Local Dev`), which keeps the designated requirement stable. If the cert is
missing the script falls back to ad-hoc and warns.

### The listener is launched hidden
`start-listener-macos.sh` uses `open -gj`, and `-j` launches the app **hidden**.
A hidden app shows no windows, so `orderFrontRegardless()` silently does nothing
(`isVisible` stays false). This is why the feedback banners and the Timeline
highlight never appeared until 2026-11-19. Anything the listener draws must call
`NSApp.unhideWithoutActivation()` first, as `FeedbackToast` and `TimelineHighlight` do.

### Timeline highlight (2026-11-19)
`native/PRFXTimelineHighlight.swift` draws the region every keystroke is judged
against, over Premiere. It is native, at screen-saver level and click-through, the
same technique as Edit Assist's inspection panel. It refreshes 5×/s from
`keystrokeScope()`.
- No fill. A 2pt orange stroke, inset 1pt, sits exactly over Premiere's own 1pt blue panel border.
  **Full orange:** armed. **Faded:** not armed, with a short orange note saying why. **Dashed:** saved region.
- Edie sits on the top-right corner. Since 2026-11-19 he is Kino's look from Edit Assist (orange, red beret) holding a
  clapperboard. His mood carries the state: awake and blinking when armed, dozing (a "z") when not, clapping the board shut
  and grinning when a key fires, startled when it is passed to Premiere (the stroke also pulses).
  `EdieSprite` is the same art as Creative Assist's `ui/sprite.ts` `edie`, so change both together.
- **Colours:** PR FX's accent is orange (`#ff9a3d`, the stroke's), never Sage's mint. `client/styles.css` `:root` and the
  native palette's `PaletteStyle` (`PRFXShortcutListener.swift`) carry the same tokens; change both together.
- The panel extends 44pt above the window so Edie still fits when the Timeline is docked at the top.
- **The palette keeps it** (2026-11-20, the user asked). Opening the palette makes the listener the active app, which used to hide
  the rectangle (Premiere not frontmost). `refreshHighlight()` now leaves it exactly as it was while the palette is visible, and the
  palette sits one level above screen-saver so the stroke and Edie never cross it.
- The region's bottom edge stops at Premiere's status bar (`statusBarTop`), not at the window's bottom.
  Only while the palette is really in front (`paletteInFront`: listener active, panel key). Freezing on `panel.isVisible`
  alone left the rectangle over Chrome and VS Code after clicking away from an open palette (2026-11-20).
- **Edie speaks up (2026-11-20)** so the editor refocuses after staring or walking away. `native/PRFXEdieNudges.swift`
  (pure, checked by `tools/check-edie-nudges.swift`) runs on the 5×/s tick (`refreshNudge()`, beside `refreshHighlight()`)
  off one `CGEventSource.secondsSinceLastEventType` read. After `edieNudgeMinutes` (default 2) with no input at all he says
  one line, as two lines in the bubble: a semibold heading ("Still with me?") and the detail under it, regular weight at 62 %
  opacity ("We left off at Ripple Delete."); no dashes joining them (the user, 2026-11-20). Once per quiet stretch, gone at the next input or after 9 s.
  When input resumes after 5 min or more (or 2.5× the setting) he says "Welcome back! You were on …" for 6 s, if Premiere is
  in front within 4 s. "You were on" is the last command fired or done (`KeyJournal.lastCommand`, in memory, so empty after
  a listener restart). Only while the highlight shows a live region, Premiere is in front and the palette is closed (opening
  it hushes him). He talks and waves (`.talk`/`.talkPause`, native-only moods), then listens awake. The bubble is in the
  same click-through panel, beside him above the line (dark `#262624`, orange edge, 11pt like the notes) and stands in for
  the note while it shows. Setting `edieNudges: "on"|"off"` (default on) and `edieNudgeMinutes` (1–30 on the page,
  Settings → On-screen feedback).
- **Premiere's own windows cut it too** (2026-11-20): any Premiere window in front of the main one, any layer ≥ 0 and at least 80×40
  (the Color Picker is a modal above layer 0), joins `covers`, so the stroke, Edie and the note go behind it as behind another app's window.
- **Back from a maximized Timeline** (the ` key, 2026-11-20). Accessibility keeps the full-window frames for a while, so the
  Timeline's controls sat in the top-left corner over the Project panel, which won the pixel match and then stuck (its own
  rectangle became the next reference). `PanelPixels.timelinePanel` now treats a reference that fills the window while the
  pixels show docked panels as stale: markers ignored, matched against `dockedTimelineRegion` (the last pick that didn't fill
  the window), nothing drawn if that isn't known yet. Checked in `tools/check-panel-pixels.swift`.
  Seen live after that: Premiere moved the Timeline's toolbar (Snap, Display Settings, Caption options, Insert/overwrite)
  back but left its ~29 track-header buttons (Lock/Output/Mute/Solo) at the maximized positions, x 38-158, inside Project,
  for minutes. So the toolbar (`lastScanToolbar`, one set per Timeline) weighs 1000 a button, the rest 10.
- **Gutterless redraw frames** (2026-11-21). Right after a command, Premiere redraws, and a capture can show one panel filling
  the whole window. That frame won the match, so for 1-5 s the whole window counted as the Timeline: keys armed after
  clicks in Project or Program, and the highlight framed the whole window. This happened 58 times on 2026-11-20.
  `timelinePanel` now returns nil for such a frame when the docked spot is known and the toolbar is still inside it (no
  toolbar seen: the track headers decide; nothing seen: nil), so the docked Timeline stays. A real ` maximize
  moves the toolbar to the top left and still counts. Checked in `tools/check-panel-pixels.swift`.
- **Project-selection commands work from other panels** (2026-11-21). `ShortcutScope.otherPanel` replaces `.modifierOnly`
  when the last click was outside the Timeline: chords as before, plus `ShortcutScope.projectSelectionCommands`
  (`place-bin-clips`, `place-bin-clips-column`, `replace-from-bin`, `replace-fit-from-bin`) on plain keys. Selecting clips in
  Project and pressing Shift+X used to be refused as "outside the Timeline" (10 times in a row on 2026-11-20). A focused text
  field, Export/Import mode, or no Timeline found still give `.modifierOnly`. `arms(_:command:)` takes the command; health
  reports `otherPanel` as modifier-only (rank 3).
- **It draws only a live region.** It never draws the saved one, and it hides in Export/Import (`panelsHidden`) and whenever another
  sizeable Premiere window is in front over the Timeline (`premiereWindows().dialogInFront`, CGWindowList front-to-back). The
  saved dashed rectangle used to land on the Export save dialog.
- **Resizes: Accessibility frames go stale; pixels are the truth.** After the Timeline's top edge was dragged up 115pt,
  every AX control and tab strip still reported the old place, indefinitely. `native/PRFXPanelPixels.swift` (Edit Assist's
  `PanelReader.panelRects`, ported) captures Premiere's main window with ScreenCaptureKit, cuts it along the black gutters
  into panels (about 15 ms), and picks the Timeline as the panel holding most AX Timeline controls, then the one overlapping
  the last region most. It runs on every lookup (2 s, clicks, mouse-up at 0.25 s and 1 s, window frame change). A changed
  capture invalidates the region. Health `timelineDetection` ends `pixels=…` when it snapped. **Needs Screen Recording**;
  without it the listener asks once and falls back to AX + `TimelinePanelGeometry.inferred` (moves the last region by
  how far the controls moved, which does nothing when AX is fully stale).
  Check: `swiftc -module-cache-path /tmp/prfx-swift-module-cache native/PRFXPanelPixels.swift tools/check-panel-pixels.swift -o /tmp/prfx-check-panel-pixels && /tmp/prfx-check-panel-pixels`

Setting `timelineHighlight: "on"|"off"`. On macOS the PR FX page's overlay switch
writes it. Creative Assist's Electron overlay is now used only on Windows.

### CEP vs host vs listener changes
- `host.jsx` / `app.js` → reload the settings panel, **no rebuild**
- `*.swift` → `./native/run-macos.sh`

---

## Windows listener (2026-11-19, UNTESTED on real Windows)

Compile- and bridge-verified only. Nobody has run it on a Windows machine yet.

- `native/windows/Core/` is platform-neutral (JSON, queue, HTTP bridge, settings,
  chords, journal). `native/windows/Win/` holds the Win32 parts: `KeyboardHook`
  (WH_KEYBOARD_LL on its own thread, plus a foreground WinEvent hook),
  `PaletteForm`, `Toast`, `ShortcutListener`.
- Build on this Mac: `./native/windows/build-windows.sh` (needs `~/.dotnet/dotnet`).
  On Windows: `native\windows\build-windows.cmd`. The output
  `native/windows/build/PRFXShortcutListener.exe` is committed so editors need no SDK.
- Check: `./tools/check-windows-bridge.sh` (29 checks against `Core/` on net8).
- Paths: support `%APPDATA%\PR FX Palette\`, logs `%APPDATA%\PR FX Palette\Logs\`
  (host.jsx `prfx.logPath` follows), installed exe `%LOCALAPPDATA%\PR FX Palette\bin\`,
  autostart HKCU Run value "PR FX Shortcut Listener". The panel's Install button
  copies, registers and starts it; the engine restarts it at most once a minute
  when `/next` fails.
- **Text-field scoping is a guess.** Plain-key shortcuts arm only after the listener
  has once seen a Win32 caret inside Premiere (`caret-calibrated.txt`). If Premiere's
  text fields never create one, plain keys stay disarmed; create
  `%APPDATA%\PR FX Palette\allow-plain-keys` to override. Verify this first.
- The hook callback must stay instant, same rule as the macOS tap: Windows silently
  removes a slow low-level hook. It is reinstalled on every Premiere activation.
- Bundled-preset roots on Windows (`prfx.bundledPresetFiles`) are guessed.

---

## PR FX as a Creative Assist tool (2026-11-19)

PR FX now lives inside Creative Assist (`~/Documents/Tools/Creative Assist-app/app`, `app` branch) as the first
**tool** used by Edie, the editor agent. Creative Assist is the one place to work in.

- `tool.json` at the repo root is the contract: `ui`, `overlay`, `service`, `mcp`, `repo` and `install` paths per OS. Creative
  Assist installs it with `git clone` into the CEP extensions folder and turns on CEP debug mode.
- `app/src/core.mjs` holds everything that doesn't need Electron (settings, catalog, bridge, journal, `runAndWait`).
  `service.mjs` and `mcp.mjs` both build on it. **Change behaviour in core.**
- `app/src/service.mjs` provides `createService(ctx)`, which Creative Assist runs in-process: health polling, overlay state, routes for the page,
  and `summary()` for Edie's tool card.
- `app/src/mcp.mjs` is a stdio MCP server with `premiere_status`, `premiere_find_commands`, `premiere_run` and `premiere_recent`.
  `premiere_run` waits for the journal's ok/failed line (20 s at most). Stretch Speed is refused.
- `app/ui/web-bridge.js` defines `window.prfx` over fetch and server-sent events when no preload has, and follows the host's theme.
  The same `index.html` therefore runs in Electron and inside Creative Assist.
- Test the MCP server by hand: pipe JSON-RPC lines into `node app/src/mcp.mjs`. **Never `premiere_run` a mutating command to test.**

## PR FX page, service and MCP (`app/`)

The standalone Electron app (`PR FX.app`) was retired on 2026-11-19. Creative Assist hosts the same page.
`app/` now holds only what Creative Assist loads: `ui/` (the page, `overlay.html`, `web-bridge.js`) and `src/`
(`core.mjs`, `service.mjs`, `mcp.mjs`). Check: `cd app && npm run check`.

- `ui/` covers Status, Shortcuts, Activity and Settings. `overlay.html` is drawn by Creative Assist's own transparent,
  click-through window over Premiere. It shows the detected Timeline rectangle (green when armed, amber otherwise), the remembered box and the last click.
- **Settings writes:** read-merge-write into the current file, back it up when bindings shrink, write atomically, then
  `POST /reload-settings`. The CEP panel polls the file's mtime every 1.5s (`watchSettingsFile`), so edits made in the page show up there too.
- **Bridge routes:** `POST /run` and `POST /open-palette` need an `X-PRFX-Token` header that matches `bridge-token`
  in the support dir (mode 0600, rewritten on every listener start). Anything else gets 403.
- **Success banners:** `shortcutFeedback:"all"` turns them on. `announceScope:"on"` shows an arming or paused banner when the
  scope changes. Health reports both, along with `geometry {live, saved, window, click, panelsHidden, premiereFrontmost}`.
- **Journal `seq` restarts at 1 when the listener restarts.** Group journal lines by `fired` and key items by `time|seq`, never by seq alone.
- **Untested:** the overlay over a real Premiere Timeline.

---

## PR AI tab (2026-11-19, straight port, pending revamp)

The former standalone **PR AI** extension (`../PR AI/`, left untouched) now runs as the
fourth tab of the settings panel. Behaviour and look are deliberately unchanged; it
will be revamped later, so do not polish it in place.

- **Files.** UI: `client/prai/` (`index.html`, `css/`, `js/main.js`, `js/csinterface.js`,
  plus `scripts/` and `templates/`). ExtendScript: `jsx/prai/host.jsx`. Every global
  there is `prAI_*` (plus a guarded `JSON` polyfill), so nothing collides with `prfx`.
- **Isolation.** It is an `<iframe id="prai-frame">` inside `#prai-view`, so PR AI's
  `:root` variables, `.settings-tab` classes, element IDs and key handlers cannot touch
  PR FX. `app.js` `loadPraiFrame()` sets its `src` only on first open.
- **CEP and Node** are injected only into the top frame. `client/prai/js/cep-bridge.js`
  copies `__adobe_cep__`, `cep_node`, `require` and `cep` from the parent before PR AI's
  scripts run. This needs the manifest's `--allow-file-access(-from-files)` flags on the
  settings extension, so the iframe shares the panel's origin. If it is blocked, the tab
  shows a red note under the frame.
- **Host loading.** Not via `ScriptPath` and not via `prfx.HOST_BUILD`. PR AI's own
  `evalHost` prefixes every call with `$.evalFile(jsx/prai/host.jsx)` when
  `prAI_hostVersion` is missing or differs from the stamp in `main.js`
  (`praiHostJsxPath()` resolves it from `client/prai`). Editing `jsx/prai/host.jsx`
  therefore needs PR AI's own stamp (`prAI_hostVersion` + the strings in `main.js`)
  bumped, **not** `PRFX_HOST_BUILD`. Run `./tools/check-extendscript.sh jsx/prai/host.jsx`.
  Three regex literals containing `"`, `'` or `<` were rewritten as `new RegExp(...)`
  for the checker; behaviour is identical.
- **Check:** `sh client/prai/scripts/check_regressions.sh` (PR AI's own JXA suite).
- **Settings did not carry over.** PR AI's `pr-ai-*` localStorage belonged to the old
  extension ID; the tab starts with defaults.
- `main.js` calls `registerKeyEventsInterest` through the shared `__adobe_cep__`, which
  now applies to the whole PR FX panel, not only the PR AI tab. **Untested in Premiere.**

---

## Premiere's Accessibility tree (macOS)

Premiere exposes **almost nothing** useful:

- `kAXFocusedUIElementAttribute` returns `AXUnknown` / `"TopLevelWindow"` in every
  state. It never reports the real focused control, so **text-field detection is
  not possible** and neither is panel focus.
- Every element has an empty `AXIdentifier`. Roles are generic (`AXLayoutArea`,
  `AXGroup`, `AXUnknown`).
- Window/element **titles carry user content** — project and sequence names. Any
  matcher keyed on titles will fire on unrelated panels and break on some project
  names. An earlier version did exactly this.
- Descendants **are** exposed with real `AXPosition` / `AXSize`, and some carry
  meaningful descriptions (`Toggle Track Lock`, `Snap in Timeline`,
  `UI_TabsContainer`). Those descriptions are **English UI strings** and will not
  survive a localized install.

Current shortcut scoping derives the Timeline rectangle from those descriptions
and hit-tests the last mouse-down against it. See `timelineShortcutFocus` and
`timelineRegion`. Diagnostics: create `~/Library/Application Support/PR FX Palette/ax-probe`
or `ax-diagnostic`, output goes to `~/Library/Logs/PR FX Shortcut Listener.log`.

### Shortcut delivery: event tap, not Carbon (2026-10-28)

Carbon hotkeys could only be scoped by unregistering them, so every click
between the Timeline and another panel rebuilt the whole set: 238,833
registrations in ten weeks. A key pressed while unregistered went to Premiere
and left no trace. `PRFXKeyTap.swift` now installs one CGEventTap that is never
unregistered and decides per keystroke.

- **The tap callback must stay instant.** No Accessibility calls, no file I/O,
  no logging inside it — macOS disables a slow tap, and while it stalls every
  keystroke on the machine waits. It reads `keystrokeScope()`, which uses only
  cached state: click point (recorded in the tap itself), live/saved Timeline
  region, and `cachedTextInputRole`. Everything else is dispatched after.
- **Carbon is still the fallback**: without Accessibility, and whenever any app
  turns on Secure Keyboard Entry (that blinds all event taps; Carbon still
  works). `updateDeliveryMode()` switches automatically.
- Consumed keys also swallow their keyUp and auto-repeats.
- Health reports `deliveryMode`, `tapReenables`, `keyStats`.

Every keypress is journaled to `~/Library/Logs/PR FX Key Journal.tsv`
(fired / passed + reason / delivered / ok / failed / expired), each fired
command carrying a `seq` that CEP echoes back via `POST /result`.
`./tools/key-report.sh [date-prefix]` turns it into a success rate. Failures,
expiries and skipped keys show a non-activating banner (General → On-screen
shortcut feedback).

### Background engine (Excalibur model)

`client/engine.html`/`engine.js` is a hidden `Custom` extension started on
`ApplicationInitialized`. It polls `/next?client=engine` and runs commands
whether or not the settings panel is open. The panel polls only when the
listener reports no engine poll in the last 3s (`enginePollAgeMs`).

- The engine has **no ScriptPath**: a second load of `host.jsx` would reset its
  in-memory undo stacks. It loads the host lazily and reads the build stamp from
  `host.jsx` on disk, so it never needs a stamp bump.
- The manifest used `<StartOnEvents>`, which is not the CEP tag; it is
  `<StartOn>`. Manifest changes need a full Premiere restart.
- Engine log: `~/Library/Logs/PR FX Engine.log`.

Shortcut reliability (2026-09-22): failed Carbon registrations retry every two
seconds while their scope remains eligible, without unregistering healthy keys.
Focus/activation changes and the delayed click refresh invalidate the live
geometry cache while retaining fallback geometry. The command bridge uses a
32-entry FIFO instead of a single overwritable slot; pending commands expire
after five seconds to prevent old edits replaying after a CEP stall. Health
reports `failedRegistrations`, `queuedCommands`, and `droppedCommands`.
These changes do not guarantee delivery after a failed `/next` HTTP response,
nor prove focus detection in every Premiere workspace.

Regression checks:
```sh
swiftc -module-cache-path /tmp/prfx-swift-module-cache native/PRFXTimelineRegionCache.swift tools/check-shortcut-detection.swift -o /tmp/prfx-check-shortcut-detection && /tmp/prfx-check-shortcut-detection
swiftc -module-cache-path /tmp/prfx-swift-module-cache native/PRFXPendingCommands.swift tools/check-shortcut-queue.swift -o /tmp/prfx-check-shortcut-queue && /tmp/prfx-check-shortcut-queue
swiftc -module-cache-path /tmp/prfx-swift-module-cache native/PRFXKeyTap.swift native/PRFXKeyFeedback.swift native/PRFXPendingCommands.swift tools/check-key-chords.swift -o /tmp/prfx-check-key-chords && /tmp/prfx-check-key-chords
```

---

## Premiere scripting API — verified capabilities

Confirmed by reflection on Premiere 26.0 (`[System] Dump QE + DOM API`).

### Exists and works
```
qe.project        undo() -> boolean   redo() -> boolean   undoStackIndex() -> number
qe video track    insert(Object, string, bool, bool, bool, bool) -> boolean
                  overwrite(Object, string, bool, bool, bool, bool) -> boolean
                  razor(string, bool, bool)
qe track item     moveToTrack(number, number, string, bool)
                  setSpeed(number, string, bool, bool, bool)
                  move / slip / slide / roll / remove / rippleDelete / removeEffects
                  addVideoEffect / addAudioEffect / addTransition
public sequence   linkSelection() / unlinkSelection() / setSelection(Array)
                  insertClip() / overwriteClip() / clone()
public TrackItem  getLinkedItems() / getSpeed() / isSpeedReversed() / isAdjustmentLayer()
                  remove(bool, bool) / move()
Component.Property  getValue / setValue / isTimeVarying / getKeys / getValueAtKey
                    addKey / setValueAtKey / getInterpolationTypeAtKey / setInterpolationTypeAtKey
app.project       applyLumetriPreset(string) -> boolean
                  getAllLumetriPresetsList() -> array of names (325 on a stock install)
                  getLumetriPresetsForFolderList(string)
```

### Does NOT exist
- No copy, paste, or duplicate API anywhere.
- **No menu bridge on Premiere 26.** `app.findMenuCommandId` and
  `app.executeCommand` are **gone** — verified `typeof === 'undefined'` on
  26.3.0 build 93. Older tools (including the reference tool in `untitled
  folder/`) call them freely; that code predates 26 and cannot run here. This
  removes the only route that made Premiere itself perform a copy/paste, so
  duplication has to be reconstructed by hand — which is why Duplicate is hard.
  `app.getConstant(name)` survives but returns `-1` for every editing command
  name; it is not a replacement.
- **`app.encoder.encodeSequence` ignores its preset argument** on 26.3. Jobs
  queue correctly but render with AME's last-used or default settings. Verified
  with the original path and with a space-free staged copy in `/tmp` — the
  fallback merely changed from "Custom" to "Match Source - Adaptive High
  Bitrate". Worst failure mode available: it looks like success and renders
  wrong. Queue the cuts, then set the format once in AME across all jobs.
- **No way to create an adjustment layer.** Verified `typeof === 'undefined'` on
  26.3.0 for `qe.project.newAdjustmentLayer`,
  `app.project.createNewAdjustmentLayer`,
  `app.project.rootItem.createAdjustmentLayer` and
  `sequence.createAdjustmentLayer`. `newTransparentVideo` and `newColorMatte`
  DO exist but neither affects layers beneath, so they are not substitutes.
  `Adjustment Layer Over Selection` therefore reuses one the project already
  has, matching it to the sequence (already-on-this-timeline, then frame size).
  One layer must be created by hand per frame size, once per project.
- No undo *grouping* (`beginUndoGroup`). `undoStackIndex()` is the substitute —
  checkpoint before, `undo()` back to it after. See `prfx.undoCheckpoint`.
- No API for the Effects panel Presets bin, except Lumetri (above).

**Reflection cannot prove absence.** `reflect.find()` does not see
non-enumerable methods, so `<not found>` in the dump means nothing on its own.
Only `typeof app.thing` settles it. The dump has a `typeof probes` section for
exactly this; add to it rather than trusting the signature lists.

### Staging: where a written clip actually lands

`overwriteClip` routes by **track targeting**, not by the track object you
address. Looking for the new clip on the staging track therefore finds nothing
whenever targeting disagrees — audio-only files were the obvious case, but it
also made placement position depend on whatever the editor had targeted.

`prfx.stageOneProjectItem` diffs the whole sequence before and after the write
(`trackContentsMap` / `newClipsSince`) and returns `fromTrackIndex`, so callers
move the clip from where it really is.

A source can publish **several** audio clips — dual mono, split stereo, 5.1.
`staged.audioClips` carries all of them and `prfx.placeStagedAudioClips` moves
each onto a free lane. **Untested:** no multichannel footage was available in
the project this was built against, so the multi-clip path is written and
reviewed but has never actually run. Replace's multichannel path is also
unverified.

### Bulk replace: the matching ladder

Editors name iterations by hand, so matching is a ladder of rules. Each rung is
only tried when the one above found nothing, and **every rung refuses unless
exactly one candidate qualifies** — replacing the wrong iteration of a shot is
far worse than leaving a clip alone.

| # | Rule | Example |
|---|---|---|
| 1 | Exact filename (case-insensitive) | `K9.mp4` → `K9.mp4` |
| 2 | Shot key + variant, option lenient | `K1 Beige O1` → `K1 Beige 1` |
| 3 | Version key, unique only | `K6` → `K6.1` |
| 4 | Shared name tail, unique only, 2+ tokens | `Lace_Black` → `VeraLifting v.B 1.0 Lace_Black` |
| 5 | Leading version marker ignored, unique only | `v1- fabric` → `V3 - fabric` |

Names decompose as **KEY / DETAIL / OPTION** — `K1 Beige O1` is key `k1`, variant
`beige`, option `1`. The key is never fuzzy; dots belong to it (`K8`, `K8.1` and
`K8.2` are different shots). `O1`, `1` and `-1` all mean option 1.

Rungs 4 and 5 exist because real projects rename wholesale between versions: one
bin carries a product prefix the next drops (`VeraLifting v.B 1.0 …`), or the
version sits at the front (`v1-`, `V2-`, `V3 -`). Only a leading `v` + digits
counts as a version marker, so `K1` and `S11` can never collapse together.

Tolerance setting (General → Bulk replace name matching): **Strict** uses rungs
1–2 only; **Normal** and **Loose** enable 3–5; **Loose** additionally allows
near-spellings and a missing variant.

Always applied:
- **Category must match.** A still never replaces a video. Taken from the real
  file extension, not the name — `S9.png.mp4` is video.
- **Ties break only on evidence:** all candidates being the same file on disk, or
  one being strictly newer (modified, then created). Otherwise it refuses and
  names the paths.

`Bulk Replace — Dry Run` prints which rung fired per clip and writes to
`~/Library/Logs/PR FX Bulk Replace Preview.txt`. Use it before changing anything.

**Never half-succeed.** If the source in/out cannot be restored after a media
swap, the clip is failed and the whole run rolls back. This means both
`inPoint` and `outPoint` must be captured, restored, and read back; restoring
only `inPoint` can look right until save/reopen or the next speed change, then
the replacement may restart from source frame 0. An earlier version
compensated by shifting keyframes to suit the wrong in-point, which produced a
clip whose animation looked right and whose framing was wrong — and reported
success. Two identical clips in one run came out wrong in two *different* ways
before this was found. Each replace is verified afterwards against the
original's source in/out and total keyframe count.

### Replacing a clip's media

**`trackItem.projectItem = newItem` works** and is by far the best route: the
clip is never rebuilt, so position, scale, effects, speed, in/out and links all
survive. `prfx.tryDirectSourceSwap` tries it, then QE `replaceWith`, verifying
against the media path. Two things it does NOT carry:

- **Source in/out.** The new file is used from its own start, so the shot looks
  chopped. Record both `inPoint` and `outPoint` before the swap and write them
  back after. Read the Timeline clip back and verify both values.
- **Keyframe timing.** Keys are stored in *source-media* time, so re-basing the
  clip onto a different file collapses them toward the media start. They must be
  captured beforehand, the stale ones cleared, and the originals re-added.

**Swap the linked audio in the same operation.** Swapping only the video leaves
the pair pointing at two different files — the timeline looks correct and every
render is wrong.

If direct swap fails and Replace falls back to staging, apply the original
source in/out to the replacement project item *before* `overwriteClip`, then
restore the bin item immediately after staging. Audio source range writes after
the Timeline item exists can appear correct in the current session but reopen at
source start later.

### Replace & Fit to Slot (`replace-fit-from-bin`)

Swaps one bin clip into the selected clips, then retimes each so the new take
fills the old clip's exact slot (voice re-records of a different length).
Source range maps proportionally against each bin item's In/Out; speed =
mapped source length ÷ slot length. Audio gets the Perfect Pitch correction
(`prfx.writePitchCorrection`, shared), which caps audio at 50–200%. Keyframes
are rescaled around the in-point (`prfx.scaleCapturedKeys`). Direct swap only —
refuses rather than falling back to the staging rebuild. **Untested live as of
2026-11-03**, especially slowing down (shorter take), which is the case that
broke Stretch Speed.

### User presets (preset engine, `20261113-presets-1`)

There is no API that applies a saved Effect Preset, so `host.jsx` reads the
`.prfpset` and rebuilds the effect. Pipeline: `loadPresetDocument` (one-pass
ObjectID index, cached by mtime) → `presetDocumentPresets` (bin-tree walk) →
`analyzePresetEffect` → route → verify. Nothing in it knows a specific effect.

- **`<CurrentValue>` is not the value.** It is usually `0`. Reading it is what
  turned clips black (Scale 0, Gamma 0, black tint). The value is field 1 of
  `<StartKeyframe>`.
- Points are `x:y` normalized. Colours are a decimal uint64 of four 16-bit
  channels A,R,G,B (above 2^53, decoded by string division); written with
  `setColorValue(a,r,g,b,true)` and checked with `getColorValue` (**untested live**).
- Keyframes: `ticks,value,…;` in **source** ticks. `FilterPreset/Type`: 1 = anchor
  to in, 2 = to out, 0 = scale across the clip (**0 untested live**). Offsets
  scale by target speed ÷ preset `<Speed>`. Easing is not decoded: keys land
  linear, and the result message says how many were eased. Reversed clips refuse.
- Param identity is `ParameterID`, never Param Index (bundled presets use an
  older Lumetri layout with different indices).
- **Binary params** (`Arb*ComponentParam`, `PremiereFilterPrivateData`) cannot be
  written. Default = majority value across every preset of that effect (user
  files + first 3 MB of the bundled Factory/Lumetri presets), arbs only within
  the same param layout. Unknown default → the innermost group decides: if any
  named sibling differs from the freshly added effect, the arb is treated as
  edited and the preset is **refused**. Otherwise "assumed default". Private
  data with no baseline is assumed default (user and bundled blobs never share
  a header).
- **Lumetri route.** Lumetri-only presets that are not exact try
  `app.project.applyLumetriPreset(name)` first, trusted only if a sequence-wide
  Lumetri count shows +1 on each selected clip and nothing else, and values read
  back. Otherwise rolled back and marked broken for the session. Whether it
  accepts **user** presets is **unverified**: run `[System] Probe Lumetri Preset
  Apply` on one selected clip (every probe is rolled back; log
  `~/Library/Logs/PR FX Preset Probe.txt`).
- Catalog dedupes by UID; duplicate names get ` (Bin)` on later copies only.
  Shortcuts carry `presetUid` through CEP, engine and listener.
- New presets appear only after Premiere rewrites the file, i.e. on quit.
- `[System] Preset Report` → `~/Library/Logs/PR FX Preset Report.txt`: every
  non-default param, its default, and whether it will be written, keyed,
  assumed, or block the preset. Read this before debugging an apply.
- The parser and analysis are plain JS: they can be exercised under `node` with
  `File`/`Folder` stubs against the real files (done when building it).

### Component property values

- **Multi-value properties are normalized 0..1, not pixels.** Position reads
  `[0.60, 0.26]` where Effect Controls shows `585.1, 508.4`. `[0,0]` is the
  top-left corner, and is what a failed write leaves behind.
- **Array-valued writes do not always take** while scalar ones do.
  `prfx.writePropertyValue` tries several argument forms and confirms each by
  reading the property back.
- **Read back from a re-resolved clip, not the property object you wrote to.**
  A detached property wrapper will happily confirm a write that never reached
  the published clip — this cost two rounds of false "fixed" reports.

### Quirks
- **`Track.overwriteClip` is not stream-specific.** Given an A/V project item it
  routes *both* streams and can publish the companion onto a lane you never chose,
  destroying whatever is there. Nothing restores it. Use QE's per-track
  `overwrite`, and always wrap destructive work in an undo checkpoint.
- **`overwriteClip` always writes at 100% speed.** A speed-changed clip lands with
  the wrong timeline length and in/out. Fix with `qeClip.setSpeed(speed,
  durationTimecode, reversed, false, false)` passing the *original* timeline
  duration.
- **`overwriteClip` writes the bin item's CURRENT in/out, not the whole media.**
  A clip someone trimmed in the Source monitor lands short, which silently
  breaks Replace (the replacement cannot fill the edit). `prfx.stageOneProjectItem`
  widens the range to the full media for the write and restores it immediately.
  **Premiere does NOT reliably clamp an over-long out point.** Widening to a
  fixed 36000s produced ten-hour clips running far past the media (hatched in
  the Timeline). Only Replace widens, because it trims to the edit afterwards;
  the Place functions pass `keepRange` and use the bin item's marked in/out.
- Setting `projectItem.setInPoint/setOutPoint` to write a trimmed clip **mutates
  the bin item** — always restore it afterwards.
- QE `getTransitionAt()` returns empty spans with type `"Empty"`; filter them or
  they connect unrelated clips.
- Structural edits invalidate QE wrappers. Re-resolve immediately before every
  mutation (`resolveMoveQEClipAt`).
- `.prfpset` (Effect Presets) is **plain XML**, not binary:
  `~/Documents/Adobe/Premiere Pro/<ver>/Profile-<user>/Effect Presets and Custom Items.prfpset`
  Structure: `TreeItem`(name) → `FilterPresetItem` → `FilterPreset`(`FilterMatchName`)
  → `VideoFilterComponent` → `VideoComponentParam`. Fully parsed by the preset
  engine; see **User presets** above.

---

## Design rules established

**PR FX moves clips; it does not create them.** Every shipping function
rearranges clips that already exist, which is why they are all safe and all
reversible. Duplicate was the one exception and it was removed: creating a clip
means `overwriteClip` / QE `overwrite`, both of which route A/V by *track
targeting* rather than by the track you address, so a companion stream lands on
an occupied lane and destroys what is there with no way back. Attempted and
insufficient: stray removal, damage detection, per-track QE overwrite, targeting
isolation, wholly-empty-lane policy. Untried: locking every non-destination
track before the write. Treat any new create-a-clip function as blocked on that
question.

**Refuse rather than corrupt.** Every function verifies before it mutates and
aborts whole rather than leaving a partial edit. Failure messages name the clip.

**Linked expansion follows timing, not tracks:**

| Changes | Expands to linked partners |
|---|---|
| track only (Move, Clean Up) | no — cannot desync |
| timeline position (Pull, Snap, Stagger, Close Gaps) | yes |

Link groups come from `expandLinkedMoveSelection`, which tags each detail with
`linkGroup` and `explicit`. Functions that shift timing give every member of a
group **one shared offset** so a pair cannot drift apart.

**Driving kind.** Where an operation needs one media type to lead (Stagger, Close
Gaps), it is whichever kind the editor *explicitly* selected more of, with video
winning ties.

**Undo.** `prfx.arrangeUndoStack` holds 25 levels of inverse-replay records for
arrange operations, each verified at undo time (clips still where we left them,
destination still clear). Deliberately **not** step-counting Premiere's undo
stack — miscounting either half-restores or eats the user's previous edit.
Duplicate is not covered by this (it creates clips); it uses an undo checkpoint
instead.
