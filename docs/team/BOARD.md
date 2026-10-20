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
- [ ] **T3c All-shots video for the teaser — overnight** (merged on `main`: every story shot is real Wan 2.2 video).
      **Start only after the owner approves the T3b keyframes** (he answers you in your chat). `git pull`, restart the
      Studio and ComfyUI. Settings → Motion: engine **Wan 2.2**, coverage **All shots**, upscale **on** (4x-UltraSharp),
      max stretch 1.6. Check free disk on E: (≥ 20 GB). Then
      `node make.mjs run 2026-10-20-souls-of-the-algorithms---teaser motion` (≈ 3–3.5 h; the log prints the estimate and
      the remaining time after each clip; it resumes if stopped), then `... render,assemble`. Copy the MP4, every clip
      (`motion\*.mp4`) and the keyframes to `E:\hakawati\out\teaser\`. Report the MEASURED times (Wan s/frame, upscale
      s/frame, render, total), VRAM/RAM peaks, any failed clip, colour jumps at chained joins, and how the motion looks
      (people, beings as light, camera). Attach 2–3 short clips or GIFs for the owner if possible.
- [ ] **T3 English teaser — superseded by T3b/T3c below the lead's decision.** Screenplay, motion flags (6 shots, owner's list), voice,
      cast and art are all done (14 shots + 4 portraits painted), but **did not run motion/render**: the picture
      critic failed on 13/14 shots (`Empty answer from the engine` from CodeCraft) and the unvalidated candidates
      that went through for the 3 "being" characters are off-model — Orion/the-Eye/the-Broker painted as
      realistic humans (Orion with visible bare skin) instead of the bible's faceless/translucent/eyeless
      design. Full detail, exact errors and 3 options → `docs/team/reports/2026-10-20-t3-english-teaser.md`.
      Also hit one confirmed 5.5-hour hang (no crash, no timeout) needing a manual kill — see the report's
      Problem 2, worth a timeout audit in `lib/llm.mjs` / the critic's image path.

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
      back, plus a plain repaint of `s4-1`. Awaiting the owner's look at the attached images before T3c.
      → `docs/team/reports/2026-10-20-t3b-repaint.md`

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
