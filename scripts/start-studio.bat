@echo off
rem Hakawati Studio - start the control panel and open it in the browser (http://127.0.0.1:4848).
rem Start ComfyUI first (start-comfyui.bat) if the story uses pictures.
setlocal

rem ---------------------------------------------------------------- edit here
if not defined HAKAWATI_PORT set "HAKAWATI_PORT=4848"
rem Use another Chromium browser for rendering if Chrome is not installed, e.g. Edge:
rem set "HAKAWATI_CHROME=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
rem ---------------------------------------------------------------------------

cd /d "%~dp0.."
set "URL=http://127.0.0.1:%HAKAWATI_PORT%"

netstat -ano -p TCP | findstr /c:"127.0.0.1:%HAKAWATI_PORT% " | findstr LISTENING >nul
if not errorlevel 1 (
  echo Something already listens on %URL% - opening it. If it is not the Studio, set HAKAWATI_PORT in this file.
  start "" "%URL%"
  exit /b 0
)

where node >nul 2>nul
if errorlevel 1 (
  echo [x] Node.js is not on PATH. Install Node 22 LTS: https://nodejs.org/dist/latest-v22.x/
  pause
  exit /b 1
)

if not exist "node_modules\playwright-core\package.json" (
  echo First run: installing packages ...
  call npm install
  if errorlevel 1 (
    echo [x] npm install failed.
    pause
    exit /b 1
  )
)

title Hakawati Studio - %URL%
echo Hakawati Studio on %URL%  (close this window or press Ctrl+C to stop)
node server.mjs

echo.
echo The Studio stopped (exit code %ERRORLEVEL%).
pause
