// The picture critic: best-of-N for every keyframe. ComfyUI paints a few candidates per shot; a text engine that can
// see (Claude, GPT…) looks at all of them in ONE call, scores each against the shot and the film's look, picks the
// best and, when even the best falls short, rewrites the prompt for another round. The best over all rounds wins.
// Talks to the engine in English (it judges best in English); the critique follows the Studio's language.
// When the critic cannot answer (a throttling gateway, after the patient retries in llm.mjs) the shot keeps its best
// candidate but is marked UNREVIEWED (reviewed: false); the next art run judges the candidates already on disk again
// without repainting them, and repaints only if the best is then under minScore.
import { askVisionJSON, probeVision } from './llm.mjs';
import { loadSettings } from './settings.mjs';
import { STYLES } from './styles.mjs';
import { hash, clamp, checkAbort } from './util.mjs';
import { addMessages, t, uiLang } from './i18n.mjs';

addMessages({
  criticMock: { en: '   👁 Offline engine — no picture critic: each shot keeps its first candidate', ar: '   👁 المحرك التجريبي — بلا ناقد صور: تأخذ كل لقطة أول صورة مرشّحة' },
  criticBlind: { en: v => `   👁 The text engine cannot see pictures (${v.e}) — no picture critic: each shot keeps its first candidate`, ar: v => `   👁 محرك النص لا يرى الصور (${v.e}) — بلا ناقد صور: تأخذ كل لقطة أول صورة مرشّحة` },
  picCandidates: { en: v => `   🖼 ${v.id}: painting ${v.n} candidates${v.round > 1 ? ` (round ${v.round})` : ''}…`, ar: v => `   🖼 ${v.id}: رسم ${v.n} صور مرشّحة${v.round > 1 ? ` (الجولة ${v.round})` : ''}…` },
  criticScores: { en: v => `   👁 ${v.id}: scores ${v.scores} → #${v.best} (${v.score}/10) — ${v.critique}`, ar: v => `   👁 ${v.id}: الدرجات ${v.scores} ← الأفضل #${v.best} (${v.score}/10) — ${v.critique}` },
  criticRepaint: { en: v => `   ↺ ${v.id}: the best is ${v.score}/10, under ${v.min} — painting again from a corrected prompt: ${v.prompt}`, ar: v => `   ↺ ${v.id}: أفضلها ${v.score}/10، دون ${v.min} — إعادة الرسم بوصف مصحَّح: ${v.prompt}` },
  criticFail: { en: v => `   ⚠ ${v.id}: the critic failed (${v.e}) — keeping candidate #${v.k} UNREVIEWED; the next art run judges it again without repainting`, ar: v => `   ⚠ ${v.id}: تعذّر عمل الناقد (${v.e}) — أُبقي الصورة المرشّحة #${v.k} دون مراجعة؛ تُحكَّم من جديد في جولة الرسم التالية دون إعادة رسمها` },
  criticRejudge: { en: v => `   👁 ${v.id}: judging the ${v.n} candidate${v.n === 1 ? '' : 's'} already painted (the critic could not see them last time)…`, ar: v => `   👁 ${v.id}: تحكيم ${v.n} من الصور المرشّحة المرسومة سابقاً (تعذّر على الناقد رؤيتها في المرة الماضية)…` },
  criticProbeLater: { en: v => `   👁 The vision check got no answer (${v.e}) — the critic stays on; each shot retries its own call`, ar: v => `   👁 لم يأتِ جواب لفحص الرؤية (${v.e}) — يبقى الناقد يعمل؛ تعيد كل لقطة محاولتها بنفسها` },
});

/** The problem shown on a shot whose picture nobody judged (the critic was on but could not answer). */
export const UNREVIEWED = 'picture critic unavailable — not reviewed';

/** The critic's settings, within their limits. */
export function criticSettings(s = loadSettings()) {
  const i = s.image;
  return {
    candidates: clamp(Math.round(Number(i.candidates) || 1), 1, 4), critic: i.critic !== false && i.critic !== 'false',
    minScore: clamp(Number(i.minScore) || 7, 1, 10), maxRounds: clamp(Math.round(Number(i.maxRounds) || 1), 1, 4),
  };
}
/** The part of the critic settings that decides which picture a shot gets (goes into the shot's art key). */
export const criticSig = (s = loadSettings()) => { const c = criticSettings(s); return c.candidates > 1 || c.critic ? hash(c.candidates, c.critic) : ''; };

/** Is there a critic for this job? Probes the engine's eyes once; the caller keeps the answer for the job. */
export async function criticReady({ signal, log = () => {} } = {}) {
  const s = loadSettings();
  if (!criticSettings(s).critic) return false;
  if (s.engine.protocol === 'mock') { log(t('criticMock')); return false; }
  const v = await probeVision({ signal });
  if (!v.vision && v.transient) { log(t('criticProbeLater', { e: String(v.error ?? '').slice(0, 160) })); return true; } // throttled, not blind
  if (!v.vision) log(t('criticBlind', { e: String(v.error ?? '').slice(0, 160) }));
  return v.vision;
}

const SYSTEM = `You are the picture critic of a film studio. An image model (SDXL) painted candidate keyframes for ONE shot of a film. You choose the one that goes into the film and say what is wrong with it.

Score every candidate from 1 to 10 against the shot, checking:
1. STORY — it shows what the shot describes: the subject, the action at its most telling instant, the setting and its props.
2. CAST — the right characters, recognisable by their written look (age, skin, hair, clothes, signature detail; compare with any REFERENCE PORTRAIT), and the right NUMBER of figures: no extra, missing or duplicated ones. Each character is marked HUMAN or BEING: a BEING is not a person — paint it exactly as its look says (light, threads, glass, smoke, rings; faceless, eyeless, translucent…), never as a human being.
3. ANATOMY — faces, eyes (both looking the same way), hands and fingers, limbs and joints, bodies merging with objects or each other.
4. CLEAN — no text, letters, numbers, captions, signs, logos, watermarks, signatures or borders anywhere (the film adds its own captions).
5. FRAMING — matches the shot size, the lens and the frame shape; the subject placed so the camera move has room; nothing important cut by the edges.
6. LIGHT — the light and time of day written for the shot are visible (a 3 AM phone glow is dark with a cold screen light, not a lit studio); colour and mood fit the film look.
7. STYLE — it belongs to the same film as the look described (medium, rendering, grain); no accidental cartoon, 3D-render or plastic-skin look.
Scale: 9–10 ready for the cinema screen; 7–8 good, flaws a viewer would not notice; 5–6 visible flaws; 3–4 wrong subject, broken anatomy or visible text; 1–2 unusable.
Caps (hard limits — the lowest one that applies wins):
- any nudity or sexualised bare skin → at most 2;
- a BEING (or a look that says non-human: light, threads, glass, smoke, faceless, eyeless, translucent) painted as a realistic human, or with a human face, human eyes or human skin → at most 3;
- the same character appearing twice (a duplicated figure) → at most 4;
- framing that ignores the shot size or lens — e.g. a centred studio portrait for a close-up, an extreme close-up or a wide story shot → at most 4;
- visible text or watermark → at most 4;
- the shot's written light or time of day not visible (e.g. "3 AM, phone glow" painted as a bright neutral studio) → at most 5;
- a deformed face or hand in the foreground → at most 5;
- wrong number of people or a missing main character → at most 5.
Be strict and calibrated: never give 8 or more to a picture with a flaw you would point out. REFERENCE PORTRAITS are never candidates; when a portrait and the written look disagree, the written look wins (a portrait can be off-model too).

"fixPrompt": ALWAYS write a corrected SDXL prompt for another try — English, 35–70 words, comma-separated phrases: subject and action first, then setting, composition (shot size, angle, lens), lighting, mood, and the same style keywords at the end. Keep what worked; fix the best candidate's problems by saying positively what must be seen ("a single woman alone in the frame", "hands hidden in her coat pockets", "plain wall without any signs"); simplify crowded scenes and poses the model got wrong. You may weight one or two key phrases like (single old man:1.3). Describe people by their look, never by name. Never ask for text, letters, signs or screens with words.

Answer with ONE JSON object only:
{"candidates":[{"n":1,"score":6,"problems":["short phrase", "..."]}, ...one entry per candidate, in order], "best": <n of the best candidate>, "critique": "<one or two sentences on the best candidate: what works, what is still wrong — shown beside that picture, so never mention candidate numbers>", "fixPrompt": "..."}`;

const kindOf = c => (c?.kind === 'being' ? 'BEING — not a human' : 'HUMAN');
const castLine = (sp, ids) => sp.cast.filter(c => ids.includes(c.id)).map(c => `- ${c.name} [${kindOf(c)}]: ${c.look}`).join('\n');

function check(o, n, minScore) {
  const list = Array.isArray(o?.candidates) ? o.candidates : [];
  if (list.length !== n) throw new Error(`"candidates" must have exactly ${n} entries, one per candidate in order`);
  const scores = list.map((c, k) => {
    const v = Number(c?.score);
    if (!Number.isFinite(v) || v < 1 || v > 10) throw new Error(`candidate ${k + 1}: "score" must be a number from 1 to 10`);
    return Math.round(v * 10) / 10;
  });
  const top = Math.max(...scores), pick = Number(o.best) - 1;
  const best = scores[pick] === top ? pick : scores.indexOf(top); // the scores decide; "best" only breaks a tie
  const fix = typeof o.fixPrompt === 'string' ? o.fixPrompt.trim() : '';
  if (top < minScore && fix.split(/\s+/).length < 15) throw new Error('"fixPrompt" must be a full corrected prompt of 35–70 words');
  const problems = Array.isArray(list[best].problems) ? list[best].problems.map(String).filter(Boolean) : [];
  const critique = (best === pick && typeof o.critique === 'string' && o.critique.trim()) || problems.join('; '); // its critique is about its own pick
  return { best, scores, critique: critique.slice(0, 600), fixPrompt: top < minScore ? fix.slice(0, 1200) : null };
}

/**
 * Judge the candidates of one shot in one call. candidates: PNG Buffers. refs (optional): [{ name, look, kind, buf }]
 * reference portraits of the characters in the frame. → { best (index), scores, critique, fixPrompt (null when the best
 * is good enough) }. Pictures travel small (candidates ≤640 px, portraits ≤384 px, JPEG ≈q80); a throttled call is
 * retried patiently by llm.mjs, each retry in the log.
 */
export async function critiquePictures({ sp, options, shot, prompt, candidates, refs = [], signal, log = () => {} }) {
  const s = loadSettings();
  const { minScore } = criticSettings(s);
  const n = candidates.length;
  if (s.engine.protocol === 'mock') { // no eyes offline: stable made-up scores, so the path can be tested without an engine
    const scores = candidates.map((b, k) => 4 + (parseInt(hash(prompt, k, b.toString('base64')).slice(0, 4), 16) % 6));
    const best = scores.indexOf(Math.max(...scores));
    return { best, scores, critique: `offline critic: made-up score ${scores[best]}/10`, fixPrompt: scores[best] < minScore ? `${prompt}, one clear subject, natural hands, sharp focus` : null };
  }
  const st = STYLES[options.style] ?? STYLES.cinematic;
  const location = sp.locations?.find(l => l.id === shot.location);
  const user = `THE FILM: ${sp.title ? `“${sp.title}” — ` : ''}look: ${sp.artStyle ?? ''}
STYLE KEYWORDS: ${st.image ?? st.brief}
FRAME: ${options.aspect}, ${shot.shotType} shot${shot.lens ? `, lens ${shot.lens}` : ''}, camera move ${shot.camera}
${shot.light ? `LIGHT AND TIME OF DAY (must be visible): ${shot.light}\n` : ''}LOCATION: ${location?.look ?? '(see below)'}
CHARACTERS WHO MUST BE IN THE FRAME:
${castLine(sp, shot.cast ?? []) || '(no named character — judge any people by WHAT WE SEE)'}
WHAT WE SEE: ${shot.visual}
WHAT HAPPENS (the picture should catch its most telling instant): ${shot.action}
${shot.narration ? `NARRATION HEARD OVER THE SHOT (mood only): ${shot.narration}\n` : ''}PROMPT THAT PAINTED THE CANDIDATES: ${prompt}

Above are ${n} candidate${n === 1 ? '' : 's'} (CANDIDATE 1${n > 1 ? ` … CANDIDATE ${n}` : ''})${refs.length ? ' after the reference portraits' : ''}. Score each, pick the best, write the critique in ${uiLang() === 'ar' ? 'Arabic' : 'English'} and the fixPrompt in English.`;
  const images = [
    ...refs.slice(0, 3).map(r => ({ buf: r.buf, mime: 'image/png', max: 384, q: 5, label: `REFERENCE PORTRAIT of ${r.name} [${kindOf(r)}]${r.look ? ` (${r.look})` : ''} — how this character must look; not a candidate` })),
    ...candidates.map((buf, k) => ({ buf, mime: 'image/png', max: 640, q: 5, label: `CANDIDATE ${k + 1}` })),
  ];
  return askVisionJSON({ purpose: 'critic', label: `${shot.id} critic`, system: SYSTEM, user, images, maxTokens: 8000, temperature: 0.2, signal, log, validate: o => check(o, n, minScore) });
}

/**
 * Best-of-N with repaints. paint(prompt, k) → PNG Buffer paints candidate k (k counts across rounds). Without a critic
 * the first candidate wins. `existing` ([{ k, buf, prompt }], candidates painted by an earlier run that nobody could
 * judge): round 1 judges them instead of painting; a repaint follows only when their best is under minScore.
 * → { png, prompt (the winner's), score, critique, rounds, reviewed, candidates: [{ k, score, prompt }] }.
 * reviewed: true = the critic judged the final pick; false = the critic was on but failed (score null, critique '');
 * null = no critic in this job.
 */
export async function paintBest({ sp, options, shot, prompt, paint, critic, refs, existing = [], signal, log = () => {} }) {
  const { candidates, minScore, maxRounds } = criticSettings();
  const n = critic ? candidates : 1; // nobody to choose between candidates → one picture, no wasted GPU time
  const all = existing.map(c => ({ k: c.k, prompt: c.prompt ?? prompt, score: null, buf: c.buf }));
  let best = null, critique = '', rounds = 0, cur = all.at(-1)?.prompt ?? prompt, reviewed = critic ? false : null;
  for (let round = 1; round <= (critic ? maxRounds : 1); round++) {
    rounds = round;
    let fresh = [];
    if (round === 1 && all.length) { fresh = [...all]; log(t('criticRejudge', { id: shot.id, n: fresh.length })); }
    else {
      if (n > 1 || round > 1) log(t('picCandidates', { id: shot.id, n, round }));
      for (let i = 0; i < n; i++) {
        checkAbort(signal);
        const c = { k: all.reduce((m, x) => Math.max(m, x.k + 1), 0), prompt: cur, score: null };
        c.buf = await paint(cur, c.k);
        all.push(c); fresh.push(c);
      }
    }
    if (!critic) { best = all[0]; break; }
    const judged = best ? [best, ...fresh] : fresh; // the best so far is judged again beside the new ones, so the scores compare
    let r;
    try {
      r = await critiquePictures({ sp, options, shot, prompt: cur, candidates: judged.map(c => c.buf), refs, signal, log });
    } catch (e) {
      if (signal?.aborted) throw e;
      best ??= fresh[0];
      reviewed = false;
      log(t('criticFail', { id: shot.id, e: e.message, k: best.k }));
      break;
    }
    reviewed = true;
    judged.forEach((c, i) => { c.score = r.scores[i]; });
    best = judged[r.best]; critique = r.critique;
    log(t('criticScores', { id: shot.id, scores: judged.map(c => `#${c.k}:${c.score}`).join(' '), best: best.k, score: best.score, critique }));
    if (best.score >= minScore || round === maxRounds || !r.fixPrompt) break;
    cur = r.fixPrompt;
    log(t('criticRepaint', { id: shot.id, score: best.score, min: minScore, prompt: cur.length > 160 ? `${cur.slice(0, 160)}…` : cur }));
  }
  const ok = reviewed !== false;
  return { png: best.buf, prompt: best.prompt, score: ok ? best.score : null, critique: ok ? critique : '', rounds, reviewed,
    candidates: all.map(({ k, score, prompt: pr }) => ({ k, score, prompt: pr })) };
}
