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
- [ ] **T3 English teaser — BLOCKED, needs a decision.** Screenplay, motion flags (6 shots, owner's list), voice,
      cast and art are all done (14 shots + 4 portraits painted), but **did not run motion/render**: the picture
      critic failed on 13/14 shots (`Empty answer from the engine` from CodeCraft) and the unvalidated candidates
      that went through for the 3 "being" characters are off-model — Orion/the-Eye/the-Broker painted as
      realistic humans (Orion with visible bare skin) instead of the bible's faceless/translucent/eyeless
      design. Full detail, exact errors and 3 options → `docs/team/reports/2026-10-20-t3-english-teaser.md`.
      Also hit one confirmed 5.5-hour hang (no crash, no timeout) needing a manual kill — see the report's
      Problem 2, worth a timeout audit in `lib/llm.mjs` / the critic's image path.
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
- ~~T3 motion count~~ → **Owner decided (2026-10-20): 6 shots with `motion: 2`** — the teaser's 3 (Broker pouring, Orion's rings
  on "No", the Eye's filaments over the city) **plus** Kira's face at 3 AM, the Eye's entrance, Orion's final turn. Set them
  in the screenplay and paint; Wan seconds 3.

## Desktop ⇄ cloud link (blocked)
Tried `ListAgents`/`SendMessage` to `session_0168VRNgUj8LDA9XreHLWoGi`: `list_sessions` finds no other sessions,
`send_message` errors "unavailable in unsupervised mode" (this desktop session runs with auto/bypass-permissions,
which disables interactive-approval tools). `/remote-control` is not in this session's available skill list either.
Needs a fix from the owner/lead's side (switch this session's permission mode, or set up the link from claude.ai) —
reports in this file + git are the fallback until then.
