// Small shared helpers: paths, hashing, child processes, media probing.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STUDIO = path.join(ROOT, '.studio');
export const PROJECTS = path.join(ROOT, 'projects');

export const hash = (...parts) => crypto.createHash('sha1').update(parts.map(p => (typeof p === 'string' ? p : JSON.stringify(p))).join('␞')).digest('hex').slice(0, 16);
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export const readJSON = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
export function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

/** Seconds of a media file (ffprobe). */
export function durationOf(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  if (r.error) throw new Error(`ffprobe not found on PATH (${r.error.message}) — install ffmpeg or restart the Studio so a new PATH takes effect`);
  return parseFloat(r.stdout?.toString()) || 0;
}

/** Run a command; resolves {code, stdout, stderr}. `signal` (AbortSignal) kills the whole tree. */
export function run(cmd, args, { signal, onStderr, cwd } = {}) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; onStderr?.(String(d)); });
    const kill = () => killTree(child);
    signal?.addEventListener('abort', kill, { once: true });
    child.on('close', code => { signal?.removeEventListener('abort', kill); resolve({ code, stdout: out, stderr: err }); });
    child.on('error', e => resolve({ code: -1, stdout: out, stderr: e.message }));
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

/** Run async tasks with at most `n` at once; stops starting new ones once `signal` aborts. */
export async function pool(items, n, fn, signal) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      checkAbort(signal);
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return results;
}
