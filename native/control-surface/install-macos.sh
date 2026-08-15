#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
BUNDLE="$ROOT_DIR/native/control-surface/build/PRFXControlSurface.bundle"
# Premiere 2026 still scans Control Surface modules from the historical
# "Plug-ins" path (with a hyphen), even though MediaCore uses "Plugins".
DESTINATION="/Library/Application Support/Adobe/Common/Plug-ins/ControlSurface/PRFXControlSurface.bundle"

if [[ ! -d "$BUNDLE" ]]; then
  print -u2 "Build the control surface first: ./native/control-surface/build-macos.sh"
  exit 1
fi

sudo mkdir -p "${DESTINATION:h}"
sudo rm -rf "$DESTINATION"
sudo ditto "$BUNDLE" "$DESTINATION"
print "Installed: $DESTINATION"
print "Quit and relaunch Premiere, then add PR FX Control Surface in Preferences > Control Surface."
