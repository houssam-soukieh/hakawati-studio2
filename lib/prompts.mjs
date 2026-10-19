// What the image model is asked to paint. The text engine turns each shot of the screenplay into one SDXL prompt;
// on the offline engine a plain template does it. Kept apart from the ComfyUI client (image.mjs).
// Both build on the screenplay's VISUAL BIBLE: each character's `look` and the location's `look` are pasted word
// for word by composePrompt (never retold by the writer — the image model has no memory, so identical words are
// what keeps a face, a costume and a place the same from shot to shot), with the shot's lens and light.
import { loadSettings } from './settings.mjs';
import { askJSON } from './llm.mjs';
import { STYLES } from './styles.mjs';

const PROMPT_SYSTEM = `You write prompts for an SDXL image model that paints single frames of a film.
The film keeps a VISUAL BIBLE that the platform pastes for you, word for word:
- Each character appears in your prompt ONLY as its placeholder, exactly as given (e.g. [[layla]]), once, where that person belongs in the phrase, followed by pose, expression, gesture, what they hold and where they are in the frame. Never describe their face, hair, skin or clothes yourself and never use their names — the image model does not know names.
- The location's look is pasted after your text: add only what this shot needs beyond it.
- The style keywords are appended after that: do not write style keywords.
Rules: English only; 30–60 words of your own (placeholders not counted); comma-separated phrases; subject and action first, then setting details, composition (shot size, camera angle, the lens given), the light given, mood.
Continuity: the neighbouring shots are given so that props and their state, light direction, time of day and screen direction (who is left or right, which way they face or travel) match across the cut.
Never ask for text, letters, subtitles, logos, screens with readable words, or signs. One frozen moment — never a sequence.
Answer with ONE JSON object: {"prompt": "..."}.`;

const flat = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const inFrame = (sp, shot) => sp.cast.filter(c => (shot.cast ?? []).includes(c.id));
const latin = s => /^[\x20-\x7e]+$/.test(s);

/** Names (Latin-script ones) of in-frame characters → their placeholder, unless the placeholder is already there. */
function placeholders(text, people) {
  let out = String(text ?? '');
  for (const c of people) {
    if (out.includes(`[[${c.id}]]`)) continue;
    for (const n of [c.name, c.id.replace(/-/g, ' ')]) if (n && n.length > 1 && latin(n)) out = out.replace(new RegExp(`\\b${reEsc(n)}('s)?\\b`, 'i'), `[[${c.id}]]`);
  }
  return out;
}

/**
 * The final SDXL prompt: [[id]] → that character's look (verbatim, first use only); a look the text never placed
 * goes first (subject first); then the location look, lens and light when the text lacks them; style keywords last.
 */
export function composePrompt({ text, people, location, shot, style, note }) {
  const used = new Set();
  let body = String(text ?? '').replace(/\[\[\s*([\w-]+)\s*\]\]/g, (m, id) => {
    const c = people.find(x => x.id === id.toLowerCase());
    if (!c || used.has(c.id)) return '';
    used.add(c.id);
    return c.look || c.id.replace(/-/g, ' ');
  });
  const has = s => !s || flat(body).includes(flat(s));
  const missing = people.filter(c => !used.has(c.id) && c.look && !has(c.look)).map(c => c.look);
  // the shot's own lens wins over a lens baked into the style keywords ("35mm lens" on an 85mm close-up)
  const keywords = shot.lens ? String(style ?? '').replace(/(^|,)\s*\d+\s?mm( lens)?\s*(?=,|$)/gi, '') : style;
  const parts = [...missing, body, has(location?.look) ? '' : location.look, has(shot.lens) ? '' : `${shot.lens} lens`, has(shot.light) ? '' : shot.light, note, keywords];
  return parts.map(x => String(x ?? '').trim()).filter(Boolean).join(', ')
    .replace(/\s+/g, ' ').replace(/\s+([,.;])/g, '$1').replace(/([,;])\s*(?:[,;]\s*)+/g, '$1 ').replace(/^[\s,;]+|[\s,;]+$/g, '').slice(0, 1600);
}

const neighbour = (label, sh, sp) => {
  if (!sh) return `${label}: (none — ${label === 'PREVIOUS SHOT' ? 'this is the first story shot' : 'this is the last story shot'})`;
  const who = inFrame(sp, sh).map(c => `[[${c.id}]]`).join(' ') || 'no cast';
  return `${label} (${sh.id}, ${sh.shotType}${sh.lens ? `, ${sh.lens}` : ''}${sh.light ? `, light: ${sh.light}` : ''}; ${who}): ${String(sh.visual ?? '').slice(0, 400)}${sh.prompt ? `\n  its picture prompt: ${String(sh.prompt).slice(0, 600)}` : ''}`;
};

/**
 * The picture for one shot as an SDXL prompt (written by the text engine; a plain template on the offline engine).
 * prev / next (optional): the neighbouring story shots, for continuity; a neighbour carrying `.prompt` (its picture
 * prompt, when already written) is quoted too.
 */
export async function shotImagePrompt({ sp, options, shot, location, note, prev, next, signal, log }) {
  const st = STYLES[options.style] ?? STYLES.cinematic;
  const style = st.image ?? st.brief;
  const people = inFrame(sp, shot);
  const { engine } = loadSettings();
  if (engine.protocol === 'mock') {
    const text = [placeholders(shot.visual, people), `${shot.shotType} shot`, sp.artStyle !== st.brief ? sp.artStyle : ''].filter(Boolean).join(', ');
    return composePrompt({ text, people, location, shot, style, note });
  }
  const user = `FILM LOOK (for mood and palette): ${sp.artStyle}
FRAME: ${options.aspect}, ${shot.shotType} shot, lens ${shot.lens || '(choose one that fits the shot size)'}, camera move ${shot.camera}
LIGHT: ${shot.light || '(match the location and its time of day)'}
LOCATION (pasted after your text): ${location ? `${location.look || location.name}` : '(as described)'}
CHARACTERS IN THE FRAME — write each placeholder exactly once:
${people.map(c => `[[${c.id}]] = ${c.name}${c.personality ? ` (${c.personality})` : ''}; pasted look: ${c.look}`).join('\n') || '(none)'}
WHAT WE SEE: ${shot.visual}
${shot.motion === 2
    ? `WHAT HAPPENS: ${shot.action}
THIS PICTURE IS THE FIRST FRAME of a short image-to-video clip: paint the instant just BEFORE the movement, poised to happen, with room in the frame for it.`
    : `WHAT HAPPENS (pick the single most telling instant): ${shot.action}`}
${neighbour('PREVIOUS SHOT', prev, sp)}
${neighbour('NEXT SHOT', next, sp)}
${note ? `PRODUCER NOTE FOR THIS PICTURE: ${note}\n` : ''}Write the prompt.`;
  return askJSON({ purpose: 'shot', system: PROMPT_SYSTEM, user, maxTokens: 2000, signal, log,
    validate: o => {
      if (typeof o.prompt !== 'string' || o.prompt.trim().length < 20) throw new Error('"prompt" must be a phrase list of 30–60 words');
      return composePrompt({ text: placeholders(o.prompt, people), people, location, shot, style });
    } });
}

/** A neutral reference portrait of one character (used to keep the face and costume the same in every shot). */
export function castImagePrompt(sp, options, c) {
  const st = STYLES[options.style] ?? STYLES.cinematic;
  return `character reference portrait, ${c.look}, upper body, facing the camera three-quarter view, neutral expression, plain dark studio background, soft key light, ${st.image ?? sp.artStyle}`.replace(/\s+/g, ' ');
}
