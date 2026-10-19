// The art department.
//  1. Cast library: ONE call draws every character once as an SVG <symbol> (model sheet). Every shot then places
//     the same symbols with <use>, so the hero looks the same in shot 1 and shot 20 — the classic weakness of
//     AI video. Idle life (blinking, breathing) lives inside the symbols and plays in every shot for free.
//  2. Shots: one call per shot writes a complete animated SVG timed to the shot's exact length (known from the
//     voice-over, which is made first). The answer is cleaned, linted, test-rendered in Chrome, and sent back
//     to the model with the problems (≤ 2 fixes) — the same write → rehearse → fix loop as Nurai Director.
import { askText } from './llm.mjs';
import { STYLES, ASPECTS } from './styles.mjs';
import { extractSvg, sanitize, normalizeRoot, lint, librarySymbols } from './svg.mjs';
import { mockCast, mockShot } from './mock.mjs';
import { loadSettings } from './settings.mjs';
import { t } from './i18n.mjs';

export const SYMBOL_BOX = { w: 240, h: 400 };

// ------------------------------------------------------------------ cast library
const CAST_SYSTEM = `You are the lead character designer of an animation studio. You draw clean, appealing, production-ready SVG character model sheets that animators will reuse in every shot of a film.
Answer with ONE complete SVG document and nothing else (no prose, no code fence).`;

function castPrompt(sp, options) {
  const st = STYLES[options.style] ?? STYLES.cinematic;
  return `FILM: ${sp.title} — ${sp.logline}
LOOK OF THE FILM: ${sp.artStyle}
STYLE RULES: ${st.brief}
PALETTE: ${JSON.stringify(sp.palette)}

CHARACTERS TO DESIGN:
${sp.cast.map(c => `- id "${c.id}" (${c.name}, ${c.personality}): ${c.look}`).join('\n')}

DELIVER exactly this structure:
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SYMBOL_BOX.w * Math.max(1, sp.cast.length)} ${SYMBOL_BOX.h}">
  <style> /* idle animations only, every class prefixed with the character id */ </style>
  <defs>
    <symbol id="cast-<id>" viewBox="0 0 ${SYMBOL_BOX.w} ${SYMBOL_BOX.h}"> … </symbol>   (one per character, ids exactly "cast-" + the id above)
    (gradients / filters used by the symbols also go inside <defs>, with ids prefixed by the character id)
  </defs>
</svg>

RULES FOR EACH SYMBOL
- Full body, standing, three-quarter view FACING RIGHT, feet touching the bottom edge (y≈${SYMBOL_BOX.h - 4}), centred on x=${SYMBOL_BOX.w / 2}, the figure filling most of the height (a small animal or child may be shorter but still stands on the bottom edge).
- Built from simple, clean shapes (15–40 elements), in the film's style and palette; strong readable silhouette; the signature detail clearly visible.
- Group body parts with classes so they can live: <g class="<id>-head">, <g class="<id>-eyes">, <g class="<id>-armL">, <g class="<id>-armR">, <g class="<id>-body">.
- In <style>, give each character subtle infinite idle animation: eyes blink (scaleY to 0.1 for 0.12s every ~4s, transform-box: fill-box; transform-origin: center), gentle breathing (body scaleY 1→1.015, 3s), a small arm or tail sway. Use different durations per character so they never move in sync.
- No text, no <script>, no <image>, no external references, no background — only the characters.
- Total size under 30 KB.`;
}

export async function drawCast(sp, options, { signal, log }) {
  const { engine } = loadSettings();
  if (!sp.cast.length) return { svg: '', issues: [] };
  if (engine.protocol === 'mock') return { svg: mockCast(sp), issues: [] };
  let issues = [], best = null;
  let user = castPrompt(sp, options);
  for (let round = 1; round <= 2; round++) {
    const text = await askText({ purpose: 'cast', system: CAST_SYSTEM, user, maxTokens: 20000, signal, log });
    let svg;
    try { svg = sanitize(extractSvg(text)).svg; } catch (e) { issues = [e.message]; user = `${castPrompt(sp, options)}\n\nYour previous answer: ${e.message}. Answer with the complete SVG only.`; continue; }
    const have = new Set(librarySymbols(svg).map(s => s.id));
    const missing = sp.cast.filter(c => !have.has(`cast-${c.id}`)).map(c => `cast-${c.id}`);
    best = svg;
    issues = missing.length ? [`missing symbols: ${missing.join(', ')}`] : [];
    if (!issues.length) break;
    log(t('castRetry', { issue: issues[0] }));
    user = `${castPrompt(sp, options)}\n\nYour previous answer had a problem: ${issues[0]}. Every character needs its <symbol id="cast-ID">. Answer again with the complete SVG only.`;
  }
  if (!best) throw new Error(t('castFail', { issues: issues.join('; ') }));
  return { svg: best, issues };
}

// ------------------------------------------------------------------ shots
const SHOT_SYSTEM = `You are a master 2D motion designer and illustrator. You write hand-crafted, self-contained ANIMATED SVG files that are rendered frame-by-frame into a film. Each answer is ONE shot of a storyboard. Your shots are beautiful in every single frame: deep layered compositions, cinematic light, purposeful motion and constant subtle life.

TECHNICAL CONTRACT (the renderer depends on it — follow every point):
1. Root element exactly: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 W H"> with the W and H you are given. Nothing outside it.
2. First drawn element: a full-canvas background (rect filled with a colour or gradient). Never leave transparent areas. Let background layers bleed 40px beyond every edge (the camera moves).
3. Motion = CSS @keyframes in ONE <style> block (SMIL <animate>/<animateTransform> also allowed). The shot timeline starts at 0s and lasts exactly D seconds (given).
   - STORY MOTION (things that happen once): give explicit animation-duration and animation-delay so it happens inside 0…D, and ALWAYS "animation-fill-mode: both" so the first frame already shows the start pose and the end pose holds.
   - AMBIENT MOTION (clouds, water, leaves, smoke, particles, flicker, stars, blinking): "infinite", with varied durations so nothing loops in sync.
   - Animate transform/opacity/fill/stroke-dashoffset. For rotate/scale set "transform-box: fill-box; transform-origin: …". Never put two transform animations on the same element — nest <g> wrappers instead (one for travel, one inside for bob/rotation).
   - Never animate the viewBox and never zoom the whole picture: the platform adds the camera move.
4. SUBTITLE ZONE: the bottom 20% of the frame will carry subtitles. Keep faces, eyes and key action out of it (ground, floor, water, foreground silhouettes are fine).
5. NO text, letters or numbers in the picture (subtitles are added later) unless the shot description explicitly requires a sign or a written word.
6. NO <script>, <foreignObject>, <image>, no external URLs, fonts or @import.
7. DEPTH: at least three layers — background (sky/far), midground (setting), foreground (framing elements: branches, pillars, grass, silhouettes) — with parallax: nearer layers move more. Add light and atmosphere: gradients, soft glows (feGaussianBlur), shadows under characters, rays, dust or particles, vignette.
8. CHARACTERS come from the film's cast library, already defined for you: place them ONLY with <use href="#cast-ID" x=".." y=".." width=".." height=".."/> keeping the symbol aspect (width:height = 240:400). They face right; to face left wrap in <g transform="translate(X 0) scale(-1 1)">. Never redraw a cast character and never redefine "cast-…" ids. Walking = translate a wrapper <g> + a small vertical bob (±5px, ~0.45s) on an inner <g>. Close-ups = a large <use> positioned so the head fills the frame. Extras (crowds, animals not in the cast) you may draw yourself.
9. Keep it lean: 8–40 KB. Simple paths with few points; reuse shapes with <use>/<symbol> (your own ids must not start with "cast-").
10. Composition: rule of thirds, a clear focal point, strong value contrast between subject and background, the palette given. The frame must look finished at 0s, at D/2 and at D.

Answer with the SVG only: start with <svg and end with </svg>. No prose, no code fence.`;

function shotPrompt({ sp, options, shot, prev, next, duration, castSvg, note, previousSvg, problems }) {
  const st = STYLES[options.style] ?? STYLES.cinematic;
  const { w, h } = ASPECTS[options.aspect] ?? ASPECTS['16:9'];
  const loc = sp.locations.find(l => l.id === shot.location);
  const syms = librarySymbols(castSvg).map(s => s.id);
  const cast = shot.cast.map(id => sp.cast.find(c => c.id === id)).filter(Boolean);
  let s = `FILM: "${sp.title}" — ${sp.logline}
LOOK: ${sp.artStyle}
STYLE RULES: ${st.brief}
PALETTE (use these colours, tints and shades of them): ${JSON.stringify(sp.palette)}
MOOD: ${sp.mood}

CANVAS: W=${w} H=${h} (${options.aspect}${options.aspect === '9:16' ? ', vertical phone frame — stack the composition vertically' : ''})
SHOT LENGTH: D = ${duration.toFixed(2)} seconds

THIS SHOT (${shot.id}, scene "${shot.sceneTitle}")
- Shot size: ${shot.shotType}
- Location: ${loc ? `${loc.name} — ${loc.look}` : shot.location || 'as described'}
- What we see: ${shot.visual}
- What moves: ${shot.action || 'subtle ambient life'}
- Narration heard over it (for emotion and timing only, do NOT write it in the image): "${shot.narration}"
- Camera move added later by the platform: ${shot.camera}
- Characters in shot: ${cast.length ? cast.map(c => `#cast-${c.id} = ${c.name} (${c.look.slice(0, 160)})`).join(' | ') : 'none from the cast'}
${syms.length ? `- Cast library symbols available: ${syms.join(', ')} (viewBox 0 0 240 400, facing right, feet at the bottom)` : ''}

CONTINUITY
- Previous shot: ${prev ? `${prev.shotType}: ${prev.visual.slice(0, 260)}` : '(this is the first story shot, right after the title card)'}
- Next shot: ${next ? `${next.shotType}: ${next.visual.slice(0, 260)}` : '(this is the last story shot, then the end card)'}`;
  if (note) s += `\n\nPRODUCER'S NOTE FOR THIS VERSION (most important): ${note}`;
  if (previousSvg) s += `\n\nTHE CURRENT VERSION OF THIS SHOT (improve it according to the note/problems, keep what works):\n${previousSvg.slice(0, 45000)}`;
  if (problems?.length) s += `\n\nPROBLEMS FOUND WHEN RENDERING YOUR LAST ANSWER — fix all of them:\n${problems.map(p => `- ${p}`).join('\n')}`;
  return s;
}

/**
 * Write one shot. `test(svg)` renders it in Chrome and returns {problems[], poster?}. Returns {svg, problems, rounds}.
 */
export async function drawShot(ctx, { signal, log, test }) {
  const { engine } = loadSettings();
  const { w, h } = ASPECTS[ctx.options.aspect] ?? ASPECTS['16:9'];
  if (engine.protocol === 'mock') {
    const svg = normalizeRoot(mockShot(ctx), w, h);
    const tr = await test(svg);
    return { svg, problems: tr.problems, rounds: 1, poster: tr.poster };
  }
  let problems = [], best = null, bestScore = Infinity, previousSvg = ctx.previousSvg, poster = null;
  for (let round = 1; round <= 3; round++) {
    const user = shotPrompt({ ...ctx, previousSvg, problems: round > 1 ? problems : null });
    let chars = 0, last = 0;
    const text = await askText({ purpose: 'shot', system: SHOT_SYSTEM, user, maxTokens: 28000, signal, log,
      onText: d => { chars += d.length; if (Date.now() - last > 8000) { last = Date.now(); log(t('artWriting', { id: ctx.shot.id, n: chars })); } } });
    let svg;
    try {
      const clean = sanitize(extractSvg(text));
      svg = normalizeRoot(clean.svg, w, h);
      problems = lint(svg, { castSvg: ctx.castSvg });
      if (clean.removed.length) problems.push(`removed forbidden parts: ${[...new Set(clean.removed)].join(', ')} — do not use them`);
    } catch (e) {
      problems = [e.message];
      log(`   ↺ ${ctx.shot.id}: ${e.message}`);
      continue;
    }
    const tr = await test(svg);
    problems.push(...tr.problems);
    const score = problems.length;
    if (score < bestScore) { best = svg; bestScore = score; poster = tr.poster; }
    if (!problems.length) return { svg, problems, rounds: round, poster };
    // Only real defects are worth another (slow) round; mild issues are accepted.
    const serious = problems.filter(p => !/removed forbidden/.test(p));
    if (!serious.length) return { svg, problems, rounds: round, poster };
    log(t('artRetry', { id: ctx.shot.id, round, problems: serious.slice(0, 3).join(' · ') }));
    previousSvg = svg;
  }
  if (!best) throw new Error(t('artFail', { id: ctx.shot.id, problems: problems.join('; ') }));
  return { svg: best, problems, rounds: 3, poster };
}
