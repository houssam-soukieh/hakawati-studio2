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

## Status (2026-10-20, after the cloud team session)
- **All team branches are merged on `main`** (pushed to github.com/houssam-soukieh/hakawati-studio2). Test suites, all
  green on main in the cloud sandbox (no GPU, fake ComfyUI/LLM): `node --test test/director/*.test.mjs` (17),
  `node --test test/whisper/whisper.test.mjs` (7), `node test/whisper/e2e.mjs`, `node test/critic/e2e.mjs`,
  `node test/e2e-pictures.mjs` (42 checks), `node test/motion/run.mjs --full` (25), `node --test test/ui/studio.test.mjs`
  (53, Playwright, EN/AR, desktop/phone). **Every suite runs in a temp folder** (`test/sandbox.mjs`,
  `HAKAWATI_STUDIO_DIR` / `HAKAWATI_PROJECTS_DIR`): tests never touch the owner's `.studio/settings.json` or projects.
- **Desktop install done (2026-10-20)** by `scripts\install-all.bat`: Node 22, Git, Python 3.12 (python.org) — Anaconda's
  3.11 also present —, 7-Zip, Chrome, ffmpeg 9.0.2, NVIDIA 616.92 (3060 Ti 8 GB); ComfyUI v0.42.1 at `E:\ComfyUI` with
  IPAdapter_plus, controlnet_aux, Manager; **all 9 models present, SHA256-verified (39 GB)**; repo at `E:\hakawati`.
  Page file left system-managed (37.9 GB virtual). check-setup: everything OK **except edge-tts**.
- **edge-tts on the desktop**: pip failed with `CERTIFICATE_VERIFY_FAILED (self signed certificate in certificate chain)`
  → something on the PC inspects HTTPS (antivirus web shield or VPN); curl works (Windows store). Fixed in code
  (3d8716c): `voice.mjs` runs edge-tts through `truststore` (Windows certificate store). On the desktop run, with the
  SAME `python` the Studio uses (new terminal): `python -m pip install -U edge-tts truststore --trusted-host pypi.org
  --trusted-host files.pythonhosted.org`, then test a voice step. If SSL still fails: `curl.exe -vI
  https://speech.platform.bing.com 2>&1 | findstr /i "issuer subject"` names the interceptor.
- **Text engine on the desktop was still `mock`** (the key was saved but the preset not switched): Settings → Ready-made
  engine → **CodeCraft (gateway)** → Test (a real reply takes seconds; mock says "The local generator is ready" and
  always reports Vision ✓) → Save. The owner reported Vision ✓ but that test ran on mock — re-check.
- **First real run (T3, 2026-10-20)** on the desktop: real SDXL keyframes; problems found → fixed on main the same day:
  beings painted as humans (kind-aware portraits/prompts, per-shot negatives, content-safety negatives), Kira's shots
  one composition (IP-Adapter 0.55 'prompt is more important' + face crop; beings 0.4 'style transfer'), critic failing on
  CodeCraft empty answers (1 vision call at a time, 6 retries with backoff, unreviewed shots re-judged without repainting),
  a 5.5 h silent hang (every external wait now bounded + job watchdog), edits lost during a job (`saveJobChanges`).
  Optional `engine.fallback` (e.g. LM Studio at 127.0.0.1:1234/v1) takes over when CodeCraft gives up.
  Interceptor on the desktop: **Kaspersky** TLS inspection (truststore handles it). Team board: `docs/team/BOARD.md`.
- **T3b (repaint after the fixes)**: no more nudity, the Broker and the Eye fully non-human, Kira on-model; a live CodeCraft
  503 outage covered the whole run and the reliability code rode it out (no hang). Follow-ups on main: Orion's faceless head
  (weighted hint + facial features in the negative when no human is in the frame) and shots painted from the offline
  template repaint from the engine's prompt once it answers again (`promptSource: 'template'`). The owner is away from the
  PC and handed the go/no-go to the lead: board **T3d** (finish keyframes, checklist) → **T3c** (all-shots video overnight).
- **Owner's direction (2026-10-20): every story shot must be real video (Wan 2.2), not a still + camera move** —
  **Done (merged 2026-10-20):** `video.coverage` 'all' (default) | 'marked'; each clip is exactly the shot's length
  (≤5 s one Wan run; ≤8 s one run stretched ≤1.6× with ffmpeg minterpolate; longer → chained runs from the last frame);
  upscale in separate 12-frame ComfyUI jobs (4x-UltraSharp → output size ×1.15, lanczos fallback); per-PC measured
  rates and a time estimate in the log; one failed clip doesn't stop the night; resumes per Wan run. Estimates on the
  3060 Ti: teaser (14 shots) ≈ 3–3.5 h, pilot (40 shots) ≈ 11–12 h (≈ 7 h with `upscaler: 'lanczos'`).
- UI: **English by default, Arabic switch** in the sidebar (`settings.ui.lang`); story language is separate.
- Server defaults: `image.engine = 'comfyui'`, style `photoreal`. With pictures off, shots are honest "PLACEHOLDER"
  storyboard cards (the cartoon SVG look was dropped at the owner's request — he wants SDXL-photo quality only).

## Files
- `server.mjs` — node:http on 127.0.0.1 only, Host/Origin checks (CSRF / DNS rebinding), Range media, SSE jobs,
  `/api/settings/test`, `/api/image/test`. `make.mjs` — CLI (`new`, `run <id> [all|script|film|steps]`).
- `lib/pipeline.mjs` — steps `script → voice → cast → art → motion → render → assemble`, incremental via content
  hashes (`artKey`: image settings, critic settings, in-frame cast/location looks, lens/light/motion). `lib/jobs.mjs` — one job at a time, SSE log.
- `lib/llm.mjs` — `openai` (`{base}/chat/completions`) or `anthropic` (`{base}/v1/messages`), streamed, JSON asked
  in words + validated (gateways ignore json_schema), usage log `.studio/llm-usage.jsonl`.
- `lib/settings.mjs` — presets (CodeCraft anthropic/openai, OpenAI, OpenRouter, Gemini, DeepSeek, Anthropic, custom,
  mock); `image` block (ComfyUI url, checkpoint, steps 6, CFG 2, dpmpp_sde/karras, negative, ipadapter, ipWeight 0.7).
  Keys only in `.studio/settings.json` (git-ignored; never commit/share).
- `lib/image.mjs` — ComfyUI client: `POST /prompt` → poll `/history/{id}` → `/view`; SDXL graph, optional
  `IPAdapterUnifiedLoader` preset `PLUS (high strength)` + `IPAdapter`; `testImageEngine()` (`/system_stats`,
  checkpoint list, IP-Adapter present). `lib/prompts.mjs` — one SDXL prompt per shot via the text engine (template on
  mock); cast reference-portrait prompt. Image model never draws text.
- `lib/i18n.mjs` — every log/error string the user reads, en/ar (`t(key, vars)`); modules add theirs with `addMessages()`.
- `lib/critic.mjs` — best-of-N pictures: N candidates per shot (`image.candidates`), a vision call scores them
  (`image.critic`, `minScore` 7, `maxRounds` 2) and rewrites the prompt when all are weak; one picture when no vision.
  `llm.mjs`: `askVisionJSON`, `probeVision` (test button reports `vision`).
- `lib/video.mjs` — depth maps (DepthAnythingV2Preprocessor) and Wan 2.2 TI2V-5B clips (native nodes; <12 GB VRAM →
  fp8 weights, 832×480, ≤121 frames) for shots with `motion: 2`; VP9-in-MP4 clips; the player seeks them frame-exactly.
- `lib/whisper.mjs` — «الهمس»: shot `whispers: [{speaker, text, plain?}]`, beings (`kind: 'being'`, `color`, `glyph`)
  speak in an unintelligible processed whisper (per-being edge-tts voice), subtitled in the player with a glyph decode;
  `overlay: 'typing'` draws the chat bubble. Director puts «Name: …» lines in `whispers`, never in narration.
- Director: script doctor loop (`engine.doctorPasses`, default 2), visual bible (canonical `look` strings), per shot
  `motion` 1|2, `lens`, `light`; Arabic narration stays MSA, painter fields English.
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

## Team (cloud session 2026-10-19/20)
Built in parallel by agents on `agent/*` branches, all merged into `main`: critic, director, comfy (client checked against
ComfyUI + IPAdapter_plus sources; `test/fake-comfy.mjs`), ui, motion, pilot (`docs/pilot/`: pilot-ar.txt ≈ 5 min,
teaser-en.txt, bible.md, director-notes.md, README.ar.md), docs (setup guides, installer), whisper.

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
- First production: the 60-s **English** teaser. The ~5-minute Arabic pilot is written (`docs/pilot/pilot-ar.txt`) but paused.

## Next steps on the desktop
1. `git pull` in `E:\hakawati`. Fix edge-tts (see Status) and confirm a voice step works.
2. Settings: switch the engine to **CodeCraft**, Test (check Vision), Save. Pictures → ComfyUI → Test ComfyUI.
3. First real pictures: sample story (Studio → New story → ✨ Sample), style photoreal, 16:9, 30 s → write the screenplay
   → "Paint what is missing". Or CLI: `node make.mjs new docs\test-story.txt --length 30` + `run <id> voice,cast,art`
   (`cast,art` alone if the voice is still broken). Record seconds per picture (ComfyUI prints `Prompt executed in N s`),
   VRAM (nvidia-smi), critic scores; show the owner the pictures. Tune parallax strength on real keyframes.
4. Before pushing a change, run the suites above (safe on the desktop: they use a temp folder).
5. Turn on Wan 2.2 (Settings → Motion) for a few `motion: 2` shots; measure minutes per clip.
6. **The Arabic pilot is PAUSED (owner, 2026-10-20): the Arabic edge-tts voices are not good enough.** Work in English
   (narration `en-US-AndrewMultilingualNeural`): the English teaser first (`docs/pilot/teaser-en.txt`, board T3b/T3c).
   Never use an Arabic narrator voice unless the owner asks. Arabic stays for the UI and the whisper subtitles.
   If Arabic narration comes back later: compare other edge-tts Arabic voices (ar-SA-HamedNeural, ar-EG-SalmaNeural,
   ar-AE-HamdanNeural…) and a local GPU TTS before resuming the pilot.
7. Vendor the fonts into `public/` so renders don't depend on Google Fonts.
