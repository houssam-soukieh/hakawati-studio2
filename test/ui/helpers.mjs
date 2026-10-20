// Shared plumbing for the Studio UI tests: a Studio server, a Chromium page that fails on console errors,
// screenshots under test/ui/shots/, and small API helpers.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { chromium } from 'playwright-core';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SHOTS = path.join(ROOT, 'test', 'ui', 'shots');
export const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
export let BASE = process.env.HAKAWATI_URL ?? '';
// The server this run starts keeps its settings and projects in a temporary folder: the tests change settings, and
// they must never touch the owner's (engine, key, ComfyUI). Pictures start off so shots are placeholders.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'hakawati-ui-'));
export const PROJECTS_DIR = process.env.HAKAWATI_URL ? path.join(ROOT, 'projects') : path.join(SANDBOX, 'projects');
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer().on('error', reject).listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

let server = null;
/** Use the Studio at HAKAWATI_URL; otherwise start this checkout's own on HAKAWATI_TEST_PORT or a free port.
 *  Never reuse whatever happens to answer on a port: it may be another checkout's Studio. */
export async function startServer() {
  if (process.env.HAKAWATI_URL) { if (!(await up())) throw new Error(`no Studio answers at ${BASE}`); return; }
  const port = Number(process.env.HAKAWATI_TEST_PORT) || await freePort();
  BASE = `http://127.0.0.1:${port}`;
  if (await up()) throw new Error(`port ${port} is already in use (another Studio?): set HAKAWATI_TEST_PORT to a free port or HAKAWATI_URL to reuse it`);
  const studio = path.join(SANDBOX, 'studio');
  fs.mkdirSync(studio, { recursive: true }); fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(studio, 'settings.json'), JSON.stringify({ image: { engine: 'none' } }));
  server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, HAKAWATI_PORT: String(port), HAKAWATI_NO_OPEN: '1', HAKAWATI_STUDIO_DIR: studio, HAKAWATI_PROJECTS_DIR: PROJECTS_DIR }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  server.stdout.on('data', d => { out = (out + d).slice(-20000); });
  server.stderr.on('data', d => { out = (out + d).slice(-20000); });
  server.on('exit', (code, sig) => { if (server) console.error(`# the Studio server exited (${code ?? sig}):\n${out.slice(-4000)}`); });
  for (let i = 0; i < 100; i++) { if (await up()) return; await sleep(100); }
  throw new Error(`the Studio did not start:\n${out}`);
}
/** Stop the server this run started, and wait until it is gone (a hung test run is worse than a failed one). */
export async function stopServer() {
  const s = server; server = null;
  if (!s || s.exitCode !== null || s.signalCode !== null) return;
  const gone = new Promise(r => s.once('exit', r));
  s.kill('SIGTERM');
  if (await Promise.race([gone.then(() => true), sleep(5000).then(() => false)])) return;
  console.error('# the Studio server ignored SIGTERM; killing it');
  s.kill('SIGKILL');
  await gone;
}
async function up() { try { return (await fetch(`${BASE}/api/meta`)).ok; } catch { return false; } }
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function api(p, body, method = body === undefined ? 'GET' : 'POST') {
  const r = await fetch(`${BASE}/api/${p}`, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${p}: ${data.error ?? r.status}`);
  return data;
}
export const setLang = lang => api('settings', { ui: { lang } });

/** The newest job number so far: pass it as `after` to waitJobs to wait for a job started later. */
export const jobSeq = async () => Math.max(0, ...(await api('jobs')).map(j => Number(j.id.slice(1))));
/** Wait until a job of this project newer than `after` exists and none of its jobs is queued or running. */
export async function waitJobs(projectId, { after = 0, timeout = 120000 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const jobs = (await api('jobs')).filter(j => j.project === projectId); // newest first
    const fresh = jobs.filter(j => Number(j.id.slice(1)) > after);
    if (fresh.length && !jobs.some(j => j.status === 'queued' || j.status === 'running')) return fresh[0];
    if (Date.now() > end) throw new Error(`jobs of ${projectId} still running after ${timeout} ms`);
    await sleep(400);
  }
}

let browser = null;
export async function launch() {
  browser = await chromium.launch({
    executablePath: process.env.HAKAWATI_CHROME || undefined, channel: process.env.HAKAWATI_CHROME ? undefined : 'chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  fs.mkdirSync(SHOTS, { recursive: true });
  return browser;
}
export const closeBrowser = () => browser?.close();

/** A page at one viewport; every console error or uncaught exception is collected and fails the test. */
export async function openPage(vp) {
  const ctx = await browser.newContext({ viewport: VIEWPORTS[vp], deviceScaleFactor: 1, acceptDownloads: true, hasTouch: vp === 'phone', isMobile: vp === 'phone' });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', m => { if (m.type() === 'error') page.errors.push(`console: ${m.text()} @ ${m.location()?.url ?? ''}`); });
  page.on('pageerror', e => page.errors.push(`pageerror: ${e.message}`));
  page.on('response', r => { if (r.status() >= 400 && new URL(r.url()).host === new URL(BASE).host) page.errors.push(`HTTP ${r.status()} ${r.url()}`); });
  return page;
}

/** Screenshot of the viewport, or of the whole scrolled content (the app scrolls inside #main) with full: true. */
export async function shot(page, name, { full = false } = {}) {
  const file = path.join(SHOTS, `${name}.png`);
  if (!full) { await page.screenshot({ path: file }); return file; }
  await page.evaluate(() => { const s = document.createElement('style'); s.id = '__full'; s.textContent = '#app{height:auto!important}#main{overflow:visible!important}'; document.head.append(s); });
  await page.screenshot({ path: file, fullPage: true });
  await page.evaluate(() => document.getElementById('__full')?.remove());
  return file;
}

/** Nothing may scroll sideways: neither the page nor the app's scroller. */
export async function noSideScroll(page) {
  return page.evaluate(() => {
    const m = document.getElementById('main'), d = document.documentElement;
    const wide = [...document.querySelectorAll('#view *')].filter(el => { const r = el.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1) && !el.closest('.timeline,.steps,.shots .frame,dialog'); }).slice(0, 5)
      .map(el => `${el.tagName.toLowerCase()}#${el.id}.${[...el.classList].join('.')} ${Math.round(el.getBoundingClientRect().left)}→${Math.round(el.getBoundingClientRect().right)}`);
    return { ok: m.scrollWidth <= m.clientWidth + 1 && d.scrollWidth <= innerWidth + 1 && !wide.length, main: [m.scrollWidth, m.clientWidth], doc: [d.scrollWidth, innerWidth], wide };
  });
}
