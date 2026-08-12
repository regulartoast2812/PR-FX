#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
"$script_dir/build-macos.sh"
osascript -e 'tell application id "com.prfx.shortcut-listener" to quit' >/dev/null 2>&1 || true
sleep 0.4
open "$script_dir/build/PR FX Shortcut Listener.app"
