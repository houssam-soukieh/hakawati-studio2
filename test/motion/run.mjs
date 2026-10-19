// Motion tests without a GPU: a fake ComfyUI (fake-comfy-motion.mjs) paints noise keyframes, gradient depth maps
// and barcode clips; the real pipeline, renderer and player do the rest. Proves:
//   b  a shot with a depth map renders with parallax — the near (bottom) layer travels further than the far one,
//      while the same shot without depth moves as one flat card
//   c  a motion-2 shot shows clip frame n at t = n/fps (barcodes read back from the rendered film, at 24 and 30 fps),
//      holding the last frame after the clip ends
//   d  render time per frame for each base layer
//   +  graphs use the verified node names/inputs; missing depth node / ComfyUI down / tainted texture all fall back
// Optional --full also runs test a (the plain mock film through make.mjs; needs edge-tts or the TTS shim on PATH).
//   HAKAWATI_CHROME=/path/to/chrome node test/motion/run.mjs [--full] [--keep]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { startFakeComfy } from './fake-comfy-motion.mjs';
import { ROOT, STUDIO, PROJECTS, readJSON, writeJSON } from '../../lib/util.mjs';
import { DEFAULTS } from '../../lib/settings.mjs';
import { createProject, loadProject, saveProject, allShots, fileOf } from '../../lib/project.mjs';
import { runSteps, shotStatus } from '../../lib/pipeline.mjs';
import { buildTimeline } from '../../lib/timeline.mjs';
import { buildBundle, stillFrame, renderClip, browser, closeBrowser } from '../../lib/render.mjs';
import { makeMotion, wanFrames } from '../../lib/video.mjs';
import { pathToFileURL } from 'node:url';

const W = 1280, H = 720, PORT = 8195;
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'hakawati-motion-test-'));
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); };
const log = m => fs.appendFileSync(path.join(OUT, 'pipeline.log'), `${m}\n`);

const SETTINGS = path.join(STUDIO, 'settings.json');
const savedSettings = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS) : null;
const settings = (image, video) => writeJSON(SETTINGS, { ...readJSON(SETTINGS, {}), engine: DEFAULTS.engine, image: { ...DEFAULTS.image, engine: 'comfyui', url: `http://127.0.0.1:${PORT}`, checkpoint: 'fake-sdxl.safetensors', ...image }, video: { ...DEFAULTS.video, ...video } });

/** Decode a JPEG/PNG buffer or a video file to 8-bit gray frames of W×H. */
function gray(input, { video = false } = {}) {
  const args = ['-v', 'error', ...(video ? ['-i', input] : ['-f', 'image2pipe', '-i', 'pipe:0']), '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'];
  const r = spawnSync('ffmpeg', args, { input: video ? undefined : input, maxBuffer: 1 << 30 });
  const frames = [];
  for (let o = 0; o + W * H <= r.stdout.length; o += W * H) frames.push(r.stdout.subarray(o, o + W * H));
  return frames;
}
/** How far (px, +right) the content of rows [y0,y1) moved from frame a to frame b: the dx with the least difference. */
function shiftOf(a, b, y0, y1, range = 260) {
  let best = 0, bestErr = Infinity;
  for (let dx = -range; dx <= range; dx++) {
    let err = 0, n = 0;
    for (let y = y0; y < y1; y += 3) for (let x = 320; x < 960; x += 2) { err += Math.abs(a[y * W + x] - b[y * W + x + dx]); n++; }
    if (err / n < bestErr) { bestErr = err / n; best = dx; }
  }
  return best;
}
const meanDiff = (a, b, y0, y1) => { let s = 0, n = 0; for (let y = y0; y < y1; y += 2) for (let x = 64; x < W - 64; x += 2) { s += Math.abs(a[y * W + x] - b[y * W + x]); n++; } return s / n; };
/** The frame number a barcode frame shows: 8 bars across the width, bar i = bit i (white = 1). */
const readCode = f => { let n = 0; for (let i = 0; i < 8; i++) { const cx = Math.round((i + 0.5) * W / 8); let s = 0; for (let x = cx - 12; x <= cx + 12; x++) for (let y = 330; y <= 390; y += 6) s += f[y * W + x]; if (s / (25 * 11) > 128) n |= 1 << i; } return n; };
const ms = (t0, frames) => Math.round((Date.now() - t0) / frames);

const made = [];
const fake = await startFakeComfy({ port: PORT, dir: path.join(OUT, 'comfy') });
try {
  // ------------------------------------------------------------ a (optional): the plain mock film still renders
  if (process.argv.includes('--full')) {
    writeJSON(SETTINGS, { ...readJSON(SETTINGS, {}), engine: DEFAULTS.engine, image: { ...DEFAULTS.image, engine: 'none' }, video: DEFAULTS.video }); // the offline film: placeholders, no ComfyUI
    const id = execFileSync('node', ['make.mjs', 'new', 'docs/test-story.txt', '--length', '30'], { cwd: ROOT }).toString().trim();
    made.push(id);
    const t0 = Date.now();
    const out = execFileSync('node', ['make.mjs', 'run', id, 'all'], { cwd: ROOT, maxBuffer: 1 << 26 }).toString();
    const p = loadProject(id);
    check('a  mock film: all steps incl. motion, final MP4 made', p.assets.final && fs.existsSync(fileOf(id, p.assets.final.file)) && /Motion: nothing to do/.test(out), `${p.assets.final?.seconds} s film in ${Math.round((Date.now() - t0) / 1000)} s`);
  }

  // ------------------------------------------------------------ picture + depth through the real pipeline
  settings({}, { engine: 'none', depth: true });
  const story = 'The fox ran across the bright valley at dawn. A small star fell behind the far hills. The girl lifted her lantern high and the star rose home.';
  const p0 = createProject({ title: 'motion test', story, options: { style: 'paper', aspect: '16:9', length: 20, language: 'en', captions: false, music: false } });
  made.push(p0.id);
  await runSteps(p0.id, ['script', 'cast', 'art', 'motion'], { log });
  let p = loadProject(p0.id);
  const shots = allShots(p).filter(s => s.kind === 'shot');
  check('depth maps made for every painted shot', shots.every(s => p.assets.motion?.[s.id]?.depth && fs.existsSync(fileOf(p.id, p.assets.motion[s.id].depth.file))), shots.map(s => p.assets.motion?.[s.id]?.depth?.file));
  const dg = fake.graphs().find(g => Object.values(g).some(n => n.class_type === 'DepthAnythingV2Preprocessor'));
  check('depth graph: LoadImage → DepthAnythingV2Preprocessor(ckpt_name, resolution) → SaveImage', dg && JSON.stringify(Object.values(dg).map(n => n.class_type)) === '["LoadImage","DepthAnythingV2Preprocessor","SaveImage"]', Object.values(dg ?? {}).find(n => n.inputs.ckpt_name)?.inputs);
  const st = shotStatus(p);
  check('shotStatus reports depth: true, video: false', shots.every(s => st[s.id].depth === true && st[s.id].video === false));
  const again = []; await runSteps(p0.id, ['motion'], { log: m => again.push(m) });
  check('motion step is cached (second run asks ComfyUI for nothing)', !again.some(m => /depth map in/.test(m)), again.filter(m => /🌗|🎥/.test(m)).length + ' new');

  // ------------------------------------------------------------ b: parallax
  const A = shots[0].id;
  p.screenplay.scenes.flatMap(sc => sc.shots).find(s => s.id === A).camera = 'pan-right';
  saveProject(p); p = loadProject(p.id);
  let tl = buildTimeline(p, 30);
  const bA = buildBundle(p, tl, A), D = bA.D;
  check('bundle carries image + depth', !!(bA.image && bA.depth && !bA.video));
  const flat = { ...bA, depth: null };
  const shots4 = async b => Promise.all([0, D - 1 / 30, D / 2, D / 2 + 0.1].map(async tt => gray(await stillFrame(b, tt, { w: W, h: H }))[0]));
  const [d0, d1, dm, dm2] = await shots4(bA), [f0, f1] = await shots4(flat);
  fs.writeFileSync(path.join(OUT, 'b-depth-start.jpg'), await stillFrame(bA, 0, { w: W, h: H }));
  fs.writeFileSync(path.join(OUT, 'b-depth-end.jpg'), await stillFrame(bA, D - 1 / 30, { w: W, h: H }));
  const far = [Math.round(H * 0.08), Math.round(H * 0.3)], near = [Math.round(H * 0.7), Math.round(H * 0.92)];
  const sd = { far: shiftOf(d0, d1, ...far), near: shiftOf(d0, d1, ...near) }, sf = { far: shiftOf(f0, f1, ...far), near: shiftOf(f0, f1, ...near) };
  check('b  frames at t=0 and t=D differ', meanDiff(d0, d1, 0, H) > 10, `mean |Δ| ${meanDiff(d0, d1, 0, H).toFixed(1)}`);
  check('b  with depth the near layer travels further than the far one (pan-right)', sd.near - sd.far > 30, `px moved: near ${sd.near}, far ${sd.far}`);
  check('b  without depth the frame moves as one flat card', Math.abs(sf.near - sf.far) <= 3, `px moved: near ${sf.near}, far ${sf.far}`);
  const dNear = meanDiff(dm, dm2, ...near), dFar = meanDiff(dm, dm2, ...far);
  check('b  0.1 s apart mid-shot, the near region changes more than the far one', dNear > dFar, `mean |Δ| near ${dNear.toFixed(1)}, far ${dFar.toFixed(1)}`);
  // push-in: near grows faster than far (measured as the spread of the texture around the centre is hard; just make sure it renders and moves)
  const bPush = { ...bA, camera: 'push-in' }, bStatic = { ...bA, camera: 'static' }, bPhoto = { ...bA, dof: 1 };
  for (const [name, b] of [['push-in', bPush], ['static (breathing)', bStatic], ['photoreal depth of field', bPhoto]]) {
    const [x0, x1] = await Promise.all([0, D - 0.04].map(async tt => gray(await stillFrame(b, tt, { w: W, h: H }))[0]));
    check(`b  ${name} renders and moves`, meanDiff(x0, x1, 0, H) > 3, `mean |Δ| ${meanDiff(x0, x1, 0, H).toFixed(1)}`);
  }

  // fallbacks inside the player: a tainted (file://) depth texture → plain picture; no WebGL is the same code path
  const b = await browser(), ctx = await b.newContext({ viewport: { width: 640, height: 360 } }), page = await ctx.newPage();
  const open = async bundle => { await page.addInitScript(x => { window.__BUNDLE = x; }, bundle); await page.goto(`${pathToFileURL(path.join(ROOT, 'public', 'player.html')).href}?mode=capture`); await page.waitForFunction(() => window.__ready === true); return page.evaluate(() => window.__info()); };
  const infoTaint = await open(bA);
  check('fallback: file:// textures (tainted) → plain keyframe, no error', infoTaint.layer === 'image' && !infoTaint.problems.length, infoTaint.notes[0]);
  await ctx.close();

  // ------------------------------------------------------------ c: a motion-2 shot, frame-exact
  const B = shots[1].id;
  p = loadProject(p.id);
  Object.assign(p.screenplay.scenes.flatMap(sc => sc.shots).find(s => s.id === B), { motion: 2, camera: 'static' });
  saveProject(p);
  settings({}, { engine: 'wan22', depth: true, seconds: 2 }); // a clip shorter than the shot: the player must hold its last frame
  await runSteps(p.id, ['motion'], { shots: [B], log });
  p = loadProject(p.id);
  tl = buildTimeline(p, 30);
  const mv = p.assets.motion[B].video, rowB = tl.shots.find(r => r.id === B);
  const want = wanFrames(Math.min(2, rowB.D), 24);
  check('c  I2V clip made (VP9 in MP4)', mv && fs.existsSync(fileOf(p.id, mv.file)) && mv.frames === want, { ...mv, expectFrames: want });
  const ig = fake.graphs().find(g => Object.values(g).some(n => n.class_type === 'Wan22ImageToVideoLatent'));
  const cls = Object.values(ig ?? {}).map(n => n.class_type);
  check('c  Wan 2.2 graph: native nodes, 8 GB defaults (832×480, fp8 weights, shift 8, uni_pc/simple)', JSON.stringify(cls) === JSON.stringify(['UNETLoader', 'CLIPLoader', 'VAELoader', 'ModelSamplingSD3', 'CLIPTextEncode', 'CLIPTextEncode', 'LoadImage', 'Wan22ImageToVideoLatent', 'KSampler', 'VAEDecode', 'SaveImage'])
    && ig[8].inputs.width === 832 && ig[8].inputs.height === 480 && ig[1].inputs.weight_dtype === 'fp8_e4m3fn' && ig[2].inputs.type === 'wan' && ig[4].inputs.shift === 8 && ig[9].inputs.sampler_name === 'uni_pc', { latent: ig?.[8]?.inputs, unet: ig?.[1]?.inputs });
  const stB = shotStatus(p)[B];
  check('c  shotStatus reports video: true, depth: true', stB.video === true && stB.depth === true, stB);
  const bB = buildBundle(p, tl, B);
  check('c  bundle carries the clip with fps/frames', bB.video?.fps === 24 && bB.video.frames === want, bB.video);
  const timing = {};
  for (const fps of [24, 30, 25]) {
    const out = path.join(OUT, `c-motion2-${fps}fps.mp4`), t0 = Date.now();
    const r = await renderClip(bB, out, { fps, quality: '720p' });
    timing[`video@${fps}`] = ms(t0, r.frames);
    const codes = gray(out, { video: true }).map(readCode);
    const expect = codes.map((_, f) => Math.min(want - 1, Math.floor(f / fps * 24 + 1e-4)));
    const bad = codes.map((c, f) => [f, c, expect[f]]).filter(([, c, e]) => c !== e);
    check(`c  rendered at ${fps} fps: every frame shows clip frame floor(t·24), last frame held`, codes.length === r.frames && !bad.length && codes.at(-1) === want - 1, `${codes.length} frames, ${bad.length} wrong${bad.length ? ` e.g. ${JSON.stringify(bad.slice(0, 5))}` : ''}; first ${codes.slice(0, 6)}, last ${codes.slice(-3)}`);
  }
  { // the player itself: which layer, and did requestVideoFrameCallback answer every seek
    const ctx2 = await (await browser()).newContext({ viewport: { width: 640, height: 360 } }), pg = await ctx2.newPage();
    await pg.addInitScript(x => { window.__BUNDLE = x; }, bB);
    await pg.goto(`${pathToFileURL(path.join(ROOT, 'public', 'player.html')).href}?mode=capture`);
    await pg.waitForFunction(() => window.__ready === true);
    for (let f = 0; f < 30; f++) await pg.evaluate(async x => { await window.__seek(x); }, f / 24);
    const info = await pg.evaluate(() => window.__info());
    check('c  player used the video layer; every seek confirmed by requestVideoFrameCallback', info.layer === 'video' && !info.notes.length, info.notes.join(' | ') || info.layer);
    await ctx2.close();
  }

  // ------------------------------------------------------------ d: render cost per frame by base layer
  const short = bd => ({ ...bd, D: 2 });
  for (const [name, bd] of [['plain keyframe', flat], ['depth parallax', bA], ['depth + DoF', bPhoto], ['svg only', { ...flat, image: null, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><rect width="16" height="9" fill="#345"><animate attributeName="opacity" values="1;.5;1" dur="2s" repeatCount="indefinite"/></rect></svg>' }]]) {
    const t0 = Date.now(), r = await renderClip(short(bd), path.join(OUT, `d-${name.replace(/\W+/g, '-')}.mp4`), { fps: 30 });
    timing[name] = ms(t0, r.frames);
  }
  check('d  render time per frame (ms, 1280×720, this sandbox: SwiftShader WebGL, 4 CPUs)', timing['depth parallax'] < 1000 && timing['video@30'] < 1000, timing);

  // ------------------------------------------------------------ graceful when depth is unavailable
  const noDepth = await startFakeComfy({ port: PORT + 2, dir: path.join(OUT, 'comfy-nodepth'), noDepth: true });
  settings({ url: `http://127.0.0.1:${PORT + 2}` }, { engine: 'none', depth: true });
  p = loadProject(p.id);
  const l1 = []; await makeMotion(p, { shots: allShots(p), tl, force: true, log: m => l1.push(m) });
  check('no Depth Anything node → skipped with one warning, no error', l1.filter(m => /not installed/.test(m)).length === 1, l1.find(m => /not installed/.test(m)));
  await noDepth.close();
  settings({ url: 'http://127.0.0.1:9' }, { engine: 'none', depth: true });
  p = loadProject(p.id);
  const l2 = []; await makeMotion(p, { shots: allShots(p), tl, force: true, log: m => l2.push(m) });
  check('ComfyUI down → depth skipped with a warning, the step does not fail', l2.some(m => /no depth map/.test(m)), l2.find(m => /no depth map/.test(m)));
} catch (e) {
  check('unexpected error', false, e.stack);
} finally {
  await closeBrowser();
  await fake.close();
  if (savedSettings) fs.writeFileSync(SETTINGS, savedSettings); else fs.rmSync(SETTINGS, { force: true });
  if (!process.argv.includes('--keep')) for (const id of made) fs.rmSync(path.join(PROJECTS, id), { recursive: true, force: true });
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed — evidence in ${OUT}`);
  process.exitCode = failed.length ? 1 : 0;
}
