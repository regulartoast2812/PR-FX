# Windows parity checklist

Updated 2026-11-21. The Windows listener builds on this Mac and passes `./tools/check-windows-bridge.sh`, but nobody
has run it on a Windows machine yet. Premiere 2025 (25.x) and later are the target on both platforms: the CEP panel
runs on CEP 12 in both 2025 and 2026, and host.jsx checks every newer call before using it.

## In place (built, not yet seen on Windows)

- Palette (Ctrl+Space) with Edie facing right, the live Premiere catalog pushed by CEP (`/catalog`), the transition,
  move (group and individual) and stagger sub-menus.
- Every bridge route the Mac listener has (`/next`, `/result`, `/health`, `/run`, `/open-palette`, `/reload-settings`,
  `/settings-write`, `/runtime`, the `/uxp-*` routes).
- Shortcut chords through a low-level keyboard hook, scoped to Premiere being in front; success and problem toasts.
- Undo Last Edie Effect Apply / Action (Any) / Arrange Functions, never Ctrl+Z itself.
- Start with Windows: the panel's Install button copies the exe and adds the HKCU Run value.
- Creative Assist installs the panel into `%APPDATA%\Adobe\CEP\extensions\PR FX` and turns on CEP debug mode (CSXS 9–13).

## Missing on Windows (Mac only today)

- **Timeline detection.** Windows has no Timeline rectangle: plain-key shortcuts arm once the listener has seen a text
  caret inside Premiere (`caret-calibrated.txt`), so they work anywhere in Premiere, not only over the Timeline.
- **Timeline highlight with Edie sitting on it** (`PRFXTimelineHighlight.swift`), and its moods.
- **Edie's nudges** after a quiet stretch (`PRFXEdieNudges.swift`).

## To verify on a real Windows Premiere (2025 and 2026)

- The listener registers the palette and every mapped shortcut; `POST /reload-settings` updates them without a restart.
- Plain-key scoping: Premiere's text fields create a Win32 caret (else create `%APPDATA%\PR FX Palette\allow-plain-keys`).
- Effect, video and audio transition, custom Function, selection errors and repeated bulk applies.
- Bundled-preset roots (`prfx.bundledPresetFiles`) are guessed.
- A Windows CI build and a code-signed exe before distributing.
