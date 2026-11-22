@echo off
setlocal
rem Builds native\windows\build\PRFXShortcutListener.exe (.NET Framework 4.8).
rem Needs the .NET SDK (https://dot.net) on the build machine only; users need nothing.
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set STAMP=%%i
set BUILD=win-%STAMP%
dotnet build "%~dp0PRFXShortcutListener.csproj" -c Release -p:PrfxBuild=%BUILD% -o "%~dp0bin\Release"
if errorlevel 1 exit /b %errorlevel%
rem The gate (2026-11-22): the Ctrl+Space palette closing as it opened broke every palette command three times.
rem No listener is built unless the palette focus rules (bridge checks) and the real palette and banner against a
rem stand-in Premiere (listener checks, about 15 s of windows) pass. PRFX_SKIP_LIVE_FOCUS=1 skips only the live part.
set DOTNET_CLI_TELEMETRY_OPTOUT=1
dotnet run --project "%~dp0..\..\tools\check-windows-bridge\check-windows-bridge.csproj" -c Release -nologo -v:q
if errorlevel 1 (echo NOT BUILT: the Windows bridge checks failed. & exit /b 1)
dotnet run --project "%~dp0..\..\tools\check-windows-listener\check-windows-listener.csproj" -c Release -nologo -v:q
if errorlevel 1 (echo NOT BUILT: the Windows listener checks failed ^(the palette or banner focus, or Edie^). & exit /b 1)
if not exist "%~dp0build" mkdir "%~dp0build"
copy /y "%~dp0bin\Release\PRFXShortcutListener.exe" "%~dp0build\PRFXShortcutListener.exe" >nul
> "%~dp0build\listener-build.txt" echo %BUILD%
echo Built %BUILD%: %~dp0build\PRFXShortcutListener.exe
