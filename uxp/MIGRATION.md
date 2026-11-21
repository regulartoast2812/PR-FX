# Edie UXP migration

> **Status: demo only.** The main Edie is the CEP panel (PR FX) and Edie in
> Creative Assist. The UXP plugin ("Edie (Demo)" in Premiere's Window menu) is
> kept as a working demo of the UXP versions, not a replacement: CEP still does
> things UXP cannot (speed, real track moves that keep transitions and links,
> presets, audio transitions, AI functions). Its command runtime defaults to
> CEP and nothing routes to UXP unless someone chooses it in its General tab.
> Do not remove or deprecate CEP on the strength of this plugin.

Edie is moving to a hybrid UXP architecture because Premiere does not expose
UXP keyboard shortcuts. The native listener remains responsible for Ctrl+Space,
timeline-scoped chords, the palette and result notifications. Creative Assist
remains responsible for agents, Whisper, ffmpeg, downloads and shared settings.

The UXP runtime advertises the command IDs it supports to the native bridge.
Those commands route to UXP while its heartbeat is fresh. The CEP engine keeps
handling every other command and automatically takes the whole queue back if
UXP disconnects. Removing CEP is the final migration step, not the first.

The current build requires Premiere 26.3 because `Sequence.setSelection()` only
became synchronous there, and UXP selection objects cannot safely escape their
callback or await work inside it.

## Command runtime switch

General › Command runtime chooses where Premiere commands run. **CEP engine
(stable)** is the default: UXP registers nothing and every command goes to the
CEP engine as before. **UXP (testing)** registers the route keys from
`EdiePremiere.routeKeys(catalog)`: a function's id, or `type:name` for effects
and transitions. Only commands whose UXP calls exist in this Premiere are
registered; everything else still goes to CEP. Switch back to CEP at any time.

## Native in UXP now (in UXP mode)

- Arrange in time: Pull Group In/Out, Snap Tracks In/Out, Stagger
  Ascending/Descending, Close Selected Gaps.
- Arrange across tracks: Move Clips Up/Down (group and individual), Clean Up
  Track Rows, Fill Track Rows Down. UXP cannot move a clip to another track, so
  it is cloned there (keeping effects) and the original removed in one
  transaction. **Differences from CEP:** transitions on a moved clip are lost,
  a moved clip loses its link to the partner it left behind, and clips joined
  by transitions are grouped by touching instead.
- Trim In/Out to Playhead, including extending into media handles.
- Select Before Playhead, Inspect Selected Clip.
- Video effects; audio effects where Premiere lists them by display name.
- Video transitions with every placement (In + Out, In, Out, selected cuts,
  group edges, centered); Remove Transitions.
- Place Source Clip, Place Bin Clips (row and column), Replace from Bin
  (effects and static settings carried over; keyframed settings reported).
- Adjustment Layer over Selection, reusing an existing adjustment layer.
  Premiere cannot create one from a plug-in.
- Perfect Pitch (Pitch Shifter, same ranges and checks as CEP).
- Queue Cuts to Media Encoder: same ranges, merging, naming and
  `PR FX Exports` folder (made by the listener, `/uxp-export-folder`).
- Edie's Undo/Redo: each step records how many Premiere transactions it took
  and the Timeline it left. Undo refuses if the Timeline has changed since,
  then presses Premiere's Undo that many times through the listener
  (`/uxp-undo`, Premiere must be frontmost).

Linked clips: UXP cannot read links, so a video clip and the audio clips with
the same name, start and end are treated as linked. Moves, trims and edits that
Adobe does not document exactly are checked afterwards; when Premiere did
something else, Edie undoes it and says so. A failure part-way is rolled back
unless the failure policy is "Keep changes".

## Still on the CEP engine (no UXP API)

- Speed: Stretch Speed to Playhead, Retract Speed In/Out, Replace & Fit from
  Bin. UXP cannot change clip speed.
- Audio transitions; saved effect presets; AI functions.
- Bulk Replace by Name and its preview.
- Diagnostics: dump QE API, preset report/route probe, failure report/clear.

CEP cannot be declared legacy until these have a replacement. Everything in
UXP mode is untested inside Premiere so far.

## UXP panel now

- The full live CEP catalog is searchable and filterable in UXP.
- Every catalog command can be run from its detail pane.
- UXP-native commands route to the Premiere DOM; unported commands route to
  the compatibility engine without bringing back the CEP UI.
- Assigned shortcuts are shown from the shared settings file.
- Shortcuts can be captured, saved and removed, and General settings are
  edited, through the listener's `/settings-write` (UXP has no file access).
- Folder sync: folders are saved per project in `folderSyncsByProject`, the
  same key the CEP panel used, so folders added there carry over. The listener
  lists media (`/uxp-scan-folder`); `premiere.js` creates the same-named bins
  and imports or refreshes clips. Sync now, Stop sync, and a silent 30-second
  auto-sync of changed files match CEP.
- Open palette and the failure, key-journal and listener logs open through
  the listener (`/uxp-open-palette`, `/uxp-reveal`).

## Still only in the CEP panel

- Edie chat (Creative Assist agents).
- Setup: listener install, Accessibility prompt, force reconnect.
- Catalog health details.

## Stays outside UXP

- Ctrl+Space and shortcut chords: native listener.
- Edie agents and reusable tool settings: Creative Assist.
- Whisper, ffmpeg and other child processes: Creative Assist.
- Timed working/success/failure bubbles: native listener.
