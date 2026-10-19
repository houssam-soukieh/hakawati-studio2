@echo off
rem Hakawati Studio - one-click installer. Double-click this file.
rem Runs install-all.ps1 (next to this file) with Windows PowerShell; options pass through, e.g.
rem   install-all.bat -DryRun
rem   install-all.bat -OnlyModels -SkipWan
rem   install-all.bat -Proxy http://127.0.0.1:8080 -HfEndpoint https://hf-mirror.com
setlocal
if not exist "%~dp0install-all.ps1" (
  echo [x] install-all.ps1 must be in the same folder as this file.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-all.ps1" -NoPause %*
set "RC=%ERRORLEVEL%"
echo.
echo Installer finished with exit code %RC%. Log: see the path printed above.
pause
exit /b %RC%
