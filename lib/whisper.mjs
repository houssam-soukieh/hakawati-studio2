// «الهمس» — the private language of the hidden beings (docs/pilot/bible.md §6). Humans in the scene hear only fan
// hum; the viewer READS each line as a coloured subtitle (player.html) and HEARS an unintelligible whisper texture
// under the narration. Shared by the director (whisper lines in a story), the offline engine, the timeline, the voice
// step and the assembler.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { STUDIO, hash, durationOf, killTree, checkAbort, track } from './util.mjs';
import { synth, speakable } from './voice.mjs';
import { t, addMessages } from './i18n.mjs';

addMessages({
  whisperStart: { en: v => `🫧 The beings whisper: ${v.n} line${v.n === 1 ? '' : 's'} in their private language…`, ar: v => `🫧 همس الكائنات: ${v.n} سطراً بلغتها الخاصة…` },
  stWhisper: { en: v => `Whisper ${v.i}/${v.n}`, ar: v => `الهمس ${v.i}/${v.n}` },
  whisperDone: { en: v => `   ✓ ${v.n} whisper clip${v.n === 1 ? '' : 's'} ready (${v.made} new)`, ar: v => `   ✓ ${v.n} مقطع همس جاهز (${v.made} جديد)` },
  whisperOff: { en: '🫧 Whisper sound is off (Settings → voice) — the whisper lines stay on screen as subtitles', ar: '🫧 صوت الهمس معطّل (الإعدادات ← الصوت) — تبقى أسطر الهمس ترجمةً على الشاشة' },
  whisperMix: { en: v => `   🫧 ${v.n} whisper clip${v.n === 1 ? '' : 's'} under the narration (${v.gain} dB)`, ar: v => `   🫧 ${v.n} مقطع همس تحت صوت الراوي (${v.gain} dB)` },
  whisperFail: { en: v => `whisper processing (ffmpeg): ${v.e}`, ar: v => `معالجة الهمس (ffmpeg): ${v.e}` },
});

/** Glyph dialects of the private language (bible §6): each house draws its burst differently. */
export const GLYPHS = ['arcs', 'rings', 'curls', 'dots', 'squares', 'mirror', 'echo'];
/**
 * Bible §4 colours with their glyph dialect, in the pilot's order of appearance (watch, fridge, the Eye, Orion, the
 * Broker, …): a being with no colour of its own takes the next one, so the offline engine gives the pilot its canon.
 */
export const BEING_STYLES = [
  { color: '#b8f25c', glyph: 'dots' }, { color: '#cdebff', glyph: 'dots' }, { color: '#eaf2ff', glyph: 'rings' },
  { color: '#4fd1e8', glyph: 'arcs' }, { color: '#e8a74f', glyph: 'curls' }, { color: '#8b5cf6', glyph: 'squares' },
  { color: '#5ee6a8', glyph: 'mirror' }, { color: '#ff9f43', glyph: 'echo' },
];
export const NO_SPEAKER = { name: '', color: '#d6dde8', glyph: 'dots' };
export const HEX = /^#[0-9a-f]{6}$/i;

// ------------------------------------------------------------------ whisper lines in a text
/** «Speaker: line» — guillemets, a short name, a colon. */
export const WHISPER_LINE = /«\s*([^«»:\n]{1,32}?)\s*:\s*([^«»]+?)\s*»/g;
export function whisperLines(text) {
  return [...String(text ?? '').matchAll(WHISPER_LINE)].map(m => ({ name: m[1].trim(), text: m[2].trim(), index: m.index, length: m[0].length }));
}
/** Names compare without tashkīl, tatweel and the usual hamza / tā' marbūṭa spellings ("الثلّاجة" = "الثلاجة"). */
export const nameKey = s => String(s ?? '').normalize('NFC').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
/** Who is speaking: a cast id, or a cast member's name as the story spells it; '' when nobody in the cast. */
export function speakerOf(cast, who) {
  const k = nameKey(who);
  if (!k) return '';
  return (cast ?? []).find(c => c.id === who || nameKey(c.id) === k || nameKey(c.name) === k)?.id ?? '';
}

/** How a speaker's lines look: the being's colour and glyph dialect, a fallback for anyone else. */
export function whisperStyle(cast, speaker) {
  const c = (cast ?? []).find(x => x.id === speaker);
  if (!c) return NO_SPEAKER;
  const bi = (cast ?? []).filter(x => x.kind === 'being').indexOf(c), def = BEING_STYLES[Math.max(0, bi) % BEING_STYLES.length];
  return { name: c.name ?? '', color: HEX.test(c.color ?? '') ? c.color.toLowerCase() : c.kind === 'being' ? def.color : NO_SPEAKER.color, glyph: GLYPHS.includes(c.glyph) ? c.glyph : def.glyph };
}

// ------------------------------------------------------------------ the sound
// Each being has its own edge-tts voice and pitch (by its place in the cast, so it is stable across the film), never the
// narrator's. The processing makes it a texture: what matters is that it sounds like someone whispering, not what is said.
const POOL = {
  ar: ['ar-SY-AmanyNeural', 'ar-LB-RamiNeural', 'ar-EG-SalmaNeural', 'ar-JO-TaimNeural', 'ar-SA-ZariyahNeural'],
  en: ['en-US-AriaNeural', 'en-GB-RyanNeural', 'en-US-JennyNeural', 'en-AU-WilliamNeural', 'en-GB-SoniaNeural'],
  fr: ['fr-FR-DeniseNeural', 'fr-FR-HenriNeural', 'fr-CA-SylvieNeural', 'fr-CA-JeanNeural', 'fr-FR-EloiseNeural'],
};
const PITCH = ['+0Hz', '-16Hz', '+18Hz', '-8Hz', '+28Hz', '-24Hz']; // 6 pitches × 5 voices: 30 distinct beings
const PAN = [0.3, -0.3, 0.16, -0.16, 0.42, -0.42, 0]; // slight: the whisper comes from around the frame, not from a side
export function whisperVoice(sp, speaker, lang) {
  const pool = POOL[lang] ?? POOL.en, i = (sp?.cast ?? []).findIndex(c => c.id === speaker);
  if (i < 0) return { name: pool[0], pitch: '-30Hz', rate: '+8%', pan: 0 };
  return { name: pool[i % pool.length], pitch: PITCH[i % PITCH.length], rate: '+8%', pan: PAN[i % PAN.length] };
}

export const WHISPER_FX = 'whisper-fx-1'; // bump when the processing changes: every clip is remade
export const whisperKey = (text, v) => hash(WHISPER_FX, speakable(text), v.name, v.pitch, v.rate);

const SR = 24000;
const GRAIN = 0.17; // local time reversal beyond ~130 ms windows leaves speech unintelligible; the rhythm survives
/** ffmpeg as a pipe: raw float PCM in (or a file), raw float PCM / a file out. One line takes a second or two: after
 *  `timeout` ms it is killed and fails (never a silent hang). */
function ff(args, input, signal, timeout = 180e3) {
  return new Promise((resolve, reject) => {
    const ch = spawn('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'], windowsHide: true });
    const w = track('ffmpeg (whisper)');
    const out = [];
    let err = '', late = false;
    ch.stdout.on('data', d => { out.push(d); w.touch(); });
    ch.stderr.on('data', d => { err += d; });
    const kill = () => killTree(ch);
    const tm = setTimeout(() => { late = true; kill(); }, timeout);
    signal?.addEventListener('abort', kill, { once: true });
    ch.on('error', e => { clearTimeout(tm); w.done(); reject(new Error(t('whisperFail', { e: e.message }))); });
    ch.on('close', code => {
      clearTimeout(tm); w.done();
      signal?.removeEventListener('abort', kill);
      try { checkAbort(signal); } catch (e) { return reject(e); }
      if (late) return reject(new Error(t('whisperFail', { e: `ffmpeg did not finish in ${Math.round(timeout / 1000)} s` })));
      code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(t('whisperFail', { e: err.trim().slice(-300) || `exit ${code}` })));
    });
    if (input) { ch.stdin.on('error', () => {}); ch.stdin.end(Buffer.from(input.buffer, input.byteOffset, input.byteLength)); }
  });
}
const PCM = ['-f', 'f32le', '-ar', String(SR), '-ac', '1'];
const floats = b => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.length & ~3)));
const mulberry = seed => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };

/**
 * Speech → whisper texture. Two layers from the same line: (1) the speech cut into 170 ms grains, each played
 * backwards in place (Hann overlap-add), so syllables keep their place and pitch but no word survives; (2) breath —
 * seeded noise that follows the speech's loudness envelope, the unvoiced "tss" of a whisper.
 */
export function texture(x, seed) {
  const n = x.length, G = Math.round(GRAIN * SR), H = G >> 1, out = new Float32Array(n);
  const w = Float32Array.from({ length: G }, (_, j) => 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / G)); // periodic Hann: sums to 1 at 50% overlap
  for (let k = -H; k < n; k += H) for (let j = 0; j < G; j++) {
    const d = k + j, s = k + G - 1 - j;
    if (d >= 0 && d < n && s >= 0 && s < n) out[d] += x[s] * w[j];
  }
  const rnd = mulberry(seed), att = Math.exp(-1 / (0.004 * SR)), rel = Math.exp(-1 / (0.06 * SR));
  let env = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(x[i]);
    env = a > env ? att * env + (1 - att) * a : rel * env + (1 - rel) * a;
    out[i] = 0.55 * out[i] + 1.7 * env * (rnd() * 2 - 1);
  }
  return out;
}
// band-pass (no chest, no lows: a whisper), then the beings' shimmer — chorus, flanger and a short echo; the pad gives the echo room
const FX = 'apad=pad_dur=0.35,highpass=f=600,highpass=f=600,lowpass=f=4800,lowpass=f=4800,chorus=0.6:0.9:38|61:0.42|0.33:0.31|0.47:1.8|2.4,flanger=delay=1.5:depth=2.5:speed=0.33,aecho=0.75:0.55:70|140:0.28|0.16';
const TARGET_RMS = 0.1; // −20 dBFS, about where edge-tts speech sits; the mix puts it `voice.whisper.gain` dB under the voice
function level(y) {
  let s = 0, m = 0, peak = 0;
  for (const v of y) { const a = Math.abs(v); if (a > 1e-4) { s += v * v; m++; } if (a > peak) peak = a; }
  const rms = m ? Math.sqrt(s / m) : 0, g = rms ? Math.min(TARGET_RMS / rms, 0.89 / peak) : 0;
  const fin = Math.round(0.015 * SR), fout = Math.round(0.12 * SR);
  for (let i = 0; i < y.length; i++) y[i] *= g * Math.min(1, i / fin, (y.length - 1 - i) / fout);
  return y;
}

export const WHISPER_RATE = SR;
/** Speech (mono float PCM at WHISPER_RATE) → the finished whisper texture: grains + breath, band-pass and shimmer, level. */
export async function processWhisper(speech, seed, signal) {
  return level(floats(await ff([...PCM, '-i', 'pipe:0', '-af', FX, ...PCM, 'pipe:1'], texture(speech, seed), signal)));
}

/**
 * The narration's level (dB RMS over the voiced samples, as `level()` measures a whisper) from up to 6 of its clips:
 * the mix sets the whispers `voice.whisper.gain` dB under THIS, whatever level the TTS voice comes at.
 */
export async function speechLevel(files, signal) {
  const pick = files.length <= 6 ? files : Array.from({ length: 6 }, (_, i) => files[Math.floor((i * files.length) / 6)]);
  let s = 0, m = 0;
  for (const f of pick) for (const v of floats(await ff(['-i', f, ...PCM, 'pipe:1'], null, signal))) if (Math.abs(v) > 1e-4) { s += v * v; m++; }
  return m ? 10 * Math.log10(s / m) : null;
}
export const WHISPER_DB = 20 * Math.log10(TARGET_RMS);

/** One whisper line → an mp3 at `out` (cached in .studio/voice-cache by text + voice + processing version). Returns its seconds. */
export async function makeWhisper(text, v, out, signal) {
  const dir = path.join(STUDIO, 'voice-cache'), key = whisperKey(text, v), cached = path.join(dir, `w-${key}.mp3`);
  if (!fs.existsSync(cached) || fs.statSync(cached).size === 0) {
    fs.mkdirSync(dir, { recursive: true });
    const raw = path.join(dir, `w-${key}.tts.mp3`), tmp = path.join(dir, `w-${key}.part.mp3`);
    try {
      await synth(speakable(text), v, raw, signal); // the TTS line itself is cached by synth()
      const speech = floats(await ff(['-i', raw, ...PCM, 'pipe:1'], null, signal));
      const wet = await processWhisper(speech, parseInt(key.slice(0, 8), 16), signal);
      await ff([...PCM, '-i', 'pipe:0', '-c:a', 'libmp3lame', '-q:a', '4', tmp], wet, signal);
      fs.renameSync(tmp, cached);
    } finally { fs.rmSync(raw, { force: true }); fs.rmSync(tmp, { force: true }); }
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(cached, out);
  return durationOf(out);
}
