# T3d — Finish the keyframes (run on FreeLLMAPI, 2026-10-23)

**Status: `art` completed without crashing (14/14 shots), but the checklist does NOT pass.** CodeCraft is suspended
(403, confirmed earlier — see the T5 report), so at the owner's explicit direction this run used **FreeLLMAPI**
(`auto:smart`, primary; CodeCraft kept as fallback, suspended) instead of CodeCraft. Do not start T3c yet.

## What happened
`node make.mjs run 2026-10-20-souls-of-the-algorithms---teaser voice,cast,art` (no `--force`). Voice was cached (0
new, 76 s film). Cast portraits repainted (Kira, Orion, The Eye, The Broker). Art: 14/14 shots drawn, no hang, no
crash, exit code 0. Unlike the T5 live test, this run hit **zero `429` rate-limit errors** — instead it hit **token
limit truncation** on 3 calls:
- `s1-1`, `s1-2`: the engine's picture-prompt answer was cut off before finishing → both fell back to the offline
  template prompt (`✎ … painted from the offline template … asking the engine for its prompt` → engine answer
  truncated → `painting from the screenplay's own words`). These should repaint automatically on the *next* `art`
  run per the existing offline-template-repaint fix, once prompt lengths are shortened or `maxTokens` raised.
- `s1-5`: the critic's answer was cut off → kept **unreviewed** (score `null`), same graceful-degradation path as
  T5's rate-limit case, just a different trigger.

## Scores per shot (critic, FreeLLMAPI `auto:smart`)

| shot | cast | score | critique (summary) |
|---|---|---|---|
| s1-1 | Kira | 5/10 | phone screen not shown, both eyes looking forward |
| s1-2 | Kira | 6/10 | atmosphere isn't a dark 3 AM bedroom |
| s1-3 | Kira | 6/10 | missing blurred doorway foreground, surrounding dark screens |
| s1-4 | Kira | 6/10 | missing signature silver hair streak, dual lighting contrast |
| s1-5 | Kira | — | **unreviewed** (critic answer truncated) |
| s1-6 | Kira | 6/10 | phone held too low, not raised to her lips |
| s2-1 | The Eye | 6/10 | monitors show light spirals instead of being dark |
| s2-2 | The Broker | 5/10 | sits behind the laptop instead of emerging from the screen |
| **s2-3** | **Orion** | 6/10 | **"facial features are overly humanized"** |
| **s2-4** | **Orion** | 4/10 | **"limbs are rendered as realistic human flesh"** instead of woven fiber |
| s3-1 | Kira | 6/10 | gaze/hand pose don't show quiet defiance |
| s4-1 | The Eye | 5/10 | ring oriented vertically, not horizontally |
| s5-1 | Orion | 5/10 | figure seated on the bed instead of hovering beside it |
| s5-2 | Kira | 6/10 | phone placed off to the side, not centered |

**Nothing reached ≥7.** None of these are "only minor details" per the checklist's own bar for accepting a 6 — every
one names a missing or wrong *story-relevant* element (a prop, a pose, an atmosphere cue), not a nitpick.

## Checklist (board's T3d list)
1. **FAIL** — no shot reviewed ≥7; the ≥6-with-minor-critique exception doesn't apply (critiques above are
   structural, not minor).
2. **FAIL** — `s2-3` (Orion close-up): critic explicitly says "facial features are overly humanized." The
   faceless-head fix (weighted hint + facial-feature negative) either isn't engaging for this shot or isn't
   enough to overcome SDXL's default human-face bias here.
3. Not separately confirmed — the Eye's shots (`s2-1`, `s4-1`) read as present but with secondary issues (monitor
   state, ring orientation); open the PNGs to judge the ring/filament look itself.
4. Not separately confirmed — no Broker shot in this teaser's 14 to check against "eyeless, gold" beyond `s2-2`'s
   own critique (emergence pose wrong, nothing said about eyes/gold).
5. Not checked here — needs a side-by-side look at Kira across `s1-1…s1-6`, `s3-1`, `s5-2` (critic scores don't
   speak to identity consistency).
6. **FAIL** — `s2-4` (Orion wrist insert): critic explicitly says limbs render as "realistic human flesh" instead
   of the fiber-woven being material.

**Open the PNGs yourself before deciding anything** — `projects/2026-10-20-souls-of-the-algorithms---teaser/images/`
— the critic's own text already flags two concrete non-human-look regressions on Orion (`s2-3`, `s2-4`) that match
exactly what T3b/T3d's own fixes were supposed to prevent.

## Why this is probably engine-related, not a code regression
The faceless-head/no-skin negative-prompt logic is server-side (kind-aware, independent of which text engine wrote
the shot's descriptive prompt) — so the fix itself should still be active. The more likely explanation: FreeLLMAPI's
Gemini-backed `auto:smart` is writing weaker/less precise picture prompts than CodeCraft's Claude did, and critiquing
with different (possibly stricter, possibly just differently-worded) judgment — same pattern as T5's finding that
the *quality* of this chain's output depends heavily on which model actually answers. Not confirmed without a
side-by-side CodeCraft run once it's unsuspended.

## Retry with a sharper note (2026-10-23) — this used up the checklist's "2 tries per shot" allowance

`run <id> art --shots s2-3,s2-4 --note "Orion is never human, anywhere in frame: … no human skin texture, no
visible muscle or bone, no realistic human limbs anywhere …"` (strong, explicit, named exactly what was wrong).

- **`s2-3`**: critic's answer was token-limit-truncated **again** (2/2 attempts now) — still **unreviewed**, no
  score. Can't confirm whether the sharper note fixed the humanized face; needs a human look at the PNG.
- **`s2-4`**: improved to **6/10** — framing is now correct (focused on wrists, per the note), but the critique
  still says explicitly: **"the hands remain too human in texture and anatomy; they must be entirely constructed
  from the glowing cyan threads … with no solid human skin visible."** The sharper note fixed the *composition*
  but not the *material* — SDXL (likely pulled by IP-Adapter's reference-portrait style transfer) keeps defaulting
  to human skin texture on hand-shaped silhouettes regardless of how explicit the text prompt is.

**This is probably not a prompt-wording problem any more.** Two real next levers, neither tried here: (a) lower
Orion's IP-Adapter weight for this shot type so less of the reference portrait's "humanness" transfers onto limbs,
or (b) regenerate Orion's reference portrait itself to read unambiguously non-human at the source, since IP-Adapter
is pulling consistency from it. Both are judgment calls for whoever owns the art pipeline next, not something to
guess at via more notes.

Both shots have now had their checklist-allowed 2 tries. Per the board's own rule ("still failing after 2 → record
it and go on to T3c with the best you have"), the next move is the owner's call, not an automatic retry loop.

## Recommendation — owner's call, not acted on further here
- Do **not** start T3c yet — T3d's own gate ("start T3c when T3d passes its checklist") isn't met.
- Options: (a) retry `s2-3`/`s2-4` individually with a strong note (`run <id> art --shots s2-3 --note "..."`,
  checklist allows 2 tries per shot) to see if a sharper note fixes the humanization; (b) wait for CodeCraft to be
  reactivated and re-run art on it instead; (c) accept the current pictures and proceed to T3c anyway if time
  matters more than a perfect score — your call, not the lead's or mine to make silently.
