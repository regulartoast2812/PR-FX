#!/bin/zsh
set -u

LISTENER_PATTERN='/PR FX Shortcut Listener\.app/Contents/MacOS/(PRFXShortcutListener|PR FX Shortcut Listener)'

osascript -e 'tell application id "com.prfx.shortcut-listener" to quit' >/dev/null 2>&1 || true
pkill -f "$LISTENER_PATTERN" >/dev/null 2>&1 || true
exit 0
