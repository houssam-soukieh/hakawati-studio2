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
  custom: { label: 'Custom', labelAr: 'مخصّص', protocol: 'openai', baseURL: '', model: '' },
  mock: { label: 'Offline test (local generator, no key)', labelAr: 'تجريبي بلا مفتاح (مولّد محلي)', protocol: 'mock', baseURL: '', model: 'mock' },
};

export const DEFAULTS = {
  engine: { preset: 'mock', protocol: 'mock', baseURL: '', model: 'mock', artModel: '', apiKey: '', temperature: 0.8, concurrency: 3 },
  voice: { ar: 'ar-SY-LaithNeural', en: 'en-US-AndrewMultilingualNeural', fr: 'fr-FR-RemyMultilingualNeural', rate: '-4%', pitch: '+0Hz' },
  render: { fps: 30, quality: '720p' },
  ui: { lang: 'en' },
  // Pictures from a local ComfyUI (SDXL). Defaults suit RealVisXL / Juggernaut XL "Lightning" checkpoints.
  image: {
    engine: 'none', url: 'http://127.0.0.1:8188', checkpoint: '', steps: 6, cfg: 2, sampler: 'dpmpp_sde', scheduler: 'karras',
    negative: 'text, letters, words, caption, watermark, logo, signature, frame, blurry, lowres, jpeg artifacts, deformed, disfigured, extra fingers, bad hands, bad anatomy, cross-eyed, cartoon, 3d render, plastic skin',
    ipadapter: false, ipWeight: 0.7,
  },
  // Motion on the same ComfyUI: depth maps for 2.5D parallax (every shot) and image-to-video for shots marked
  // motion: 2 (engine 'wan22' = Wan 2.2 TI2V-5B; 'none' = parallax only). Model files as named in ComfyUI.
  video: { engine: 'none', unet: 'wan2.2_ti2v_5B_fp16.safetensors', clip: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', vae: 'wan2.2_vae.safetensors', steps: 20, cfg: 5, fps: 24, seconds: 5, depth: true },
};

export function loadSettings() {
  const s = readJSON(FILE, {});
  return { engine: { ...DEFAULTS.engine, ...s.engine }, voice: { ...DEFAULTS.voice, ...s.voice }, render: { ...DEFAULTS.render, ...s.render }, ui: { ...DEFAULTS.ui, ...s.ui }, image: { ...DEFAULTS.image, ...s.image }, video: { ...DEFAULTS.video, ...s.video } };
}

export function saveSettings(patch) {
  const cur = loadSettings();
  const next = {
    engine: { ...cur.engine, ...patch.engine },
    voice: { ...cur.voice, ...patch.voice },
    render: { ...cur.render, ...patch.render },
    ui: { ...cur.ui, ...patch.ui },
    image: { ...cur.image, ...patch.image },
    video: { ...cur.video, ...patch.video },
  };
  // an empty or masked key from the form means "keep the saved one"
  if (patch.engine && (!patch.engine.apiKey || /•/.test(patch.engine.apiKey))) next.engine.apiKey = cur.engine.apiKey;
  writeJSON(FILE, next);
  setUiLang(next.ui.lang);
  return next;
}

export const mask = k => (k ? `${k.slice(0, 4)}••••••••${k.slice(-4)}` : '');
export function publicSettings() {
  const s = loadSettings();
  return { ...s, engine: { ...s.engine, apiKey: mask(s.engine.apiKey), hasKey: !!s.engine.apiKey }, presets: PRESETS };
}
