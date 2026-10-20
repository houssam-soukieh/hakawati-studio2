// What the image model is asked to paint. The text engine turns each shot of the screenplay into one SDXL prompt;
// on the offline engine a plain template does it. Kept apart from the ComfyUI client (image.mjs).
// Both build on the screenplay's VISUAL BIBLE: each character's `look` and the location's `look` are pasted word
// for word by composePrompt (never retold by the writer — the image model has no memory, so identical words are
// what keeps a face, a costume and a place the same from shot to shot), with the shot's lens and light.
// Hidden BEINGS (cast kind 'being': light, smoke, glass — never people) are painted from their look only: the writer is
// told so, a being-only frame loses any human-anatomy phrase, and shotNegative() pushes the picture away from people.
import { loadSettings, withTerms } from './settings.mjs';
import { askJSON } from './llm.mjs';
import { STYLES } from './styles.mjs';
import { Cancelled } from './util.mjs';
import { t, addMessages } from './i18n.mjs';

addMessages({
  promptFallback: { en: v => `   ⚠ ${v.id}: the text engine could not write the picture prompt (${v.e}) — painting from the screenplay's own words (offline template); repaint this shot when the engine works again`,
    ar: v => `   ⚠ ${v.id}: تعذّر على محرك النص كتابة وصف الصورة (${v.e}) — الرسم من كلمات السيناريو نفسها (القالب المحلي)؛ أعد رسم هذه اللقطة حين يعود المحرك للعمل` },
});

const PROMPT_SYSTEM = `You write prompts for an SDXL image model that paints single frames of a film.
The film keeps a VISUAL BIBLE that the platform pastes for you, word for word:
- Each character appears in your prompt ONLY as its placeholder, exactly as given (e.g. [[layla]]), once, where that person belongs in the phrase, followed by pose, expression, gesture, what they hold and where they are in the frame. Never describe their face, hair, skin or clothes yourself and never use their names — the image model does not know names.
- Some characters are hidden BEINGS (marked BEING below): non-human entities of light, smoke or glass that only the viewer sees, never people. Show a being only through its placeholder plus its glow, posture, size and place in the frame. Add no human anatomy of your own to a being (no skin, lips, hair, chest, torso, breasts, muscles, bare limbs) and never call it a woman, man, girl, boy, lady, person or figure of a person. A being never touches or holds anything.
- Every character in the frame appears exactly once: never two copies of one character, never an extra person. When a human and a being share the frame, write the human first, then the being.
- The location's look is pasted after your text: add only what this shot needs beyond it.
- The style keywords are appended after that: do not write style keywords.
Rules: English only; 30–60 words of your own (placeholders not counted); comma-separated phrases; subject and action first, then setting details, composition (shot size, camera angle, the lens given), the light given, mood.
Continuity: the neighbouring shots are given so that props and their state, light direction, time of day and screen direction (who is left or right, which way they face or travel) match across the cut.
Never ask for text, letters, subtitles, logos, screens with readable words, or signs. One frozen moment — never a sequence.
Answer with ONE JSON object: {"prompt": "..."}.`;

const flat = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const inFrame = (sp, shot) => (sp?.cast ?? []).filter(c => (shot?.cast ?? []).includes(c.id));
const latin = s => /^[\x20-\x7e]+$/.test(s);

// A look no person could have (decides even against the default kind 'human' the director's normaliser gives)…
const PLAINLY_BEING = /\b(faceless|eyeless|no face|humanoid|sprites?|apparitions?|(?:made|formed|woven|spun) (?:only |entirely |purely )?(?:of|from) (?:[\w-]+ ){0,4}(?:light|smoke|glass|mist|threads?)|(?:figure|body|entity|creature|silhouette) (?:made )?of (?:[\w-]+ ){0,3}(?:light|smoke|glass|mist)|threads of light|light[- ]threads?)\b/i;
// …and words that point to a being when the screenplay has no kind at all (older screenplays)
const LIKELY_BEING = /\b(translucent(?! skin)|transparent|see-through|incorporeal|ethereal|ghostly|spectral|wisps?|(?:of|from) (?:[\w-]+ ){0,3}(?:light|smoke|glass)(?![- ]?(?:blue|green|grey|gray|brown|pink|purple|yellow|skin|hair|eyes|wash|stubble|freckles)))\b/i;

/** 'human' or 'being'. The screenplay's kind decides; a look that is plainly not a person makes a being anyway, and
 *  a screenplay written before kinds existed is read from the look. */
export function castKind(c) {
  const kind = String(c?.kind ?? '').toLowerCase(), look = String(c?.look ?? '');
  if (kind === 'being' || PLAINLY_BEING.test(look)) return 'being';
  if (kind === 'human') return 'human';
  return LIKELY_BEING.test(look) ? 'being' : 'human';
}
const isBeing = c => castKind(c) === 'being';

// words that make SDXL paint a person; a frame of beings alone loses every phrase of the writer's that has one
const HUMAN_WORDS = /\b(wom[ae]n|m[ae]n|girls?|boys?|lady|ladies|gentlem[ae]n|businessm[ae]n|businesswom[ae]n|persons?|people|human|female|male|feminine|masculine|skin|skinned|flesh|nude|naked|bare|topless|shirtless|torso|chest|breasts?|bust|cleavage|lingerie|lips|hair(?!-thin)|beard|muscles?|muscular|abs|curves|curvy|sexy|sensual|seductive)\b/i;
const dehumanise = text => String(text ?? '').split(',').filter(ph => !HUMAN_WORDS.test(ph.replace(/\[\[[\w-]+\]\]/g, ''))).join(',');
// after a being's look when the look itself does not already say what kind of thing it is
const BEING_ANCHOR = 'otherworldly entity';
// a humanoid being whose look has no face (Orion): SDXL paints a human face on any head unless pushed hard — a weighted
// phrase after the look, and (in a frame without humans) the features themselves in the negative
const FACELESS = /\b(faceless|featureless face|no face)\b/i, HAS_HEAD = /\b(humanoid|head|figure|body|silhouette)\b/i;
const facelessBeing = c => isBeing(c) && FACELESS.test(c.look ?? '') && HAS_HEAD.test(c.look ?? '');
const FACELESS_HINT = '(smooth blank featureless oval head like frosted glass:1.3)';
const beingLook = c => [/\b(entity|being|sprites?|apparition|spirit)\b/i.test(c.look ?? '') ? c.look : `${c.look}, ${BEING_ANCHOR}`, facelessBeing(c) ? FACELESS_HINT : ''].filter(Boolean).join(', ');

const NEG_BEINGS_ONLY = 'human face, human skin, realistic person, woman, man, body, torso, nude, cleavage';
const NEG_WITH_HUMANS = 'nude, cleavage, bare torso'; // a being next to a human: the human must stay a person
const NEG_SECOND = 'second person, extra person, twins'; // …and the being must not become a second one
const NEG_ONE = 'two people, duplicate, twins, clone, multiple figures';
const NEG_FACELESS = 'facial features, nose, nostrils, lips, mouth, eyebrows, human eyes'; // a faceless being, no human in the frame
const OTHERS = /\b(crowds?|people|passers?-by|strangers|customers|passengers|neighbours|neighbors|others|family|friends|students|workers)\b/i; // extras the cast does not list

/**
 * The negative prompt for one shot: `base` (Settings → Negative) plus what this frame must not become. Beings alone in
 * the frame → no person, face, skin or body; beings with one human → no second person; one character → no copies.
 */
export function shotNegative(sp, shot, base = loadSettings().image.negative) {
  const people = inFrame(sp, shot), beings = people.filter(isBeing).length, humans = people.length - beings;
  const alone = people.length === 1 && !OTHERS.test(`${shot?.visual ?? ''} ${shot?.action ?? ''}`);
  return withTerms(base, beings && !humans ? NEG_BEINGS_ONLY : '', !humans && people.some(facelessBeing) ? NEG_FACELESS : '', beings && humans ? NEG_WITH_HUMANS : '', beings && humans === 1 ? NEG_SECOND : '', alone ? NEG_ONE : '');
}

/** The negative prompt for a character's reference portrait (one character, alone). */
export const castNegative = (c, base) => shotNegative({ cast: [c] }, { cast: [c.id] }, base);

/** Whose portrait steers a shot through IP-Adapter: the first human in the frame that has one (a face is what must
 *  stay the same), else the first being that has one. hasPortrait(id) → boolean. */
export function refCast(sp, shot, hasPortrait = () => true) {
  const ok = inFrame(sp, shot).filter(c => hasPortrait(c.id));
  return ok.find(c => !isBeing(c)) ?? ok[0] ?? null;
}

/** Names (Latin-script ones) of in-frame characters → their placeholder, unless the placeholder is already there.
 *  One placeholder per character: a name that is also its id ("Kira" / kira) is not wrapped twice. */
function placeholders(text, people) {
  let out = String(text ?? '');
  for (const c of people) {
    if (out.includes(`[[${c.id}]]`)) continue;
    for (const n of [c.name, c.id.replace(/-/g, ' ')]) {
      const re = n && n.length > 1 && latin(n) && new RegExp(`(?<!\\[\\[)\\b${reEsc(n)}('s)?\\b(?!\\]\\])`, 'i');
      if (re && re.test(out)) { out = out.replace(re, `[[${c.id}]]`); break; }
    }
  }
  return out;
}

/**
 * The final SDXL prompt: [[id]] → that character's look (verbatim, first use only); a look the text never placed
 * goes first (subject first); then the location look, lens and light when the text lacks them; style keywords last.
 */
export function composePrompt({ text, people, location, shot, style, note }) {
  const used = new Set();
  // beings alone: the writer's own phrases (and style words like "detailed skin") never make a person; their looks,
  // pasted below, are the bible's words
  const beingsOnly = people.length > 0 && people.every(isBeing);
  const own = beingsOnly ? dehumanise(text) : String(text ?? '');
  let body = own.replace(/\[\[\s*([\w-]+)\s*\]\]/g, (m, id) => {
    const c = people.find(x => x.id === id.toLowerCase());
    if (!c || used.has(c.id)) return '';
    used.add(c.id);
    return !c.look ? c.id.replace(/-/g, ' ') : isBeing(c) ? beingLook(c) : c.look;
  });
  const has = s => !s || flat(body).includes(flat(s));
  // a look the text never placed goes first: humans before beings (the bible's order for a shared frame)
  const missing = [...people.filter(c => !isBeing(c)), ...people.filter(isBeing)].filter(c => !used.has(c.id) && c.look && !has(c.look)).map(c => (isBeing(c) ? beingLook(c) : c.look));
  // the shot's own lens wins over a lens baked into the style keywords ("35mm lens" on an 85mm close-up)
  let keywords = shot.lens ? String(style ?? '').replace(/(^|,)\s*\d+\s?mm( lens)?\s*(?=,|$)/gi, '') : style;
  if (beingsOnly) keywords = dehumanise(keywords);
  const parts = [...missing, body, has(location?.look) ? '' : location.look, has(shot.lens) ? '' : `${shot.lens} lens`, has(shot.light) ? '' : shot.light, note, keywords];
  return parts.map(x => String(x ?? '').trim()).filter(Boolean).join(', ')
    .replace(/\s+/g, ' ').replace(/\s+([,.;])/g, '$1').replace(/([,;])\s*(?:[,;]\s*)+/g, '$1 ').replace(/^[\s,;]+|[\s,;]+$/g, '').slice(0, 1600);
}

const neighbour = (label, sh, sp) => {
  if (!sh) return `${label}: (none — ${label === 'PREVIOUS SHOT' ? 'this is the first story shot' : 'this is the last story shot'})`;
  const who = inFrame(sp, sh).map(c => `[[${c.id}]]`).join(' ') || 'no cast';
  return `${label} (${sh.id}, ${sh.shotType}${sh.lens ? `, ${sh.lens}` : ''}${sh.light ? `, light: ${sh.light}` : ''}; ${who}): ${String(sh.visual ?? '').slice(0, 400)}${sh.prompt ? `\n  its picture prompt: ${String(sh.prompt).slice(0, 600)}` : ''}`;
};

// Who wrote each shot's last prompt: 'engine' | 'template' (the engine failed: the offline template stood in) |
// 'offline' (the offline engine is chosen). Per screenplay object, so two projects never mix.
const sources = new WeakMap();
/** Who wrote the prompt shotImagePrompt last returned for this shot of this screenplay ('' if none yet). */
export const promptSource = (sp, shotId) => (sp && typeof sp === 'object' ? sources.get(sp)?.get(shotId) ?? '' : '');
const setSource = (sp, shotId, src) => { if (sp && typeof sp === 'object') { if (!sources.has(sp)) sources.set(sp, new Map()); sources.get(sp).set(shotId, src); } };

/**
 * The picture for one shot as an SDXL prompt (written by the text engine; a plain template on the offline engine,
 * and in place of the engine when it fails after its own retries — logged, and promptSource(sp, shot.id) then says
 * 'template'). A stopped job still throws. prev / next (optional): the neighbouring story shots, for continuity; a
 * neighbour carrying `.prompt` (its picture prompt, when already written) is quoted too.
 */
export async function shotImagePrompt({ sp, options, shot, location, note, prev, next, signal, log = () => {} }) {
  const st = STYLES[options.style] ?? STYLES.cinematic;
  const style = st.image ?? st.brief;
  const people = inFrame(sp, shot);
  const { engine } = loadSettings();
  // the screenplay's own words: what we see, the shot size, the film look (when it is not the style's), with the
  // looks, place, lens, light and style keywords pasted by composePrompt (and the being rules it keeps)
  const template = () => composePrompt({ text: [placeholders(shot.visual, people), `${shot.shotType} shot`, sp.artStyle !== st.brief ? sp.artStyle : ''].filter(Boolean).join(', '), people, location, shot, style, note });
  if (engine.protocol === 'mock') { setSource(sp, shot.id, 'offline'); return template(); }
  const user = `FILM LOOK (for mood and palette): ${sp.artStyle}
FRAME: ${options.aspect}, ${shot.shotType} shot, lens ${shot.lens || '(choose one that fits the shot size)'}, camera move ${shot.camera}
LIGHT: ${shot.light || '(match the location and its time of day)'}
LOCATION (pasted after your text): ${location ? `${location.look || location.name}` : '(as described)'}
CHARACTERS IN THE FRAME — write each placeholder exactly once:
${people.map(c => `[[${c.id}]] = ${c.name}${c.personality ? ` (${c.personality})` : ''}; ${isBeing(c) ? 'BEING — not a person, no human anatomy' : 'human'}; pasted look: ${c.look}`).join('\n') || '(none)'}
WHAT WE SEE: ${shot.visual}
${shot.motion === 2
    ? `WHAT HAPPENS: ${shot.action}
THIS PICTURE IS THE FIRST FRAME of a short image-to-video clip: paint the instant just BEFORE the movement, poised to happen, with room in the frame for it.`
    : `WHAT HAPPENS (pick the single most telling instant): ${shot.action}`}
${neighbour('PREVIOUS SHOT', prev, sp)}
${neighbour('NEXT SHOT', next, sp)}
${note ? `PRODUCER NOTE FOR THIS PICTURE: ${note}\n` : ''}Write the prompt.`;
  try {
    const prompt = await askJSON({ purpose: 'shot', system: PROMPT_SYSTEM, user, maxTokens: 2000, signal, log,
      validate: o => {
        if (typeof o.prompt !== 'string' || o.prompt.trim().length < 20) throw new Error('"prompt" must be a phrase list of 30–60 words');
        return composePrompt({ text: placeholders(o.prompt, people), people, location, shot, style });
      } });
    setSource(sp, shot.id, 'engine');
    return prompt;
  } catch (e) {
    if (e?.cancelled) throw e;
    if (signal?.aborted) throw new Cancelled();
    log(t('promptFallback', { id: shot.id, e: String(e?.message ?? e).replace(/\s+/g, ' ').slice(0, 200) }));
    setSource(sp, shot.id, 'template');
    return template();
  }
}

// a reference carries identity, not mood: the film's lens, light and grade stay out of it (the medium stays in)
const MOOD_WORDS = /\b(\d+\s?mm|lens|depth of field|bokeh|volumetric|rim light|light|lighting|lit|tilt-shift|graded|grade|grain|film still|anamorphic)\b/i;
const refStyle = (keywords, being) => String(keywords ?? '').split(',').map(x => x.trim())
  .filter(x => x && !MOOD_WORDS.test(x) && !(being && /\b(skin|fabric|portrait)\b/i.test(x))).join(', ');

/**
 * The reference portrait of one character, which IP-Adapter carries into every shot of it. A human: a tight
 * head-and-shoulders identity photo, soft even light, plain mid-grey ground — the face, not a mood or a composition
 * (image.mjs crops it to the face). A being: the whole entity exactly as its look says, never a person, on black.
 */
export function castImagePrompt(sp, options, c) {
  const st = STYLES[options.style] ?? STYLES.cinematic;
  const being = isBeing(c), style = refStyle(st.image ?? sp.artStyle, being);
  const text = being
    ? `full-figure reference of a non-human luminous entity, ${c.look}${facelessBeing(c) ? `, ${FACELESS_HINT}` : ''}, the whole entity in frame and centred, no human face, no skin, not a person, glowing against a pure black background, ${style}`
    : `character identity reference, ${c.look}, tight head-and-shoulders framing, face centred and looking straight at the camera, neutral expression, soft even frontal light, plain mid-grey background, sharp focus on the face, ${style}`;
  return text.replace(/\s+/g, ' ').replace(/[\s,]+$/, '');
}
