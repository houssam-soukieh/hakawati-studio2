// Motion tests without a GPU: a fake ComfyUI (fake-comfy-motion.mjs) paints noise keyframes, gradient depth maps
// and barcode clips; the real pipeline, renderer and player do the rest. Proves:
//   b  a shot with a depth map renders with parallax — the near (bottom) layer travels further than the far one,
//      while the same shot without depth moves as one flat card
//   c  coverage 'marked': only the motion-2 shot gets a clip; it shows clip frame n at t = n/fps (barcodes read back
//      from the rendered film, at 24, 30 and 25 fps) to the very end of the shot — the clip is as long as the shot
//   d  render time per frame for each base layer
//   e  coverage 'all' (the default): every story shot is video, never a title/end card; a 7 s shot is covered by two
//      chained Wan runs (the barcodes count on across the seam), a 5.8 s shot by one run stretched to its exact frame
//      count; every clip is enlarged to the film size (upscale model in ComfyUI, or ffmpeg when it is missing — and
//      the model again once it is back, without a new Wan run); the render changes frame to the very end of each shot
//      (no frozen tail); a clip shorter than its shot is slowed by the player, never frozen; the time estimate is
//      logged before the first Wan run; the Wan prompts carry motion, the camera rule and the beings' rule
//   +  graphs use the verified node names/inputs; missing depth node / ComfyUI down / tainted texture all fall back
// Optional --full also runs test a (the plain mock film through make.mjs; needs edge-tts or the TTS shim on PATH).
//   HAKAWATI_CHROME=/path/to/chrome node test/motion/run.mjs [--full] [--keep]
import '../sandbox.mjs'; // first: settings and projects in a temp folder, never the owner's
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
import { makeMotion, clipPlan, videoSettings, wanPrompt, wantsClip, frameCount } from '../../lib/video.mjs';
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
/** The longest run of consecutive (nearly) unchanged frames. */
const longestHold = (frames, eq) => { let best = 1, cur = 1; for (let i = 1; i < frames.length; i++) { cur = eq(frames[i - 1], frames[i]) ? cur + 1 : 1; best = Math.max(best, cur); } return best; };
const probe = file => { const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]); const [w, h] = String(r.stdout).trim().split(',').map(Number); return { w, h, frames: frameCount(file) }; };

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
  settings({}, { engine: 'wan22', coverage: 'marked', depth: true, upscale: false }); // only the motion-2 shot; Wan's own size
  await runSteps(p.id, ['motion'], { log });
  p = loadProject(p.id);
  tl = buildTimeline(p, 30);
  const mv = p.assets.motion[B].video, rowB = tl.shots.find(r => r.id === B);
  const want = Math.ceil(rowB.D * 24 - 1e-6); // the whole shot, to the frame
  check('c  I2V clip made (VP9 in MP4), as long as the shot; coverage "marked" leaves the other shots still', mv && fs.existsSync(fileOf(p.id, mv.file)) && mv.frames === want && probe(fileOf(p.id, mv.file)).frames === want
    && shots.filter(x => x.id !== B).every(x => !p.assets.motion[x.id]?.video), { ...mv, expectFrames: want, D: rowB.D });
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
    const expect = codes.map((_, f) => Math.floor(f / fps * 24 + 1e-4));
    const bad = codes.map((c, f) => [f, c, expect[f]]).filter(([, c, e]) => c !== e), hold = longestHold(codes, (a, b) => a === b);
    check(`c  rendered at ${fps} fps: every frame shows clip frame floor(t·24) to the very end (longest hold ${hold} frame(s))`, codes.length === r.frames && !bad.length && codes.at(-1) >= want - 2 && hold / fps <= 0.1, `${codes.length} frames, ${bad.length} wrong${bad.length ? ` e.g. ${JSON.stringify(bad.slice(0, 5))}` : ''}; first ${codes.slice(0, 6)}, last ${codes.slice(-3)} of ${want} clip frames`);
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

  // ------------------------------------------------------------ e: every story shot is video, as long as its shot
  const S = video => ({ video, image: {}, render: {} });
  const v4 = videoSettings(S({ seconds: 4 })), v5 = videoSettings(S({}));
  const plans = Object.fromEntries([[4, v5], [5.8, v4], [7, v4], [8, v5], [9, v5], [20, v5]].map(([d, v]) => [`${d}s/${v.seconds}`, clipPlan(d, v)]));
  check('e  clip plan: within one run → trimmed; ≤ ×1.6 → one run stretched; beyond → chained runs (4k+1 frames, ≤ 121 each)',
    JSON.stringify(plans['4s/5'].runs) === '[97]' && plans['5.8s/4'].runs.length === 1 && plans['5.8s/4'].stretch > 1.4 && plans['7s/4'].runs.length === 2 && plans['7s/4'].raw >= plans['7s/4'].need
    && plans['8s/5'].runs.length === 1 && plans['9s/5'].runs.length === 2 && Object.values(plans).every(x => x.runs.every(n => n <= 121 && (n - 1) % 4 === 0) && x.stretch <= 1.6), Object.fromEntries(Object.entries(plans).map(([k, x]) => [k, `${x.runs.join('+')}→${x.need}${x.stretch > 1 ? ` ×${x.stretch}` : ''}`])));
  check('e  wantsClip: coverage "all" → every story shot, "marked" → motion 2 only, title/end and engine off → never',
    wantsClip({ kind: 'shot', motion: 1 }, S({ engine: 'wan22' })) && wantsClip({ kind: 'shot' }, S({ engine: 'wan22' })) && !wantsClip({ kind: 'title' }, S({ engine: 'wan22' })) && !wantsClip({ kind: 'end' }, S({ engine: 'wan22' }))
    && !wantsClip({ kind: 'shot', motion: 1 }, S({ engine: 'wan22', coverage: 'marked' })) && wantsClip({ kind: 'shot', motion: 2 }, S({ engine: 'wan22', coverage: 'marked' })) && !wantsClip({ kind: 'shot', motion: 2 }, S({ engine: 'none' })));
  const pp = { id: 'x', options: { aspect: '16:9' }, screenplay: { cast: [{ id: 'kira', name: 'Kira', kind: 'human' }, { id: 'orion', name: 'Orion', kind: 'being' }] }, assets: { art: { a: { prompt: 'a dark bedroom lit by a phone screen, dust in the air, [[Kira]] at her desk' } } } };
  const pb = wanPrompt(pp, { id: 'a', kind: 'shot', action: 'Orion unfurls above the desk.', cast: ['orion'], camera: 'static', shotType: 'close' });
  const pm = wanPrompt(pp, { id: 'a', kind: 'shot', action: 'Kira turns to the screen', cast: ['kira', 'orion'], camera: 'pan-left', shotType: 'medium' });
  check('e  Wan prompt: the action first, scene cues, a static shot moves inside the clip / a moving one holds steady, beings move as light/threads/smoke',
    pb.prompt.startsWith('Orion unfurls above the desk —') && /subtle push-in/.test(pb.prompt) && !/holds steady/.test(pb.prompt) && /flowing light, glowing threads and drifting smoke/.test(pb.prompt) && /never a human body/.test(pb.prompt)
    && /screen light flickers/.test(pb.prompt) && /dust motes/.test(pb.prompt) && /human body/.test(pb.negative) && /holds steady/.test(pm.prompt) && !/human body/.test(pm.negative) && /Scene: a dark bedroom.*Kira at her desk/.test(pm.prompt),
    { static: pb.prompt.slice(0, 220), moving: pm.prompt.slice(0, 120) });

  settings({}, { engine: 'wan22', depth: true, seconds: 4 }); // coverage 'all' and upscale on are the defaults; one Wan run ≤ 97 frames here
  p = loadProject(p.id);
  const edit = (pr, id, o) => Object.assign(pr.screenplay.scenes.flatMap(sc => sc.shots).find(x => x.id === id), o);
  edit(p, A, { seconds: 7, camera: 'static', shotType: 'close' }); edit(p, B, { seconds: 5.8, camera: 'pan-left', motion: 1 });
  saveProject(p);
  const isWan = g => Object.values(g).some(n => n.class_type === 'Wan22ImageToVideoLatent'), isUp = g => Object.values(g).some(n => n.class_type === 'ImageUpscaleWithModel');
  const g0n = fake.graphs().length, le = [];
  await runSteps(p.id, ['motion'], { log: m => { le.push(m); log(m); } });
  p = loadProject(p.id); tl = buildTimeline(p, 30);
  const gE = fake.graphs().slice(g0n), storyE = allShots(p).filter(x => x.kind === 'shot'), cards = allShots(p).filter(x => x.kind !== 'shot');
  const vid = id => p.assets.motion[id]?.video, need = id => Math.ceil(tl.shots.find(r => r.id === id).D * 24 - 1e-6), stE = shotStatus(p);
  check('e  coverage "all": every story shot gets a clip as long as the shot, shotStatus video: true; title/end cards never',
    storyE.every(x => vid(x.id) && fs.existsSync(fileOf(p.id, vid(x.id).file)) && stE[x.id].video === true && vid(x.id).frames === need(x.id)) && cards.every(x => !p.assets.motion[x.id] && !buildBundle(p, tl, x.id).video),
    storyE.map(x => `${x.id}: ${vid(x.id)?.frames}/${need(x.id)} frames, ${vid(x.id)?.runs} run(s), ${vid(x.id)?.how}`).join(' · '));
  const iBudget = le.findIndex(m => /Estimated GPU time/.test(m)), iWan = le.findIndex(m => /Wan run 1\//.test(m));
  check('e  the time estimate is logged before the first Wan run; every clip logs elapsed / left', iBudget >= 0 && iBudget < iWan && le.filter(m => /video ready .*elapsed .*left/.test(m)).length === storyE.length, `${le[iBudget]?.trim()} | ${le.find(m => /video ready/.test(m))?.trim()}`);
  const vA = vid(A), mA = p.assets.motion[A], codesA = gray(fileOf(p.id, vA.file), { video: true }).map(readCode), cont = gE.filter(g => isWan(g) && /Continuing the same shot/.test(g[5].inputs.text));
  check('e  7 s shot: two chained Wan runs (the 2nd starts from the 1st one\'s last frame), joined without a repeated frame, ≥ 7 s',
    mA.runs.length === 2 && cont.length === 1 && vA.frames === need(A) && vA.frames / vA.fps >= tl.shots.find(r => r.id === A).D && probe(fileOf(p.id, vA.file)).frames === need(A) && codesA.every((c, i) => c === i),
    { runs: mA.runs.map(r => r.frames), frames: vA.frames, seconds: (vA.frames / vA.fps).toFixed(3), codes: `${codesA.slice(82, 88)} … ${codesA.slice(-2)}` });
  const vB = vid(B), fB = gray(fileOf(p.id, vB.file), { video: true }), holdB = longestHold(fB, (a, b) => meanDiff(a, b, 0, H) < 0.5);
  check('e  5.8 s shot: one Wan run, stretched (motion-compensated) to exactly the shot\'s frames, no frame repeated',
    p.assets.motion[B].runs.length === 1 && vB.raw === 97 && vB.frames === need(B) && fB.length === need(B) && vB.how === 'mci' && holdB === 1, { raw: vB.raw, frames: vB.frames, need: need(B), stretch: vB.stretch, how: vB.how, longestHold: holdB });
  const ug = gE.filter(isUp), u0 = ug[0];
  check('e  every clip enlarged to the film size (720p + push-in room = 1472×828) by the upscale model: frames (uploaded to temp) → ImageBatch → ImageUpscaleWithModel → ImageScale → SaveWEBM',
    storyE.every(x => { const pr = probe(fileOf(p.id, vid(x.id).file)); return pr.w === 1472 && pr.h === 828 && vid(x.id).upscaled === '4x-UltraSharp.pth'; })
    && u0?.[1].inputs.model_name === '4x-UltraSharp.pth' && u0[3].inputs.width === 1472 && u0[3].inputs.height === 828 && u0[3].inputs.upscale_method === 'lanczos' && u0[3].inputs.crop === 'center' && u0[4].class_type === 'SaveWEBM'
    && Object.values(u0).some(n => n.class_type === 'ImageBatch') && Object.values(u0).filter(n => n.class_type === 'LoadImage').every(n => / \[temp\]$/.test(n.inputs.image)),
    { upscaleJobs: ug.length, framesPerJob: Object.values(u0 ?? {}).filter(n => n.class_type === 'LoadImage').length, sizes: storyE.map(x => { const pr = probe(fileOf(p.id, vid(x.id).file)); return `${pr.w}×${pr.h}`; }) });
  for (const [id, label] of [[A, '7 s chained'], [B, '5.8 s stretched']]) { // the film itself: frame-exact capture of the shot
    const bd = { ...buildBundle(p, tl, id), grain: false }, out = path.join(OUT, `e-${id}.mp4`), r = await renderClip(bd, out, { fps: 30 });
    const fr = gray(out, { video: true }), codes = fr.map(readCode), hold = longestHold(fr, (a, b) => meanDiff(a, b, 0, H) < 0.5);
    const exact = id !== A || codes.every((c, f) => c === Math.floor(f / 30 * 24 + 1e-4));
    check(`e  rendered ${label} shot at 30 fps: the picture changes to the very end (longest hold ${hold} frames = ${(hold / 30).toFixed(3)} s)`, bd.video && fr.length === r.frames && hold / 30 <= 0.1 && exact,
      `${fr.length} frames${id === A ? `, codes ${codes.slice(0, 5)} … ${codes.slice(-3)}` : ''}`);
  }
  { // the player's safety net: a clip made for a shorter cut is slowed to fit, never frozen
    const bd = { ...buildBundle(p, tl, A), D: 9, grain: false }, out = path.join(OUT, 'e-slowed.mp4'), r = await renderClip(bd, out, { fps: 30 });
    const fr = gray(out, { video: true }), codes = fr.map(readCode), hold = longestHold(fr, (a, b) => meanDiff(a, b, 0, H) < 0.5), rate = vA.frames / (9 * 24);
    const ctx3 = await (await browser()).newContext({ viewport: { width: 640, height: 360 } }), pg = await ctx3.newPage();
    await pg.addInitScript(x => { window.__BUNDLE = x; }, bd);
    await pg.goto(`${pathToFileURL(path.join(ROOT, 'public', 'player.html')).href}?mode=capture`);
    await pg.waitForFunction(() => window.__ready === true);
    const info = await pg.evaluate(() => window.__info());
    await ctx3.close();
    check('e  a clip shorter than its shot (7 s clip, 9 s shot) is slowed by the player to fit — changing to the end, not frozen', fr.length === r.frames && hold / 30 <= 0.1 && codes.every((c, f) => Math.abs(c - Math.floor(f / 30 * 24 * rate)) <= 1) && codes.at(-1) >= vA.frames - 2 && Math.abs(info.clip?.rate - rate) < 0.01 && info.notes.some(n => /slowed/.test(n)),
      { rate: info.clip?.rate, hold, last: codes.slice(-3), note: info.notes[0] });
  }
  const g1n = fake.graphs().length, lc = [];
  await runSteps(p.id, ['motion'], { log: m => lc.push(m) });
  check('e  motion step is cached: the second run asks ComfyUI for nothing', fake.graphs().length === g1n && lc.some(m => /0 to make/.test(m)), lc.find(m => /Video:/.test(m))?.trim());
  p = loadProject(p.id); edit(p, B, { seconds: 6.2 }); saveProject(p);
  const g2n = fake.graphs().length;
  await runSteps(p.id, ['motion'], { log });
  p = loadProject(p.id); tl = buildTimeline(p, 30);
  const g2 = fake.graphs().slice(g2n);
  check('e  a longer cut re-stretches the Wan frames already made (no new Wan run) to its new exact length', !g2.some(isWan) && g2.some(isUp) && vid(B).frames === need(B) && probe(fileOf(p.id, vid(B).file)).frames === need(B) && shotStatus(p)[B].video, { frames: vid(B).frames, need: need(B), stretch: vid(B).stretch });
  // no upscale model: ffmpeg enlarges (and a new film size re-enlarges without Wan); when the model is back it takes over
  const noUp = await startFakeComfy({ port: PORT + 3, dir: path.join(OUT, 'comfy-noup'), upscalers: [] });
  settings({ url: `http://127.0.0.1:${PORT + 3}` }, { engine: 'wan22', depth: true, seconds: 4 });
  p = loadProject(p.id); p.options.quality = '1080p'; saveProject(p);
  const lf = [];
  await runSteps(p.id, ['motion'], { log: m => { lf.push(m); log(m); } });
  p = loadProject(p.id);
  const gNo = (() => { try { return noUp.graphs(); } catch { return []; } })();
  check('e  upscale model missing → one warning, clips enlarged by ffmpeg lanczos to the 1080p size (2208×1242), no Wan run',
    lf.filter(m => /no upscale model/.test(m)).length === 1 && !gNo.some(isWan) && storyE.every(x => { const pr = probe(fileOf(p.id, vid(x.id).file)); return pr.w === 2208 && pr.h === 1242 && pr.frames === need(x.id) && vid(x.id).upscaled === 'lanczos' && vid(x.id).fallback; }),
    lf.find(m => /no upscale model/.test(m))?.trim());
  await noUp.close();
  settings({}, { engine: 'wan22', depth: true, seconds: 4 });
  const g3n = fake.graphs().length;
  await runSteps(p.id, ['motion'], { log });
  p = loadProject(p.id);
  const g3 = fake.graphs().slice(g3n);
  check('e  upscale model back → those clips are enlarged again with it, still no Wan run', !g3.some(isWan) && g3.some(isUp) && storyE.every(x => vid(x.id).upscaled === '4x-UltraSharp.pth' && !vid(x.id).fallback && probe(fileOf(p.id, vid(x.id).file)).w === 2208), storyE.map(x => vid(x.id).upscaled));
  // a ComfyUI without SaveWEBM: the enlarged frames come back as temp PNGs (PreviewImage); a new film size, still no Wan
  const noWebm = await startFakeComfy({ port: PORT + 4, dir: path.join(OUT, 'comfy-nowebm'), noWebm: true });
  settings({ url: `http://127.0.0.1:${PORT + 4}` }, { engine: 'wan22', depth: true, seconds: 4 });
  p = loadProject(p.id); p.options.quality = '720p'; saveProject(p);
  await runSteps(p.id, ['motion'], { log });
  p = loadProject(p.id);
  const gW = noWebm.graphs(), upW = gW.filter(isUp);
  check('e  no SaveWEBM node → frames come back as PreviewImage temp PNGs, clips at the 720p size again, no Wan run', !gW.some(isWan) && upW.length && upW.every(g => g[4].class_type === 'PreviewImage')
    && storyE.every(x => { const pr = probe(fileOf(p.id, vid(x.id).file)); return pr.w === 1472 && pr.h === 828 && pr.frames === need(x.id) && vid(x.id).upscaled === '4x-UltraSharp.pth'; }), { jobs: upW.length });
  await noWebm.close();
  settings({}, { engine: 'wan22', depth: true, seconds: 4 });
  tl = buildTimeline(p, 30);

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
