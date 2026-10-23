# Team board — cloud lead ⇄ desktop session

Two Claude sessions work on this repo for the owner (Dr. Houssam Soukieh):

| | Cloud lead (claude.ai, "New session") | Desktop session (Claude Desktop → Code → Local, `E:\hakawati`) |
|---|---|---|
| Has | agents in parallel, all test suites, code review, GitHub | the RTX 3060 Ti, ComfyUI + models, CodeCraft, edge-tts, the owner's screen |
| Cannot | reach the PC, run SDXL/Wan, hear the voices | — |
| Does | design, code that needs no GPU, merges to `main`, keeps CLAUDE.md true | real runs, measurements, pictures/clips, fixes found by real runs |

## Protocol
1. **`main` is merged by the lead.** The desktop works on `desktop/<topic>` branches and pushes them. Small, obvious
   fixes found by a real run may go straight to `main` after the test suites pass (they are safe on the desktop:
   they run in a temp folder).
2. **Reports**: after each real run the desktop writes `docs/team/reports/YYYY-MM-DD-<topic>.md` — what was run,
   timings (s/picture, min/clip, VRAM), critic scores, problems, the exact errors — and pushes it. No media in git
   (keep pictures and clips in `E:\hakawati\out\`; attach small previews to the chat instead).
3. **Tasks**: the lead adds tasks below; the desktop moves them to Done with a one-line result and the report link.
4. **Direct messages** when available: the desktop session can send a message to the cloud session (SendMessage /
   ListAgents) — use it to say "pushed X, please review". The cloud session reads the branch and the report.
5. Never commit `.studio/` (keys) or `projects/`.

## Tasks for the desktop
- [ ] **T3d Finish the keyframes (lead's fixes for T3b) — do this first.** `git pull` (the commit that adds this task),
      restart the Studio. Settings → Test: CodeCraft must answer for real (`Ready ✓` in seconds, `vision: true`). If it
      still returns 503, wait and test again every ~30 min; do not run art against a dead gateway (it would only keep
      the template pictures). Then `node make.mjs run 2026-10-20-souls-of-the-algorithms---teaser voice,cast,art`
      (no `--force`). What it does on its own now:
      - **Orion**: his portrait prompt gained a weighted faceless head and, without a human in the frame, the negative
        lists the facial features → his portrait and every Orion shot repaint.
      - **Every shot painted from the offline template during the outage** (all 14 in T3b) asks the engine for its
        prompt; when the engine writes it, the shot repaints from it (this is the fix for `s4-1`, the Eye missing over the
        city) and the critic judges it. Log lines: `✎ <id>: painted from the offline template … asking the engine`.
        If the engine fails again the picture is kept (`⏸ … still away`), nothing is lost.
      **Checklist (look at every keyframe yourself — open the PNGs):** (1) every story shot `reviewed` with a score
      ≥ 7, or ≥ 6 after its rounds when the critique is only about minor details; (2) Orion: no nose, lips or human face —
      a blank glowing head with two white eye-points; (3) the Eye is in `s2-1` and `s4-1` (a ring of white light with
      filaments; over the city in `s4-1`); (4) the Broker eyeless, gold; (5) Kira the same woman in all her shots;
      (6) no skin or nudity on any being, no duplicate figure. A shot that fails: repaint it alone with a note, at most
      2 tries per shot, e.g. `... run <id> art --shots s4-1 --note "a colossal ring of cold white light floating in the
      low clouds above the city, filaments descending into the windows"`. Still failing after 2 → record it in the
      report and go on to T3c with the best you have (do not block the night on one shot).
      Report: `docs/team/reports/2026-10-20-t3d-keyframes.md` (scores per shot, which repainted, the Orion face result,
      s/picture); then start T3c in the same session.
      **2026-10-23 run (CodeCraft still suspended, owner directed FreeLLMAPI instead): checklist NOT passed.**
      14/14 shots drawn, no crash, but nothing scored ≥7 and two Orion shots explicitly fail the checklist
      (`s2-3` "facial features are overly humanized", `s2-4` "limbs are rendered as realistic human flesh").
      3 calls hit token-limit truncation (`s1-1`/`s1-2` fell back to offline template, `s1-5` critic unreviewed).
      **Do not start T3c** until this is resolved — see the report for the full table and options.
      **Retry with a sharper note used up both shots' 2-try allowance**: `s2-3`'s critic was token-limit-truncated
      again (still unverified), `s2-4` improved to 6/10 (framing fixed) but still shows human skin texture on the
      hands per the critic — likely an IP-Adapter/reference-portrait issue, not a prompt-wording one.
      **Owner chose: lower the being IP-Adapter weight (0.4→0.3, `lib/image.mjs`, `IPA.version` bumped 2→3).**
      Result: **`s2-3` now PASSES at 7/10** (the face fix worked). **`s2-4` still fails at 5/10** — hands still
      render as human flesh; this looks specific to the extreme-macro hand framing (an SDXL hard case), not beings
      in general. Not retried further (past the 2-try budget). **13/14 shots acceptable, `s2-4` is the one open
      item** — owner's call on a targeted per-shot negative or accepting it and moving to T3c.
      → `docs/team/reports/2026-10-20-t3d-keyframes.md`
- [ ] **T3e Close T3d: s2-4 once more, then the video (lead, 2026-10-23).** `git pull` (T5 merged on `main` with the
      lead's fixes, below). Run the Studio from `E:\hakawati` again (the `E:\hakawati-engines` worktree is no longer
      needed: `git worktree remove E:\hakawati-engines` after copying anything you want from it).
      1. `node make.mjs run 2026-10-20-souls-of-the-algorithms---teaser art --shots s2-4 --force` — a frame with only
         beings now also has `flesh, skin pores, fingernails, knuckles` in its negative (`--force` because a negative
         change alone does not make a shot stale). One try only.
      2. `node make.mjs run 2026-10-20-souls-of-the-algorithms---teaser art` — `s1-1`/`s1-2` (template prompts, cut off)
         repaint from the engine and `s1-5` is re-judged: the picture-prompt and critic token budgets are 8000 now
         (a thinking model spent the old 2000/3000 before answering).
      3. Put the 14 keyframes side by side for the owner (a contact sheet is fine) and **wait for his OK** — the
         critic's 5–6 on Gemini Flash is a stricter, different judge than before; his eyes decide. Then T3c.
      Report: append to the T3d report.
      4. **Video runs are 3 s now** (owner, 2026-10-23): one Wan run ≤ 73 frames by default; a settings file that still
         holds the old 5 s moves to 3 s by itself (Settings → Motion shows it). Shots of 4–4.8 s = one run stretched
         ≤ ×1.6; 5 s = two runs of 61; 8 s = two runs of 73 stretched ×1.32. **Never single 8-s runs.** Before T3c, answer
         the open question about the bad 8-s fox clip: compare the RAW 832×480 Wan frames with the upscaled ones (same
         frame numbers) — blue cast already in the raw → Wan at 193 frames; raw clean → a bug in the chunked upscale.
- [ ] **T3c All-shots video for the teaser — overnight** (merged on `main`: every story shot is real Wan 2.2 video).
      **Start after T3e, on the owner's OK of the keyframes.** `git pull`, restart the
      Studio and ComfyUI. Settings → Motion: engine **Wan 2.2**, coverage **All shots**, upscale **on** (4x-UltraSharp),
      max stretch 1.6. Check free disk on E: (≥ 20 GB). Then
      `node make.mjs run 2026-10-20-souls-of-the-algorithms---teaser motion` (≈ 3–3.5 h; the log prints the estimate and
      the remaining time after each clip; it resumes if stopped), then `... render,assemble`. Copy the MP4, every clip
      (`motion\*.mp4`) and the keyframes to `E:\hakawati\out\teaser\`. Report the MEASURED times (Wan s/frame, upscale
      s/frame, render, total), VRAM/RAM peaks, any failed clip, colour jumps at chained joins, and how the motion looks
      (people, beings as light, camera). Attach 2–3 short clips or GIFs for the owner if possible.

- [x] **T5 Engine chain + FreeLLMAPI (owner's request, 2026-10-21) — code, no GPU.** **Merged on `main` by the lead
      (2026-10-23)** with three fixes: a 401/402/403/404 (e.g. CodeCraft "Account is suspended") hands the call to the
      chain at once instead of failing it; the circuit breaker also skips the PRIMARY engine during its pause; token
      budgets 8000 for picture prompts and the critic. `test/critic/e2e.mjs` Windows path fixed (`fileURLToPath`). Never interrupt a running T3c job:
      do this in a separate worktree (`git worktree add E:\hakawati-engines -b desktop/engines origin/main`), run the
      Studio from there on another port (`set HAKAWATI_PORT=4849`) and push the branch; the lead reviews and merges.
      **A. Install FreeLLMAPI** (MIT, github.com/tashfeenahmed/freellmapi → Releases → the Windows `.exe`). Tell the owner
      the file name, size and source before downloading. The owner creates the provider accounts and pastes every
      provider key into FreeLLMAPI's own dashboard himself (`http://127.0.0.1:31415`) — you never type a key or password.
      Find and write down: the real API base URL of the desktop app (dashboard port 31415; check whether `/v1` is on
      the same port), where and how it stores its unified `freellmapi-…` key on Windows (documented API? config file?
      `%APPDATA%`?), the shape of `GET /v1/models`, the `X-Routed-Via` response header, and whether `model: "auto:smart"`
      routes a request with an image to a vision model.
      **B. Code (lib/settings.mjs, lib/llm.mjs, server.mjs, public/app.js, i18n en/ar):**
      1. **An ordered engine chain** instead of one fallback: `engine.chain = [primary, …]` (CodeCraft first, then
         FreeLLMAPI `auto:smart`, then optional LM Studio). Keep reading the old `engine.fallback` (migrate it into the chain).
         A call that still fails on one engine (after its retries) goes to the next; calls with pictures skip engines that
         cannot see. **Circuit breaker**: an engine that failed 2 calls in a row is skipped for 10 min (log it), then tried
         again — so an outage costs minutes once, not 3 min on every shot. Each engine keeps its own concurrency limit.
      2. **A `freellmapi` preset** (openai protocol, base URL from A, model `auto:smart`). **The key is read automatically**
         from FreeLLMAPI if A found a reliable, documented-enough way (else: the owner pastes it once). A **⟳ Refresh
         button** in Settings re-reads the key and re-fetches the model list (`GET /v1/models`) — no restart.
      3. **See and choose the model in the UI**: per engine a model dropdown filled from `/v1/models` (CodeCraft too) plus
         free text; **"Test all models"** runs a tiny prompt on each listed model one by one (with a pause; free tiers have
         per-minute limits) and shows a table: model, OK/error, seconds, vision yes/no. The job dock and the log show the
         engine and model that ANSWERED each call (for FreeLLMAPI the provider/model from `X-Routed-Via`), and
         `.studio/llm-usage.jsonl` records it.
      4. Tests: extend `test/reliability/` (fake gateways: chain order, circuit breaker skip + retry after the pause, vision
         skip, routed-via shown) and `test/ui/studio.test.mjs` (Refresh, model list, Test all). All suites green before push.
      **Rules:** keys only in `.studio/settings.json` (git-ignored); never print a key in chat, logs, reports or commits
      (mask it); no private data to CodeCraft or the free providers; FreeLLMAPI's paid "premium catalog" is not needed.
      Report: `docs/team/reports/2026-10-21-t5-engines.md` (what A found, which providers answered, Test-all table).
      **Part A + part B code/tests: done, pushed to `desktop/engines`.** `reliability.test.mjs` 26/26 (new chain-order
      + circuit-breaker + routed-via tests, 5 pre-existing single-fallback tests unchanged), `director` 19/19, `motion`
      41/41. `e2e-pictures`/`whisper`/`critic` each have one pre-existing failure — **confirmed identical on unmodified
      `main`**, not T5. `test/ui/studio.test.mjs`'s `jobs: paint what is missing…` also fails identically on `main`
      (confirmed by a direct side-by-side run) and in a clean manual browser repro it worked fine — pre-existing,
      environment-specific, not fixed here. **Gap (still open)**: `test/ui/studio.test.mjs` itself was not extended
      per item 4 (only `test/reliability/`) — see the report's Problems section.
      **Live run: done (2026-10-23).** CodeCraft turned out suspended (403, not transient) before the live test, so
      the planned "CodeCraft primary → blank its key" fallover never applied; engine slots were swapped instead
      (FreeLLMAPI primary, CodeCraft fallback, config-only, no key retyped). Owner pasted the FreeLLMAPI key and
      added provider keys in FreeLLMAPI's own dashboard himself (Gemini, then Groq). **Test all models: 17/19 ok**,
      all routed via `google/*` (2 failures are FreeLLMAPI's own stale catalog entries). **Real pipeline run**
      (script→voice→cast→art, English sample story) completed clean 4 times in a row with no hang/crash; the
      picture critic repeatedly hit the one free Gemini key's rate limit (confirmed from the error text: routing
      pool stays Google-only — Groq isn't selected for vision calls). Tried lowering `image.candidates` 3→2 and
      `engine.concurrency` 2→1: neither changed the outcome (2/5 shots stayed unreviewed each time, just which
      ones shifted) — the `retryAtMs` window growing from ~60s to ~5m across runs shows it's a **spent daily quota**
      on that one key, not a concurrency/candidate tuning problem. Settings reverted to defaults. The
      unreviewed-shot fallback (existing behavior) is what actually carried every run to completion — this is the
      real reliability result of T5, arguably a better proof than an all-green run would have been. Remaining
      options for more picture coverage: a second genuinely vision-capable key, or wait for quota reset — owner's
      call, not pursued further today. → `docs/team/reports/2026-10-21-t5-engines.md`

## Lead's decision on T3 (2026-10-20, after reading the T3 report — thank you, excellent report)
**Hold T3: don't run motion/render and don't repaint yet.** The lead is fixing the root causes on two branches:
- `agent/reliability`: idle timeout on the gateway stream (most likely cause of the 5.5 h hang), bounded edge-tts/ffmpeg,
  job watchdog; max 2 text calls and **1 vision call** in flight, critic retries with backoff, smaller images; a failed
  critic marks the shot **unreviewed** and the next art run **re-judges the existing candidates without repainting**;
  stricter rubric (wrong framing, missing light, duplicate figure, humanized being, nudity); the job no longer
  overwrites screenplay edits made while it runs.
- `agent/looks`: beings painted as non-human (kind-aware portraits and shot prompts, per-shot negatives against human
  faces/skin/duplicates), content-safety negatives, IP-Adapter at 0.55 "prompt is more important" with a **face crop**
  for humans (Kira's three shots were one composition), "style transfer" 0.4 for beings.
When they land on `main` the lead adds **T3b** here (pull, then `art` repaints only the affected shots).

**Meanwhile → T4** (no gateway needed): on Kira's existing keyframes, render 2–3 shots with depth parallax at the current
strength and at ½× and 1.5× (player constants), look at them, and report what reads natural. Push the report.

## Done
- [x] **T3 English teaser (first run)** — superseded by T3b/T3d/T3c; found the being looks, critic and hang problems.
      → `docs/team/reports/2026-10-20-t3-english-teaser.md`
- [x] **T1 Narrator voice** — edge-tts + truststore confirmed working (OS cert store, not interceptor-specific); full
      Arabic and English test films rendered. Interceptor: Kaspersky Anti-Virus TLS inspection.
      → `docs/team/reports/2026-10-20-t1-narrator-voice.md`
- [x] **T2 Engine** — CodeCraft live (`claude-opus-5.5`, vision: true), critic now active (was silently off under mock).
      → `docs/team/reports/2026-10-20-t2-engine.md`
- [x] **T4 Parallax tuning** — current 1.0× constants look right for non-cap-bound shots (don't blanket-raise them);
      found the margin cap self-cancels AMP/ZOOM scaling on some shots (e.g. pull-outs) — a real lever would need to
      touch the cap formula, not the nominal constants. Static-shot "breathe" needs a clip not stills to judge (gap).
      → `docs/team/reports/2026-10-20-t4-parallax.md`
- [x] **T3b Repaint with fixes** — big improvement: Broker and the Eye (in its own entrance shot) are fully
      non-human now, no skin anywhere. Orion is translucent/wireframe with no more nudity but still has a
      recognizable human face, not fully "faceless" yet. One miss: the Eye is absent from `s4-1` (the
      city-filaments shot). **Zero critic reviews this run** — not a bug: a live CodeCraft 503 outage sat
      under the whole run; the new retry/fallback/UNREVIEWED-marking code handled it cleanly (no hang, no
      crash, confirms the reliability fix works). Recommend a critic-only re-judge pass once CodeCraft is
      back, plus a plain repaint of `s4-1`. Follow-ups are in T3d (lead's fixes merged).
      → `docs/team/reports/2026-10-20-t3b-repaint.md`

## Owner's direction (2026-10-20)
- **English only for now.** The Arabic pilot is paused — the Arabic narrator voices are not good enough. Don't schedule
  the pilot and don't use an Arabic narrator voice unless the owner asks. Narration: `en-US-AndrewMultilingualNeural`.

## Open questions for the owner
- Commercial use later? (Depth Anything V2 Large and 4x-UltraSharp are non-commercial; production is non-commercial for now.)
- ~~T3 motion count~~ → **Owner decided (2026-10-20): 6 shots with `motion: 2`** — the teaser's 3 (Broker pouring, Orion's rings
  on "No", the Eye's filaments over the city) **plus** Kira's face at 3 AM, the Eye's entrance, Orion's final turn. Set them
  in the screenplay and paint; Wan seconds 3.

## Desktop ⇄ cloud link (blocked)
Tried `ListAgents`/`SendMessage` to `session_0168VRNgUj8LDA9XreHLWoGi`: `list_sessions` finds no other sessions,
`send_message` errors "unavailable in unsupervised mode" (this desktop session runs with auto/bypass-permissions,
which disables interactive-approval tools). `/remote-control` is not in this session's available skill list either.
Needs a fix from the owner/lead's side (switch this session's permission mode, or set up the link from claude.ai) —
reports in this file + git are the fallback until then.
