@echo off
rem The Windows listener's platform-neutral core against real HTTP requests (same as check-windows-bridge.sh).
set DOTNET_CLI_TELEMETRY_OPTOUT=1
dotnet run --project "%~dp0check-windows-bridge\check-windows-bridge.csproj" -c Release -nologo -v:q
