#!/bin/zsh
# Cross-compiles the Windows listener on macOS. The exe cannot run here; this
# only proves it builds and produces the file the Windows installer copies.
set -euo pipefail
here="${0:A:h}"
dotnet_bin="${DOTNET:-$(command -v dotnet || echo "$HOME/.dotnet/dotnet")}"
build="win-$(date +%Y%m%d-%H%M%S)"
"$dotnet_bin" build "$here/PRFXShortcutListener.csproj" -c Release -p:PrfxBuild="$build" -o "$here/bin/Release" -nologo -v:q
mkdir -p "$here/build"
cp "$here/bin/Release/PRFXShortcutListener.exe" "$here/build/PRFXShortcutListener.exe"
print -r -- "$build" > "$here/build/listener-build.txt"
print "Built $build: $here/build/PRFXShortcutListener.exe"
