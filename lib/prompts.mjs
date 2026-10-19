// What the image model is asked to paint. The text engine turns each shot of the screenplay into one SDXL prompt;
// on the offline engine a plain template does it. Kept apart from the ComfyUI client (image.mjs).
import { loadSettings } from './settings.mjs';
import { askJSON } from './llm.mjs';
import { STYLES } from './styles.mjs';

const PROMPT_SYSTEM = `You write prompts for an SDXL image model that paints single frames of a film.
Rules: English only; 35–70 words; comma-separated phrases; subject and action first, then setting, composition (shot size, camera angle, lens), lighting, mood, then the style keywords you are given.
Describe people by their LOOK (age, skin, hair, clothes, signature detail), never by name — the model does not know the names. Keep each character's look word-for-word the same in every prompt so they stay recognisable.
Never ask for text, letters, subtitles, logos, screens with readable words, or signs. Do not describe a story or a sequence: one frozen moment.
Answer with ONE JSON object: {"prompt": "..."}.`;

const castLine = (sp, ids) => sp.cast.filter(c => ids.includes(c.id)).map(c => `${c.name}: ${c.look}`).join('\n');

/** The picture for one shot as an SDXL prompt (written by the text engine; a plain template on the offline engine). */
export async function shotImagePrompt({ sp, options, shot, location, note, signal, log }) {
  const st = STYLES[options.style] ?? STYLES.cinematic;
  const { engine } = loadSettings();
  if (engine.protocol === 'mock') {
    const people = sp.cast.filter(c => shot.cast.includes(c.id)).map(c => c.look).join('; ');
    return [shot.visual, people, `${shot.shotType} shot`, sp.artStyle, st.image, note].filter(Boolean).join(', ').replace(/\s+/g, ' ').slice(0, 900);
  }
  const user = `FILM LOOK: ${sp.artStyle}
STYLE KEYWORDS (end the prompt with these): ${st.image ?? st.brief}
FRAME: ${options.aspect}, ${shot.shotType} shot, camera move ${shot.camera}
LOCATION: ${location?.look ?? ''}
CHARACTERS IN THE FRAME:
${castLine(sp, shot.cast) || '(none)'}
WHAT WE SEE: ${shot.visual}
WHAT HAPPENS (pick the single most telling instant): ${shot.action}
${note ? `PRODUCER NOTE FOR THIS PICTURE: ${note}\n` : ''}Write the prompt.`;
  return askJSON({ purpose: 'shot', system: PROMPT_SYSTEM, user, maxTokens: 2000, signal, log,
    validate: o => { if (typeof o.prompt !== 'string' || o.prompt.trim().length < 20) throw new Error('"prompt" must be a sentence of 35–70 words'); return o.prompt.trim(); } });
}

/** A neutral reference portrait of one character (used to keep the face and costume the same in every shot). */
export function castImagePrompt(sp, options, c) {
  const st = STYLES[options.style] ?? STYLES.cinematic;
  return `character reference portrait, ${c.look}, upper body, facing the camera three-quarter view, neutral expression, plain dark studio background, soft key light, ${st.image ?? sp.artStyle}`.replace(/\s+/g, ' ');
}
