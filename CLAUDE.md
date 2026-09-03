# PR FX — working notes

Premiere Pro command palette. Three layers, all of which must agree:

| Layer | File | Role |
|---|---|---|
| Host | `jsx/host.jsx` | ExtendScript; every function actually lives here |
| Panel | `client/app.js` | CEP settings panel + its own palette; owns the command catalog |
| Listener | `native/PRFXShortcutListener.swift` | standalone palette + global hotkeys |

Adding a function means an entry in **all three**: `prfx.functions` in the host, the
`commands` array in `app.js`, and `prfxFunctionCommands` in the Swift listener.

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
python3 tools/check-extendscript.py jsx/host.jsx
```

Known killers:
- **ES3 FutureReservedWords as identifiers** — `byte`, `char`, `int`, `float`,
  `short`, `long`, `final`, `public`, `static`, `class`, `enum`… `var byte` cost
  a full debugging round.
- **Regex literals containing `<`** — E4X reads `<` as the start of an XML
  literal. Scan with `indexOf`/`substring` instead.
- Anything ES5+: `let`, `const`, arrow functions, template literals, spread.

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

### CEP vs host vs listener changes
- `host.jsx` / `app.js` → reload the settings panel, **no rebuild**
- `*.swift` → `./native/run-macos.sh`

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
  → `VideoFilterComponent` → `VideoComponentParam`. Keyframes are packed
  comma-separated blobs — not decoded.

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
