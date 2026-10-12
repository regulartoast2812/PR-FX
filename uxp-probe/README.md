# PR FX UXP probe

A throwaway UXP panel that answers one question: **could PR FX be rebuilt on
UXP at all?**

It is not part of the shipping tool and never touches a project. It only reads.

## Why it exists

Everything in `jsx/host.jsx` runs on ExtendScript plus the QE DOM. UXP has
neither — no `qe.project`, no `qeClip.moveToTrack`, no `undoStackIndex()`. A
"port" would be a rewrite of essentially the whole tool.

Before committing to that, find out whether the primitives PR FX is actually
built on exist in UXP:

| PR FX depends on | Used by |
|---|---|
| `qeClip.moveToTrack` | Move, Stagger, Snap, Clean Up, Place, Replace |
| `qeClip.setSpeed` | Replace, Perfect Pitch |
| `qe.project.undoStackIndex()` | Universal undo, every rollback |
| `trackItem.projectItem = item` | Replace's direct source swap |
| `Track.overwriteClip` | Place, Replace staging |
| Component properties + keyframes | Replace attribute carry-over, Perfect Pitch |
| `projectItem.setInPoint/setOutPoint` | Place, Replace, synthetic durations |

The probe enumerates the whole `premierepro` surface and scores it against that
list. It reports `MISSING` where it finds nothing — but **`MISSING` does not
prove absence**, only that the names it looked for were not there. Same rule as
the CEP side: reflection could not prove absence there either, and assuming it
could cost real time.

## Loading it

UXP plugins do not load from the CEP extensions folder.

1. Install the **UXP Developer Tool** (Creative Cloud app → Marketplace).
2. Open UDT → **Add Plugin** → select `uxp-probe/manifest.json`.
3. Premiere must be running. Click **Load**.
4. In Premiere: **Window → Extensions (UXP) → PR FX UXP Probe**.
5. Open a project with a sequence, then **Run probe** → **Save report…**

If Premiere does not appear as a target in UDT, this Premiere build does not
accept UXP plugins and the question is already answered.

## Reading the result

- **Member listings** — the real API surface, which is the useful part
- **Requirements scorecard** — FOUND / MISSING per PR FX primitive
- **Total distinct API names** — rough measure of how much surface exists

A mostly-MISSING scorecard means a UXP rebuild would need different *strategies*,
not just different syntax — and that is a much bigger decision than a port.
