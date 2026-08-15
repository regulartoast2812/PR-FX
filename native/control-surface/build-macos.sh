#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SDK_DIR="${PRFX_PREMIERE_SDK_MAC:-$ROOT_DIR/SDK/Premiere Pro 26.0 C++ SDK Mac}"
HEADERS_DIR="$SDK_DIR/Examples/Headers"
WRAPPER_DIR="$HEADERS_DIR/adobesdk/controlsurface/plugin/wrapper"
OUTPUT_DIR="$ROOT_DIR/native/control-surface/build"
BUNDLE="$OUTPUT_DIR/PRFXControlSurface.bundle"

if [[ ! -f "$HEADERS_DIR/adobesdk/controlsurface/plugin/ControlSurfacePluginSuite.h" ]]; then
  print -u2 "Premiere Pro C++ SDK for macOS was not found. Set PRFX_PREMIERE_SDK_MAC or place it in SDK/."
  exit 1
fi

mkdir -p "$BUNDLE/Contents/MacOS"
cp "$ROOT_DIR/native/control-surface/macos/Info.plist" "$BUNDLE/Contents/Info.plist"

SDK_PATH="$(xcrun --sdk macosx --show-sdk-path)"
xcrun clang++ -std=c++17 -x objective-c++ -fblocks -fvisibility=hidden -fvisibility-inlines-hidden \
  -bundle -arch arm64 -arch x86_64 -isysroot "$SDK_PATH" -mmacosx-version-min=12.0 \
  -I "$HEADERS_DIR" \
  "$ROOT_DIR/native/control-surface/src/PRFXControlSurface.cpp" \
  "$WRAPPER_DIR/ControlSurfaceBase.cpp" \
  "$WRAPPER_DIR/ControlSurfaceCommandBase.cpp" \
  -framework Cocoa \
  -o "$BUNDLE/Contents/MacOS/PRFXControlSurface"

codesign --force --sign - "$BUNDLE" >/dev/null
print "Built: $BUNDLE"
