// The director: story → screenplay (the montage). Scenes → shots, each with narration, what we see, what moves,
// shot size, camera move and the transition into the next shot. The platform adds the title and end cards itself.
import { askJSON } from './llm.mjs';
import { STYLES, CAMERAS, TRANSITIONS, SHOT_TYPES } from './styles.mjs';
import { clamp } from './util.mjs';
import { mockScreenplay } from './mock.mjs';
import { loadSettings } from './settings.mjs';
import { t } from './i18n.mjs';

const LANG = { ar: 'Modern Standard Arabic (فصحى), vivid storyteller voice like a hakawati', en: 'English', fr: 'French' };
const MOODS = ['calm', 'wonder', 'tense', 'joyful', 'sad', 'epic', 'mysterious', 'warm'];

export function shotPlan(length, aspect) {
  const avg = aspect === '9:16' ? 4.2 : 5.2;
  const body = Math.max(8, length - 6.5);
  return { shots: clamp(Math.round(body / avg), 3, 40), avg };
}

function systemPrompt() {
  return `You are an award-winning film director AND montage editor for short animated films made entirely of animated vector (SVG) scenes.
You turn a story into a SHOOTING SCRIPT: scenes broken into shots, written so that an illustrator-animator who has never read the story can draw and animate every shot from your words alone.

MONTAGE GRAMMAR you always apply:
- Open each scene with an establishing or wide shot, then move closer (wide → medium → close) as emotion rises; never two identical shot sizes in a row unless it is a deliberate rhythm.
- One clear idea per shot. The image must SHOW what the narration does not say (subtext, reaction, detail) — never just illustrate the sentence literally.
- Keep screen direction (180° rule): a character travelling toward a goal keeps moving the same way across shots.
- Use inserts (a hand, an object, an eye) and reaction shots to build tension; use a wide, still shot to let a big moment breathe.
- Rhythm: tension = shorter shots and cuts; calm or wonder = longer shots with fades/dissolves. Time jumps or location changes = fade, fade-black or a wipe. Inside one scene = mostly cut.
- Camera: push-in for revelation or emotion, pull-out for loneliness or ending, pan to follow movement or reveal space, tilt-up for awe, drift for dreamy or calm, static for dialogue or comedy timing.
- The last shot must resolve the story (an image that echoes the first shot is ideal).

WRITING EACH SHOT:
- "visual": 2–4 sentences in ENGLISH describing the composition like a storyboard: background (sky, setting, time of day, light direction), midground, foreground, where each character stands (left/center/right third, near/far), their pose and expression, key props, and which palette colours dominate. Concrete shapes only — it will be drawn in SVG.
- "action": 1–2 sentences in ENGLISH describing exactly what MOVES during the shot, in order, with rough timing (e.g. "0–2s the boat glides left to center; 2s the girl turns her head; ambient: waves ripple, gulls cross"). Always include ambient motion so no frame is ever frozen.
- "narration": the spoken line for this shot in the story language. Rich, rhythmic, literary but easy to hear. About 2.2 words per second of the shot. A shot may have an empty narration ("") for a silent beat, but at most one silent shot in a row.
- Keep every bit of narration faithful to the story; you may compress, but never invent a different plot.

Answer with ONE JSON object only, no commentary, no code fence.`;
}

function userPrompt(p) {
  const o = p.options, st = STYLES[o.style] ?? STYLES.cinematic, plan = shotPlan(o.length, o.aspect);
  return `STORY:
"""
${p.story.trim()}
"""

FILM SETTINGS
- Narration language: ${LANG[o.language] ?? o.language}
- Target length: about ${o.length} seconds of story shots → about ${plan.shots} shots (±2), average ${plan.avg}s each, between 2.5 and 9 seconds each.
- Frame: ${o.aspect}${o.aspect === '9:16' ? ' (vertical phone video: compose vertically, one subject at a time, big and centered)' : ''}
- Visual style: ${st.brief}
- Starting palette (adjust to the story if needed, keep 7 colours): ${JSON.stringify(st.palette)}
${o.audience ? `- Audience: ${o.audience}\n` : ''}${o.notes ? `- Director notes from the producer: ${o.notes}\n` : ''}
JSON SHAPE (all keys required):
{
  "title": "film title in the narration language (short, evocative)",
  "logline": "one sentence in the narration language",
  "mood": one of ${JSON.stringify(MOODS)},
  "palette": { "bg": "#hex", "sky1": "#hex", "sky2": "#hex", "ink": "#hex", "accent": "#hex", "accent2": "#hex", "shadow": "#hex" },
  "artStyle": "one English sentence that pins the look for this film, building on the visual style above",
  "cast": [ { "id": "kebab-case", "name": "name in the narration language", "look": "ENGLISH model-sheet description: body proportions, head shape, skin/fur hex colour, hair, clothing with hex colours, ONE signature detail that makes them recognisable in silhouette. Simple enough to draw with ~20 SVG shapes.", "personality": "3 words" } ],
  "locations": [ { "id": "kebab-case", "name": "...", "look": "ENGLISH: ground, sky, landmarks, light, colours" } ],
  "scenes": [
    { "id": "s1", "title": "scene title in the narration language", "location": "location id",
      "shots": [
        { "id": "s1-1", "narration": "...", "visual": "...", "action": "...", "cast": ["ids of characters visible"],
          "shotType": one of ${JSON.stringify(SHOT_TYPES)},
          "camera": one of ${JSON.stringify(CAMERAS)},
          "transition": "into the NEXT shot", one of ${JSON.stringify(TRANSITIONS)},
          "seconds": number }
      ] }
  ]
}
Rules: 1–5 cast members (only those who appear on screen), 1–5 locations, 2–7 scenes, shot ids "s<scene>-<n>", every cast id used in shots must exist in "cast".`;
}

const HEX = /^#[0-9a-f]{6}$/i;
const ID = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** Make whatever came back usable: fill defaults, fix ids/enums, add title + end cards. Throws only when hopeless. */
export function normalizeScreenplay(sp, options) {
  if (!sp || typeof sp !== 'object') throw new Error('expected an object');
  if (!Array.isArray(sp.scenes) || !sp.scenes.length) throw new Error('"scenes" must be a non-empty array');
  const st = STYLES[options.style] ?? STYLES.cinematic;
  const palette = { ...st.palette };
  for (const k of Object.keys(palette)) if (HEX.test(sp.palette?.[k] ?? '')) palette[k] = sp.palette[k];
  const cast = (Array.isArray(sp.cast) ? sp.cast : []).slice(0, 6).map((c, i) => ({
    id: ID(c.id) || `char-${i + 1}`, name: String(c.name ?? c.id ?? `${options.language === 'ar' ? 'شخصية' : 'Character'} ${i + 1}`), look: String(c.look ?? ''), personality: String(c.personality ?? ''),
  }));
  const castIds = new Set(cast.map(c => c.id));
  const locations = (Array.isArray(sp.locations) ? sp.locations : []).slice(0, 8).map((l, i) => ({ id: ID(l.id) || `loc-${i + 1}`, name: String(l.name ?? ''), look: String(l.look ?? '') }));
  const seen = new Set();
  const scenes = [];
  let total = 0;
  sp.scenes.forEach((sc, si) => {
    const sid = `s${si + 1}`;
    const shots = (Array.isArray(sc.shots) ? sc.shots : []).map((sh, hi) => {
      let id = `${sid}-${hi + 1}`;
      while (seen.has(id)) id += 'b';
      seen.add(id);
      if (typeof sh.visual !== 'string' || !sh.visual.trim()) throw new Error(`shot ${id}: "visual" is missing`);
      const s = {
        id, kind: 'shot',
        narration: String(sh.narration ?? '').trim(),
        visual: sh.visual.trim(), action: String(sh.action ?? '').trim(),
        cast: (Array.isArray(sh.cast) ? sh.cast : []).map(ID).filter(c => castIds.has(c)),
        shotType: SHOT_TYPES.includes(sh.shotType) ? sh.shotType : 'medium',
        camera: CAMERAS.includes(sh.camera) ? sh.camera : 'drift',
        transition: TRANSITIONS.includes(sh.transition) ? sh.transition : 'cut',
        seconds: clamp(Number(sh.seconds) || 5, 2.5, 12),
      };
      total += s.seconds;
      return s;
    });
    if (shots.length) scenes.push({ id: sid, title: String(sc.title ?? `${options.language === 'ar' ? 'المشهد' : 'Scene'} ${si + 1}`), location: ID(sc.location), shots });
  });
  if (!scenes.length) throw new Error('no shots in any scene');
  // title + end cards (drawn by the platform, never by the model)
  const lang = options.language;
  scenes[0].shots.unshift({ id: 'title', kind: 'title', narration: '', visual: '', action: '', cast: [], shotType: 'wide', camera: 'push-in', transition: 'fade', seconds: 3.5 });
  const last = scenes[scenes.length - 1].shots;
  last[last.length - 1].transition = 'fade-black';
  last.push({ id: 'end', kind: 'end', narration: '', visual: '', action: '', cast: [], shotType: 'wide', camera: 'static', transition: 'cut', seconds: 3, text: lang === 'ar' ? 'النهاية' : lang === 'fr' ? 'Fin' : 'The End' });
  return {
    title: String(sp.title ?? (options.language === 'ar' ? 'حكاية' : 'A Tale')), logline: String(sp.logline ?? ''), mood: MOODS.includes(sp.mood) ? sp.mood : 'warm',
    palette, artStyle: String(sp.artStyle ?? st.brief), cast, locations, scenes, estSeconds: Math.round(total + 6.5),
  };
}

export async function writeScreenplay(p, { signal, log }) {
  const { engine } = loadSettings();
  if (engine.protocol === 'mock') return normalizeScreenplay(mockScreenplay(p), p.options);
  let chars = 0, last = 0;
  return askJSON({
    purpose: 'director', system: systemPrompt(), user: userPrompt(p), maxTokens: 24000, signal, log,
    onText: d => { chars += d.length; if (Date.now() - last > 4000) { last = Date.now(); log(t('directorWriting', { n: chars })); } },
    validate: obj => normalizeScreenplay(obj, p.options),
  });
}
