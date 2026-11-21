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
  - A panel whose playhead is scrolled out of view reads as "not the Timeline" until it's looked at again (every
    3 s while focused). A Timeline verdict stays for as long as the panel's window exists.
- **Timeline highlight with Edie sitting on it** (`Win/TimelineHighlight.cs`, setting `timelineHighlight`, off by
  default), with his moods: awake and armed, dozing with "Click the Timeline to arm", grinning when a key fires,
  startled when one is passed on, and "Working on …" for AI functions. A click-through layered window owned by
  Premiere's window, so it sits just above Premiere and goes behind anything in front of it.
- **Edie's nudges** (`Core/EdieNudges.cs`, settings `edieNudges` and `edieNudgeMinutes`): "Still with me?" after a
  quiet stretch and "Welcome back!" after being away, in a speech bubble beside him on the highlight.
- Edie's sprite is one port of the macOS `EdieSprite` (`Win/EdieSprite.cs`); the palette draws from it too.
- The palette (Ctrl+Space) opens and runs commands; the catalog CEP pushes is cached.
- The CEP panel ("Edie" in Window ▸ Extensions) draws and runs commands when docked. Floating on its own it can come
  up blank on this machine: dock it, or close and reopen it.

## Checks

- `tools\check-windows-bridge.cmd` (or `.sh` on the Mac): the platform-neutral core, nudges, settings, scoping reasons.
- `tools\check-windows-listener.cmd` (Windows only): Edie's sprite matches the macOS one, and the playhead detector.

## Still to verify on Windows

- Plain-key shortcuts end to end with real key presses (the hook ignores synthesised keys, so this needs a person).
- Effect, video and audio transition, custom Function, selection errors and repeated bulk applies.
- Bundled-preset roots (`prfx.bundledPresetFiles`) are guessed.
- A Windows CI build and a code-signed exe before distributing.
- The Edie UXP demo needs Premiere 26.3 or later; it was refused on 26.0.1, as expected.
