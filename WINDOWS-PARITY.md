# Windows parity checklist

Windows is intentionally not a supported release target yet. The CEP settings UI writes the same `settings.json` format, and the Windows listener has initial multi-shortcut support, but it must be verified in a real Windows Premiere install.

Before enabling Windows support:

- Build and run `native/windows/PRFXShortcutListener.csproj` with the .NET 8 SDK on Windows.
- Verify the listener registers the palette trigger and every mapped effect, transition, audio transition, and Function shortcut while Premiere’s Timeline has focus.
- Verify `POST /reload-settings` updates shortcut mappings without restarting the listener, including duplicate/OS-reserved shortcut conflict feedback.
- Add the same Premiere Effects-panel catalog sync used on macOS; the current Windows palette still has a small fallback catalog.
- Extend the Windows listener command model to carry `moveMode`, `staggerFrames`, and `staggerGroup`; expose the up/down group and individual moves plus Pull Group In/Out and Stagger Ascending/Descending. The current C# command/settings records do not decode those fields yet.
- Add automatic listener startup/shutdown with Premiere (Task Scheduler or a user-level startup service), matching macOS `LaunchAgent` behavior.
- Decide and implement the Windows-safe equivalent of the explicit **Undo Last PR FX Apply** Function. Do not intercept Ctrl/Cmd+Z.
- Test effect, video-transition, audio-transition, custom Function, selection errors, and repeated bulk applies across supported Premiere versions.
- Add a Windows CI build and code-sign the distributed executable.

Until this checklist is complete, develop and validate features on macOS first.
