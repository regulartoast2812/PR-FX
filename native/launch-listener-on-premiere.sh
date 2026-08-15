#!/bin/zsh
set -u

SCRIPT_DIR="${0:A:h}"
LISTENER_APP="$SCRIPT_DIR/build/PR FX Shortcut Listener.app"
PREMIERE_PATTERN='/Adobe Premiere Pro [^/]*/Adobe Premiere Pro [^/]*\.app/Contents/MacOS/Adobe Premiere Pro'
LISTENER_PATTERN='/PR FX Shortcut Listener\.app/Contents/MacOS/PR FX Shortcut Listener'

premiere_is_running() {
  pgrep -f "$PREMIERE_PATTERN" >/dev/null 2>&1
}

listener_is_running() {
  pgrep -f "$LISTENER_PATTERN" >/dev/null 2>&1
}

while true; do
  if premiere_is_running; then
    if ! listener_is_running && [[ -d "$LISTENER_APP" ]]; then
      open -gj "$LISTENER_APP"
    fi
  elif listener_is_running; then
    osascript -e 'tell application id "com.prfx.shortcut-listener" to quit' >/dev/null 2>&1 || true
  fi
  sleep 2
done
