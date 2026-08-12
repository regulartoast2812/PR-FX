# PR FX Palette

A cross-platform Premiere Pro command palette that keeps its Window panel for **settings and key mappings only**. The working surface is a command palette: select clips on the Timeline, press the configured shortcut (default **Ctrl + Space**), search, and press Enter to apply an effect or transition.

## Use in Premiere

1. Build and open the included listener for your operating system. Keep it running:

   - macOS: `./native/run-macos.sh` (rebuilds and restarts the listener)
   - Windows: `native\windows\build-windows.cmd`, then start `native\windows\build\win-x64\PRFXShortcutListener.exe`

2. Restart Premiere Pro, then open **Window → Extensions → PR FX Palette Settings** once. The panel listens for commands from the native listener and applies them to the selected Timeline clips.
3. In the settings panel, set the shortcut and default transition duration. Restart the listener after changing the shortcut. Supported trigger keys: Space, A–Z, and 0–9, with modifiers.
4. Click/select clips in an active Timeline and invoke the shortcut. The standalone palette opens over Premiere; type, then press Enter.

Pressing **Enter** applies the highlighted item to every compatible selected Timeline clip: video effects use selected video clips; transitions and audio fades apply to both the In and Out of compatible selected clips. Use Up/Down to change the highlighted result and Escape to cancel.


The palette includes a small starting catalog (Gaussian Blur, Lumetri Color, Crop, Transform, Warp Stabilizer, Cross Dissolve, Dip to Black/White, and common audio fades). Add more commands in `client/app.js` using the same `{ type, name }` format. Names must match Premiere's installed effect/transition names.

## Why there is a listener

Premiere does not let CEP or UXP extensions register a shortcut in the Timeline context. The included **PR FX Shortcut Listener** uses the same essential architecture as Excalibur’s companion shortcut listener: it owns the hotkey at the operating-system level but only responds while **Adobe Premiere Pro** is frontmost. This means Ctrl + Space works while the Timeline has focus—without first focusing a CEP panel.

The app is built locally and ad-hoc signed on macOS; the Windows build produces a self-contained `.exe`. For distribution, sign/notarize the macOS app and code-sign the Windows executable. If Ctrl + Space is already used by Premiere or another app, choose a different combination in the settings panel and restart the listener.

## Development installation

This folder is already in Premiere's CEP extensions directory. Build the listener first.

### macOS

```sh
./native/build-macos.sh
open "native/build/PR FX Shortcut Listener.app"
```

### Windows

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

The host action layer uses Premiere's QE DOM because it exposes adding video effects and transitions to timeline clips. QE is not Adobe's fully public scripting surface, so verify behavior against the Premiere versions you plan to support.
