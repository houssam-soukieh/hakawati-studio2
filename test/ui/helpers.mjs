// Shared plumbing for the Studio UI tests: a Studio server, a Chromium page that fails on console errors,
// screenshots under test/ui/shots/, and small API helpers.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SHOTS = path.join(ROOT, 'test', 'ui', 'shots');
export const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const PORT = Number(process.env.HAKAWATI_TEST_PORT ?? 4865);
export let BASE = process.env.HAKAWATI_URL ?? `http://127.0.0.1:${PORT}`;

let server = null;
/** Use the Studio at HAKAWATI_URL, or start one on HAKAWATI_TEST_PORT (default 4865). */
export async function startServer() {
  if (await up()) return;
  server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, HAKAWATI_PORT: String(PORT), HAKAWATI_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  server.stdout.on('data', d => { out += d; });
  server.stderr.on('data', d => { out += d; });
  for (let i = 0; i < 100; i++) { if (await up()) return; await sleep(100); }
  throw new Error(`the Studio did not start:\n${out}`);
}
export async function stopServer() { server?.kill(); server = null; }
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
