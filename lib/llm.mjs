// One door to any language model. Two wire formats cover almost every provider and gateway:
//   openai    → POST {baseURL}/chat/completions  (OpenAI, OpenRouter, Gemini, DeepSeek, CodeCraft /v1, …)
//   anthropic → POST {baseURL}/v1/messages       (Anthropic, CodeCraft, other Claude-style gateways)
// Both are streamed (long SVG answers would otherwise hit proxy timeouts) and every call is logged to
// .studio/llm-usage.jsonl. JSON is asked for in words and checked here, because gateways often ignore
// json_schema / response_format (CodeCraft did, 2026-10-19).
// A user message is a string or a list of parts: { type: 'text', text } | { type: 'image', mime, data (base64) }.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { STUDIO, sleep, checkAbort, run } from './util.mjs';
import { loadSettings } from './settings.mjs';
import { t } from './i18n.mjs';

const USAGE = path.join(STUDIO, 'llm-usage.jsonl');
const logUsage = row => { try { fs.mkdirSync(STUDIO, { recursive: true }); fs.appendFileSync(USAGE, JSON.stringify(row) + '\n'); } catch { /* best effort */ } };

export class EngineError extends Error {
  constructor(msg, { status, retry } = {}) { super(msg); this.status = status; this.retry = retry; }
}

const trimSlash = s => String(s ?? '').replace(/\/+$/, '');

async function* sseLines(res, signal) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    checkAbort(signal);
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  if (buf.startsWith('data:')) yield buf.slice(5).trim();
}

// the neutral parts in each wire format
const partsFor = (protocol, user) => (typeof user === 'string' ? user : user.map(p => (p.type !== 'image' ? { type: 'text', text: p.text }
  : protocol === 'anthropic' ? { type: 'image', source: { type: 'base64', media_type: p.mime, data: p.data } }
    : { type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.data}` } })));

async function callOnce({ engine, model, system, user, maxTokens, temperature, signal, onText }) {
  const base = trimSlash(engine.baseURL);
  if (!base) throw new EngineError(t('noBase'));
  if (!engine.apiKey) throw new EngineError(t('noKey'));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12 * 60e3);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let url, headers, body;
  if (engine.protocol === 'anthropic') {
    url = `${base}/v1/messages`;
    headers = { 'content-type': 'application/json', 'x-api-key': engine.apiKey, authorization: `Bearer ${engine.apiKey}`, 'anthropic-version': '2023-06-01' };
    body = { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: partsFor('anthropic', user) }], stream: true, temperature };
  } else {
    url = `${base}/chat/completions`;
    headers = { 'content-type': 'application/json', authorization: `Bearer ${engine.apiKey}`, 'HTTP-Referer': 'http://127.0.0.1:4848', 'X-Title': 'Hakawati Studio' };
    body = { model, max_tokens: maxTokens, temperature, stream: true, messages: [{ role: 'system', content: system }, { role: 'user', content: partsFor('openai', user) }] };
  }
  let text = '', usage = {}, stop = null;
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
    if (!res.ok) {
      const msg = (await res.text()).slice(0, 400);
      throw new EngineError(`HTTP ${res.status}: ${msg}`, { status: res.status, retry: res.status === 429 || res.status >= 500 });
    }
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('event-stream')) { // a gateway that ignored stream:true
      const j = await res.json();
      text = engine.protocol === 'anthropic' ? (j.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('') : j.choices?.[0]?.message?.content ?? '';
      stop = engine.protocol === 'anthropic' ? j.stop_reason : j.choices?.[0]?.finish_reason;
      usage = j.usage ?? {};
      onText?.(text);
    } else {
      for await (const data of sseLines(res, signal)) {
        if (!data || data === '[DONE]') continue;
        let ev; try { ev = JSON.parse(data); } catch { continue; }
        if (ev.error) throw new EngineError(t('engineError', { e: JSON.stringify(ev.error).slice(0, 300) }), { retry: true });
        let d = '';
        if (engine.protocol === 'anthropic') {
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') d = ev.delta.text;
          if (ev.type === 'message_delta') { stop = ev.delta?.stop_reason ?? stop; usage = { ...usage, ...ev.usage }; }
          if (ev.type === 'message_start') usage = { ...ev.message?.usage };
        } else {
          d = ev.choices?.[0]?.delta?.content ?? '';
          if (ev.choices?.[0]?.finish_reason) stop = ev.choices[0].finish_reason;
          if (ev.usage) usage = ev.usage;
        }
        if (d) { text += d; onText?.(d); }
      }
    }
  } catch (e) {
    if (signal?.aborted) throw e;
    if (e.name === 'AbortError') throw new EngineError(t('timeout'), { retry: true });
    if (e instanceof EngineError) throw e;
    throw new EngineError(t('connect', { e: e.cause?.code ?? e.message }), { retry: true });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  if (stop === 'max_tokens' || stop === 'length') throw new EngineError(t('cutOff'), { retry: false });
  if (stop === 'refusal') throw new EngineError(t('refusal'));
  if (!text.trim()) throw new EngineError(t('empty'), { retry: true });
  return { text, usage, stop };
}

/**
 * Plain-text answer. purpose: 'director' | 'cast' | 'shot' | 'critic' | 'test' (decides the model: art uses artModel if set).
 * `user` is a string or a list of parts (see the top). Retries twice on 429/5xx/network with back-off.
 */
export async function askText({ purpose, system, user, maxTokens = 16000, temperature, signal, onText, log = () => {} }) {
  const { engine } = loadSettings();
  const model = (purpose === 'cast' || purpose === 'shot') && engine.artModel ? engine.artModel : engine.model;
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    checkAbort(signal);
    const started = Date.now();
    try {
      const r = await callOnce({ engine, model, system, user, maxTokens, temperature: Number(temperature ?? engine.temperature ?? 0.8), signal, onText });
      logUsage({ at: new Date().toISOString(), purpose, model, ok: true, seconds: Math.round((Date.now() - started) / 1000), in: r.usage.input_tokens ?? r.usage.prompt_tokens, out: r.usage.output_tokens ?? r.usage.completion_tokens, images: typeof user === 'string' ? undefined : user.filter(p => p.type === 'image').length });
      return r.text;
    } catch (e) {
      if (signal?.aborted) throw e;
      logUsage({ at: new Date().toISOString(), purpose, model, ok: false, seconds: Math.round((Date.now() - started) / 1000), error: String(e.message).slice(0, 300) });
      last = e;
      if (!e.retry || attempt === 3) break;
      log(t('retrying', { e: e.message, n: attempt + 1 }));
      await sleep(4000 * attempt);
    }
  }
  throw last;
}

/** Pull the first JSON object out of an answer (plain, fenced, or with chatter around it). */
export function extractJSON(text) {
  const raw = text.trim();
  try { return JSON.parse(raw); } catch { /* next */ }
  const fence = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch { /* next */ } }
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a >= 0 && b > a) {
    const s = raw.slice(a, b + 1);
    try { return JSON.parse(s); } catch { /* next */ }
    try { return JSON.parse(s.replace(/,\s*([}\]])/g, '$1')); } catch { /* fall through */ } // trailing commas
  }
  throw new Error(t('notJson'));
}

/**
 * JSON answer checked by `validate(obj)` (throws a readable message on problems). On a bad answer the model
 * gets its own answer back with the problem and one more try.
 */
export async function askJSON({ purpose, system, user, validate, maxTokens = 16000, temperature, signal, onText, log = () => {} }) {
  let prompt = user;
  for (let round = 1; round <= 3; round++) {
    const text = await askText({ purpose, system, user: prompt, maxTokens, temperature, signal, onText, log });
    try {
      const obj = extractJSON(text);
      return validate ? validate(obj) ?? obj : obj;
    } catch (e) {
      if (round === 3) throw new Error(t('jsonFail', { e: e.message }));
      log(t('jsonRetry', { e: e.message }));
      const fix = `\n\n---\nYour previous answer had a problem: ${e.message}\nAnswer again with ONE valid JSON object only, fixing that problem.`;
      prompt = typeof user === 'string' ? user + fix : [...user, { type: 'text', text: fix.trim() }];
    }
  }
}

/** A picture as a message part, shrunk first (≤768 px long side, JPEG): engines bill pictures by their pixels. */
export async function imagePart({ buf, mime = 'image/png' }, signal) {
  const tmp = path.join(os.tmpdir(), `hakawati-${crypto.randomUUID()}`);
  const src = `${tmp}.${(mime.split('/')[1] ?? 'png').replace('jpeg', 'jpg')}`, out = `${tmp}.out.jpg`;
  try {
    fs.writeFileSync(src, buf);
    const r = await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-frames:v', '1', '-vf', "scale='min(768,iw)':'min(768,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", '-q:v', '4', out], { signal });
    checkAbort(signal);
    if (r.code === 0 && fs.existsSync(out)) return { type: 'image', mime: 'image/jpeg', data: fs.readFileSync(out).toString('base64') };
  } finally {
    fs.rmSync(src, { force: true }); fs.rmSync(out, { force: true });
  }
  return { type: 'image', mime, data: Buffer.from(buf).toString('base64') }; // ffmpeg could not read it: send it as it is
}

/** The pictures (each after its label, if any) and then the text, as one user message. images: [{ buf, mime, label }] */
export async function withImages(text, images = [], signal) {
  const parts = await Promise.all(images.map(async im => [...(im.label ? [{ type: 'text', text: im.label }] : []), await imagePart(im, signal)]));
  return [...parts.flat(), { type: 'text', text }];
}

/** askJSON with pictures in the question (the engine must be able to see: probeVision). */
export async function askVisionJSON({ purpose, system, user, images = [], validate, maxTokens = 4000, temperature, signal, onText, log = () => {} }) {
  return askJSON({ purpose, system, user: await withImages(user, images, signal), validate, maxTokens, temperature, signal, onText, log });
}

let redSquare = null;
async function redPng() {
  if (redSquare) return redSquare;
  const f = path.join(os.tmpdir(), `hakawati-red-${crypto.randomUUID()}.png`);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1', f]);
  try { return (redSquare = fs.readFileSync(f)); } finally { fs.rmSync(f, { force: true }); }
}

/** Can the engine see pictures? Shows it a red square and asks the colour. Never throws, except when stopped. */
export async function probeVision({ signal } = {}) {
  const { engine } = loadSettings();
  if (engine.protocol === 'mock') return { vision: true };
  try {
    const user = await withImages('Which single colour fills this picture? Answer with one English word.', [{ buf: await redPng(), mime: 'image/png' }], signal);
    const reply = await askText({ purpose: 'test', system: 'You are a terse assistant.', user, maxTokens: 400, temperature: 0, signal });
    return /\b(red|crimson|scarlet)\b/i.test(reply) ? { vision: true } : { vision: false, error: `asked the colour of a red square, got “${reply.trim().slice(0, 80)}”` };
  } catch (e) {
    if (signal?.aborted) throw e;
    return { vision: false, error: e.message };
  }
}

/** Settings → "test connection": a tiny call, a vision probe, and the model list when the provider has one. */
export async function testEngine() {
  const { engine } = loadSettings();
  if (engine.protocol === 'mock') return { ok: true, model: 'mock', reply: t('mockReady'), models: [], vision: true };
  const started = Date.now();
  const [reply, seen] = await Promise.all([
    askText({ purpose: 'test', system: 'You are a terse assistant.', user: `Reply with exactly: ${t('readyWord')}`, maxTokens: 400 }),
    probeVision(),
  ]);
  let models = [];
  try {
    const base = trimSlash(engine.baseURL);
    const url = engine.protocol === 'anthropic' ? `${base}/v1/models` : `${base}/models`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${engine.apiKey}`, 'x-api-key': engine.apiKey, 'anthropic-version': '2023-06-01' } });
    if (res.ok) models = ((await res.json()).data ?? []).map(m => m.id).filter(Boolean).slice(0, 300);
  } catch { /* optional */ }
  return { ok: true, model: engine.model, reply: reply.trim().slice(0, 200), seconds: (Date.now() - started) / 1000, models, vision: seen.vision, ...(seen.error ? { visionError: seen.error.slice(0, 300) } : {}) };
}
