# PR FX Palette

A macOS-first Premiere Pro command palette that keeps its Window panel for **settings and key mappings only**. The working surface is a command palette: select clips on the Timeline, press the configured shortcut (default **Ctrl + Space**), search, and press Enter to apply an effect or transition.

macOS is the currently supported target. Windows listener work is tracked in [WINDOWS-PARITY.md](WINDOWS-PARITY.md) and should be validated on a real Windows/Premiere installation before release.

## Use in Premiere

1. On macOS, build and open the listener. Keep it running:

   - macOS: `./native/run-macos.sh` (rebuilds and restarts the listener)

2. Restart Premiere Pro, then open **Window → Extensions → PR FX Palette Settings** once. The panel listens for commands from the native listener and applies them to the selected Timeline clips.
3. In the settings panel, set the shortcut and default transition duration. Changes reload into the listener automatically. Supported trigger keys: Space, A–Z, and 0–9, with or without modifiers. A key with no modifier works only while the Timeline is the active panel, so add Ctrl, Option, or Command to anything destructive.
4. Click/select clips in an active Timeline and invoke the shortcut. The standalone palette opens over Premiere; type, then press Enter.

Pressing **Enter** applies the highlighted item to every compatible selected Timeline clip: video effects use selected video clips; transitions and audio fades apply to both the In and Out of compatible selected clips. Use Up/Down to change the highlighted result and Escape to cancel.

The palette lists PR FX's own functions alongside every video effect, video transition, and audio transition your Premiere installation actually has. The settings panel reads that catalog from Premiere and syncs it to the listener, which caches it so the palette still opens before Premiere has connected. PR FX functions are defined in `client/app.js`; effects and transitions come from Premiere and need no configuration.

## Major features

- [Replace Selected Clips from Bin](docs/replace-selected-clips-from-bin.md) — swaps selected Timeline clips to the selected Project/Bin item while preserving timeline position, source In/Out, speed, effects, linked audio/video, and recoverable transitions.

## Why there is a listener

Premiere does not let CEP or UXP extensions register a shortcut in the Timeline context. The included **PR FX Shortcut Listener** uses the same essential architecture as Excalibur’s companion shortcut listener: it owns the hotkey at the operating-system level but only responds while **Adobe Premiere Pro** is frontmost. This means Ctrl + Space works while the Timeline has focus—without first focusing a CEP panel.

The app is built and signed locally on macOS. If Ctrl + Space is already used by Premiere or another app, choose a different combination in the settings panel.

### How PR FX decides when a shortcut is live

Premiere doesn't tell us which panel has focus — the Accessibility API reports a generic placeholder in every state and exposes no panel containers. It does expose individual controls with screen positions, so PR FX works out where the Timeline is and whether you're working in it.

Shortcuts are registered only when all of the following hold:

- Premiere is the frontmost application
- Accessibility permission is granted (required — without it, nothing is armed)
- No text field has focus
- Your last mouse click landed inside the Timeline panel

The Timeline's rectangle is derived by finding controls that exist only in that panel — track lock, mute, solo, snap — and extending their bounds to the panel's tab bar and the bottom of the window. It's recomputed as focus changes and re-checked on every keypress, so shortcuts release the moment you click into another panel.

Because this follows your last click rather than true focus, it can be wrong if you switch panels by menu or keyboard without clicking, or if Premiere moves focus itself. Adding a modifier to a binding sidesteps that entirely, which is worth doing for anything destructive.

**Accessibility permission is required.** Grant it under System Settings → Privacy & Security → Accessibility. Without it the listener cannot locate the Timeline, refuses to arm any shortcut, and neither the palette nor mapped keys will respond.

## Development installation

This folder is already in Premiere's CEP extensions directory. Build the listener first.

### macOS

```sh
./native/build-macos.sh
open "native/build/PR FX Shortcut Listener.app"
```

To start and stop the listener automatically with Premiere, run this once:

```sh
./native/install-autostart-macos.sh
```

### Windows

Not yet release-ready; see [WINDOWS-PARITY.md](WINDOWS-PARITY.md).

Install the [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0), then run:

```bat
native\windows\build-windows.cmd
native\windows\build\win-x64\PRFXShortcutListener.exe
```

For an unsigned development CEP build, enable CEP PlayerDebugMode for your installed CEP version, then restart Premiere. In macOS Terminal the usual command is:

```sh
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
```

Use the matching CSXS major version if your Premiere install uses another one. Remove the setting or sign the extension for distribution.

## Structure

- `CSXS/manifest.xml` — Premiere CEP registration
- `client/` — settings panel and command palette UI
- `jsx/host.jsx` — ExtendScript bridge that applies the selected command to selected timeline clips
- `native/` — macOS and Windows Timeline-aware hotkey listeners and build scripts
- `native/control-surface/` — experimental Control Surface SDK investigation; it is not part of the runtime

The host action layer uses Premiere's QE DOM because it exposes adding video effects and transitions to timeline clips. QE is not Adobe's fully public scripting surface, so verify behavior against the Premiere versions you plan to support.
