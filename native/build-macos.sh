#!/bin/zsh
set -euo pipefail

project_dir="${0:A:h}"
output_dir="$project_dir/build"
app_dir="$output_dir/PR FX Shortcut Listener.app"
module_cache="${TMPDIR:-/tmp}/prfx-swift-module-cache"

rm -rf "$app_dir"
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources" "$module_cache"
swiftc -module-cache-path "$module_cache" "$project_dir/PRFXShortcutListener.swift" -o "$app_dir/Contents/MacOS/PR FX Shortcut Listener" -framework AppKit -framework ApplicationServices -framework Carbon -framework Network
cp "$project_dir/Info.plist" "$app_dir/Contents/Info.plist"
codesign --force --deep --sign - "$app_dir"
echo "Built: $app_dir"
