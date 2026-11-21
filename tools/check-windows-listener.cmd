@echo off
rem Windows-only checks for the listener: Edie's sprite and the Timeline playhead detector.
set DOTNET_CLI_TELEMETRY_OPTOUT=1
dotnet run --project "%~dp0check-windows-listener\check-windows-listener.csproj" -c Release -nologo -v:q
