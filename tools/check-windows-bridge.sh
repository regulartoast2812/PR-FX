#!/bin/zsh
# Runs the Windows listener's platform-neutral core on this Mac against real
# HTTP requests. Does not touch the keyboard hook, palette or caret logic --
# those need a Windows machine.
set -euo pipefail
here="${0:A:h}"
dotnet_bin="${DOTNET:-$(command -v dotnet || echo "$HOME/.dotnet/dotnet")}"
DOTNET_CLI_TELEMETRY_OPTOUT=1 "$dotnet_bin" run --project "$here/check-windows-bridge/check-windows-bridge.csproj" -c Release -nologo -v:q
