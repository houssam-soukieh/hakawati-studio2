# Hakawati Studio — setup on the Windows desktop

Target machine: Windows 10/11 x64, i7-10700, RTX 3060 Ti 8 GB, 16 GB RAM, SSD on `E:`.
Everything here is free and runs locally. Only edge-tts (narration) and the text engine (CodeCraft) need the internet.

Layout used throughout (change it, but then change the scripts' variables too):

| What | Path |
|---|---|
| Hakawati Studio (this repo) | `E:\hakawati` |
| ComfyUI portable root | `E:\ComfyUI` (the extracted `ComfyUI_windows_portable` folder, renamed) |
| ComfyUI models | `E:\ComfyUI\ComfyUI\models\…` |
| ComfyUI custom nodes | `E:\ComfyUI\ComfyUI\custom_nodes\…` |

Disk: ≈ 37 GB of models + ≈ 7 GB ComfyUI + projects. Keep **≥ 60 GB free on E:**.

Marks: **[v]** = checked against the source while writing this (Oct 2026); **[?]** = not verified, from memory or a third-party listing — check on the page.

---

## 0. Before you start

1. **NVIDIA driver R580 or newer.** The current ComfyUI portable ships PyTorch built for CUDA 13.0 [v ComfyUI README]. Check:
   ```bat
   nvidia-smi
   ```
   The header must show `CUDA Version: 13.0` or higher. If not, install the latest Game Ready or Studio driver from nvidia.com.
2. **Microsoft Visual C++ Redistributable x64** (needed by PyTorch; a `c10.dll` error means it is missing): https://aka.ms/vc14/vc_redist.x64.exe [v ComfyUI `run_nvidia_gpu.bat`].
3. **Page file.** 16 GB RAM is not enough for Wan 2.2 (10 GB model + 6.7 GB text encoder + Windows). Set *System Properties → Advanced → Performance → Settings → Advanced → Virtual memory* to *System managed* on the SSD, or a fixed 32768 MB. Without it you get `The paging file is too small for this operation to complete` (os error 1455).

## 1. Base tools

Install in this order. After each install open a **new** terminal so PATH is re-read.

| Tool | Get it | Install choices | Check |
|---|---|---|---|
| Node.js 22 LTS | https://nodejs.org/dist/latest-v22.x/ → `node-v22.*-x64.msi` | defaults (adds to PATH). Native-module tools not needed. | `node -v` → `v22.x.x` |
| Git for Windows | https://git-scm.com/downloads/win (64-bit) | defaults | `git --version` |
| ffmpeg (gyan.dev) | https://www.gyan.dev/ffmpeg/builds/ → `ffmpeg-release-essentials.zip` | extract to `C:\ffmpeg` so that `C:\ffmpeg\bin\ffmpeg.exe` exists; add `C:\ffmpeg\bin` to the **user** PATH (*Edit environment variables for your account → Path → New*) | `ffmpeg -version`, `ffprobe -version` |
| Python 3.12 | https://www.python.org/downloads/release/python-31210/ → *Windows installer (64-bit)* `python-3.12.10-amd64.exe` (3.12.10 is the last 3.12 with a Windows installer [v]; 3.13 also works) | tick **Add python.exe to PATH** on the first screen | `python --version` → `Python 3.12.10` |
| edge-tts | `python -m pip install -U edge-tts` | — | `python -m edge_tts --list-voices \| findstr ar-SY` → `ar-SY-AmanyNeural`, `ar-SY-LaithNeural` |
| Google Chrome | https://www.google.com/chrome/ | defaults | `C:\Program Files\Google\Chrome\Application\chrome.exe` exists |
| 7-Zip (for the ComfyUI archive) | https://7-zip.org (64-bit x64) | defaults | — |

Notes:
- The essentials ffmpeg build contains `libx264` and the native AAC encoder, which is all Hakawati uses (`libx264`, `aac`, `pcm_s16le`, filters `xfade`, `loudnorm`, `aevalsrc`).
- `python` must be the real interpreter, not the Microsoft Store stub. If `python` opens the Store: *Settings → Apps → Advanced app settings → App execution aliases* → turn off `python.exe` and `python3.exe`.
- Hakawati calls `python -m edge_tts`, `ffmpeg`, `ffprobe` by name — they must be on PATH for the terminal that starts the Studio.
- Chrome: Playwright looks for `Google\Chrome\Application\chrome.exe` under `%LOCALAPPDATA%`, `%ProgramFiles%`, `%ProgramFiles(x86)%` [v playwright-core 1.64.1]. If Chrome cannot be installed, Microsoft Edge (already on Windows) works: set `HAKAWATI_CHROME` (see §8).
- Optional one-liners with winget (IDs [?], confirm with `winget search`): `winget install --id Git.Git -e`, `winget install --id Gyan.FFmpeg.Essentials -e`, `winget install --id Google.Chrome -e`, `winget install --id 7zip.7zip -e`.

## 2. Hakawati Studio

```bat
cd /d E:\
git clone https://github.com/houssam-soukieh/hakawati-studio2 hakawati
cd /d E:\hakawati
npm install
```

No repository URL exists yet — if the repo is not on GitHub, copy the folder to `E:\hakawati` instead (without `node_modules`, `.studio`, `projects`) and run `npm install` there. The only dependency is `playwright-core` (it does **not** download a browser; it drives the installed Chrome).

Smoke test without GPU or key (offline `mock` engine):

```bat
node make.mjs new docs\test-story.txt --style shadow --aspect 16:9 --length 30
node make.mjs run <the id it printed> all
```

The film lands in `E:\hakawati\projects\<id>\final\` (`.mp4`, `.srt`, `thumbnail.jpg`).

## 3. ComfyUI portable (NVIDIA)

1. Download the official archive [v ComfyUI README]:
   https://github.com/comfyanonymous/ComfyUI/releases/latest/download/ComfyUI_windows_portable_nvidia.7z
   (for RTX 20-series and newer; do **not** take the `_cu126` variant — that one is for GTX 10-series).
   It currently contains embedded Python 3.13 and PyTorch for CUDA 13.0 [v].
2. If extraction complains: right-click the `.7z` → *Properties* → **Unblock**.
3. Extract with 7-Zip to `E:\`, then rename `E:\ComfyUI_windows_portable` → `E:\ComfyUI`. Result:
   ```
   E:\ComfyUI\python_embeded\python.exe
   E:\ComfyUI\ComfyUI\main.py
   E:\ComfyUI\ComfyUI\models\
   E:\ComfyUI\update\update_comfyui.bat
   E:\ComfyUI\run_nvidia_gpu.bat
   ```
4. Update once before first use (and whenever a node needs a newer ComfyUI):
   ```bat
   cd /d E:\ComfyUI\update
   update_comfyui_stable.bat
   ```
   `update_comfyui_stable.bat` moves to the latest tagged release; `update_comfyui.bat` moves to the latest commit. Use `update_comfyui_and_python_dependencies.bat` only if Python packages are broken [v `README_VERY_IMPORTANT.txt`].
5. **ComfyUI-Manager** (now a pip package enabled with a flag [v ComfyUI README, `main.py`]):
   ```bat
   cd /d E:\ComfyUI
   python_embeded\python.exe -s -m pip install -r ComfyUI\manager_requirements.txt
   ```
   `scripts\start-comfyui.bat` passes `--enable-manager`; without the package ComfyUI prints the pip command above and starts anyway. Re-run the pip line after each ComfyUI update (the Manager version is pinned in that file).
   Older method, only if the pip package fails: `git clone https://github.com/ltdrdata/ComfyUI-Manager comfyui-manager` inside `custom_nodes` and start without `--enable-manager`.
6. First start: double-click `E:\hakawati\scripts\start-comfyui.bat` (see §6). Wait for `To see the GUI go to: http://127.0.0.1:8188`.

## 4. Custom nodes

Only these two. Custom nodes run arbitrary Python inside ComfyUI — install from the official repos only.

```bat
cd /d E:\ComfyUI\ComfyUI\custom_nodes
git clone https://github.com/cubiq/ComfyUI_IPAdapter_plus
git clone https://github.com/Fannovel16/comfyui_controlnet_aux
cd comfyui_controlnet_aux
install.bat
```

- **ComfyUI_IPAdapter_plus** (cubiq): no extra Python packages. Provides `IPAdapterUnifiedLoader` and `IPAdapter`, which Hakawati uses for character consistency (preset `PLUS (high strength)`). The repo is in maintenance-only mode since 2025-04 [v README].
- **comfyui_controlnet_aux** (Fannovel16): `install.bat` detects the portable Python (`..\..\..\python_embeded\python.exe`) and installs `requirements.txt` line by line [v], so one failing package does not stop the others. If `mediapipe` fails on Python 3.13 [?], only the MediaPipe face preprocessor is lost; Depth Anything V2 does not need it. Node used: `DepthAnythingV2Preprocessor` ("Depth Anything V2 - Relative") [v].
- Alternative: ComfyUI-Manager → *Custom Nodes Manager* → search the two names → Install.
- Restart ComfyUI after installing. Update later with `git pull` in each folder (or the Manager).

## 5. Models

Put every file **directly** in the folder named (no sub-folder) with the **exact** file name — ComfyUI lists sub-folder files as `sub\name`, and workflows that name the bare file then fail with `Value not in list`. ComfyUI-Manager's *Model Manager* saves Wan 2.2 into `diffusion_models\Wan2.2\` — move it up if you use it.

All folders below are under `E:\ComfyUI\ComfyUI\models\`. Sizes are decimal GB as shown by Hugging Face.

| # | File (exact name) | Folder | Size | Source | Status |
|---|---|---|---|---|---|
| 1 | `RealVisXL_V5.0_Lightning_fp16.safetensors` | `checkpoints` | 6.94 GB | HF [SG161222/RealVisXL_V5.0_Lightning](https://huggingface.co/SG161222/RealVisXL_V5.0_Lightning) · Civitai page "RealVisXL V5.0" (civitai.com/models/139562 [?]) | name + size seen in a mirror's listing; official path not fetched [?] |
| 2 | `Juggernaut_RunDiffusionPhoto2_Lightning_4Steps.safetensors` | `checkpoints` | 7.11 GB | HF [RunDiffusion/Juggernaut-XL-Lightning](https://huggingface.co/RunDiffusion/Juggernaut-XL-Lightning) · Civitai page "Juggernaut XL" (civitai.com/models/133005 [?]) | name + size seen in the official listing via search; not fetched [?] |
| 3 | `ip-adapter-plus_sdxl_vit-h.safetensors` | `ipadapter` (create it) | 848 MB | HF [h94/IP-Adapter](https://huggingface.co/h94/IP-Adapter) `sdxl_models/` | [v] cubiq README, Manager model list |
| 4 | `CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors` | `clip_vision` | 2.53 GB | HF h94/IP-Adapter `models/image_encoder/model.safetensors` — **download and rename** | [v] cubiq README, Manager model list |
| 5 | `depth_anything_v2_vitl.pth` | auto: `custom_nodes\comfyui_controlnet_aux\ckpts\depth-anything\Depth-Anything-V2-Large\` | 1.34 GB | downloaded by the preprocessor on first use from HF `depth-anything/Depth-Anything-V2-Large` | [v] node source |
| 6 | `wan2.2_ti2v_5B_fp16.safetensors` | `diffusion_models` | 10.0 GB | HF [Comfy-Org/Wan_2.2_ComfyUI_Repackaged](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged) `split_files/diffusion_models/` | [v] ComfyUI examples, Comfy docs, Manager list |
| 7 | `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | `text_encoders` | 6.74 GB | HF Comfy-Org/Wan_2.1_ComfyUI_repackaged `split_files/text_encoders/` (same file also in the Wan 2.2 repo) | [v] Comfy docs, Manager list |
| 8 | `wan2.2_vae.safetensors` | `vae` | ≈ 1.41 GB [?] | HF Comfy-Org/Wan_2.2_ComfyUI_Repackaged `split_files/vae/` (the 5B model needs **this** VAE, not `wan_2.1_vae`) | name + folder [v]; size from a mirror [?] |
| 9 | `4x-UltraSharp.pth` | `upscale_models` | 67 MB | HF Kim2091/UltraSharp · page: openmodeldb.info/models/4x-UltraSharp | [v] Manager model list |

Item 4: the IPAdapter Unified Loader finds the encoder by the regex `ViT.H.14.*s32B.b79K` and the adapter by `plus.sdxl.vit.h` [v `utils.py`] — keep the names exactly as above.
Item 5: if Hugging Face is unreachable when the node first runs, download `https://huggingface.co/depth-anything/Depth-Anything-V2-Large/resolve/main/depth_anything_v2_vitl.pth` yourself into the folder shown. The Small model (`depth_anything_v2_vits.pth`, ≈ 99 MB) is the licence-safe alternative (see §11).

### Download commands

PowerShell; `curl.exe` ships with Windows 10/11 (in PowerShell, plain `curl` is a different command). `-C -` resumes a broken download: just run the same line again.

```powershell
$M  = "E:\ComfyUI\ComfyUI\models"
$HF = "https://huggingface.co"
function Get-Model($dest, $url) { curl.exe -L -C - --create-dirs -o "$M\$dest" $url }

Get-Model "checkpoints\RealVisXL_V5.0_Lightning_fp16.safetensors"          "$HF/SG161222/RealVisXL_V5.0_Lightning/resolve/main/RealVisXL_V5.0_Lightning_fp16.safetensors"
Get-Model "checkpoints\Juggernaut_RunDiffusionPhoto2_Lightning_4Steps.safetensors" "$HF/RunDiffusion/Juggernaut-XL-Lightning/resolve/main/Juggernaut_RunDiffusionPhoto2_Lightning_4Steps.safetensors"
Get-Model "ipadapter\ip-adapter-plus_sdxl_vit-h.safetensors"               "$HF/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors"
Get-Model "clip_vision\CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors"         "$HF/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors"
Get-Model "diffusion_models\wan2.2_ti2v_5B_fp16.safetensors"                "$HF/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors"
Get-Model "text_encoders\umt5_xxl_fp8_e4m3fn_scaled.safetensors"            "$HF/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors"
Get-Model "vae\wan2.2_vae.safetensors"                                      "$HF/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors"
Get-Model "upscale_models\4x-UltraSharp.pth"                                "$HF/Kim2091/UltraSharp/resolve/main/4x-UltraSharp.pth"
```

You need only one of the two SDXL checkpoints to start; RealVisXL is the default for the `photoreal` style. If a URL returns a small HTML file instead of gigabytes, the path changed — open the model page and take the file from *Files and versions*.

### VRAM / RAM per model (8 GB VRAM, 16 GB RAM)

| Model | Loaded size | Fit on 3060 Ti | Notes |
|---|---|---|---|
| SDXL Lightning checkpoint (UNet + 2 CLIP + VAE, fp16) | ≈ 6.5–7 GB VRAM peak at 1344×768 [?] | yes | first load from SSD 20–40 s, then stays cached |
| + IP-Adapter Plus SDXL + CLIP-ViT-H | + ≈ 1.5–2 GB [?] | borderline | ComfyUI offloads part of the UNet to RAM; costs seconds, not an OOM |
| Depth Anything V2 Large | ≈ 1 GB [?] | yes | inference at 512 px |
| 4x-UltraSharp | 67 MB + tiles | yes | the upscale node tiles at 512 and halves the tile on OOM [v] |
| Wan 2.2 TI2V-5B fp16 | 10.0 GB weights | **no — streamed** | weights stream from RAM (dynamic VRAM). Optional: *Load Diffusion Model* → `weight_dtype = fp8_e4m3fn` stores it in ≈ 5 GB (slight quality loss; Ampere has no fp8 compute, so memory saving only) |
| umt5-xxl fp8 text encoder | 6.74 GB | briefly | used for prompt encoding, then evicted |
| Wan 2.2 VAE | 1.41 GB | yes | decoding 121 frames at 1280×704 is heavy; ComfyUI retries with tiled decode on OOM [v] |

Close Chrome/games while Wan runs. RAM peak for a Wan job exceeds 16 GB → the page file (§0.3) is mandatory.

## 6. Start scripts

| Script | What it does |
|---|---|
| `scripts\start-comfyui.bat` | starts `E:\ComfyUI` on `127.0.0.1:8188` |
| `scripts\start-studio.bat` | starts the Studio (installs packages on first run) and opens `http://127.0.0.1:4848`; if it already runs, only opens the browser |
| `scripts\check-setup.ps1` | ✓/✗ table of tools, ComfyUI, nodes, model files |

`start-comfyui.bat` runs (variables at the top of the file):

```
python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --listen 127.0.0.1 --port 8188 --disable-auto-launch --preview-method none --enable-manager
```

Flag notes [v `comfy/cli_args.py`, `main.py`, Oct 2026]:
- `--listen 127.0.0.1`: never use bare `--listen` (that binds 0.0.0.0 and exposes ComfyUI to the LAN).
- `--preview-method none`: no latent previews (saves a little VRAM and time; Hakawati does not show them).
- **`--lowvram` is not set on purpose.** Current ComfyUI enables *dynamic VRAM* by default on NVIDIA with PyTorch ≥ 2.8, which streams Wan 2.2 weights automatically; in that mode `--lowvram` does nothing. Put `--lowvram` into `EXTRA_FLAGS` only on an older build (log line `DynamicVRAM support requires Pytorch version 2.8`) or if Wan still runs out of memory. Last resort: `--novram`.
- `--reserve-vram 1.0` (in `EXTRA_FLAGS`) keeps 1 GB free for the Windows desktop and Chrome if you see OOMs while the Studio renders.

## 7. Check everything

```bat
cd /d E:\hakawati
powershell -ExecutionPolicy Bypass -File scripts\check-setup.ps1
```

Options: `-ComfyRoot E:\ComfyUI`, `-ComfyUrl http://127.0.0.1:8188`, `-Ascii` / `-Unicode`. It prints ✓/✗ in Windows Terminal and VS Code, OK/FAIL in the old console window (its fonts lack the glyphs). Start ComfyUI first so the node checks run. Exit code 0 = everything required is present.

## 8. First run of the Studio

1. `scripts\start-comfyui.bat`, wait for the `To see the GUI` line.
2. `scripts\start-studio.bat` → the browser opens `http://127.0.0.1:4848`. The UI is English; the **العربية** button at the bottom of the sidebar switches it to Arabic (saved in Settings).
3. Click the engine chip (bottom of the sidebar) → **Engine and settings**:
   - **Ready-made engine:** `CodeCraft (gateway)` → fills protocol `anthropic`, Base URL `https://codecraftapi.com`, model `claude-opus-5.5`. Paste the key in **API key**. Press **🔌 Test the connection** (it saves first) → `✓ claude-opus-5.5: "Ready ✓" (n s) — N models available`. If the Anthropic format fails, try `CodeCraft (OpenAI format)` (`https://codecraftapi.com/v1`, `gpt-5.5`). CodeCraft is text only; pictures come from ComfyUI.
   - **Pictures:** choose **ComfyUI**, address `http://127.0.0.1:8188`, press **🔌 Test ComfyUI** → `✓ ComfyUI <version> · NVIDIA GeForce RTX 3060 Ti 8 GB · N checkpoints · IP-Adapter ✓`. The checkpoint field fills with the first `*Lightning*` file; pick from the list. Defaults suit both Lightning checkpoints: steps 6, CFG 2, `dpmpp_sde` + `karras` (RealVisXL Lightning: 4–6 steps, CFG 1–2, DPM++ SDE Karras [?]; Juggernaut Lightning: same range [?]). Turn on **Keep faces with IP-Adapter**, weight 0.7.
   - **Narrator:** Arabic `ar-SY-LaithNeural` (default), English `en-US-AndrewMultilingualNeural`; the list fills from edge-tts after a few seconds.
   - **Filming:** 720p / 30 fps for drafts, 1080p for the final.
   - **Save.**
4. **＋ New story** → paste `docs\test-story.txt` → style **Cinematic photoreal**, frame 16:9, 60 s → **🎬 Write the screenplay** → edit in **Storyboard** → **🎞 Make the film** → **Screening room** → download MP4 / SRT / thumbnail.

Environment variables (set in `start-studio.bat`, or permanently with `setx NAME "value"` and a new terminal):

| Variable | Default | Use |
|---|---|---|
| `HAKAWATI_PORT` | `4848` | Studio port |
| `HAKAWATI_CHROME` | Chrome found by Playwright | full path of a Chromium browser, e.g. `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` |
| `HAKAWATI_NO_OPEN` | unset | set to `1` to stop the server opening the browser |

The API key is stored only in `E:\hakawati\.studio\settings.json` (git-ignored) and is shown masked in the browser. Do not share that file.

## 9. Expected timings on the RTX 3060 Ti

**All are estimates [?]** — derived from published 4090 figures and typical 3060 Ti SDXL speed, not measured on this machine. ComfyUI prints `Prompt executed in N seconds` for each job; replace these numbers with your own.

| Task | Estimate |
|---|---|
| SDXL Lightning keyframe 1344×768, 6 steps DPM++ SDE, warm | 5–8 s |
| first picture after a ComfyUI start (checkpoint load) | + 20–40 s |
| + IP-Adapter Plus (character reference) | + 1–3 s per picture; + 5–10 s on first use |
| cast portrait 1024×1024 | 5–8 s |
| Depth Anything V2 Large depth map | < 1 s (first use: 1.34 GB download + load) |
| 4x-UltraSharp, 1344×768 → 5376×3072 | 5–15 s |
| Wan 2.2 TI2V-5B, 1280×704, 41 frames (1.7 s @ 24 fps), 30 steps | 6–12 min |
| Wan 2.2 TI2V-5B, 1280×704, 121 frames (5 s), 30 steps | 25–45 min (the Wan team quotes < 9 min on one RTX 4090) |
| edge-tts, one narration line | 1–3 s (network) |
| frame-exact render in Chrome, 1 min of film at 720p30 | 1–1.5 min (laptop measured 2.5 min for 55 s) |
| 60 s photoreal film, 12 shots, parallax only, no Wan | ≈ 5–8 min + the text engine's time |

Wan 2.2's native size is 1280×704, up to 121 frames at 24 fps [v ComfyUI example note]. Keep I2V for the few action shots; the parallax level covers the rest.

## 10. Troubleshooting

| Symptom (as printed) | Cause | Fix |
|---|---|---|
| `torch.OutOfMemoryError: CUDA out of memory` / `Allocation on device` | VRAM full (Wan, or SDXL + IP-Adapter while Chrome uses the GPU) | close GPU apps; add `--reserve-vram 1.0` to `EXTRA_FLAGS`; for Wan: fewer frames / smaller size, or `weight_dtype = fp8_e4m3fn`; on an old build add `--lowvram`; last resort `--novram` |
| `The paging file is too small for this operation to complete` (os error 1455) | RAM + page file exhausted while loading a big model | §0.3 page file, close other apps |
| ComfyUI window closes at once / `c10.dll` error | old driver / missing VC++ runtime | driver R580+ (`nvidia-smi` → CUDA 13.x); install https://aka.ms/vc14/vc_redist.x64.exe |
| Studio: `No image checkpoint chosen in Settings → Pictures` | checkpoint field empty | Settings → Pictures → Test ComfyUI → pick one |
| `CheckpointLoaderSimple: Value not in list ckpt_name: '…' not in [...]` | name in Settings ≠ file in `models\checkpoints` (typo, sub-folder, still downloading) | press Test ComfyUI and pick from the list; check the file size; restart ComfyUI if the list is stale |
| `IPAdapterUnifiedLoader: IPAdapter model not found.` | `ipadapter\ip-adapter-plus_sdxl_vit-h.safetensors` missing or renamed | §5 item 3 |
| `IPAdapterUnifiedLoader: ClipVision model not found.` | encoder not renamed (still `model.safetensors`) | rename to `CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors` in `clip_vision` |
| Studio log: `IP-Adapter nodes are not installed in ComfyUI` | custom node missing / failed to import | §4; read the ComfyUI console for `IMPORT FAILED` |
| `ComfyUI is not answering at http://127.0.0.1:8188 (ECONNREFUSED)` | ComfyUI not started / other port | `start-comfyui.bat`; match the address in Settings |
| `edge-tts: … No module named edge_tts` | edge-tts installed into another Python | `python -m pip install -U edge-tts` with the same `python` |
| `edge-tts: … 403` / `WSServerHandshakeError` | outdated edge-tts or wrong system clock (the request token is time-based) | `python -m pip install -U edge-tts`; sync the Windows clock |
| `edge-tts: … NoAudioReceived` | wrong voice name / empty line | pick the voice from the list in Settings |
| `Python was not found; run without arguments to install from the Microsoft Store` | Store alias in front of the real Python | turn off the App execution aliases (§1) or reinstall with *Add python.exe to PATH* |
| `spawn ffmpeg ENOENT` / `'ffmpeg' is not recognized` | ffmpeg not on PATH | add `C:\ffmpeg\bin` to PATH, open a new terminal |
| `Could not start Chrome: … Chromium distribution 'chrome' is not found at …` | Chrome not installed in a standard place | install Chrome, or `setx HAKAWATI_CHROME "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"` and a new terminal |
| `Error: listen EADDRINUSE: address already in use 127.0.0.1:4848` | Studio already running, or another program on 4848 | `start-studio.bat` just opens the browser if it is the Studio; otherwise `netstat -ano \| findstr :4848` → `tasklist /fi "pid eq <PID>"`, or `set HAKAWATI_PORT=4850` in `start-studio.bat` |
| `running scripts is disabled on this system` | PowerShell execution policy | `powershell -ExecutionPolicy Bypass -File scripts\check-setup.ps1` |
| Depth Anything node hangs / download error | Hugging Face unreachable on first use | download `depth_anything_v2_vitl.pth` manually (§5 item 5) |
| `Value not in list: unet_name: 'wan2.2_ti2v_5B_fp16.safetensors'` | file in `diffusion_models\Wan2.2\` (Manager) or wrong folder | move it directly into `diffusion_models` |

## 11. Licences (before publishing or selling a film)

[?] = read the model card yourself; licences change.

| Model | Licence |
|---|---|
| Wan 2.2 TI2V-5B | Apache-2.0 [?] |
| IP-Adapter (h94) | Apache-2.0 [?] |
| Depth Anything V2 **Small** | Apache-2.0 [v official README via search] |
| Depth Anything V2 **Base/Large/Giant** | **CC-BY-NC-4.0 — non-commercial** [v official README via search] |
| 4x-UltraSharp | **CC-BY-NC-SA-4.0 — non-commercial** [v OpenModelDB via search] |
| RealVisXL V5.0 Lightning | sources disagree (OpenRAIL++ vs CC-BY-NC-ND) [?] |
| Juggernaut XL Lightning | RunDiffusion licence [?] |

For commercial releases: switch depth to Depth Anything V2 Small, replace 4x-UltraSharp (e.g. a permissively licensed ESRGAN model), and confirm the checkpoint's licence.

## 12. Verification record

Checked while writing (2026-10-19), from source code or official pages:
- ComfyUI portable URL, contents (Python 3.13, CUDA 13.0), update scripts, Manager-as-pip (`manager_requirements.txt`, `--enable-manager`), all CLI flags and the dynamic-VRAM rule for `--lowvram` — ComfyUI repo `master`.
- IPAdapter Unified Loader file-name regexes, preset names, error strings — `cubiq/ComfyUI_IPAdapter_plus` source.
- `DepthAnythingV2Preprocessor`, default `depth_anything_v2_vitl.pth`, HF repo and download folder, `install.bat` behaviour — `Fannovel16/comfyui_controlnet_aux` source.
- Wan 2.2 5B file names, folders, VAE choice, 1280×704 / 121 frames — ComfyUI examples + Comfy docs.
- URLs and sizes of items 3, 4, 6, 7, 9 — ComfyUI-Manager `model-list.json`.
- Chrome lookup paths — `playwright-core` 1.64.1 in this repo.

Not verified (marked [?]): items 1, 2 and 8 (Hugging Face could not be fetched from the build sandbox; names from search listings), Civitai page IDs, winget IDs, all VRAM peaks and timings, recommended sampler settings of the two checkpoints, `mediapipe` on Python 3.13, the licences marked [?].
