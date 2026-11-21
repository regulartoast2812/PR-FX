@echo off
setlocal
rem Builds native\windows\build\PRFXShortcutListener.exe (.NET Framework 4.8).
rem Needs the .NET SDK (https://dot.net) on the build machine only; users need nothing.
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set STAMP=%%i
set BUILD=win-%STAMP%
dotnet build "%~dp0PRFXShortcutListener.csproj" -c Release -p:PrfxBuild=%BUILD% -o "%~dp0bin\Release"
if errorlevel 1 exit /b %errorlevel%
if not exist "%~dp0build" mkdir "%~dp0build"
copy /y "%~dp0bin\Release\PRFXShortcutListener.exe" "%~dp0build\PRFXShortcutListener.exe" >nul
> "%~dp0build\listener-build.txt" echo %BUILD%
echo Built %BUILD%: %~dp0build\PRFXShortcutListener.exe
