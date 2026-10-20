// One door to any language model. Two wire formats cover almost every provider and gateway:
//   openai    → POST {baseURL}/chat/completions  (OpenAI, OpenRouter, Gemini, DeepSeek, CodeCraft /v1, …)
//   anthropic → POST {baseURL}/v1/messages       (Anthropic, CodeCraft, other Claude-style gateways)
// Both are streamed (long SVG answers would otherwise hit proxy timeouts) and every call is logged to
// .studio/llm-usage.jsonl. JSON is asked for in words and checked here, because gateways often ignore
// json_schema / response_format (CodeCraft did, 2026-10-19).
// A user message is a string or a list of parts: { type: 'text', text } | { type: 'image', mime, data (base64) }.
//
// Never waits forever (a gateway that keeps a stream open and sends nothing is the classic hang): every call has
//   - a start limit: no answer headers within `engine.firstByteSeconds` (300) → stop and retry,
//   - an idle limit: once the answer has started, no byte for `engine.idleSeconds` (90; 0 = off) → stop and retry,
//   - a total cap per attempt: `engine.callMinutes` (12).
// Gateways throttle (CodeCraft answers empty under load), so calls queue process-wide: at most `engine.concurrency`
// (default 2) in flight and at most ONE carrying pictures. Retryable failures (empty answer, 429/5xx, stalls, network)
// are retried with growing waits — 10/20/40/60/60 s, each retry in the job log; Settings → Test retries quickly.
// When the engine still fails that way, an optional FALLBACK engine (Settings → engine.fallback, e.g. LM Studio on this
// PC: openai, http://127.0.0.1:1234/v1) answers that one call; a call with pictures only if the fallback can see.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { STUDIO, sleep, checkAbort, run, track, clamp, Cancelled } from './util.mjs';
import { loadSettings, PRESETS } from './settings.mjs';
import { t, addMessages } from './i18n.mjs';

addMessages({
  idle: { en: v => `The engine sent nothing for ${v.sec} s in the middle of its answer — the connection stalled`, ar: v => `توقّف المحرك عن الإرسال ${v.sec} ث في منتصف جوابه — تعطّل الاتصال` },
  noStart: { en: v => `The engine did not start answering within ${v.sec} s`, ar: v => `لم يبدأ المحرك بالإجابة خلال ${v.sec} ث` },
  callTimeout: { en: v => `Timed out (${v.min} minutes) without a complete answer`, ar: v => `انتهت المهلة (${v.min} دقيقة) دون جواب كامل` },
  retryIn: { en: v => `   ⚠ ${v.who ? `${v.who}: ` : ''}${v.e} — retry ${v.n}/${v.of} in ${v.sec} s`, ar: v => `   ⚠ ${v.who ? `${v.who}: ` : ''}${v.e} — إعادة المحاولة ${v.n}/${v.of} بعد ${v.sec} ث` },
  fallbackTakes: { en: v => `   ↪ ${v.who ? `${v.who}: ` : ''}${v.from} gave up (${v.e}) — the fallback engine ${v.to} takes over this call`, ar: v => `   ↪ ${v.who ? `${v.who}: ` : ''}تعذّر ${v.from} ‏(${v.e}) — يتولّى المحرك الاحتياطي ${v.to} هذا الطلب` },
  fallbackFailed: { en: v => `   ⚠ The fallback engine ${v.to} failed too: ${v.e}`, ar: v => `   ⚠ فشل المحرك الاحتياطي ${v.to} أيضاً: ${v.e}` },
  fallbackBlind: { en: v => `   ⚠ The fallback engine ${v.to} cannot see pictures (${v.e}) — it does not take over calls with pictures`, ar: v => `   ⚠ المحرك الاحتياطي ${v.to} لا يرى الصور (${v.e}) — لا يتولّى الطلبات التي فيها صور` },
  fallbackAlso: { en: v => `fallback ${v.to}: ${v.e}`, ar: v => `الاحتياطي ${v.to}: ${v.e}` },
});

const USAGE = path.join(STUDIO, 'llm-usage.jsonl');
const logUsage = row => { try { fs.mkdirSync(STUDIO, { recursive: true }); fs.appendFileSync(USAGE, JSON.stringify(row) + '\n'); } catch { /* best effort */ } };

export class EngineError extends Error {
  constructor(msg, { status, retry, kind } = {}) { super(msg); this.status = status; this.retry = retry; this.kind = kind; }
}

const trimSlash = s => String(s ?? '').replace(/\/+$/, '');
const num = (v, d) => { const n = Number(v); return v !== '' && v != null && Number.isFinite(n) && n >= 0 ? n : d; };

/** The time limits of one call, in ms (see the top). */
export function engineTimes(engine = loadSettings().engine) {
  return { start: Math.max(1, num(engine.firstByteSeconds, 300)) * 1000, idle: num(engine.idleSeconds, 90) * 1000, total: Math.max(0.05, num(engine.callMinutes, 12)) * 60e3 };
}
/** How many engine calls may be in flight at once (Settings → engine.concurrency, default 2, 1–6). */
export const engineConcurrency = (engine = loadSettings().engine) => clamp(Math.round(Number(engine.concurrency) || 2), 1, 6);

/** A queue with `limit` places; enter() resolves with leave() once a place is free (FIFO; a stopped job leaves the line). */
class Gate {
  busy = 0;
  line = [];
  async enter(limit, signal) {
    while (this.busy >= limit) {
      checkAbort(signal);
      await new Promise((resolve, reject) => {
        const wake = () => { signal?.removeEventListener('abort', gone); resolve(); };
        const gone = () => { const i = this.line.indexOf(wake); if (i >= 0) this.line.splice(i, 1); reject(new Cancelled()); };
        this.line.push(wake);
        signal?.addEventListener('abort', gone, { once: true });
      });
    }
    this.busy++;
    let left = false;
    return () => { if (left) return; left = true; this.busy--; this.line.shift()?.(); };
  }
}
const calls = new Gate(), seeing = new Gate(); // every call / calls with pictures
/** For tests and the watchdog: how many calls are running and waiting now. */
export const engineLoad = () => ({ calls: calls.busy, vision: seeing.busy, waiting: calls.line.length + seeing.line.length });

async function* sseLines(res, signal, onBytes) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    checkAbort(signal);
    const { done, value } = await reader.read();
    if (done) break;
    onBytes();
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

/** The whole body as text, every chunk counted as a sign of life. */
async function readAll(res, onBytes) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + dec.decode();
    onBytes();
    text += dec.decode(value, { stream: true });
  }
}

// the neutral parts in each wire format
const partsFor = (protocol, user) => (typeof user === 'string' ? user : user.map(p => (p.type !== 'image' ? { type: 'text', text: p.text }
  : protocol === 'anthropic' ? { type: 'image', source: { type: 'base64', media_type: p.mime, data: p.data } }
    : { type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.data}` } })));

async function callOnce({ engine, model, system, user, maxTokens, temperature, signal, onText, label = 'engine call' }) {
  const base = trimSlash(engine.baseURL);
  if (!base) throw new EngineError(t('noBase'));
  // a server on this PC (LM Studio, Ollama…) needs no key; anything else does
  const apiKey = engine.apiKey || (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(base) ? 'local' : '');
  if (!apiKey) throw new EngineError(t('noKey'));
  const T = engineTimes(engine);
  const ctl = new AbortController();
  let why = null, started = false;
  const stopFor = reason => () => { why ??= reason; ctl.abort(); };
  const total = setTimeout(stopFor('total'), T.total);
  let quiet = setTimeout(stopFor('start'), T.start); // until the answer starts (headers)
  const w = track(`${label} (${model})`);
  const alive = () => { // any sign of life from the engine: the headers, then every chunk
    w.touch();
    if (started) { quiet?.refresh(); return; }
    started = true;
    clearTimeout(quiet);
    quiet = T.idle ? setTimeout(stopFor('idle'), T.idle) : null;
  };
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let url, headers, body;
  if (engine.protocol === 'anthropic') {
    url = `${base}/v1/messages`;
    headers = { 'content-type': 'application/json', 'x-api-key': apiKey, authorization: `Bearer ${apiKey}`, 'anthropic-version': '2023-06-01' };
    body = { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: partsFor('anthropic', user) }], stream: true, temperature };
  } else {
    url = `${base}/chat/completions`;
    headers = { 'content-type': 'application/json', authorization: `Bearer ${apiKey}`, 'HTTP-Referer': 'http://127.0.0.1:4848', 'X-Title': 'Hakawati Studio' };
    body = { model, max_tokens: maxTokens, temperature, stream: true, messages: [{ role: 'system', content: system }, { role: 'user', content: partsFor('openai', user) }] };
  }
  let text = '', usage = {}, stop = null;
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
    alive();
    if (!res.ok) {
      const msg = (await readAll(res, alive)).slice(0, 400);
      throw new EngineError(`HTTP ${res.status}: ${msg}`, { status: res.status, retry: res.status === 429 || res.status >= 500, kind: 'http' });
    }
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('event-stream')) { // a gateway that ignored stream:true
      const j = JSON.parse(await readAll(res, alive));
      text = engine.protocol === 'anthropic' ? (j.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('') : j.choices?.[0]?.message?.content ?? '';
      stop = engine.protocol === 'anthropic' ? j.stop_reason : j.choices?.[0]?.finish_reason;
      usage = j.usage ?? {};
      onText?.(text);
    } else {
      for await (const data of sseLines(res, signal, alive)) {
        if (!data || data === '[DONE]') continue;
        let ev; try { ev = JSON.parse(data); } catch { continue; }
        if (ev.error) throw new EngineError(t('engineError', { e: JSON.stringify(ev.error).slice(0, 300) }), { retry: true, kind: 'stream' });
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
    if (why === 'idle') throw new EngineError(t('idle', { sec: Math.round(T.idle / 1000) }), { retry: true, kind: 'idle' });
    if (why === 'start') throw new EngineError(t('noStart', { sec: Math.round(T.start / 1000) }), { retry: true, kind: 'idle' });
    if (why === 'total' || e.name === 'AbortError') throw new EngineError(t('callTimeout', { min: Math.round(T.total / 6e3) / 10 }), { retry: true, kind: 'timeout' });
    if (e instanceof EngineError) throw e;
    if (e instanceof SyntaxError) throw new EngineError(t('engineError', { e: `unreadable answer: ${e.message}` }), { retry: true, kind: 'stream' });
    throw new EngineError(t('connect', { e: e.cause?.code ?? e.message }), { retry: true, kind: 'connect' });
  } finally {
    clearTimeout(total); clearTimeout(quiet);
    w.done();
    signal?.removeEventListener('abort', onAbort);
    ctl.abort(); // frees the connection when we stopped reading early (an error event); harmless after a full answer
  }
  if (stop === 'max_tokens' || stop === 'length') throw new EngineError(t('cutOff'), { retry: false });
  if (stop === 'refusal') throw new EngineError(t('refusal'));
  if (!text.trim()) throw new EngineError(t('empty'), { retry: true, kind: 'empty' });
  return { text, usage, stop };
}

/** How often and how patiently a call is retried (waits in seconds between attempts). Settings → Test answers fast;
 *  job calls ride out a throttling gateway (the same calls succeed a minute later). */
export const RETRY = {
  quick: { attempts: 3, waits: [4, 8] },
  patient: { attempts: 6, waits: [10, 20, 40, 60, 60] },
};
const retryFor = purpose => (purpose === 'test' ? RETRY.quick : RETRY.patient);
// tests shrink the waits (HAKAWATI_RETRY_SCALE=0.01 → 10 s becomes 0.1 s)
const waitMs = sec => sec * 1000 * (Number(process.env.HAKAWATI_RETRY_SCALE) || 1);

/** The fallback engine (Settings → engine.fallback) when it is filled in, else null. It inherits the primary's time
 *  limits and temperature unless it sets its own (a local model may need a longer callMinutes). */
export function fallbackEngine(engine = loadSettings().engine) {
  const f = engine.fallback;
  if (!f || typeof f !== 'object' || !['openai', 'anthropic'].includes(f.protocol) || !trimSlash(f.baseURL) || !String(f.model ?? '').trim()) return null;
  const inherit = Object.fromEntries(['temperature', 'idleSeconds', 'firstByteSeconds', 'callMinutes', 'concurrency'].map(k => [k, f[k] ?? engine[k]]));
  return { ...f, ...inherit, artModel: '', fallback: null, role: 'fallback' };
}
/** "CodeCraft (gateway) · claude-opus-5.5", "LM Studio (local) · qwen2.5-7b-instruct" — for the log. */
export const engineName = e => `${PRESETS[e.preset]?.label ?? (trimSlash(e.baseURL).replace(/^https?:\/\//, '') || e.protocol)} · ${e.model}`;

/** One engine, with its retries: the work of askText. */
async function askOn(engine, { purpose, system, user, maxTokens, temperature, signal, onText, log, label, retry }) {
  const model = (purpose === 'cast' || purpose === 'shot') && engine.artModel ? engine.artModel : engine.model;
  const images = typeof user === 'string' ? 0 : user.filter(p => p.type === 'image').length;
  let last;
  for (let attempt = 1; attempt <= retry.attempts; attempt++) {
    checkAbort(signal);
    const leave = [];
    let started = Date.now();
    try {
      if (images) leave.push(await seeing.enter(1, signal)); // one call with pictures at a time
      leave.push(await calls.enter(engineConcurrency(engine), signal));
      started = Date.now();
      const r = await callOnce({ engine, model, system, user, maxTokens, temperature: Number(temperature ?? engine.temperature ?? 0.8), signal, onText, label: label || purpose });
      logUsage({ at: new Date().toISOString(), purpose, model, ...(engine.role && { engine: engine.role }), ok: true, attempt, seconds: Math.round((Date.now() - started) / 1000), in: r.usage.input_tokens ?? r.usage.prompt_tokens, out: r.usage.output_tokens ?? r.usage.completion_tokens, images: images || undefined });
      return r.text;
    } catch (e) {
      if (signal?.aborted || e.cancelled) throw e;
      logUsage({ at: new Date().toISOString(), purpose, model, ...(engine.role && { engine: engine.role }), ok: false, attempt, seconds: Math.round((Date.now() - started) / 1000), kind: e.kind, images: images || undefined, error: String(e.message).slice(0, 300) });
      last = e;
      if (!e.retry || attempt === retry.attempts) break;
      const sec = retry.waits[Math.min(attempt - 1, retry.waits.length - 1)];
      log(t('retryIn', { who: label || purpose, e: e.message, n: attempt + 1, of: retry.attempts, sec }));
      await sleep(waitMs(sec));
    } finally {
      for (const f of leave.reverse()) f();
    }
  }
  throw last;
}

// Can the fallback see? Asked once per process and engine (a definite answer is kept; "no answer" is asked again).
const fallbackEyes = new Map();
const eyesKey = e => `${e.protocol}|${trimSlash(e.baseURL)}|${e.model}`;
async function fallbackSees(fb, signal) {
  const k = eyesKey(fb);
  if (!fallbackEyes.has(k)) {
    const v = await probeVision({ signal, engine: fb });
    if (v.transient) return v;
    fallbackEyes.set(k, v);
  }
  return fallbackEyes.get(k);
}

/**
 * Plain-text answer. purpose: 'director' | 'cast' | 'shot' | 'critic' | 'test' (decides the model: art uses artModel if set).
 * `user` is a string or a list of parts (see the top). Retryable failures are retried (RETRY), each retry logged with
 * `label` (e.g. "s5-2 critic"); every attempt waits for its place in the process-wide queue first. When the engine
 * still fails with a retryable error, the fallback engine (if set; for pictures: if it can see) gets one try.
 * `fallback: false` = this engine only (Settings → Test).
 */
export async function askText({ purpose, system, user, maxTokens = 16000, temperature, signal, onText, log = () => {}, label = '', retry = retryFor(purpose), fallback = true }) {
  const { engine } = loadSettings();
  const call = { purpose, system, user, maxTokens, temperature, signal, onText, log, label, retry };
  try {
    return await askOn(engine, call);
  } catch (e) {
    const fb = fallback && e.retry && !signal?.aborted && !e.cancelled ? fallbackEngine(engine) : null;
    if (!fb) throw e;
    const to = engineName(fb);
    if (typeof user !== 'string' && user.some(p => p.type === 'image')) {
      const eyes = await fallbackSees(fb, signal);
      if (!eyes.vision) { log(t('fallbackBlind', { to, e: String(eyes.error ?? '').slice(0, 160) })); throw e; }
    }
    log(t('fallbackTakes', { who: label || purpose, from: engineName(engine), to, e: e.message }));
    try {
      return await askOn(fb, { ...call, retry: { attempts: 1, waits: [] } });
    } catch (e2) {
      if (signal?.aborted || e2.cancelled) throw e2;
      log(t('fallbackFailed', { to, e: e2.message }));
      throw new EngineError(`${e.message} — ${t('fallbackAlso', { to, e: e2.message })}`, { status: e.status, retry: e.retry, kind: e.kind });
    }
  }
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
export async function askJSON({ purpose, system, user, validate, maxTokens = 16000, temperature, signal, onText, log = () => {}, label, retry }) {
  let prompt = user;
  for (let round = 1; round <= 3; round++) {
    const text = await askText({ purpose, system, user: prompt, maxTokens, temperature, signal, onText, log, label, retry });
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

/**
 * A picture as a message part, shrunk first (≤ `max` px long side, JPEG): engines bill pictures by their pixels, and a
 * throttling gateway fails big requests first. `q` is ffmpeg's JPEG scale (2 best … 31): 4 ≈ quality 85, 5 ≈ 80.
 */
export async function imagePart({ buf, mime = 'image/png', max = 768, q = 4 }, signal) {
  const tmp = path.join(os.tmpdir(), `hakawati-${crypto.randomUUID()}`);
  const src = `${tmp}.${(mime.split('/')[1] ?? 'png').replace('jpeg', 'jpg')}`, out = `${tmp}.out.jpg`;
  try {
    fs.writeFileSync(src, buf);
    const r = await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-frames:v', '1', '-vf', `scale='min(${max},iw)':'min(${max},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`, '-q:v', String(q), out], { signal, timeout: 60e3, what: 'ffmpeg (picture for the engine)' });
    checkAbort(signal);
    if (r.code === 0 && fs.existsSync(out)) return { type: 'image', mime: 'image/jpeg', data: fs.readFileSync(out).toString('base64') };
  } finally {
    fs.rmSync(src, { force: true }); fs.rmSync(out, { force: true });
  }
  return { type: 'image', mime, data: Buffer.from(buf).toString('base64') }; // ffmpeg could not read it: send it as it is
}

/** The pictures (each after its label, if any) and then the text, as one user message. images: [{ buf, mime, label, max?, q? }] */
export async function withImages(text, images = [], signal) {
  const parts = await Promise.all(images.map(async im => [...(im.label ? [{ type: 'text', text: im.label }] : []), await imagePart(im, signal)]));
  return [...parts.flat(), { type: 'text', text }];
}

/** askJSON with pictures in the question (the engine must be able to see: probeVision). */
export async function askVisionJSON({ purpose, system, user, images = [], validate, maxTokens = 4000, temperature, signal, onText, log = () => {}, label, retry }) {
  return askJSON({ purpose, system, user: await withImages(user, images, signal), validate, maxTokens, temperature, signal, onText, log, label, retry });
}

let redSquare = null;
async function redPng() {
  if (redSquare) return redSquare;
  const f = path.join(os.tmpdir(), `hakawati-red-${crypto.randomUUID()}.png`);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1', f], { timeout: 30e3 });
  try { return (redSquare = fs.readFileSync(f)); } finally { fs.rmSync(f, { force: true }); }
}

/**
 * Can the engine see pictures? Shows it a red square and asks the colour. Never throws, except when stopped.
 * `transient: true` = no answer at all (throttled, network): unknown, not "blind". `engine`: another engine than the
 * one in Settings (the fallback); never falls back itself.
 */
export async function probeVision({ signal, engine = loadSettings().engine } = {}) {
  if (engine.protocol === 'mock') return { vision: true };
  try {
    const user = await withImages('Which single colour fills this picture? Answer with one English word.', [{ buf: await redPng(), mime: 'image/png' }], signal);
    const reply = await askOn(engine, { purpose: 'test', system: 'You are a terse assistant.', user, maxTokens: 400, temperature: 0, signal, log: () => {}, label: 'vision check', retry: RETRY.quick });
    return /\b(red|crimson|scarlet)\b/i.test(reply) ? { vision: true } : { vision: false, error: `asked the colour of a red square, got “${reply.trim().slice(0, 80)}”` };
  } catch (e) {
    if (signal?.aborted) throw e;
    return { vision: false, error: e.message, ...(e.retry && { transient: true }) };
  }
}

/** The fallback engine's own test (never throws): { ok, name, model, reply, seconds, vision, visionError?, error? }. */
async function testFallback(fb) {
  const started = Date.now();
  try {
    const [reply, seen] = await Promise.all([
      askOn(fb, { purpose: 'test', system: 'You are a terse assistant.', user: `Reply with exactly: ${t('readyWord')}`, maxTokens: 400, log: () => {}, label: 'fallback test', retry: { attempts: 1, waits: [] } }),
      probeVision({ engine: fb }),
    ]);
    if (!seen.transient) fallbackEyes.set(eyesKey(fb), seen);
    return { ok: true, name: engineName(fb), model: fb.model, reply: reply.trim().slice(0, 200), seconds: (Date.now() - started) / 1000, vision: seen.vision, ...(seen.error ? { visionError: seen.error.slice(0, 300) } : {}) };
  } catch (e) {
    return { ok: false, name: engineName(fb), model: fb.model, error: e.message.slice(0, 400), seconds: (Date.now() - started) / 1000 };
  }
}

/** Settings → "test connection": a tiny call, a vision probe, and the model list when the provider has one; the
 *  fallback engine (when set) is tested too and reported as `fallback`. The engine itself never falls back here. */
export async function testEngine() {
  const { engine } = loadSettings();
  const fb = fallbackEngine(engine);
  if (engine.protocol === 'mock') return { ok: true, model: 'mock', reply: t('mockReady'), models: [], vision: true, ...(fb && { fallback: await testFallback(fb) }) };
  const started = Date.now();
  const [reply, seen, fallback] = await Promise.all([
    askText({ purpose: 'test', system: 'You are a terse assistant.', user: `Reply with exactly: ${t('readyWord')}`, maxTokens: 400, fallback: false }),
    probeVision(),
    fb ? testFallback(fb) : null,
  ]);
  let models = [];
  try {
    const base = trimSlash(engine.baseURL);
    const url = engine.protocol === 'anthropic' ? `${base}/v1/models` : `${base}/models`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${engine.apiKey}`, 'x-api-key': engine.apiKey, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(20e3) });
    if (res.ok) models = ((await res.json()).data ?? []).map(m => m.id).filter(Boolean).slice(0, 300);
  } catch { /* optional */ }
  return { ok: true, model: engine.model, reply: reply.trim().slice(0, 200), seconds: (Date.now() - started) / 1000, models, vision: seen.vision, ...(seen.error ? { visionError: seen.error.slice(0, 300) } : {}), ...(fallback && { fallback }) };
}
