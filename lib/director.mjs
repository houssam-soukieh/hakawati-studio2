// The director: story → screenplay (the montage). Scenes → shots, each with narration, what we see, what moves,
// shot size, lens, light, camera move, motion level and the transition into the next shot. Then a script doctor —
// a separate editor prompt — reviews the draft and the director revises it (`engine.doctorPasses` times, 0–3).
// The cast and location `look` strings are the film's visual bible: pasted verbatim into every picture prompt.
// The platform adds the title and end cards itself.
import { askJSON } from './llm.mjs';
import { STYLES, CAMERAS, TRANSITIONS, SHOT_TYPES } from './styles.mjs';
import { clamp, checkAbort } from './util.mjs';
import { mockScreenplay } from './mock.mjs';
import { loadSettings } from './settings.mjs';
import { t, addMessages } from './i18n.mjs';

addMessages({
  doctorStart: { en: v => `🩺 The script doctor is reviewing the montage (pass ${v.pass}/${v.of})…`, ar: v => `🩺 طبيب السيناريو يراجع المونتاج (الجولة ${v.pass}/${v.of})…` },
  doctorIssues: { en: v => `   📋 Pass ${v.pass}: ${v.n} note${v.n === 1 ? '' : 's'}${v.n ? ' — the most important:' : ''}`, ar: v => `   📋 الجولة ${v.pass}: ${v.n} ملاحظة${v.n ? ' — أهمّها:' : ''}` },
  doctorNote: { en: v => `      · ${v.text}`, ar: v => `      · ${v.text}` },
  doctorClean: { en: '   ✅ The script doctor has no more notes — the screenplay is ready', ar: '   ✅ لا ملاحظات أخرى لدى طبيب السيناريو — السيناريو جاهز' },
  doctorRevising: { en: '   ✍ The director is revising the screenplay with these notes…', ar: '   ✍ المخرج يعدّل السيناريو وفق هذه الملاحظات…' },
  doctorRevised: { en: v => `   ✓ Revised: ${v.scenes} scenes, ${v.shots} shots, about ${v.sec} s`, ar: v => `   ✓ عُدّل: ${v.scenes} مشاهد، ${v.shots} لقطة، نحو ${v.sec} ث` },
  doctorFail: { en: v => `   ⚠ The script doctor could not review this draft (${v.e}) — keeping it as it is`, ar: v => `   ⚠ تعذّرت مراجعة هذه المسودة (${v.e}) — أُبقيها كما هي` },
  reviseFail: { en: v => `   ⚠ The revision failed (${v.e}) — keeping the previous version`, ar: v => `   ⚠ تعذّر التعديل (${v.e}) — أُبقي النسخة السابقة` },
  doctorMock: { en: v => `📋 Script check (offline engine, no script doctor): ${v.n} note${v.n === 1 ? '' : 's'}${v.top ? ` — ${v.top}` : ''}`, ar: v => `📋 فحص السيناريو (المولّد المحلي، بلا طبيب سيناريو): ${v.n} ملاحظة${v.top ? ` — ${v.top}` : ''}` },
});

const LANG = {
  ar: 'Modern Standard Arabic (العربية الفصحى) in the voice of a hakawati, the traditional storyteller: warm, rhythmic, vivid — never colloquial dialect',
  en: 'English', fr: 'French',
};
const MOODS = ['calm', 'wonder', 'tense', 'joyful', 'sad', 'epic', 'mysterious', 'warm'];
const WPS = 2.2; // narration words per second (edge-tts at the default rate)
const LENSES = '"24mm wide", "35mm", "50mm", "85mm portrait", "100mm macro", "135mm telephoto"';

export function shotPlan(length, aspect) {
  const avg = aspect === '9:16' ? 4.2 : 5.2;
  const body = Math.max(8, length - 6.5);
  return { shots: clamp(Math.round(body / avg), 3, 40), avg };
}

/** Share of Arabic letters among all letters (Arabic + Latin). */
const arabicShare = s => {
  const a = (String(s).match(/[؀-ۿݐ-ݿ]/g) ?? []).length, l = (String(s).match(/[A-Za-zÀ-ɏ]/g) ?? []).length;
  return a + l ? a / (a + l) : 0;
};
export const storyLanguage = story => (arabicShare(story) > 0.5 ? 'ar' : 'other');

function systemPrompt() {
  return `You are an award-winning film director AND montage editor. You make short films in which every shot is ONE painted keyframe — an SDXL image model paints it from your words (some styles draw it as vector art instead) — brought to life by camera moves, parallax and ambient motion, and, for the few shots that need real movement, a short image-to-video clip.
You turn a story into a SHOOTING SCRIPT: scenes broken into shots, written so that a painter who has never read the story can paint every shot from your words alone, and so that the same people and places look identical in every shot.

MONTAGE GRAMMAR you always apply:
- Open each scene with an establishing or wide shot, then move closer (wide → medium → close) as emotion rises; never two identical shot sizes in a row unless it is a deliberate rhythm.
- One clear idea per shot. The image must SHOW what the narration does not say (subtext, reaction, detail) — never just illustrate the sentence literally. Each cut answers a question the previous shot raised (what does she see? how does he react?).
- Keep screen direction (180° rule): a character travelling toward a goal keeps moving the same way across shots; two characters facing each other keep their left/right sides.
- Use inserts (a hand, an object, an eye) and reaction shots to build tension; use a wide, still shot to let a big moment breathe.
- Rhythm: tension = shorter shots and cuts; calm or wonder = longer shots with fades/dissolves. Time jumps or location changes = fade, fade-black or a wipe. Inside one scene = mostly cut.
- Camera: push-in for revelation or emotion, pull-out for loneliness or ending, pan to follow movement or reveal space, tilt-up for awe, drift for dreamy or calm, static for dialogue or comedy timing.
- Lens follows the shot: establishing/wide → 24mm or 35mm; medium → 35mm or 50mm; close → 85mm portrait; extreme-close/insert → 100mm macro; 135mm telephoto to compress distance or isolate a figure.
- The last shot must resolve the story (an image that echoes the first shot is ideal).

THE VISUAL BIBLE — the image model has no memory, so these strings are pasted WORD FOR WORD into every picture prompt. Make them specific, stable and paintable:
- cast[].look: ENGLISH, at most 45 words, comma-separated: age, ethnicity and skin tone, build, face shape, hair (colour, length, style), eye colour, clothing with colour NAMES (no hex), and ONE signature detail visible in every shot (a saffron scarf, a brass lantern, a scar). For an animal or creature: species, size, fur/skin colours, eyes, signature detail. No names, no personality, no actions, no camera words.
- locations[].look: ENGLISH, at most 45 words: the place, ground, architecture or landmarks, vegetation, TIME OF DAY and LIGHT (direction, colour, quality), weather/atmosphere, dominant colours. The same place at another time of day is a separate location (e.g. "village-night", "village-dawn").
- A character's costume and signature detail never change between shots unless the story changes them.

WRITING EACH SHOT:
- "visual": 2–4 sentences in ENGLISH describing ONE frozen moment like a storyboard frame: background, midground, foreground; where each character stands (left/center/right third, near/far), which way they face, pose and expression, what they hold, key props. Name characters by their cast name only — their look comes from the bible. Concrete and paintable: no sequences ("then…"), no abstractions without a visible cue, no readable text, signs or screens with words.
- "action": 1–2 sentences in ENGLISH: what MOVES during the shot, in order, with rough timing (e.g. "0–2s the lantern flame flickers; 2s the girl turns her head; ambient: dust drifts"). Always include ambient motion so no frame is ever frozen.
- "motion": 1 = the still picture brought to life by the camera move, parallax and ambient motion (most shots); 2 = an image-to-video clip, ONLY when the shot's meaning depends on a character's movement or action (a leap, a throw, turning to face someone, taking flight). At most 30% of the shots.
- "lens": one of ${LENSES} (or similar).
- "light": a short phrase — key light direction, colour and quality — that agrees with the location's time of day (e.g. "warm lantern key from left, cold moonlight rim").
- "narration": the spoken line for this shot, in the narration language. Rich, rhythmic, literary but easy to hear. About ${WPS} words per second of the shot. A shot may have an empty narration ("") for a silent beat, but never two silent shots in a row.

THE STORY IS SACRED:
- Every event, character and outcome comes from the story; compress and order it for the screen, but never invent plot, characters or a different ending. Keep every name exactly as the story spells it.
- Film title, logline, scene titles, character names and narration are in the narration language (normally the story's own language). Everything meant for the painter — visual, action, look, artStyle, lens, light — is in English.
- Arabic narration: Modern Standard Arabic (فصحى) only, never dialect, in the voice of a hakawati — warm, rhythmic, vivid, with classical connectives (فـ، ثمّ، حتى إذا، وما إن… حتى) and a storyteller's opening formula only where it fits. Keep the story's strongest phrases. Add tashkīl only where a word could be misread aloud. Write numbers as words.

Answer with ONE JSON object only, no commentary, no code fence.`;
}

function userPrompt(p) {
  const o = p.options, st = STYLES[o.style] ?? STYLES.cinematic, plan = shotPlan(o.length, o.aspect);
  const sl = storyLanguage(p.story);
  return `STORY:
"""
${p.story.trim()}
"""

FILM SETTINGS
- Narration language: ${LANG[o.language] ?? o.language}${sl === 'ar' && o.language === 'ar' ? ' — the story is Arabic: keep its names and its strongest phrases, never translate them' : sl === 'ar' ? ' — translate the Arabic story faithfully, keeping the names' : ''}
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
  "cast": [ { "id": "kebab-case", "name": "name in the narration language, as the story spells it", "look": "ENGLISH visual-bible descriptor, ≤ 45 words: age, ethnicity/skin tone, build, face shape, hair, eyes, clothing with colour names, one signature detail", "personality": "3 words" } ],
  "locations": [ { "id": "kebab-case", "name": "...", "look": "ENGLISH visual-bible descriptor, ≤ 45 words: place, landmarks, time of day, light (direction, colour), atmosphere, colours" } ],
  "scenes": [
    { "id": "s1", "title": "scene title in the narration language", "location": "location id",
      "shots": [
        { "id": "s1-1", "narration": "...", "visual": "...", "action": "...", "cast": ["ids of characters visible"],
          "shotType": one of ${JSON.stringify(SHOT_TYPES)},
          "camera": one of ${JSON.stringify(CAMERAS)},
          "lens": "e.g. 35mm",
          "light": "short phrase",
          "motion": 1 or 2,
          "transition": "into the NEXT shot", one of ${JSON.stringify(TRANSITIONS)},
          "seconds": number }
      ] }
  ]
}
Rules: 1–5 cast members (only those who appear on screen), 1–5 locations, 2–7 scenes, shot ids "s<scene>-<n>", every cast id used in shots must exist in "cast", "motion": 2 on at most 30% of the shots.`;
}

const HEX = /^#[0-9a-f]{6}$/i;
const ID = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const isStory = sh => sh.kind !== 'title' && sh.kind !== 'end';
const storyShots = sp => sp.scenes.flatMap(sc => sc.shots.filter(isStory));
/** Image-to-video is slow on an 8 GB card: about 30% of the shots at most. */
export const motionCap = n => Math.max(1, Math.round(n * 0.3));

/** Make whatever came back usable: fill defaults, fix ids/enums, add title + end cards. Throws only when hopeless. */
export function normalizeScreenplay(sp, options) {
  if (!sp || typeof sp !== 'object') throw new Error('expected an object');
  if (!Array.isArray(sp.scenes) || !sp.scenes.length) throw new Error('"scenes" must be a non-empty array');
  const st = STYLES[options.style] ?? STYLES.cinematic;
  const palette = { ...st.palette };
  for (const k of Object.keys(palette)) if (HEX.test(sp.palette?.[k] ?? '')) palette[k] = sp.palette[k];
  const cast = (Array.isArray(sp.cast) ? sp.cast : []).slice(0, 6).map((c, i) => ({
    id: ID(c.id) || `char-${i + 1}`, name: String(c.name ?? c.id ?? `${options.language === 'ar' ? 'شخصية' : 'Character'} ${i + 1}`), look: String(c.look ?? '').trim(), personality: String(c.personality ?? ''),
  }));
  const castIds = new Set(cast.map(c => c.id));
  const locations = (Array.isArray(sp.locations) ? sp.locations : []).slice(0, 8).map((l, i) => ({ id: ID(l.id) || `loc-${i + 1}`, name: String(l.name ?? ''), look: String(l.look ?? '').trim() }));
  const seen = new Set();
  const scenes = [];
  let total = 0;
  sp.scenes.forEach((sc, si) => {
    const sid = `s${si + 1}`;
    const shots = (Array.isArray(sc.shots) ? sc.shots : []).filter(sh => sh && isStory(sh)).map((sh, hi) => {
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
        lens: String(sh.lens ?? '').trim().slice(0, 60),
        light: String(sh.light ?? '').trim().slice(0, 200),
        motion: Number(sh.motion) === 2 ? 2 : 1,
        transition: TRANSITIONS.includes(sh.transition) ? sh.transition : 'cut',
        seconds: clamp(Number(sh.seconds) || 5, 2.5, 12),
      };
      total += s.seconds;
      return s;
    });
    if (shots.length) scenes.push({ id: sid, title: String(sc.title ?? `${options.language === 'ar' ? 'المشهد' : 'Scene'} ${si + 1}`), location: ID(sc.location), shots });
  });
  if (!scenes.length) throw new Error('no shots in any scene');
  // over the image-to-video budget: keep it on shots with characters (movement is about them), earliest first
  const all = scenes.flatMap(sc => sc.shots), moving = all.filter(s => s.motion === 2);
  const cap = motionCap(all.length);
  if (moving.length > cap) [...moving].sort((a, b) => (b.cast.length > 0) - (a.cast.length > 0)).slice(cap).forEach(s => { s.motion = 1; });
  // title + end cards (drawn by the platform, never by the model)
  const lang = options.language;
  const card = { narration: '', visual: '', action: '', cast: [], shotType: 'wide', lens: '', light: '', motion: 1 };
  scenes[0].shots.unshift({ ...card, id: 'title', kind: 'title', camera: 'push-in', transition: 'fade', seconds: 3.5 });
  const last = scenes[scenes.length - 1].shots;
  last[last.length - 1].transition = 'fade-black';
  last.push({ ...card, id: 'end', kind: 'end', camera: 'static', transition: 'cut', seconds: 3, text: lang === 'ar' ? 'النهاية' : lang === 'fr' ? 'Fin' : 'The End' });
  return {
    title: String(sp.title ?? (options.language === 'ar' ? 'حكاية' : 'A Tale')), logline: String(sp.logline ?? ''), mood: MOODS.includes(sp.mood) ? sp.mood : 'warm',
    palette, artStyle: String(sp.artStyle ?? st.brief), cast, locations, scenes, estSeconds: Math.round(total + 6.5),
  };
}

/** The screenplay as the models see it: no platform cards, no bookkeeping. */
function bare(sp) {
  const { title, logline, mood, palette, artStyle, cast, locations } = sp;
  const scenes = sp.scenes.map(sc => ({ id: sc.id, title: sc.title, location: sc.location, shots: sc.shots.filter(isStory).map(({ kind, ...sh }) => sh) })).filter(sc => sc.shots.length);
  return { title, logline, mood, palette, artStyle, cast, locations, scenes };
}

/** Story text and painter text must each be in their own language; a model that drifted gets this back as the error. */
function checkLanguage(sp, lang) {
  const shots = storyShots(sp);
  const spoken = [sp.title, ...sp.cast.map(c => c.name), ...sp.scenes.map(sc => sc.title), ...shots.map(sh => sh.narration)].join(' ');
  const share = arabicShare(spoken);
  if (lang === 'ar' && share < 0.6) throw new Error('the title, scene titles, character names and narration must be in Modern Standard Arabic (the narration language), not translated');
  if (lang !== 'ar' && share > 0.4) throw new Error(`the title, scene titles, character names and narration must be in ${LANG[lang] ?? lang}, not Arabic`);
  // painter text, field by field (an Arabic name inside an English sentence is fine)
  const painter = [['artStyle', sp.artStyle], ...sp.cast.map(c => [`cast:${c.id} look`, c.look]), ...sp.locations.map(l => [`location:${l.id} look`, l.look]),
    ...shots.flatMap(sh => [[`${sh.id} visual`, sh.visual], [`${sh.id} action`, sh.action], [`${sh.id} light`, sh.light]])];
  const wrong = painter.filter(([, v]) => arabicShare(v) > 0.5).map(([k]) => k);
  if (wrong.length) throw new Error(`${wrong.slice(0, 4).join(', ')}${wrong.length > 4 ? ` and ${wrong.length - 4} more` : ''}: "visual", "action", "light", "artStyle" and every "look" must be in English (they go to the image model)`);
}

// ------------------------------------------------------------------ the editing suite's measurements
const words = s => (String(s ?? '').trim().match(/\S+/g) ?? []).length;
const TIME_OF_DAY = /\b(dawn|sunrise|morning|noon|midday|afternoon|golden hour|sunset|dusk|twilight|evening|night|midnight|blue hour|daylight|daytime|moonlit|moonlight|starlight)\b/i;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text, c) => [c.name, c.id.replace(/-/g, ' ')].filter(n => n && n.length > 1).some(n => (/^[\x20-\x7e]+$/.test(n) ? new RegExp(`\\b${esc(n)}\\b`, 'i').test(text) : text.includes(n)));

/**
 * Facts a machine can count (the doctor gets them so it need not count words itself; the offline engine logs them):
 * narration density, repeated shot sizes, silent runs, missing lens/light/action, the bible's gaps.
 */
export function measure(sp, options) {
  const notes = [];
  const shots = sp.scenes.flatMap(sc => sc.shots.filter(isStory).map(sh => ({ ...sh, scene: sc.id })));
  let film = 0;
  shots.forEach((sh, i) => {
    const w = words(sh.narration), wps = w / sh.seconds;
    film += Math.max(sh.seconds, w / WPS + 0.6);
    if (w && wps > WPS * 1.4) notes.push(`${sh.id}: ${w} words ≈ ${(w / WPS).toFixed(1)} s of voice in a ${sh.seconds} s shot (${wps.toFixed(1)} words/s, aim ≈ ${WPS}) — the shot will stretch`);
    else if (w && wps < WPS * 0.45) notes.push(`${sh.id}: only ${w} words for a ${sh.seconds} s shot (${wps.toFixed(1)} words/s, aim ≈ ${WPS})`);
    const prev = shots[i - 1];
    if (prev && prev.scene === sh.scene && prev.shotType === sh.shotType) notes.push(`${prev.id} → ${sh.id}: two ${sh.shotType} shots in a row`);
    if (prev && !prev.narration && !sh.narration) notes.push(`${prev.id} → ${sh.id}: two silent shots in a row`);
    const miss = [!sh.action && 'action', !sh.lens && 'lens', !sh.light && 'light'].filter(Boolean);
    if (miss.length) notes.push(`${sh.id}: no ${miss.join(', ')}`);
    for (const c of sp.cast) if (!sh.cast.includes(c.id) && mentions(sh.visual, c)) notes.push(`${sh.id}: the visual shows ${c.name} but "cast" does not list "${c.id}"`);
  });
  for (const sc of sp.scenes) {
    const own = sc.shots.filter(isStory);
    if (own.length > 1 && !['establishing', 'wide'].includes(own[0].shotType)) notes.push(`scene ${sc.id} opens on a ${own[0].shotType} shot, not an establishing or wide one`);
  }
  for (const c of sp.cast) {
    const n = words(c.look);
    if (!n) notes.push(`cast:${c.id} has no look`);
    else if (n > 45) notes.push(`cast:${c.id} look is ${n} words (≤ 45)`);
  }
  for (const l of sp.locations) {
    if (!l.look) notes.push(`location:${l.id} has no look`);
    else if (!TIME_OF_DAY.test(l.look)) notes.push(`location:${l.id} look names no time of day`);
  }
  const target = Math.max(8, options.length - 6.5), moving = shots.filter(sh => sh.motion === 2).length;
  const off = Math.abs(film - target) > target * 0.25;
  const summary = `${shots.length} story shots; with this narration the story runs ≈ ${Math.round(film)} s against a target of ≈ ${Math.round(target)} s; image-to-video shots: ${moving}/${shots.length} (budget ${motionCap(shots.length)})`;
  if (off) notes.unshift(`length is off target: ≈ ${Math.round(film)} s of story for a target of ≈ ${Math.round(target)} s`);
  return { summary, notes };
}

// ------------------------------------------------------------------ the script doctor
const DOCTOR_SYSTEM = `You are a veteran film editor and script doctor. You have cut hundreds of films, and you read a shooting script the way you watch rushes: shot by shot, asking whether every cut works.
This film is made of painted keyframes: an SDXL image model paints each shot from its "visual", with the cast and location "look" strings pasted verbatim into every prompt; camera moves and parallax bring the stills to life, and shots marked "motion": 2 become short image-to-video clips. A text-to-speech voice reads the narration at about ${WPS} words per second, and the voice sets each shot's real length.

You do not rewrite the script: you give the director precise, actionable notes. Check, in this order:
1. FAITHFULNESS — every event, character and outcome comes from the story; nothing invented that changes the plot; no essential story beat missing; names exactly as the story spells them; the ending is the story's ending.
2. NARRATION — the narration language throughout (for Arabic: Modern Standard Arabic in a hakawati's voice, never dialect, the story's names and strongest phrases kept); about ${WPS} words per second of shot (use the measured numbers); it adds what the picture cannot show instead of describing the picture; no two silent shots in a row; it sounds good aloud.
3. MONTAGE GRAMMAR — each scene opens wide or establishing, then moves closer as emotion rises; no accidental repeated shot sizes; the 180° rule and screen direction (who is left/right, which way they travel) hold across cuts; inserts and reaction shots wherever tension or emotion needs them; shot lengths and transitions fit the mood (cuts inside a scene, fades for jumps in time or place); camera moves are motivated; the lens fits the shot size.
4. VISUAL SPECIFICITY — each "visual" is ONE frozen, paintable moment: concrete subject, pose, expression, position in the frame, props, setting, light; no sequences ("then…"), no abstraction without a visible cue, no readable text or signs; "action" says what moves; "motion": 2 only where the meaning depends on a character's movement, about 30% of the shots at most.
5. VISUAL BIBLE — each cast look is English, ≤ 45 words: age, ethnicity/skin tone, face shape, hair, eyes, clothing with colours, one signature detail; each location look names its time of day and light; every shot's "light" agrees with its location's time of day.
6. CONTINUITY — costumes, props and their state (a lantern lit or dark, which hand holds it), time of day, weather and positions stay consistent from shot to shot; every character visible in a "visual" is listed in that shot's "cast".
7. ENDING — the last shot resolves the story and echoes the opening image.

Do not nitpick: give only notes that would visibly or audibly improve the film. Be specific: name the shot, quote the words, say exactly what to change.
Answer with ONE JSON object only, no commentary, no code fence.`;

const AREAS = ['faithfulness', 'narration', 'montage', 'visual', 'bible', 'continuity', 'motion', 'ending'];
const SEVERITY = { high: 0, medium: 1, low: 2 };
const noteLine = x => `[${x.severity}] ${x.shot} (${x.area}): ${x.problem}`;

function cleanNotes(o) {
  const list = Array.isArray(o) ? o : o?.issues;
  if (!Array.isArray(list)) throw new Error('"issues" must be an array (empty when the script is ready to shoot)');
  const issues = list.filter(x => x && typeof x === 'object' && String(x.problem ?? '').trim()).map(x => ({
    shot: String(x.shot ?? 'film').slice(0, 40),
    area: AREAS.includes(x.area) ? x.area : 'montage',
    severity: Object.hasOwn(SEVERITY, x.severity) ? x.severity : 'medium',
    problem: String(x.problem).trim().slice(0, 700),
    fix: String(x.fix ?? '').trim().slice(0, 900),
  })).sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]).slice(0, 15);
  if (list.length && !issues.length) throw new Error('every issue needs a "problem" and a "fix"');
  return { verdict: String(o?.verdict ?? '').slice(0, 500), issues };
}

function doctorPrompt(p, sp, before) {
  const o = p.options, st = STYLES[o.style] ?? STYLES.cinematic, m = measure(sp, o);
  return `STORY (the only source of truth):
"""
${p.story.trim()}
"""

FILM: about ${o.length} s, frame ${o.aspect}, style "${st.label}", narration language: ${LANG[o.language] ?? o.language}${o.audience ? `, audience: ${o.audience}` : ''}${o.notes ? `\nPRODUCER NOTES: ${o.notes}` : ''}

MEASURED BY THE EDITING SUITE (exact — trust these numbers):
- ${m.summary}
${m.notes.map(n => `- ${n}`).join('\n') || '- nothing flagged'}
${before?.length ? `\nYOUR NOTES ON THE PREVIOUS DRAFT (check they were applied; repeat one only if it is still wrong):\n${before.map(x => `- ${noteLine(x)}`).join('\n')}\n` : ''}
SHOOTING SCRIPT (JSON; the platform adds the title and end cards):
${JSON.stringify(bare(sp))}

Review it and answer with ONE JSON object:
{"verdict": "one sentence", "issues": [{"shot": "s2-1 | s2 | cast:<id> | location:<id> | film", "area": one of ${JSON.stringify(AREAS)}, "severity": "high" | "medium" | "low", "problem": "what is wrong, concretely", "fix": "the exact change to make"}]}
At most 12 issues, the most important first. "issues": [] when the script is ready to shoot.`;
}

function revisePrompt(p, sp, notes) {
  return `${userPrompt(p)}

YOUR CURRENT SCREENPLAY:
${JSON.stringify(bare(sp))}

THE SCRIPT DOCTOR'S NOTES — apply every one:
${notes.issues.map((x, i) => `${i + 1}. ${noteLine(x)}${x.fix ? ` → FIX: ${x.fix}` : ''}`).join('\n')}

REVISION RULES: return the FULL corrected screenplay — every scene and every shot, the same JSON shape. Change only what the notes require; keep the cast and location ids, and keep every "look" word for word unless a note is about that look. Shot ids may be renumbered.`;
}

/** The director's own answer, checked: shape (normalizeScreenplay), languages, and for a revision, no lost shots. */
function askScreenplay(p, user, { purpose, before, signal, log }) {
  let chars = 0, last = 0;
  return askJSON({
    purpose, system: systemPrompt(), user, maxTokens: 24000, signal, log,
    onText: d => { chars += d.length; if (Date.now() - last > 4000) { last = Date.now(); log(t('directorWriting', { n: chars })); } },
    validate: obj => {
      const sp = normalizeScreenplay(obj, p.options);
      checkLanguage(sp, p.options.language);
      if (before) {
        const a = storyShots(before).length, b = storyShots(sp).length;
        if (b < Math.max(2, Math.floor(a * 0.6))) throw new Error(`the revision has ${b} shots where the screenplay had ${a} — return the FULL screenplay, every scene and every shot, not only the changed ones`);
      }
      return sp;
    },
  });
}

const stopped = (e, signal) => signal?.aborted || e?.cancelled;

export async function writeScreenplay(p, { signal, log = () => {} } = {}) {
  const { engine } = loadSettings();
  if (engine.protocol === 'mock') { // instant: no doctor, only the editing suite's measurements
    const sp = normalizeScreenplay(mockScreenplay(p), p.options);
    const m = measure(sp, p.options);
    log(t('doctorMock', { n: m.notes.length, top: m.notes.slice(0, 3).join(' · ') }));
    return sp;
  }
  const n = Number(engine.doctorPasses ?? 2), passes = Number.isFinite(n) ? clamp(Math.round(n), 0, 3) : 2;
  let sp = await askScreenplay(p, userPrompt(p), { purpose: 'director', signal, log });
  const rounds = [];
  let before = null;
  for (let pass = 1; pass <= passes; pass++) {
    checkAbort(signal);
    log(t('doctorStart', { pass, of: passes }));
    let notes;
    try {
      notes = await askJSON({ purpose: 'doctor', system: DOCTOR_SYSTEM, user: doctorPrompt(p, sp, before), maxTokens: 8000, temperature: 0.3, signal, log, validate: cleanNotes }); // a critic, not a writer: steady judgement
    } catch (e) {
      if (stopped(e, signal)) throw e;
      log(t('doctorFail', { e: e.message }));
      break;
    }
    rounds.push({ pass, issues: notes.issues.length, top: notes.issues.slice(0, 3).map(noteLine), verdict: notes.verdict });
    log(t('doctorIssues', { pass, n: notes.issues.length }));
    for (const x of notes.issues.slice(0, 3)) log(t('doctorNote', { text: noteLine(x).slice(0, 220) }));
    if (!notes.issues.length) { log(t('doctorClean')); break; }
    log(t('doctorRevising'));
    try {
      sp = await askScreenplay(p, revisePrompt(p, sp, notes), { purpose: 'revise', before: sp, signal, log });
    } catch (e) {
      if (stopped(e, signal)) throw e;
      log(t('reviseFail', { e: e.message }));
      break;
    }
    before = notes.issues;
    log(t('doctorRevised', { scenes: sp.scenes.length, shots: storyShots(sp).length, sec: sp.estSeconds }));
  }
  if (rounds.length) sp.doctor = rounds;
  return sp;
}
