// Messages the user reads (job log, progress, errors) in the Studio's language: English by default, Arabic from
// Settings. Story content (narration, titles) follows the story's own language, never this one.
import path from 'node:path';
import { STUDIO, readJSON } from './util.mjs';

export const UI_LANGS = ['en', 'ar'];
let cur = null;
export const uiLang = () => (cur ??= (l => (UI_LANGS.includes(l) ? l : 'en'))(readJSON(path.join(STUDIO, 'settings.json'), {})?.ui?.lang));
export const setUiLang = l => { cur = UI_LANGS.includes(l) ? l : 'en'; };

const M = {
  // jobs
  queued: { en: 'Queued', ar: 'في الانتظار' },
  done: { en: 'Done', ar: 'تم' },
  stopped: { en: '⏹ Job stopped', ar: '⏹ أُوقفت المهمة' },
  makeFilm: { en: 'Make the film', ar: 'صناعة الفيلم' },
  writeStoryFirst: { en: 'Write the story first', ar: 'اكتب القصة أولاً' },
  // pipeline
  needScript: { en: 'Write the screenplay first (step 1)', ar: 'اكتب السيناريو أولاً (الخطوة ١)' },
  scriptStart: { en: '🎬 The director is reading the story and cutting it into scenes and shots…', ar: '🎬 المخرج يقرأ القصة ويقطّعها إلى مشاهد ولقطات…' },
  stScript: { en: 'Screenplay', ar: 'السيناريو' },
  scriptDone: { en: v => `✅ “${v.title}”: ${v.scenes} scenes, ${v.shots} shots, ${v.cast} characters — about ${v.sec} s`, ar: v => `✅ «${v.title}»: ${v.scenes} مشاهد، ${v.shots} لقطة، ${v.cast} شخصيات — نحو ${v.sec} ث` },
  directorWriting: { en: v => `   ✍ The director is writing… ${v.n} characters`, ar: v => `   ✍ المخرج يكتب… ${v.n} حرفاً` },
  voiceStart: { en: v => `🎙 The narrator (${v.voice}) is recording ${v.n} lines…`, ar: v => `🎙 الراوي (${v.voice}) يسجّل ${v.n} مقطعاً…` },
  stVoice: { en: v => `Voice ${v.i}/${v.n}`, ar: v => `الصوت ${v.i}/${v.n}` },
  voiceDone: { en: v => `✅ Voice ready — the film runs ${v.sec} s`, ar: v => `✅ الصوت جاهز — طول الفيلم ${v.sec} ث` },
  castOff: { en: '👥 No character library (turned off, or no characters)', ar: '👥 بلا مكتبة شخصيات (معطّلة أو لا شخصيات)' },
  castKept: { en: '👥 Character library is up to date — no change', ar: '👥 مكتبة الشخصيات محفوظة — لا تغيير' },
  castStart: { en: v => `👥 The character designer is drawing: ${v.names}…`, ar: v => `👥 مصمّم الشخصيات يرسم: ${v.names}…` },
  stCast: { en: 'Characters', ar: 'الشخصيات' },
  castDone: { en: v => `✅ Character library ready${v.notes ? ` (notes: ${v.notes})` : ''}`, ar: v => `✅ مكتبة الشخصيات جاهزة${v.notes ? ` (ملاحظات: ${v.notes})` : ''}` },
  castRetry: { en: v => `   ↺ Character library incomplete (${v.issue}) — asking for a fix`, ar: v => `   ↺ مكتبة الشخصيات ناقصة (${v.issue}) — أطلب تصحيحها` },
  castFail: { en: v => `Could not draw the characters: ${v.issues}`, ar: v => `تعذّر رسم الشخصيات: ${v.issues}` },
  artStart: { en: v => `🎨 The artists are drawing ${v.n} shots (${v.conc} at a time)…`, ar: v => `🎨 الرسّامون يعملون على ${v.n} لقطة (${v.conc} في وقت واحد)…` },
  artShot: { en: v => `   🖌 ${v.id} (${v.type}, ${v.sec} s)${v.note ? ` — note: ${v.note}` : ''}`, ar: v => `   🖌 ${v.id} (${v.type}، ${v.sec} ث)${v.note ? ` — ملاحظة: ${v.note}` : ''}` },
  artShotDone: { en: v => `   ${v.left ? '⚠' : '✓'} ${v.id} ready (${v.rounds} round${v.rounds === 1 ? '' : 's'}${v.left ? ` — still: ${v.left}` : ''})`, ar: v => `   ${v.left ? '⚠' : '✓'} ${v.id} جاهزة (${v.rounds} جولة${v.left ? ` — باقٍ: ${v.left}` : ''})` },
  artWriting: { en: v => `   ✍ ${v.id}: ${v.n} characters…`, ar: v => `   ✍ ${v.id}: ${v.n} حرفاً…` },
  artRetry: { en: v => `   ↺ ${v.id} (round ${v.round}): ${v.problems}`, ar: v => `   ↺ ${v.id} (جولة ${v.round}): ${v.problems}` },
  artFail: { en: v => `${v.id}: the engine produced no usable SVG — ${v.problems}`, ar: v => `${v.id}: لم يُنتج المحرك SVG صالحاً — ${v.problems}` },
  stArt: { en: v => `Drawing ${v.i}/${v.n}`, ar: v => `الرسم ${v.i}/${v.n}` },
  artDone: { en: '✅ Art ready', ar: '✅ الرسوم جاهزة' },
  noArt: { en: v => `Shots without art: ${v.ids} — run the drawing step`, ar: v => `لقطات بلا رسم: ${v.ids} — شغّل خطوة الرسم` },
  renderStart: { en: v => `🎞 Filming ${v.n} shots frame by frame (${v.quality}, ${v.fps} fps)…`, ar: v => `🎞 تصوير ${v.n} لقطة إطاراً بإطار (${v.quality}، ${v.fps} إطاراً/ث)…` },
  stRender: { en: v => `Filming ${v.id}`, ar: v => `تصوير ${v.id}` },
  renderShot: { en: v => `   🎥 ${v.id}: ${v.frames} frames in ${v.sec} s${v.err ? ` ⚠ ${v.err}` : ''}`, ar: v => `   🎥 ${v.id}: ${v.frames} إطاراً في ${v.sec} ث${v.err ? ` ⚠ ${v.err}` : ''}` },
  renderDone: { en: '✅ Every shot is filmed', ar: '✅ كل اللقطات مصوّرة' },
  notRendered: { en: v => `Shot ${v.id} is not filmed — run the filming step`, ar: v => `اللقطة ${v.id} غير مصوّرة — شغّل خطوة التصوير` },
  lengthChanged: { en: v => `Shot ${v.id} changed length — film it again`, ar: v => `طول اللقطة ${v.id} تغيّر — أعد التصوير` },
  music: { en: v => `🎼 Background score, mood “${v.mood}”…`, ar: v => `🎼 موسيقى خلفية بمزاج «${v.mood}»…` },
  stAssemble: { en: 'Editing', ar: 'المونتاج' },
  assembling: { en: v => `   🎚 Cutting ${v.clips} shots, ${v.voices} voice clips${v.music ? ', score' : ''} — ${v.sec} s`, ar: v => `   🎚 مونتاج ${v.clips} لقطة، ${v.voices} مقطع صوت${v.music ? '، موسيقى' : ''} — ${v.sec} ث` },
  filmDone: { en: v => `🏁 The film is ready: ${v.sec} s, ${v.mb} MB`, ar: v => `🏁 الفيلم جاهز: ${v.sec} ث، ${v.mb} MB` },
  // engine
  noBase: { en: 'No engine address (Base URL) in Settings', ar: 'لم يُحدَّد عنوان المحرك (Base URL) في الإعدادات' },
  noKey: { en: 'No API key in Settings', ar: 'لا يوجد مفتاح API في الإعدادات' },
  engineError: { en: v => `Engine error: ${v.e}`, ar: v => `خطأ من المحرك: ${v.e}` },
  timeout: { en: 'Timed out (12 minutes) without an answer', ar: 'انتهت المهلة (12 دقيقة) دون جواب' },
  connect: { en: v => `Could not connect: ${v.e}`, ar: v => `تعذّر الاتصال: ${v.e}` },
  cutOff: { en: 'The answer was cut off before it finished (token limit)', ar: 'انقطع الجواب قبل اكتماله (حدّ الرموز)' },
  refusal: { en: 'The model refused the request', ar: 'رفض النموذج الطلب' },
  empty: { en: 'Empty answer from the engine', ar: 'جواب فارغ من المحرك' },
  retrying: { en: v => `   ⚠ ${v.e} — retry ${v.n}/3`, ar: v => `   ⚠ ${v.e} — إعادة المحاولة ${v.n}/3` },
  notJson: { en: 'The answer is not valid JSON', ar: 'الجواب ليس JSON صالحاً' },
  jsonFail: { en: v => `The engine gave no valid JSON after 3 tries: ${v.e}`, ar: v => `لم يعطِ المحرك JSON صالحاً بعد 3 محاولات: ${v.e}` },
  jsonRetry: { en: v => `   ↺ The answer did not match the shape asked for (${v.e}) — asking for a fix`, ar: v => `   ↺ الجواب لم يطابق المطلوب (${v.e}) — أطلب تصحيحه` },
  mockReady: { en: 'The local generator is ready (no key needed).', ar: 'المولّد المحلي جاهز (لا يحتاج مفتاحاً).' },
  readyWord: { en: 'Ready ✓', ar: 'جاهز ✓' },
  // tools
  chrome: { en: v => `Could not start Chrome: ${v.e}`, ar: v => `تعذّر تشغيل Chrome: ${v.e}` },
  edgeTts: { en: v => `edge-tts: ${v.e} (is the internet on? is edge-tts installed: pip install edge-tts)`, ar: v => `edge-tts: ${v.e} (هل الإنترنت متصل؟ هل edge-tts مثبّت: pip install edge-tts)` },
  untitled: { en: 'Untitled story', ar: 'قصة بلا عنوان' },
  // pictures (ComfyUI)
  comfyDown: { en: v => `ComfyUI is not answering at ${v.url} (${v.e}) — start ComfyUI, or turn pictures off in Settings`, ar: v => `ComfyUI لا يجيب على ${v.url} (${v.e}) — شغّل ComfyUI أو أوقف الصور من الإعدادات` },
  noCheckpoint: { en: 'No image checkpoint chosen in Settings → Pictures', ar: 'لم يُختر نموذج الصور في الإعدادات ← الصور' },
  noIpAdapter: { en: '   ⚠ IP-Adapter nodes are not installed in ComfyUI — painting without the character reference', ar: '   ⚠ عُقد IP-Adapter غير مثبتة في ComfyUI — الرسم بلا صورة مرجعية للشخصية' },
  comfyTimeout: { en: 'ComfyUI did not finish the picture in 15 minutes', ar: 'لم ينهِ ComfyUI الصورة خلال 15 دقيقة' },
  painted: { en: v => `   🖼 ${v.label}: ${v.w}×${v.h} painted in ${v.sec} s`, ar: v => `   🖼 ${v.label}: ${v.w}×${v.h} رُسمت في ${v.sec} ث` },
  castPortraits: { en: v => `👥 Painting a reference portrait for each character: ${v.names}…`, ar: v => `👥 رسم صورة مرجعية لكل شخصية: ${v.names}…` },
  castPortraitsDone: { en: '✅ Character portraits ready', ar: '✅ صور الشخصيات جاهزة' },
  picStart: { en: v => `🖼 Painting ${v.n} keyframes with ComfyUI…`, ar: v => `🖼 رسم ${v.n} صورة أساسية عبر ComfyUI…` },
  picPrompt: { en: v => `   ✎ ${v.id}: ${v.prompt}`, ar: v => `   ✎ ${v.id}: ${v.prompt}` },
};

/** A module adds its own messages: addMessages({ key: { en, ar } }) (a string, or a function of the vars). */
export function addMessages(more) { Object.assign(M, more); }

/** t('voiceDone', { sec: 30 }) → the message in the Studio's language. */
export function t(key, vars = {}) {
  const m = M[key];
  if (!m) return key;
  const v = m[uiLang()] ?? m.en;
  return typeof v === 'function' ? v(vars) : v;
}
