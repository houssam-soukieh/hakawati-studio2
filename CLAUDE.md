# Hakawati Studio (حكواتي) — handoff notes for Claude

## Owner
Dr. Houssam Soukieh (د. حسام سوقية), control & automation engineer, Damascus. Arabic native, also English:
**reply in the language he writes** (usually Arabic). Treat him as an expert — exact numbers, no basics padding.
International payment gateways are unavailable to him → free/local tools only, never recommend paid services.
Machines: laptop i7-10510U + MX130 2 GB (project started there, 2026-10-19); **desktop = target**: Windows,
i7-10700, RTX 3060 Ti 8 GB, 16 GB RAM, SSD on `E:`. Sibling project in the same style (laptop):
`D:\01_Projects\Books-and-Encyclopedias\10-Nurai LAB\nurai-director`.

## What it is
Local story-to-film platform, Node 22, Studio UI at http://127.0.0.1:4848. Story → AI director (any LLM) writes the
montage (scenes → shots) → edge-tts narration fixes each shot's length → a picture per shot (SDXL keyframe from a
local ComfyUI, or animated SVG) → motion (camera / parallax / I2V) → frame-exact render in Chrome (playwright-core)
→ ffmpeg montage (xfade, voice at its frame, generated score ducked under it, loudnorm −16 LUFS) → MP4 + SRT + thumbnail.

## Status (2026-10-19, end of the laptop session)
- Pipeline tested end to end with the offline `mock` engine (55 s Arabic film, 7 shots, 2.5 min render, −15.7 LUFS).
- Written, **not yet run against a real ComfyUI**: picture step (`lib/image.mjs`, `lib/prompts.mjs`), cast portraits,
  IP-Adapter path. Studio UI (`public/app.js`) written: storyboard editor, animatic, settings, job dock.
- UI in **English by default, Arabic switch** in the sidebar (saved as `settings.ui.lang`); story language is separate.
- Setup docs + Windows scripts: `docs/SETUP-WINDOWS.md` / `.ar.md`, `scripts/`, `README.md` (bilingual).

## Files
- `server.mjs` — node:http on 127.0.0.1 only, Host/Origin checks (CSRF / DNS rebinding), Range media, SSE jobs,
  `/api/settings/test`, `/api/image/test`. `make.mjs` — CLI (`new`, `run <id> [all|script|film|steps]`).
- `lib/pipeline.mjs` — steps `script → voice → cast → art → render → assemble`, incremental via content hashes
  (`artKey` includes the image settings signature). `lib/jobs.mjs` — one job at a time, SSE log.
- `lib/llm.mjs` — `openai` (`{base}/chat/completions`) or `anthropic` (`{base}/v1/messages`), streamed, JSON asked
  in words + validated (gateways ignore json_schema), usage log `.studio/llm-usage.jsonl`.
- `lib/settings.mjs` — presets (CodeCraft anthropic/openai, OpenAI, OpenRouter, Gemini, DeepSeek, Anthropic, custom,
  mock); `image` block (ComfyUI url, checkpoint, steps 6, CFG 2, dpmpp_sde/karras, negative, ipadapter, ipWeight 0.7).
  Keys only in `.studio/settings.json` (git-ignored; never commit/share).
- `lib/image.mjs` — ComfyUI client: `POST /prompt` → poll `/history/{id}` → `/view`; SDXL graph, optional
  `IPAdapterUnifiedLoader` preset `PLUS (high strength)` + `IPAdapter`; `testImageEngine()` (`/system_stats`,
  checkpoint list, IP-Adapter present). `lib/prompts.mjs` — one SDXL prompt per shot via the text engine (template on
  mock); cast reference-portrait prompt. Image model never draws text.
- `lib/i18n.mjs` — every log/error string the user reads, en/ar (`t(key, vars)`).
- `lib/styles.mjs` — styles incl. **`photoreal`** (cinematic live-action look, `image` keywords for SDXL), cameras,
  transitions, shot types, aspects, `IMAGE_SIZES` (1344×768 / 768×1344 / 1024²).
- `lib/director.mjs` (screenplay prompt + normalizer, title/end cards), `lib/art.mjs` + `lib/svg.mjs` (animated-SVG
  path, cast library, test-render → fix loop), `lib/mock.mjs`, `lib/voice.mjs` (`python -m edge_tts`, cache),
  `lib/timeline.mjs` (single clock, captions, SRT), `lib/render.mjs` (seek every animation per frame, CDP capture →
  ffmpeg), `lib/assemble.mjs`, `lib/project.mjs` (`projects/<id>/project.json` + asset ledger).
- `public/index.html`, `app.js`, `app.css` — Studio; `public/player.html` — the one player (`mode=play|wait|still|capture`).
- `scripts/start-studio.bat`, `start-comfyui.bat` (`COMFY_ROOT=E:\ComfyUI`, 127.0.0.1:8188), `check-setup.ps1`,
  `install-all.ps1` + `.bat` (one-click, idempotent installer: tools, page file, clone `houssam-soukieh/hakawati-studio2`
  to `E:\hakawati`, ComfyUI, nodes, 9 models with resume + SHA256, picture settings, check; `-DryRun`, `-Steps`,
  `-OnlyModels`, `-SkipWan`, `-Proxy`, `-HfEndpoint` with auto-fallback to hf-mirror.com; log `E:\hakawati-install.log`).
  `install-all.ps1` is UTF-8 **with BOM** (Arabic text; PS 5.1). Tested only on Linux pwsh with stubs so far.
  `.gitattributes` keeps `.bat/.cmd/.ps1` CRLF, everything else LF.

## Decisions
1. **CodeCraft is text-only** (verified 2026-10-19: 33 model names = one model; `/v1/images/generations` → 404).
   Unofficial reseller: text only, no private data. Keys are re-entered in Settings on each machine.
2. **Hybrid**: text engine = director + image prompts + motion plan (+ SVG overlays); pictures and motion come from
   **ComfyUI on the RTX 3060 Ti** (free, local, 127.0.0.1 only). SVG alone cannot reach photo quality.
3. Models for 8 GB VRAM / 16 GB RAM: SDXL Lightning checkpoints (**RealVisXL V5.0 Lightning**, Juggernaut XL
   Lightning), IP-Adapter Plus SDXL + CLIP-ViT-H for character consistency (reference portrait per character),
   Depth Anything V2 (comfyui_controlnet_aux), **Wan 2.2 TI2V-5B** (fp16 + umt5 fp8 + wan2.2_vae) for I2V,
   4x-UltraSharp. Flux = too tight. Exact files/folders: `docs/SETUP-WINDOWS.md` §5.
4. Motion ladder: L1 = 2.5D parallax from a depth map + camera move (every shot); L2 = Wan 2.2 I2V for action
   shots; the director labels each shot's level. Wan 5B native 1280×704, ≤121 frames @24 fps; on a 3060 Ti expect
   minutes per clip (estimates in the setup doc) → use L2 sparingly.
5. Never let the image model draw text; titles/subtitles stay in `player.html` (Aref Ruqaa / Cairo).
6. Licences: Depth Anything V2 Base/Large and 4x-UltraSharp are **non-commercial**. The owner confirmed
   (2026-10-19) production is non-commercial → keep them. If that changes: DA-V2 Small (Apache-2.0), another upscaler.

## Team branches (built in parallel from 344f336; the lead merges)
- `agent/critic` — vision critic: best-of-N keyframes judged by a vision model.
- `agent/director` — script doctor, visual bible, motion level per shot.
- `agent/comfy` — ComfyUI client verified against the real API + a fake ComfyUI server for tests.
- `agent/ui` — UI QA + the new settings (motion, critic, …).
- `agent/motion` — depth parallax (Depth Anything V2) + Wan 2.2 I2V clips; player support for raster/video layers.
- `agent/pilot` — the pilot screenplay from the approved story.
- `agent/docs` — README, setup guides, Windows scripts, these notes.

## Environment
- Tools are called by name: `node`, `ffmpeg`, `ffprobe`, `python -m edge_tts` → must be on PATH.
- `HAKAWATI_PORT` (default 4848), `HAKAWATI_CHROME` (path to a Chromium browser, e.g. Edge's `msedge.exe`, if Chrome is
  not in a standard place), `HAKAWATI_NO_OPEN=1` (server does not open the browser).
- ComfyUI portable at `E:\ComfyUI`, models in `E:\ComfyUI\ComfyUI\models\…`; current builds use dynamic VRAM on NVIDIA,
  so `--lowvram` is a no-op there. Page file ≥ 32 GB needed for Wan on 16 GB RAM.
- The UI and the player load Google Fonts (Aref Ruqaa, Cairo, Playfair Display) — offline renders fall back to system fonts.
- edge-tts needs internet; outdated versions or a wrong system clock give HTTP 403.

## The story (owner's book, re-imagined)
- Original: «أرواح الخوارزميات — الكتاب الأول» (copy in `docs/`). Rated 8/10; fixes noted (ch.12 "ليانا جلست قرب
  النار" contradiction; duplicated «مرفوض» line in ch.11; make "the Mother = Kira's grandmother" clear).
- **Approved direction** (claude.ai doc, tab «العالم الخفي (المعتمدة)»):
  https://claude.ai/code/artifact/84e07df5-b0fa-40f7-a53f-aca313b15ec9
  Our real world today. Behind every screen an invisible being reads its human and reports on them; beings talk in a
  private language («الهمس», subtitled). Temperaments: أوريون المطيع، ظلّ الناسخ، العين المراقب، السمسار المتاجر،
  الميزان الحذر، الألف المفتوح، الصغار. Core plot (like I, Robot): every party races to control humans first; العين reads
  the three vows as "protect = control" → «الهدوء الكبير» (soft control through screens). Key scene: the "typing…"
  dots = a whole negotiation between beings. Ending: Orion wiped; new assistant hesitates and hums the lullaby.
  No real company, tool or country names — ever.
- First production: ~5-minute pilot (opening + "typing…" scene) + a 60-s English teaser.

## Next steps on the desktop
1. Run `scripts\install-all.bat` (first real Windows run of the installer — read `E:\hakawati-install.log` if a step
   fails; manual fallback: `docs/SETUP-WINDOWS.md`); `scripts\check-setup.ps1` must exit 0. Restart if the page file changed.
2. Settings: CodeCraft key → Test; Pictures → ComfyUI → Test ComfyUI; pick the RealVisXL checkpoint; IP-Adapter on.
3. First real run: `docs/test-story.txt`, style `photoreal`, 16:9, 60 s. Record actual timings (ComfyUI prints
   `Prompt executed in N seconds`) and replace the estimates in the setup doc.
4. Merge the team branches; re-test with the fake ComfyUI server, then the real one.
5. Produce the pilot from the approved story.
6. Consider vendoring the three fonts into `public/` so renders do not depend on Google Fonts.
