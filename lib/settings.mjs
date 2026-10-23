// .studio/settings.json — the AI engine (any provider), voice and render defaults.
// The key never leaves this machine except to the engine's own base URL; the browser only ever sees it masked.
import path from 'node:path';
import { STUDIO, readJSON, writeJSON } from './util.mjs';
import { setUiLang } from './i18n.mjs';

const FILE = path.join(STUDIO, 'settings.json');

/** Ready-made engines. protocol 'openai' = POST {baseURL}/chat/completions; 'anthropic' = POST {baseURL}/v1/messages. */
export const PRESETS = {
  codecraft: { label: 'CodeCraft (gateway)', labelAr: 'CodeCraft (بوابة)', protocol: 'anthropic', baseURL: 'https://codecraftapi.com', model: 'claude-opus-5.5' },
  'codecraft-openai': { label: 'CodeCraft (OpenAI format)', labelAr: 'CodeCraft (صيغة OpenAI)', protocol: 'openai', baseURL: 'https://codecraftapi.com/v1', model: 'gpt-5.5' },
  openai: { label: 'OpenAI', protocol: 'openai', baseURL: 'https://api.openai.com/v1', model: 'gpt-5.5' },
  openrouter: { label: 'OpenRouter', protocol: 'openai', baseURL: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-opus-5.5' },
  gemini: { label: 'Google Gemini', protocol: 'openai', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.1-pro' },
  deepseek: { label: 'DeepSeek', protocol: 'openai', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  anthropic: { label: 'Anthropic (official Claude)', labelAr: 'Anthropic (Claude الرسمي)', protocol: 'anthropic', baseURL: 'https://api.anthropic.com', model: 'claude-opus-5-5' },
  freellmapi: { label: 'FreeLLMAPI (local router)', labelAr: 'FreeLLMAPI (موجّه محلي)', protocol: 'openai', baseURL: 'http://127.0.0.1:31415/v1', model: 'auto:smart' },
  lmstudio: { label: 'LM Studio (local)', labelAr: 'LM Studio (محلي)', protocol: 'openai', baseURL: 'http://127.0.0.1:1234/v1', model: '' },
  custom: { label: 'Custom', labelAr: 'مخصّص', protocol: 'openai', baseURL: '', model: '' },
  mock: { label: 'Offline test (local generator, no key)', labelAr: 'تجريبي بلا مفتاح (مولّد محلي)', protocol: 'mock', baseURL: '', model: 'mock' },
};

/** Weight types of the IPAdapter node (cubiq/ComfyUI_IPAdapter_plus, IPAdapterSimple). */
export const IP_WEIGHT_TYPES = ['standard', 'prompt is more important', 'style transfer'];
/** What no picture may show, whatever the Negative field says: paint() adds the terms of it the field lacks. */
export const SAFE_NEGATIVE = 'nsfw, nude, nudity, topless, cleavage, lingerie, sexualized';
const OLD_NEGATIVE = 'text, letters, words, caption, watermark, logo, signature, frame, blurry, lowres, jpeg artifacts, deformed, disfigured, extra fingers, bad hands, bad anatomy, cross-eyed, cartoon, 3d render, plastic skin';

/** A comma-separated term list plus the terms of `more` it lacks (case-insensitive); `base` itself is kept as written. */
export function withTerms(base, ...more) {
  const out = String(base ?? '').trim().replace(/[\s,]+$/, '');
  const have = new Set(out.split(',').map(x => x.trim().toLowerCase()).filter(Boolean));
  const add = more.flatMap(m => String(m ?? '').split(',')).map(x => x.trim()).filter(x => x && !have.has(x.toLowerCase()) && have.add(x.toLowerCase()));
  return [out, ...add].filter(Boolean).join(', ');
}

export const DEFAULTS = {
  // concurrency: engine calls in flight at once (calls with pictures: always one at a time). Time limits per call
  // (lib/llm.mjs): idleSeconds without a byte once the answer started (0 = off), firstByteSeconds for it to start,
  // callMinutes in all. watchdogMinutes: a job silent this long says what it waits on (lib/jobs.mjs; 0 = off).
  // fallback: null, or a second engine { preset, protocol, baseURL, model, apiKey } that takes a call over when this one
  // keeps failing (empty answers, 429/5xx, stalls, no connection) — e.g. FreeLLMAPI's local router; a key is optional
  // for a server on this PC. chain: further engines tried in order after fallback gives up too (same shape each), e.g.
  // an optional LM Studio behind FreeLLMAPI. A call with pictures skips any engine that cannot see.
  engine: { preset: 'mock', protocol: 'mock', baseURL: '', model: 'mock', artModel: '', apiKey: '', temperature: 0.8, concurrency: 2, doctorPasses: 2,
    idleSeconds: 90, firstByteSeconds: 300, callMinutes: 12, watchdogMinutes: 20, fallback: null, chain: [] },
  // whisper: the beings' private language (lib/whisper.mjs) — an unintelligible texture `gain` dB under the narration
  voice: { ar: 'ar-SY-LaithNeural', en: 'en-US-AndrewMultilingualNeural', fr: 'fr-FR-RemyMultilingualNeural', rate: '-4%', pitch: '+0Hz', whisper: { enabled: true, gain: -14 } },
  render: { fps: 30, quality: '720p' },
  ui: { lang: 'en' },
  // Pictures from a local ComfyUI (SDXL). Defaults suit RealVisXL / Juggernaut XL "Lightning" checkpoints.
  image: {
    engine: 'comfyui', url: 'http://127.0.0.1:8188', checkpoint: '', steps: 6, cfg: 2, sampler: 'dpmpp_sde', scheduler: 'karras',
    negative: `${OLD_NEGATIVE}, ${SAFE_NEGATIVE}`,
    // IP-Adapter: how strongly a shot follows its character's reference portrait. 'prompt is more important' takes the
    // face from the reference and leaves pose, framing and light to the shot's own prompt (IP_WEIGHT_TYPES)
    ipadapter: false, ipWeight: 0.55, ipWeightType: 'prompt is more important',
    // best-of-N: paint `candidates` per shot, a vision-capable text engine scores them (critic) and the best wins;
    // under `minScore` it rewrites the prompt and paints again, up to `maxRounds` rounds in all
    candidates: 2, critic: true, minScore: 7, maxRounds: 2,
    upscaler: '', // a file in ComfyUI/models/upscale_models (e.g. 4x-UltraSharp.pth): pictures are enlarged for 1080p
  },
  // Motion on the same ComfyUI (lib/video.mjs): depth maps for 2.5D parallax, and image-to-video clips (engine 'wan22' =
  // Wan 2.2 TI2V-5B; 'none' = parallax only) for every story shot (coverage 'all') or only shots marked motion: 2
  // ('marked'). A clip always covers its whole shot: one Wan run is at most `seconds` (≤ 5 s = 121 frames at 24 fps);
  // a longer shot is time-stretched up to `maxStretch`×, beyond that chained. `upscale` enlarges every clip to the
  // film's size with `upscaler` ('' = 4x-UltraSharp or the picture upscaler; 'lanczos' = ffmpeg only).
  // Model files as named in ComfyUI.
  video: { engine: 'none', coverage: 'all', upscale: true, upscaler: '', maxStretch: 1.6, unet: 'wan2.2_ti2v_5B_fp16.safetensors', clip: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', vae: 'wan2.2_vae.safetensors', steps: 20, cfg: 5, fps: 24, seconds: 3, depth: true, v: 2 },
};

export function loadSettings() {
  const s = readJSON(FILE, {});
  // nested, so a file saved before it existed keeps the defaults; a form may send strings
  const w = { ...DEFAULTS.voice.whisper, ...s.voice?.whisper }, gain = Number(w.gain);
  const whisper = { ...w, enabled: w.enabled !== false && w.enabled !== 'false', gain: Number.isFinite(gain) && w.gain !== '' ? Math.min(0, Math.max(-40, gain)) : DEFAULTS.voice.whisper.gain };
  const image = { ...DEFAULTS.image, ...s.image };
  // a file saved before ipWeightType existed holds the defaults of that time word for word: they move to today's
  if (s.image && s.image.ipWeightType === undefined) {
    if (Number(s.image.ipWeight) === 0.7) image.ipWeight = DEFAULTS.image.ipWeight;
    if (String(s.image.negative ?? '').trim() === OLD_NEGATIVE) image.negative = DEFAULTS.image.negative;
  }
  if (!IP_WEIGHT_TYPES.includes(image.ipWeightType)) image.ipWeightType = DEFAULTS.image.ipWeightType;
  // video v2 (2026-10-23): one Wan run is 3 s (73 frames) by default — the owner's tests on the 3060 Ti: 2–3 s runs are
  // clean, 8 s single runs fall apart; a file that still holds the old default (5 s) moves to the new one
  const video = { ...DEFAULTS.video, ...s.video };
  if (s.video && s.video.v === undefined && Number(s.video.seconds) === 5) video.seconds = DEFAULTS.video.seconds;
  video.v = DEFAULTS.video.v;
  return { engine: { ...DEFAULTS.engine, ...s.engine }, voice: { ...DEFAULTS.voice, ...s.voice, whisper }, render: { ...DEFAULTS.render, ...s.render }, ui: { ...DEFAULTS.ui, ...s.ui }, image, video };
}

/** A saved extra engine (fallback or a chain member): a masked/empty key from the form keeps the old one, but only
 *  when it was saved for the SAME address (never sent to a new server); hasKey is display-only. */
function mergeExtraEngine(patched, old) {
  if (!patched || typeof patched !== 'object') return null;
  const { hasKey, ...rest } = patched;
  const keep = (!rest.apiKey || /•/.test(rest.apiKey)) && old?.apiKey && String(old.baseURL ?? '').replace(/\/+$/, '') === String(rest.baseURL ?? '').replace(/\/+$/, '');
  return { ...rest, apiKey: keep ? old.apiKey : /•/.test(rest.apiKey ?? '') ? '' : String(rest.apiKey ?? '') };
}

export function saveSettings(patch) {
  const cur = loadSettings();
  const next = {
    engine: { ...cur.engine, ...patch.engine },
    voice: { ...cur.voice, ...patch.voice, whisper: { ...cur.voice.whisper, ...patch.voice?.whisper } },
    render: { ...cur.render, ...patch.render },
    ui: { ...cur.ui, ...patch.ui },
    image: { ...cur.image, ...patch.image },
    video: { ...cur.video, ...patch.video },
  };
  // an empty or masked key from the form means "keep the saved one"
  if (patch.engine && (!patch.engine.apiKey || /•/.test(patch.engine.apiKey))) next.engine.apiKey = cur.engine.apiKey;
  if ('fallback' in (patch.engine ?? {})) next.engine.fallback = mergeExtraEngine(patch.engine.fallback, cur.engine.fallback);
  if ('chain' in (patch.engine ?? {})) {
    const old = Array.isArray(cur.engine.chain) ? cur.engine.chain : [];
    next.engine.chain = (Array.isArray(patch.engine.chain) ? patch.engine.chain : []).map((e, i) => mergeExtraEngine(e, old[i])).filter(Boolean);
  }
  writeJSON(FILE, next);
  setUiLang(next.ui.lang);
  return next;
}

export const mask = k => (k ? `${k.slice(0, 4)}••••••••${k.slice(-4)}` : '');
const maskExtra = e => (e && typeof e === 'object' ? { ...e, apiKey: mask(e.apiKey), hasKey: !!e.apiKey } : null);
export function publicSettings() {
  const s = loadSettings();
  const chain = Array.isArray(s.engine.chain) ? s.engine.chain.map(maskExtra) : [];
  return { ...s, engine: { ...s.engine, apiKey: mask(s.engine.apiKey), hasKey: !!s.engine.apiKey, fallback: maskExtra(s.engine.fallback), chain }, presets: PRESETS };
}
