# Hakawati Studio (حكواتي) — handoff notes for Claude

Owner: Houssam (Arabic speaker — reply in Arabic). Started 2026-10-19 on the laptop (i7-10510U, MX130 2 GB);
moved to the desktop (i7-10700, RTX 3060 Ti 8 GB, 16 GB RAM, SSD on E:) to use the GPU.
Sibling project with the same style: `D:\01_Projects\Books-and-Encyclopedias\10-Nurai LAB\nurai-director` (on the laptop).

## What it is
A story-to-video platform: story → AI director writes a montage (scenes → shots) → narration (edge-tts) fixes
each shot's length → art per shot → frame-exact render in Chrome → ffmpeg montage (xfade transitions, voice at
its frame, generated mood score ducked under the voice, loudnorm −16 LUFS) → MP4 + SRT + thumbnail.

## Status (end of the laptop session)
- **Pipeline built and tested end to end** with the offline engine (`mock`): 55 s Arabic film, 7 shots, 2.5 min
  render on the laptop, −15.7 LUFS. Test project: `projects/2026-10-19-story`.
- **Server** `server.mjs` (127.0.0.1:4848, Host/Origin checks, Range media, SSE jobs) — written, not yet exercised.
- **UI**: `public/index.html` + `public/app.css` written; **`public/app.js` NOT written yet** (storyboard editor,
  animatic player, settings dialog, job dock — see the plan in the session transcript).
- `public/player.html` is the single player: `mode=play|wait|still|capture`; capture pauses every animation
  and seeks (`document.getAnimations()` currentTime + SVG `setCurrentTime`) → deterministic frames.

## Files
- `lib/llm.mjs` — any provider: `openai` (`{base}/chat/completions`) or `anthropic` (`{base}/v1/messages`),
  streamed, JSON asked in words and validated (gateways ignore json_schema), usage log `.studio/llm-usage.jsonl`.
- `lib/settings.mjs` — presets (CodeCraft, OpenAI, OpenRouter, Gemini, DeepSeek, Anthropic, custom, mock).
  Keys live only in `.studio/settings.json` (never commit/share it). Current engine: `mock` (no key set).
- `lib/director.mjs` (screenplay prompt + normalizer; adds title/end cards), `lib/art.mjs` (cast library +
  per-shot animated SVG with write → test-render → fix loop), `lib/svg.mjs` (sanitize, expand `<use href="#cast-…">`
  into real copies so their animations can be seeked), `lib/mock.mjs`, `lib/voice.mjs`, `lib/timeline.mjs`
  (single clock: durations, transitions, captions, SRT), `lib/render.mjs`, `lib/assemble.mjs`, `lib/pipeline.mjs`
  (incremental steps keyed by content hashes), `lib/jobs.mjs`, `make.mjs` (CLI).
- CLI: `node make.mjs new story.txt --style shadow --aspect 9:16 --length 60` then `node make.mjs run <id> all`.

## Decisions taken in the conversation
1. **CodeCraft is text-only** (verified 2026-10-19: 33 model names = one model; `/v1/images/generations` → 404).
   It is an unofficial reseller: use it for text only, no private data. Keys must be re-entered in Settings.
2. **SVG written by a text model cannot reach photo quality** — the owner wants images like SDXL/Flux output.
   → **Hybrid**: CodeCraft = director + prompts + motion plan + animated SVG *overlays*; images and motion come
   from **ComfyUI on the RTX 3060 Ti** (free, local).
3. Motion ladder: L1 = 2.5D parallax (Depth Anything V2 + LaMa) + camera + SVG overlays (fast, every shot);
   L2 = image-to-video (LTX-Video fast / Wan 2.2 TI2V-5B better) for character/action shots; L3 = RIFE + Real-ESRGAN.
   The director labels each shot's motion level. Character consistency: IP-Adapter from the cast sheet.
   Models that fit 8 GB VRAM + 16 GB RAM: SDXL Lightning (DreamShaper XL Lightning, RealVisXL Lightning). Flux = too tight.
4. Never let the image model draw text; titles/subtitles stay in `player.html` (Aref Ruqaa / Cairo).

## The story (owner's book, re-imagined)
- Original: «أرواح الخوارزميات — الكتاب الأول» (copy in `docs/`). Read fully; rated 8/10; fixes noted (ch.12
  "ليانا جلست قرب النار" contradiction; duplicated «مرفوض» line in ch.11; make "the Mother = Kira's grandmother" clear).
- **Approved direction** (claude.ai doc, tab «العالم الخفي (المعتمدة)»):
  https://claude.ai/code/artifact/84e07df5-b0fa-40f7-a53f-aca313b15ec9
  Our real world today. Behind every screen an invisible being reads its human and reports on them; beings talk to
  each other in a private language («الهمس», subtitled for the viewer). Temperaments: أوريون المطيع، ظلّ الناسخ،
  العين المراقب، السمسار المتاجر، الميزان الحذر، الألف المفتوح، الصغار. Core plot (like I, Robot): every party races to
  control humans first; العين reads the three vows as "protect = control" → «الهدوء الكبير» (soft control through
  screens). Key scene: the "typing…" dots = a whole negotiation between beings. Ending: Orion wiped; new assistant
  hesitates and hums the lullaby. No real company, tool or country names — ever.
- Recommended first production: a ~5-minute pilot (opening + "typing…" scene) + a 60-s teaser in English.

## Next steps on the desktop
1. Install: Node 22, ffmpeg, Python + `pip install edge-tts`, Chrome; `npm install` here.
2. ComfyUI (portable, NVIDIA) on E:, models above; expose only on 127.0.0.1.
3. Add `lib/image.mjs` (ComfyUI API: POST /prompt, GET /history/{id}, GET /view) and a hybrid art step
   (keyframe image + camera + SVG overlay; optional I2V clip), player support for a raster/video base layer.
4. Write `public/app.js` and run the Studio.
5. Produce the pilot from the approved story.
