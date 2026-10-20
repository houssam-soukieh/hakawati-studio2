// Small shared helpers: paths, hashing, child processes, media probing.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// overridable so tests run against their own settings and projects, never the owner's
export const STUDIO = process.env.HAKAWATI_STUDIO_DIR ? path.resolve(process.env.HAKAWATI_STUDIO_DIR) : path.join(ROOT, '.studio');
export const PROJECTS = process.env.HAKAWATI_PROJECTS_DIR ? path.resolve(process.env.HAKAWATI_PROJECTS_DIR) : path.join(ROOT, 'projects');

export const hash = (...parts) => crypto.createHash('sha1').update(parts.map(p => (typeof p === 'string' ? p : JSON.stringify(p))).join('␞')).digest('hex').slice(0, 16);
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export const readJSON = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
/** Atomic: a temp file of our own, then rename over the old one. On Windows an antivirus or indexer holding the file
 *  for a moment makes the rename fail (EPERM/EBUSY/EACCES), so it is tried again for up to ~2 s. */
export function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}-${crypto.randomUUID().slice(0, 8)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      if (i >= 20 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { fs.rmSync(tmp, { force: true }); throw e; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

/** Seconds of a media file (ffprobe; at most 60 s — it blocks the Studio while it runs). */
export function durationOf(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { timeout: 60e3, windowsHide: true });
  if (r.error?.code === 'ETIMEDOUT') throw new Error(`ffprobe did not finish in 60 s on ${path.basename(file)}`);
  if (r.error) throw new Error(`ffprobe not found on PATH (${r.error.message}) — install ffmpeg or restart the Studio so a new PATH takes effect`);
  return parseFloat(r.stdout?.toString()) || 0;
}

// What the process is waiting on right now (child processes, engine calls, browser calls). Nothing here stops
// anything: the job watchdog reads it to say WHAT a silent job is stuck on.
const waits = new Map();
let waitSeq = 0;
/** Mark the start of an external wait → { touch() (data arrived), done() }. */
export function track(what) {
  const id = ++waitSeq, w = { what, at: Date.now(), seen: Date.now() };
  waits.set(id, w);
  return { touch: () => { w.seen = Date.now(); }, done: () => { waits.delete(id); } };
}
/** [{ what, sec (since it started), quiet (seconds since its last data) }], oldest first. */
export const pendingWaits = () => [...waits.values()].map(w => ({ what: w.what, sec: Math.round((Date.now() - w.at) / 1000), quiet: Math.round((Date.now() - w.seen) / 1000) }));

/** A promise with a time limit: rejects with Error(`${what}: no answer in N s`) when it has not settled by then. */
export function within(promise, ms, what) {
  let tm;
  const late = new Promise((_, reject) => { tm = setTimeout(() => reject(Object.assign(new Error(`${what}: no answer in ${Math.round(ms / 1000)} s`), { timedOut: true })), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(tm));
}

/**
 * Run a command; resolves {code, stdout, stderr, timedOut}. `signal` (AbortSignal) kills the whole tree; so does
 * `timeout` (ms) — then code is -1 and stderr ends with the reason. Never waits forever on a killed child whose
 * pipes stay open (a grandchild holding them): 5 s after a kill it resolves anyway.
 */
export function run(cmd, args, { signal, onStderr, cwd, timeout, what } = {}) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const w = track(what ?? `${path.basename(cmd)} → ${path.basename(String(args.at(-1) ?? ''))}`);
    let out = '', err = '', timedOut = false, over = false, grace = null;
    const finish = r => { if (over) return; over = true; clearTimeout(tm); clearTimeout(grace); w.done(); signal?.removeEventListener('abort', kill); resolve(r); };
    child.stdout.on('data', d => { out += d; w.touch(); });
    child.stderr.on('data', d => { err += d; w.touch(); onStderr?.(String(d)); });
    const kill = () => { killTree(child); grace ??= setTimeout(() => finish({ code: -1, stdout: out, stderr: err, timedOut }), 5000); };
    const tm = timeout ? setTimeout(() => { timedOut = true; err += `\n${path.basename(cmd)} did not finish in ${Math.round(timeout / 1000)} s — stopped`; kill(); }, timeout) : null;
    signal?.addEventListener('abort', kill, { once: true });
    if (signal?.aborted) kill();
    child.on('close', code => finish({ code: timedOut ? -1 : code, stdout: out, stderr: err, timedOut }));
    child.on('error', e => finish({ code: -1, stdout: out, stderr: e.message, timedOut }));
  });
}

export function killTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill('SIGKILL');
}

/** ids used in URLs and file names */
export const SAFE_ID = /^[A-Za-z0-9][\w.-]{0,80}$/;
export const slug = s => (String(s ?? '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').toLowerCase().slice(0, 40) || 'story');

export class Cancelled extends Error { constructor() { super('stopped by the user'); this.cancelled = true; } }
export const checkAbort = signal => { if (signal?.aborted) throw new Cancelled(); };

/**
 * Run async tasks with at most `n` at once. Stops starting new ones once `signal` aborts or a task fails, and settles
 * only when every started task has: a failed job never leaves workers behind that keep painting and saving.
 */
export async function pool(items, n, fn, signal) {
  const results = new Array(items.length);
  let next = 0, failure = null;
  const worker = async () => {
    while (next < items.length && !failure) {
      if (signal?.aborted) { failure = new Cancelled(); break; }
      const i = next++;
      try { results[i] = await fn(items[i], i); } catch (e) { failure ??= e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  if (failure) throw failure;
  return results;
}
