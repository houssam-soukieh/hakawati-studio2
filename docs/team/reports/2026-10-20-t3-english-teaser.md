# T3 — English teaser ("Souls of the Algorithms")

**Status: blocked — stopped before motion/render.** Keyframes for the 3 "being" characters came out
off-model (and one is a content concern), and the mechanism that should have caught it (the picture critic)
failed on 13 of 14 shots due to CodeCraft reliability issues. Did not spend Wan 2.2 GPU time on these
keyframes. Awaiting a call from the owner/lead on how to proceed (see "Recommendation" below).

## What was run
- Project `2026-10-20-souls-of-the-algorithms---teaser`, `docs/pilot/teaser-en.txt`, photoreal, 16:9, 60s target.
- `options.audience`/`options.notes` populated from `director-notes.md` §2 before `script`.
- `script`: CodeCraft (claude-opus-5.5), 2 script-doctor passes → 5 scenes, 14 shots + title/end cards, ~75s
  (doctor flagged the overfill twice; narration at a natural pace still runs long against the 60s target).
- Title card set to 1.5s/cut, end card text → "Coming soon" (per director-notes.md).
- Cast looks (`kira`, `orion`, `the-eye`, `the-broker`) verified **word-for-word** against `bible.md` — exact match.
- Whisper lines verified: the Eye's 2 lines, the Broker's line, and Orion's "No." (`plain: true`) are all in
  `whispers`, never `narration` — correct.
- Motion: owner decided 6 shots at `motion: 2` (teaser's original 3 — Broker pouring `s2-2`, Orion's rings on
  "No" `s2-3`, the Eye's filaments over the city `s4-1` — plus Kira's face at 3am `s1-6`, the Eye's entrance
  `s2-1`, Orion's final shot `s5-1`). Set via direct API edit after the art job finished (editing mid-run risks
  the job's own autosave reverting it — confirmed this is a real race, not just theoretical).
- `voice,cast,art`: required **4 attempts** total (see Problems). Final attempt: all 14 shots + 4 portraits done.

## Timings
- Voice: 9 narration lines + 4 whisper lines (edge-tts, en-US-AndrewMultilingualNeural) — film runs 76s.
- Portraits (1024×1024, RealVisXL Lightning): Kira 13.5s, Orion 11.9s, The Eye 11.9s, The Broker 11.9s.
- Shot keyframes (1344×768): most candidates 11.9–28s each; two outliers at 100.5s and 249.9s/332.8s tied to
  ComfyUI's first-load-after-idle model load (consistent with CLAUDE.md's existing note on this). Steady-state
  average ≈ 15–17s/candidate, 3 candidates/shot when the critic is active.
- VRAM: peaked ~7.8/8.2 GB during concurrent painting (3 painters + ComfyUI model residency), settled to
  4.6–5.1 GB between jobs. Tight but did not OOM on the GPU side.
- System RAM: dropped to 3.5–3.7 GB free of 15.9 GB total during/after the run. Plausible contributor to Problem 2.

## Critic scores
The critic (CodeCraft vision) fired successfully exactly **once** out of ~14 shots — `s1-1`
(extreme-close-up of Kira's eye, the hook shot): scored candidates `#0:3 #1:3 #2:4` → picked `#2` (4/10),
critique: *"framing is a centered medium portrait instead of the required extreme close-up... silver-white
temple streak, charcoal T-shirt, cold cyan under-glow, dust motes and dark bedroom with warm bokeh are all
missing."* Repainted once from a corrected prompt; second-round critic also failed (empty answer), so the
run kept the best-seen (still 4/10, below `minScore: 7`).

**Every other shot's critic call failed** with `Empty answer from the engine` and fell back to the first
unvalidated candidate (`keeping candidate #0`) per the existing graceful-degradation path in `lib/critic.mjs`.
This matters: the one time the critic *did* respond, it correctly flagged a real problem — the reliability
issue, not the critic logic, is the actual blocker.

## Problems

1. **`Empty answer from the engine` — frequent, worsens later in each run.** Across 4 attempts, failures
   clustered on whichever shots were still in flight near the end of a batch (last attempt: only the single
   last remaining shot failed, 3 times in a row, before finally succeeding on the 4th try). Consistent with
   cumulative rate-limiting/throttling on the CodeCraft gateway under `concurrency: 3`, not a per-shot content
   issue — confirmed by the *same* shots succeeding cleanly on a later retry with no prompt changes.
2. **One confirmed multi-hour hang, no crash.** Attempt 3 (shot `s5-2`) produced zero further log output for
   ~5.5 hours (last line 04:20, found still running — not crashed — at 09:44) despite ComfyUI's queue being
   empty and CodeCraft answering a plain `GET` in <1s at the time I checked. `lib/llm.mjs`'s `callOnce` has a
   12-minute `AbortController` timeout per attempt (`setTimeout(() => ctl.abort(), 12 * 60e3)` at line 54), so
   `askText`'s own 3-attempt loop should bound at ~36 minutes worst case — something *outside* that per-call
   timeout hung indefinitely (candidates: the critic's vision image-fetch/encode path in `withImages()`, or an
   unbounded ComfyUI history-poll). Had to `Stop-Process -Force` and retry. **Worth a timeout audit** on
   whatever code path isn't covered by the 12-minute abort.
3. **Quality/content: the 3 "being" characters rendered as realistic humans, not the bible's design.**
   `bible.md` specifies Orion/the-Eye/the-Broker as faceless, translucent, light-woven entities with no human
   skin. What RealVisXL Lightning (photoreal checkpoint) actually painted, uncaught because of Problem 1:
   - **Orion** (portrait + shot `s2-3`, a motion-2 shot): realistic human **female torsos with visible bare
     skin**, normal faces, cyan circuit-pattern overlay instead of translucent light-threads. Not faceless,
     not translucent — and the bare-skin rendering is a content concern on top of being off-model.
     `s2-3` shows **two** such figures where the prompt calls for one.
   - **The Eye**: a normal human face centered in the rings — bible: "no face, an empty dark centre."
   - **The Broker**: a normal human male face with fire effects — bible: "smooth **eyeless** golden face."
   - Kira (human) rendered correctly and on-model.
   This is the shot quality problem the critic exists to catch; Problem 1 is why it didn't.

## Recommendation (awaiting a decision)
Did not run `motion` or `render,assemble` — would spend real Wan 2.2 GPU minutes on keyframes for `s2-2`,
`s2-3`, `s4-1`, `s5-1` that need repainting regardless. Options:
1. Retry `art --force` on the portraits + the 4 being-involving shots now that the gateway settled (last
   attempt went clean) — if the critic actually responds this time it should self-correct per the `s1-1`
   precedent.
2. Strengthen the being prompts / negative-prompt first (explicit "no human skin, no face, translucent only"
   weighting), since the photoreal checkpoint clearly defaults to realistic humans without stronger steering.
3. Lower `image.candidates`/concurrency to reduce load on CodeCraft and see if the critic's reliability improves.

No media pushed to git (`E:\hakawati\out\` not yet populated — holding until the keyframes are fixed).
