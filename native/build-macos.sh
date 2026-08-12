#!/bin/zsh
set -euo pipefail

project_dir="${0:A:h}"
output_dir="$project_dir/build"
app_dir="$output_dir/PR FX Shortcut Listener.app"

rm -rf "$app_dir"
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"
swiftc "$project_dir/PRFXShortcutListener.swift" -o "$app_dir/Contents/MacOS/PR FX Shortcut Listener" -framework AppKit -framework Carbon -framework Network
cp "$project_dir/Info.plist" "$app_dir/Contents/Info.plist"
codesign --force --deep --sign - "$app_dir"
echo "Built: $app_dir"
