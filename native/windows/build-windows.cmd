@echo off
setlocal
dotnet publish "%~dp0PRFXShortcutListener.csproj" -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o "%~dp0build\win-x64"
if errorlevel 1 exit /b %errorlevel%
echo Built: %~dp0build\win-x64\PRFXShortcutListener.exe
