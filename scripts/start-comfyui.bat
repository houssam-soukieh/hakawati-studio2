@echo off
rem Hakawati Studio - start the local ComfyUI (portable, NVIDIA) for the Pictures / Motion steps.
rem Listens on 127.0.0.1 only. See docs\SETUP-WINDOWS.md section 6 for the flags.
setlocal

rem ---------------------------------------------------------------- edit here
rem Root of the extracted ComfyUI_windows_portable folder (contains python_embeded and ComfyUI).
set "COMFY_ROOT=E:\ComfyUI"
set "COMFY_PORT=8188"
rem Extra flags. Empty = ComfyUI defaults (dynamic VRAM on NVIDIA streams Wan 2.2 weights by itself).
rem   --reserve-vram 1.0   keep 1 GB free for the desktop and Chrome (OOM while the Studio renders)
rem   --lowvram            only on an old ComfyUI without dynamic VRAM, or if Wan still runs out of memory
rem   --novram             last resort
set "EXTRA_FLAGS="
rem Remove --enable-manager if you do not use ComfyUI-Manager.
set "MANAGER_FLAG=--enable-manager"
rem ---------------------------------------------------------------------------

if not exist "%COMFY_ROOT%\python_embeded\python.exe" (
  echo [x] ComfyUI portable not found at "%COMFY_ROOT%".
  echo     Extract ComfyUI_windows_portable_nvidia.7z and rename the folder, or edit COMFY_ROOT in this file.
  pause
  exit /b 1
)

netstat -ano -p TCP | findstr /c:"127.0.0.1:%COMFY_PORT% " | findstr LISTENING >nul
if not errorlevel 1 (
  echo ComfyUI is already running on http://127.0.0.1:%COMFY_PORT%
  timeout /t 5 >nul
  exit /b 0
)

cd /d "%COMFY_ROOT%"
title ComfyUI - 127.0.0.1:%COMFY_PORT%
echo Starting ComfyUI from %COMFY_ROOT% on http://127.0.0.1:%COMFY_PORT% ...
"%COMFY_ROOT%\python_embeded\python.exe" -s ComfyUI\main.py --windows-standalone-build --listen 127.0.0.1 --port %COMFY_PORT% --disable-auto-launch --preview-method none %MANAGER_FLAG% %EXTRA_FLAGS%

echo.
echo ComfyUI stopped (exit code %ERRORLEVEL%).
echo If it did not start: update the NVIDIA driver (nvidia-smi must show CUDA 13.0 or newer).
echo A c10.dll error means the VC++ runtime is missing: https://aka.ms/vc14/vc_redist.x64.exe
pause
