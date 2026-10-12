# Saved Pieces: reference logic and PR FX compatibility

Reviewed 2026-09-21 against the local, modified Speed Edit source in
`untitled folder/`. This is a source review, not a Premiere runtime validation.
The reference folder has uncommitted changes; its GitHub HEAD alone is not a
backup of the implementation reviewed here. No reference files were deleted.

## Conclusion

The feature fits PR FX's CEP panel / ExtendScript host / native shortcut bridge.
Port the data model and workflow, but rebuild insertion around PR FX's existing
placement, property handling, verification, and undo helpers. Copying the old
function and its dependencies directly is not a reliable integration.

## What the reference feature does

- `js/main.js:2291` (`saveTimelinePiece`) requests a host capture, assigns an ID,
  name, icon and shortcut, then persists the returned data in CEP localStorage
  under `timelineTools.pieces.v1`. `runPiece` at line 2261 passes that data back
  to `timelineTools.insertTimelinePiece`.
- `jsx/host.jsx:5334` (`captureTimelinePieceData`) produces a version-5 record:
  project scope, original timeline origin, duration, video/audio track spans,
  clip records and transition records.
- Each clip records relative start, duration and track offset (video and audio
  have separate base tracks), source in/out, project item identity and media
  path, name, enabled state, speed/reverse, adjustment-layer flag, components,
  parameter values/keyframes, and selected A/V link-group membership.
- `insertTimelinePiece` at line 8740 resolves/imports sources, finds a free block
  of tracks at the playhead, creates tracks as needed, sets temporary source
  marks, overwrites each clip, restores playback/properties, restores source
  marks, then restores links and transitions. It attempts verification and
  removes inserted clips on failure.
- This saves an editing recipe and references to source media. It does not
  bundle media files or serialize the contents of nested sequences.
- Saved Pieces does not call the native Copy/Paste menu bridge. The separate
  `pasteTimelineClipboardAtPlayhead` near line 12626 does; do not confuse it with
  this feature. Temporary Piece commands also share the reconstruction logic.

## Reusable ideas

1. Capture selection in one host operation and normalize time/track offsets.
2. Store a versioned recipe independently of the active timeline.
3. Scope project node IDs to their original project; resolve external media by
   identity/path when opening a different project.
4. Preflight the entire group and reserve destinations before placing anything.
5. Restore source marks after each operation and verify the complete result,
   including links, before reporting success.

## Changes required for PR FX

| Area | Reference limitation | PR FX integration |
| --- | --- | --- |
| Placement | `overwriteProjectItemOnSingleTrack` at line 10772 writes directly to a requested track; insertion then searches that track. PR FX documents targeting-dependent routing. | Adapt `prfx.stageOneProjectItem`, `trackContentsMap`, `newClipsSince` and staged placement. Account for every emitted video/audio item, including multiple audio channels, before moving to reserved destinations. |
| Keyframes | `captureComponentParam` subtracts timeline start; restoration/verification adds destination timeline start. This can shift source-time keys when pasting elsewhere. | Preserve source-time anchors using `prfx.captureComponentState` / `capturePropertyState`; verify trimmed and retimed clips at a different timeline position. Use explicit JSON fields for anchors: custom properties attached to an Array are not preserved by ordinary JSON serialization. |
| Fidelity | Capture catches property-read errors and can omit data. `savedPropertyMatches` at line 6988 accepts null/undefined captured values as matching. | Track unsupported/unreadable properties explicitly. Reject unsupported captures or clearly report limitations; do not count missing data as verified. Masks, graphics, opaque/plugin parameters and easing require dedicated validation. |
| Media identity | Resolver can fall back to a unique exact name when the original source cannot be found. A unique name does not prove it is the right media. | Require trustworthy identity/path or an explicit relink choice. Nest/adjustment-layer references need an existing compatible project item; cross-project reconstruction is not supplied by this schema. |
| Rollback | Failure cleanup mainly removes recorded inserted clips; imported sources/new tracks and unexpected routed clips are not comprehensively covered. Source-mark failure can occur before the current insertion is recorded. | Use PR FX undo checkpoints plus explicit verified restoration for state not covered by undo. Track all mutations and emitted items, and preserve unrelated timeline contents. |
| Command bridge | PR FX currently sends a fixed set of scalar fields; its Swift `Command` has no piece payload/library. | Add stable piece IDs and a persistent library lookup in CEP/host. Publish saved entries to the native catalog; update both panel dispatch paths. Avoid passing a large recipe through every shortcut binding. |
| Results | Speed Edit uses structured `ok/message/undoSteps` results and its own undo wrapper. | Adapt to PR FX dispatch, error reporting and universal undo rather than importing Speed Edit's mutation-count bookkeeping. |

## Proposed implementation sequence

1. Add a versioned, durable JSON library with stable IDs, names and explicit
   source/keyframe anchors. Provide export/import; localStorage alone is a weak
   archive for user-created pieces.
2. Add capture and paste-by-ID host entry points and panel/native commands.
   Bump both PR FX host build stamps on host edits.
3. First support ordinary file-backed clips at normal speed, with verified
   source ranges, relative placement and supported static properties. Refuse
   unsupported content before mutating the timeline.
4. Extend to animated parameters, links, speed/reverse, transitions and special
   project items only as their preservation tests pass.

Runtime acceptance cases: paste at a different playhead; trimmed animated clips;
occupied/locked destination tracks; altered track targeting; audio-only and
multichannel sources; missing media; project changes; forced partial failure;
undo; and save/reopen. Verify originals and unrelated clips remain intact as
well as verifying the reconstructed group. Static syntax checks cannot prove
these behaviors.

## Before deleting the reference folder

Archive the complete modified reference outside this repository, including
untracked files. Export any user Saved Pieces from the running Speed Edit panel
separately: those live in CEP localStorage, not in the source directory. This
review preserves the design and migration map, not a backup of source or saved
user pieces.
