// Frame-exact rendering. Chrome loads the player with a shot, every animation is paused and seeked to the exact
// time of each frame (Web Animations currentTime + SVG setCurrentTime), the frame is captured over CDP as JPEG and
// piped into ffmpeg. No screen recording, no dropped frames, any fps, and the same result on every run.
// `__seek(t)` may return a promise (a motion clip seeking to its frame): every caller awaits it before capturing.
// Every call into Chrome has a time limit (guard): a wedged browser fails the step with a clear message and is
// replaced by a fresh one for the next shot, instead of hanging the job forever.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { ROOT, checkAbort, killTree, round, within, track } from './util.mjs';
import { expandCast } from './svg.mjs';
import { fileOf, findShot } from './project.mjs';
import { ASPECTS, outputSize } from './styles.mjs';
import { t } from './i18n.mjs';
import { loadSettings } from './settings.mjs';
import { motionOf } from './video.mjs';

const PLAYER = pathToFileURL(path.join(ROOT, 'public', 'player.html')).href;

let browserPromise = null;
export function browser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      ...(process.env.HAKAWATI_CHROME ? { executablePath: process.env.HAKAWATI_CHROME } : { channel: 'chrome' }), headless: true,
      args: ['--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
    }).catch(e => { browserPromise = null; throw new Error(t('chrome', { e: e.message })); });
  }
  return browserPromise;
}
export async function closeBrowser() { if (browserPromise) { const b = await browserPromise.catch(() => null); browserPromise = null; await within(b?.close() ?? Promise.resolve(), 30e3, 'Chrome: close').catch(() => {}); } }
/** A browser that stopped answering: forget it (the next call launches a new one) and close it in the background. */
function dropBrowser() {
  const p = browserPromise;
  browserPromise = null;
  p?.then(b => b.close()).catch(() => {});
}
/** One call into Chrome, at most `ms`; a time-out drops the browser. */
async function guard(promise, ms, what) {
  const w = track(`Chrome: ${what}`);
  try { return await within(promise, ms, `Chrome: ${what}`); } catch (e) { if (e.timedOut) dropBrowser(); throw e; } finally { w.done(); }
}
const closeCtx = ctx => guard(ctx.close(), 15e3, 'closing a page').catch(() => {});

/** Everything the player needs for one shot. `svg` overrides the saved art (used while testing a new version). */
export function buildBundle(p, tl, shotId, { svg, captions } = {}) {
  const row = tl.shots.find(s => s.id === shotId);
  const found = findShot(p, shotId);
  if (!row || !found) throw new Error(`no shot ${shotId}`);
  const sp = p.screenplay;
  let art = svg, image = null;
  const a = found.shot.kind === 'shot' ? p.assets.art[shotId] : null;
  if (art === undefined && a) art = a.file && fs.existsSync(fileOf(p.id, a.file)) ? fs.readFileSync(fileOf(p.id, a.file), 'utf8') : '';
  if (a?.image && fs.existsSync(fileOf(p.id, a.image))) image = { file: pathToFileURL(fileOf(p.id, a.image)).href, url: `/files/${p.id}/${a.image}?v=${a.at ?? ''}` };
  // motion made from this keyframe: a depth map (2.5D parallax) and/or an image-to-video clip (base layer)
  const mo = image ? motionOf(p, found.shot, loadSettings()) : {};
  const media = (f, extra) => ({ file: pathToFileURL(fileOf(p.id, f)).href, url: `/files/${p.id}/${f}?v=${p.assets.motion[shotId].at ?? ''}`, ...extra });
  const depth = mo.depth ? media(mo.depth.file) : null, video = mo.video ? media(mo.video.file, { fps: mo.video.fps, frames: mo.video.frames }) : null;
  const castSvg = p.assets.cast?.file && fs.existsSync(fileOf(p.id, p.assets.cast.file)) ? fs.readFileSync(fileOf(p.id, p.assets.cast.file), 'utf8') : '';
  // the beings' whispers (subtitles in their colour, drawn by the player) and the chat "typing…" bubble
  const whispers = (row.whispers ?? []).map(({ name, color, glyph, text, plain, start, end }) => ({ name, color, glyph, text, ...(plain && { plain }), start: round(start, 3), end: round(end, 3) }));
  return {
    id: shotId, kind: found.shot.kind, D: row.D, camera: row.camera, captions: row.captions, captionsOn: captions ?? p.options.captions,
    svg: art ? expandCast(art, castSvg) : '', image, title: sp.title, logline: sp.logline, endText: found.shot.text ?? (p.options.language === 'ar' ? 'النهاية' : p.options.language === 'fr' ? 'Fin' : 'The End'),
    palette: sp.palette, language: p.options.language, aspect: p.options.aspect, grain: p.options.style !== 'explainer',
    // only when present, so the render cache keys of shots without motion stay what they were
    ...(depth && { depth, dof: p.options.style === 'photoreal' ? 1 : 0 }), ...(video && { video }),
    ...(whispers.length && { whispers }), ...(found.shot.overlay === 'typing' && { overlay: 'typing' }),
  };
}

export async function openPlayer(bundle, size) {
  const b = await browser();
  const ctx = await guard(b.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1 }), 60e3, 'new context');
  const page = await guard(ctx.newPage(), 60e3, 'new page').catch(async e => { await closeCtx(ctx); throw e; });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
  // WebGL may not read a file:// picture (it counts as cross-origin), so the textures travel inside the bundle
  const inline = m => (m?.file?.startsWith('file:') && fs.existsSync(fileURLToPath(m.file)) ? { ...m, data: `data:image/${/\.jpe?g$/i.test(m.file) ? 'jpeg' : 'png'};base64,${fs.readFileSync(fileURLToPath(m.file)).toString('base64')}` } : m);
  const bd = bundle.depth ? { ...bundle, image: inline(bundle.image), depth: inline(bundle.depth) } : bundle;
  try {
    await guard(page.addInitScript(x => { window.__BUNDLE = x; }, bd), 30e3, 'init script');
    await guard(page.goto(`${PLAYER}?mode=capture`, { waitUntil: 'load', timeout: 60000 }), 70e3, 'loading the player');
    await guard(page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 }), 40e3, 'player ready');
  } catch (e) { await closeCtx(ctx); throw e; }
  return { ctx, page, errors };
}

/**
 * Test-render a shot the model just wrote: well-formed? does it move? is anything on screen? do the story
 * animations fit the shot? Returns {problems[], poster (jpeg Buffer at 60%)}.
 */
export async function testShot(bundle) {
  const { w, h } = ASPECTS[bundle.aspect] ?? ASPECTS['16:9'];
  const size = { w: Math.round(w / 2), h: Math.round(h / 2) };
  // the art alone: whisper glyphs flicker and would hide a picture that does not move
  const { ctx, page, errors } = await openPlayer({ ...bundle, captionsOn: false, grain: false, whispers: undefined, overlay: undefined }, size);
  try {
    const info = await guard(page.evaluate(() => window.__info()), 30e3, 'reading the shot');
    const problems = [...info.problems, ...errors.map(e => `script error while rendering: ${e}`)];
    const cdp = await guard(ctx.newCDPSession(page), 30e3, 'CDP session');
    const shot = async t => {
      await guard(page.evaluate(async x => { await window.__seek(x); }, t), 30e3, 'seek');
      return Buffer.from((await guard(cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 }), 30e3, 'screenshot')).data, 'base64');
    };
    const D = bundle.D;
    const f1 = await shot(D * 0.15), f2 = await shot(D * 0.6), f3 = await shot(Math.max(0, D - 0.05));
    if (info.animations + info.smil === 0) problems.push('nothing is animated (0 running animations) — add story motion and ambient motion');
    else if (f1.equals(f2) && f2.equals(f3)) problems.push('the picture does not change at all during the shot — the animations are not visible (check selectors, transform-box, and that animated elements are on screen)');
    const px = size.w * size.h;
    if (f2.length < px * 0.018) problems.push('the frame looks almost empty or a single flat colour — draw a full, detailed composition');
    const late = info.finite.filter(a => a.end > D + 0.6);
    if (late.length) problems.push(`${late.length} story animation(s) end after the shot is over (e.g. ${late.slice(0, 3).map(a => `${a.name || 'animation'} ends at ${round(a.end, 1)}s`).join(', ')}; shot is ${round(D, 1)}s) — fit them inside 0–${round(D, 1)}s`);
    if (info.elements < 12) problems.push(`only ${info.elements} elements — the picture is too sparse`);
    return { problems, poster: f2 };
  } finally {
    await closeCtx(ctx);
  }
}

/** A still frame (thumbnail) of a shot at time t. */
export async function stillFrame(bundle, t, size) {
  const { ctx, page } = await openPlayer(bundle, size);
  try {
    await guard(page.evaluate(async x => { await window.__seek(x); }, t), 30e3, 'seek');
    return await guard(page.screenshot({ type: 'jpeg', quality: 85, timeout: 30000 }), 40e3, 'still frame');
  } finally { await closeCtx(ctx); }
}

/** Render one shot to an MP4 clip (video only). onProgress(0..1) */
export async function renderClip(bundle, out, { fps = 30, quality = '720p', signal, onProgress } = {}) {
  const size = outputSize(bundle.aspect, quality);
  const frames = Math.max(1, Math.round(bundle.D * fps));
  const { ctx, page, errors } = await openPlayer(bundle, size);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = out.replace(/\.mp4$/, '.part.mp4');
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', 'pipe:0',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart', tmp], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
  let ffErr = '';
  ff.stderr.on('data', d => { ffErr += d; });
  const done = new Promise(resolve => ff.on('close', resolve));
  const write = buf => within(new Promise((resolve, reject) => { if (ff.stdin.destroyed) return reject(new Error(`ffmpeg stopped: ${ffErr.slice(-300)}`)); ff.stdin.write(buf) ? resolve() : ff.stdin.once('drain', resolve); }), 60e3, 'ffmpeg (taking frames)');
  try {
    const cdp = await guard(ctx.newCDPSession(page), 30e3, 'CDP session');
    for (let f = 0; f < frames; f++) {
      checkAbort(signal);
      await guard(page.evaluate(async t => { await window.__seek(t); }, f / fps), 30e3, `seek to frame ${f}`);
      const { data } = await guard(cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true }), 30e3, `frame ${f}`);
      await write(Buffer.from(data, 'base64'));
      if (f % 15 === 0) onProgress?.(f / frames);
    }
    ff.stdin.end();
    const code = await within(done, 10 * 60e3, 'ffmpeg (finishing the clip)');
    if (code !== 0) throw new Error(`ffmpeg: ${ffErr.slice(-400)}`);
    fs.renameSync(tmp, out);
    onProgress?.(1);
    return { frames, size, errors };
  } catch (e) {
    killTree(ff);
    fs.rmSync(tmp, { force: true });
    throw e;
  } finally {
    await closeCtx(ctx);
  }
}
