# PR FX assets

## adjustment-layers.prproj

Premiere 26 exposes **no scripting API** to create an adjustment layer —
`qe.project.newAdjustmentLayer`, `app.project.createNewAdjustmentLayer`,
`app.project.rootItem.createAdjustmentLayer` and `sequence.createAdjustmentLayer`
are all `undefined` (verified on 26.3.0 build 93). `newTransparentVideo` and
`newColorMatte` exist but neither affects layers beneath, so they are not
substitutes.

`Adjustment Layer Over Selection` therefore imports them from this template
project when the open project has none that fits the current sequence.

### Regenerating the template

Premiere has to author this file; it cannot be written by hand.

1. New project, name it anything.
2. For each frame size you want covered, create a sequence at that size, then
   **File → New → Adjustment Layer** (it inherits the sequence's frame size).
   Suggested set: 1920x1080, 1080x1920, 1080x1080, 3840x2160.
3. Rename each layer to include its size, e.g. `Adjustment Layer 1080x1920`.
   The importer matches on frame size read from project metadata, and falls back
   to parsing the name, so the size in the name is a useful safety net.
4. Delete the sequences — only the adjustment layer items are needed.
5. Save as `adjustment-layers.prproj` in this folder.

Keep it small: no media, no sequences, just the layers.
