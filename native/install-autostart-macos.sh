#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
LABEL="com.prfx.shortcut-listener"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
TEMPLATE="$SCRIPT_DIR/$LABEL.plist.template"
WATCHER="$SCRIPT_DIR/launch-listener-on-premiere.sh"

mkdir -p "$HOME/Library/LaunchAgents"
chmod +x "$WATCHER"

# Escape the path before replacing the template marker. This is an install-time
# generated LaunchAgent so the project can live in any CEP extensions folder.
ESCAPED_WATCHER="${WATCHER//\\/\\\\}"
ESCAPED_WATCHER="${ESCAPED_WATCHER//&/\\&}"
ESCAPED_WATCHER="${ESCAPED_WATCHER//|/\\|}"
sed "s|__WATCHER_PATH__|$ESCAPED_WATCHER|g" "$TEMPLATE" > "$TARGET"
plutil -lint "$TARGET" >/dev/null

launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID" "$TARGET"
launchctl kickstart -k "gui/$UID/$LABEL"

print "Installed PR FX automatic listener. It will start the palette bridge whenever Premiere opens."
