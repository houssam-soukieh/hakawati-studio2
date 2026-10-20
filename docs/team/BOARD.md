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
- [ ] **T3 English teaser** (owner's request: English only, no Arabic voice; real video, not stills + voice):
      `docs/pilot/teaser-en.txt` + its notes in `docs/pilot/director-notes.md` + looks from `docs/pilot/bible.md`;
      photoreal 16:9 60 s; candidates 3, critic on; video.engine wan22, seconds 3; 5–6 shots with `motion: 2`.
      Steps script → (show the shot list) → voice,cast,art → motion → render,assemble. Copy the MP4, Wan clips,
      keyframes and portraits to `E:\hakawati\out\teaser\`. Report timings + critic scores.
      **In progress** — screenplay written and shot list reviewed with the owner (14 shots, ~75 s). Note: the
      teaser's own section in `director-notes.md` only tags 3 shots `motion: 2` (Broker pouring, Orion's rings on
      "No", the Eye's filaments over the city), not 5–6 — that 6-shot list is the *pilot*'s (bible §1). Screenplay
      matches the teaser's documented 3; flagged to the owner, awaiting a call on whether to force the other 3.
      Painting next.
- [ ] **T4 Parallax tuning**: on 2–3 real keyframes compare depth parallax strength (player constants) and report
      what looks natural; the lead tunes the defaults.

## Done
- [x] **T1 Narrator voice** — edge-tts + truststore confirmed working (OS cert store, not interceptor-specific); full
      Arabic and English test films rendered. Interceptor: Kaspersky Anti-Virus TLS inspection.
      → `docs/team/reports/2026-10-20-t1-narrator-voice.md`
- [x] **T2 Engine** — CodeCraft live (`claude-opus-5.5`, vision: true), critic now active (was silently off under mock).
      → `docs/team/reports/2026-10-20-t2-engine.md`

## Open questions for the owner
- Commercial use later? (Depth Anything V2 Large and 4x-UltraSharp are non-commercial; production is non-commercial for now.)
- T3 motion count: teaser notes say 3 shots get `motion: 2`, the board task said 5–6 (that's the pilot's list) — which should it be?

## Desktop ⇄ cloud link (blocked)
Tried `ListAgents`/`SendMessage` to `session_0168VRNgUj8LDA9XreHLWoGi`: `list_sessions` finds no other sessions,
`send_message` errors "unavailable in unsupervised mode" (this desktop session runs with auto/bypass-permissions,
which disables interactive-approval tools). `/remote-control` is not in this session's available skill list either.
Needs a fix from the owner/lead's side (switch this session's permission mode, or set up the link from claude.ai) —
reports in this file + git are the fallback until then.
