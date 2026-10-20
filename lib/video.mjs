// Motion for painted keyframes — the motion ladder on the local ComfyUI:
//   L1  a depth map per keyframe (Depth Anything V2, comfyui_controlnet_aux); the player turns it into 2.5D parallax
//   L2  an image-to-video clip for shots marked `motion: 2` (Wan 2.2 TI2V-5B, ComfyUI's native nodes)
// The player does the rest: the parallax shader, and frame-exact seeking of the clip under the camera move.
// Clips are stored as VP9 in MP4: real Chrome and the open-source Chromium (no H.264) both decode it.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSettings } from './settings.mjs';
import { fileOf } from './project.mjs';
import { hash, sleep, checkAbort, run, round } from './util.mjs';
import { addMessages, t } from './i18n.mjs';

addMessages({
  motionStart: { en: v => `🌀 Motion: ${v.depth ? 'depth maps for parallax' : ''}${v.depth && v.clips ? ' + ' : ''}${v.clips ? `${v.clips} moving clip(s)` : ''} for ${v.n} shot(s)…`, ar: v => `🌀 الحركة: ${v.depth ? 'خرائط العمق للبارالاكس' : ''}${v.depth && v.clips ? ' + ' : ''}${v.clips ? `${v.clips} مقطع متحرك` : ''} لـ ${v.n} لقطة…` },
  motionNone: { en: '🌀 Motion: nothing to do (no painted keyframes, or parallax and image-to-video are off)', ar: '🌀 الحركة: لا شيء (لا صور مرسومة، أو البارالاكس والفيديو معطّلان)' },
  stMotion: { en: v => `Motion ${v.i}/${v.n}`, ar: v => `الحركة ${v.i}/${v.n}` },
  motionDone: { en: '✅ Motion ready', ar: '✅ الحركة جاهزة' },
  noDepthNode: { en: '   ⚠ Depth Anything V2 is not installed in ComfyUI (comfyui_controlnet_aux) — shots keep the flat camera move', ar: '   ⚠ Depth Anything V2 غير مثبّت في ComfyUI (comfyui_controlnet_aux) — تبقى حركة الكاميرا المسطّحة' },
  depthDone: { en: v => `   🌗 ${v.id}: depth map in ${v.sec} s`, ar: v => `   🌗 ${v.id}: خريطة العمق في ${v.sec} ث` },
  depthFail: { en: v => `   ⚠ ${v.id}: no depth map (${v.e}) — parallax off for this run`, ar: v => `   ⚠ ${v.id}: لا خريطة عمق (${v.e}) — البارالاكس معطّل في هذه الجولة` },
  noWanNode: { en: 'ComfyUI has no Wan 2.2 nodes (Wan22ImageToVideoLatent) — update ComfyUI, or set Motion → engine to none', ar: 'لا توجد عُقد Wan 2.2 في ComfyUI (Wan22ImageToVideoLatent) — حدّث ComfyUI أو اجعل محرك الحركة «بلا»' },
  i2vStart: { en: v => `   🎥 ${v.id}: image-to-video ${v.w}×${v.h}, ${v.frames} frames (${v.sec} s at ${v.fps} fps)${v.fp8 ? ', fp8 weights' : ''} — several minutes on an 8 GB card`, ar: v => `   🎥 ${v.id}: صورة إلى فيديو ${v.w}×${v.h}، ${v.frames} إطاراً (${v.sec} ث بمعدل ${v.fps})${v.fp8 ? '، أوزان fp8' : ''} — دقائق عدّة على بطاقة 8 GB` },
  i2vDone: { en: v => `   ✓ ${v.id}: moving clip ready in ${v.min} min`, ar: v => `   ✓ ${v.id}: المقطع المتحرك جاهز في ${v.min} دقيقة` },
  i2vEmpty: { en: 'ComfyUI returned no frames for the clip', ar: 'لم يُرجع ComfyUI أي إطار للمقطع' },
  comfyLate: { en: v => `ComfyUI did not finish in ${v.min} minutes`, ar: v => `لم ينهِ ComfyUI العمل خلال ${v.min} دقيقة` },
  comfyDown2: { en: v => `ComfyUI is not answering at ${v.url} (${v.e})`, ar: v => `ComfyUI لا يجيب على ${v.url} (${v.e})` },
});

// ---------------------------------------------------------------- a small ComfyUI client
// (a copy of image.mjs's helper on purpose: that module belongs to the picture step)
const base = s => String(s.image.url || 'http://127.0.0.1:8188').replace(/\/+$/, '');

async function comfy(s, route, { method = 'GET', body, signal, raw = false } = {}) {
  let res;
  const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(120e3)]) : AbortSignal.timeout(120e3);
  try {
    res = await fetch(`${base(s)}${route}`, { method, body: body instanceof FormData ? body : body && JSON.stringify(body), headers: body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}, signal: sig });
  } catch (e) {
    checkAbort(signal);
    throw new Error(t('comfyDown2', { url: base(s), e: e.cause?.code ?? e.message }));
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = text.slice(0, 600);
    try { const j = JSON.parse(text); msg = [j.error?.message, ...Object.values(j.node_errors ?? {}).flatMap(n => (n.errors ?? []).map(e => `${n.class_type}: ${e.message} ${e.details ?? ''}`))].filter(Boolean).join(' · ') || msg; } catch { /* plain text */ }
    throw new Error(`ComfyUI ${route.split('?')[0]} → HTTP ${res.status}: ${msg}`);
  }
  return raw ? Buffer.from(await res.arrayBuffer()) : res.json();
}

const known = new Set(); // only positives are remembered: a node installed later is found on the next run
async function nodeInfo(s, cls, signal) {
  const j = await comfy(s, `/object_info/${encodeURIComponent(cls)}`, { signal }).catch(e => { checkAbort(signal); throw e; });
  return j?.[cls] ?? null;
}
async function hasNode(s, cls, signal) {
  if (known.has(`${base(s)}|${cls}`)) return true;
  const ok = !!(await nodeInfo(s, cls, signal));
  if (ok) known.add(`${base(s)}|${cls}`);
  return ok;
}

async function upload(s, file, signal) {
  const data = fs.readFileSync(file);
  const fd = new FormData();
  fd.append('image', new Blob([data], { type: 'image/png' }), `hakawati-${crypto.createHash('sha1').update(data).digest('hex').slice(0, 16)}${path.extname(file) || '.png'}`);
  fd.append('overwrite', 'true');
  const r = await comfy(s, '/upload/image', { method: 'POST', body: fd, signal });
  return r.subfolder ? `${r.subfolder}/${r.name}` : r.name;
}

/** Queue a graph, wait for it, return every saved output image ({filename, subfolder, type}) in file order. */
async function execute(s, graph, { signal, minutes }) {
  const started = Date.now();
  const { prompt_id: id } = await comfy(s, '/prompt', { method: 'POST', body: { prompt: graph, client_id: 'hakawati-motion' }, signal });
  for (;;) {
    checkAbort(signal);
    await sleep(1000);
    if (Date.now() - started > minutes * 60e3) throw new Error(t('comfyLate', { min: minutes })); // whatever history says
    const hist = (await comfy(s, `/history/${encodeURIComponent(id)}`, { signal }))[id];
    if (!hist) continue;
    if (hist.status?.status_str === 'error') {
      const err = hist.status.messages?.find(m => m[0] === 'execution_error')?.[1];
      throw new Error(`ComfyUI: ${err ? `${err.node_type}: ${err.exception_message}` : 'execution error'}`.trim());
    }
    const imgs = Object.values(hist.outputs ?? {}).flatMap(o => o.images ?? []).filter(i => (i.type ?? 'output') === 'output');
    if (imgs.length) return imgs.sort((a, b) => a.filename.localeCompare(b.filename));
    if (hist.status?.completed) return [];
  }
}
const view = (s, img, signal) => comfy(s, `/view?${new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? '', type: img.type ?? 'output' })}`, { raw: true, signal });

function sizeOf(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { timeout: 60e3, windowsHide: true });
  const [w, h] = String(r.stdout).trim().split(',').map(Number);
  return w && h ? { w, h } : null;
}
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hakawati-motion-'));
async function ffmpeg(args, signal) {
  const r = await run('ffmpeg', ['-y', '-loglevel', 'error', ...args], { signal, timeout: 30 * 60e3 });
  checkAbort(signal);
  if (r.code !== 0) throw new Error(`ffmpeg: ${r.stderr.slice(-400)}`);
}

// ---------------------------------------------------------------- L1: depth maps
export const DEPTH_NODE = 'DepthAnythingV2Preprocessor';
const DEPTH_RES = 768; // the SDXL short side; the preprocessor's own step is 64

/** LoadImage → DepthAnythingV2Preprocessor (white = near) → SaveImage. */
export function buildDepthGraph({ image, ckpt = 'depth_anything_v2_vitl.pth', resolution = DEPTH_RES, prefix = 'hakawati/depth' }) {
  return {
    1: { class_type: 'LoadImage', inputs: { image } },
    2: { class_type: DEPTH_NODE, inputs: { image: ['1', 0], ckpt_name: ckpt, resolution } },
    3: { class_type: 'SaveImage', inputs: { images: ['2', 0], filename_prefix: prefix } },
  };
}

/**
 * The depth map of a keyframe as a PNG Buffer (grayscale, half the keyframe's size, same framing, lightly blurred so
 * the parallax stretches instead of tearing at hard edges) — or null when the depth node is not installed.
 */
export async function depthMap({ imageFile, signal, log = () => {}, label = '' }) {
  const s = loadSettings();
  const info = await nodeInfo(s, DEPTH_NODE, signal);
  if (!info) { log(t('noDepthNode')); return null; }
  const ckpts = info.input?.optional?.ckpt_name?.[0] ?? info.input?.required?.ckpt_name?.[0] ?? [];
  const ckpt = ckpts.includes('depth_anything_v2_vitl.pth') ? 'depth_anything_v2_vitl.pth' : ckpts[0]; // vitl: best detail that is still light on 8 GB
  const started = Date.now();
  const name = await upload(s, imageFile, signal);
  const [img] = await execute(s, buildDepthGraph({ image: name, ckpt }), { signal, minutes: 10 });
  if (!img) throw new Error('ComfyUI returned no depth image');
  const dir = tmpDir();
  try {
    const raw = path.join(dir, 'raw.png'), out = path.join(dir, 'depth.png');
    fs.writeFileSync(raw, await view(s, img, signal));
    const { w, h } = sizeOf(imageFile) ?? sizeOf(raw);
    const ew = v => Math.max(2, Math.round(v / 4) * 2);
    await ffmpeg(['-i', raw, '-vf', `scale=${ew(w)}:${ew(h)}:flags=area,format=gray,gblur=sigma=1.5`, '-frames:v', '1', out], signal);
    log(t('depthDone', { id: label, sec: round((Date.now() - started) / 1000, 1) }));
    return fs.readFileSync(out);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------- L2: image-to-video (Wan 2.2 TI2V-5B)
// The 5B model's native size is 1280×704 / 704×1280 at 121 frames (5 s at 24 fps). On an 8 GB card that is ~30-45
// min a clip, so smaller cards get 832×480 (about a third of the work); the player upscales it to the film's size.
export const I2V_SIZES = {
  native: { '16:9': { w: 1280, h: 704 }, '9:16': { w: 704, h: 1280 }, '1:1': { w: 960, h: 960 } },
  safe: { '16:9': { w: 832, h: 480 }, '9:16': { w: 480, h: 832 }, '1:1': { w: 640, h: 640 } },
};
// Wan's recommended negative prompt (from the official ComfyUI template; the model was trained with it, in Chinese).
export const WAN_NEGATIVE = '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走';

/** Frames Wan can make for a length: 4k+1 (its VAE packs 4 frames per latent), at most 121. */
export const wanFrames = (seconds, fps) => Math.min(121, Math.max(5, 4 * Math.round(seconds * fps / 4) + 1));

/** The native ComfyUI graph (as in ComfyUI's own "Wan 2.2 5B video generation" template, with frames saved as PNGs). */
export function buildI2VGraph({ image, prompt, negative = WAN_NEGATIVE, width, height, length, seed, steps = 20, cfg = 5, unet, clip, vae, weightDtype = 'default', shift = 8, prefix = 'hakawati/i2v' }) {
  return {
    1: { class_type: 'UNETLoader', inputs: { unet_name: unet, weight_dtype: weightDtype } },
    2: { class_type: 'CLIPLoader', inputs: { clip_name: clip, type: 'wan' } },
    3: { class_type: 'VAELoader', inputs: { vae_name: vae } },
    4: { class_type: 'ModelSamplingSD3', inputs: { model: ['1', 0], shift } },
    5: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['2', 0] } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['2', 0] } },
    7: { class_type: 'LoadImage', inputs: { image } },
    8: { class_type: 'Wan22ImageToVideoLatent', inputs: { vae: ['3', 0], width, height, length, batch_size: 1, start_image: ['7', 0] } },
    9: { class_type: 'KSampler', inputs: { model: ['4', 0], positive: ['5', 0], negative: ['6', 0], latent_image: ['8', 0], seed, steps, cfg, sampler_name: 'uni_pc', scheduler: 'simple', denoise: 1 } },
    10: { class_type: 'VAEDecode', inputs: { samples: ['9', 0], vae: ['3', 0] } }, // falls back to tiled decoding by itself on OOM
    11: { class_type: 'SaveImage', inputs: { images: ['10', 0], filename_prefix: prefix } }, // one PNG per frame: exact count, any ComfyUI version
  };
}

/**
 * Animate a keyframe. Returns { mp4: Buffer (VP9, every 12th frame a keyframe so seeking stays cheap), frames, fps, w, h }.
 * `seconds` is the clip length wanted (the pipeline passes min(settings, shot length)).
 */
export async function imageToVideo({ imageFile, prompt, seconds, fps, aspect, seed, signal, log = () => {}, label = '' }) {
  const s = loadSettings(), v = s.video;
  if (!(await hasNode(s, 'Wan22ImageToVideoLatent', signal))) throw new Error(t('noWanNode'));
  fps = Number(fps) || Number(v.fps) || 24;
  const length = wanFrames(Number(seconds) || Number(v.seconds) || 5, fps);
  const stats = await comfy(s, '/system_stats', { signal }).catch(() => ({}));
  const vram = (stats.devices?.[0]?.vram_total ?? 0) / 2 ** 30;
  const { w, h } = I2V_SIZES[vram >= 15 ? 'native' : 'safe'][aspect] ?? I2V_SIZES.safe['16:9'];
  // the fp16 5B weights are 9.3 GB: on a small card store them as fp8 (≈4.7 GB) so they fit next to the
  // activations and 16 GB of RAM still holds the 6.3 GB text encoder too
  const fp8 = vram > 0 && vram < 12 && !/fp8/i.test(v.unet);
  const name = await upload(s, imageFile, signal);
  log(t('i2vStart', { id: label, w, h, frames: length, sec: round(length / fps, 2), fps, fp8 }));
  const started = Date.now();
  const graph = buildI2VGraph({ image: name, prompt, width: w, height: h, length, seed, steps: Number(v.steps) || 20, cfg: Number(v.cfg) || 5,
    unet: v.unet, clip: v.clip, vae: v.vae, weightDtype: fp8 ? 'fp8_e4m3fn' : 'default', prefix: `hakawati/i2v-${hash(label, seed, Date.now())}` });
  const imgs = await execute(s, graph, { signal, minutes: 90 });
  if (!imgs.length) throw new Error(t('i2vEmpty'));
  const dir = tmpDir();
  try {
    for (const [i, img] of imgs.entries()) { checkAbort(signal); fs.writeFileSync(path.join(dir, `${String(i).padStart(5, '0')}.png`), await view(s, img, signal)); }
    const out = path.join(dir, 'clip.mp4');
    await ffmpeg(['-framerate', String(fps), '-i', path.join(dir, '%05d.png'), '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-crf', '20', '-b:v', '0',
      '-g', '12', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-r', String(fps), '-movflags', '+faststart', out], signal);
    const size = sizeOf(out) ?? { w, h };
    log(t('i2vDone', { id: label, min: round((Date.now() - started) / 60e3, 1) }));
    return { mp4: fs.readFileSync(out), frames: imgs.length, fps, w: size.w, h: size.h };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------- cache keys and what the player may use
const hashes = new Map();
/** Content hash of a file, remembered per (path, size, mtime) — the status view asks for every shot often. */
export function fileHash(file) {
  const st = fs.statSync(file), k = `${file}|${st.size}|${st.mtimeMs}`;
  if (!hashes.has(k)) hashes.set(k, crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 16));
  return hashes.get(k);
}
export const depthKey = imgHash => hash(imgHash, 'depth-anything-v2', DEPTH_RES);

/** What the I2V clip of a shot is made from (prompt, length, seed…) and its cache key for a given keyframe hash. */
export function i2vJob(p, shot, D, s = loadSettings()) {
  const v = s.video, fps = Number(v.fps) || 24;
  const seconds = Math.min(Number(v.seconds) || 5, D || 5);
  // Wan animates the subject; the player adds the camera move on top, so the clip itself keeps the camera still
  const prompt = [shot.action, p.assets.art[shot.id]?.prompt, 'the camera stays still, fixed shot'].filter(Boolean).join('. ').replace(/\s+/g, ' ').slice(0, 1500);
  const seed = parseInt(hash(p.id, shot.id, 'i2v').slice(0, 8), 16);
  return { prompt, seconds, fps, seed, aspect: p.options.aspect, key: imgHash => hash(imgHash, v.unet, v.clip, v.vae, v.steps, v.cfg, fps, wanFrames(seconds, fps), p.options.aspect, prompt, seed) };
}
export const wantsClip = (shot, s = loadSettings()) => s.video.engine === 'wan22' && Number(shot.motion ?? 1) === 2;

/** The depth map and clip the player may use for a shot: made from the current keyframe, and switched on. */
export function motionOf(p, shot, s = loadSettings()) {
  const m = p.assets.motion?.[shot.id], a = p.assets.art?.[shot.id];
  if (!m || !a?.image || !fs.existsSync(fileOf(p.id, a.image)) || m.key !== fileHash(fileOf(p.id, a.image))) return { depth: null, video: null };
  const ok = x => !!x?.file && fs.existsSync(fileOf(p.id, x.file));
  return { depth: s.video.depth && ok(m.depth) ? m.depth : null, video: wantsClip(shot, s) && ok(m.video) ? m.video : null };
}

/**
 * The motion step: for each story shot with a painted keyframe, a depth map (when video.depth is on) and, for shots
 * marked motion: 2 with the wan22 engine, an image-to-video clip. Cached in p.assets.motion[id] =
 * { key: keyframe hash, depth: {key, file}, video: {key, file, fps, frames, w, h}, at }.
 */
export async function makeMotion(p, { shots, tl, force, signal, log = () => {}, prog = () => {}, save = () => {} }) {
  const s = loadSettings();
  p.assets.motion ??= {};
  for (const id of Object.keys(p.assets.motion)) if (!tl.shots.some(r => r.id === id)) delete p.assets.motion[id];
  const has = f => !!f && fs.existsSync(fileOf(p.id, f));
  const list = shots.filter(sh => sh.kind === 'shot' && has(p.assets.art[sh.id]?.image));
  const clips = list.filter(sh => wantsClip(sh, s));
  if (!list.length || (!s.video.depth && !clips.length)) { log(t('motionNone')); save(); return; }
  log(t('motionStart', { n: list.length, depth: s.video.depth, clips: clips.length }));
  let depthOn = !!s.video.depth;
  for (const [i, sh] of list.entries()) {
    checkAbort(signal);
    const img = fileOf(p.id, p.assets.art[sh.id].image), ih = fileHash(img);
    let m = p.assets.motion[sh.id];
    if (m?.key !== ih) m = p.assets.motion[sh.id] = { key: ih, depth: null, video: null, at: Date.now() }; // a new keyframe: start over
    if (depthOn && (force || m.depth?.key !== depthKey(ih) || !has(m.depth.file))) {
      try {
        const png = await depthMap({ imageFile: img, signal, log, label: sh.id });
        if (!png) depthOn = false; // the node is missing: said once, the other shots skip too
        else {
          const file = `depth/${sh.id}.png`;
          fs.mkdirSync(fileOf(p.id, 'depth'), { recursive: true });
          fs.writeFileSync(fileOf(p.id, file), png);
          m.depth = { key: depthKey(ih), file }; m.at = Date.now(); save();
        }
      } catch (e) {
        if (e.cancelled || signal?.aborted) throw e;
        log(t('depthFail', { id: sh.id, e: e.message })); depthOn = false; // parallax is a bonus: the film still gets made
      }
    }
    if (wantsClip(sh, s)) {
      const row = tl.shots.find(r => r.id === sh.id), job = i2vJob(p, sh, row?.D, s), key = job.key(ih);
      if (force || m.video?.key !== key || !has(m.video.file)) {
        const r = await imageToVideo({ imageFile: img, prompt: job.prompt, seconds: job.seconds, fps: job.fps, aspect: job.aspect, seed: job.seed, signal, log, label: sh.id });
        const file = `motion/${sh.id}.mp4`;
        fs.mkdirSync(fileOf(p.id, 'motion'), { recursive: true });
        fs.writeFileSync(fileOf(p.id, file), r.mp4);
        m.video = { key, file, fps: r.fps, frames: r.frames, w: r.w, h: r.h }; m.at = Date.now(); save();
      }
    }
    prog((i + 1) / list.length, t('stMotion', { i: i + 1, n: list.length }));
  }
  save();
  log(t('motionDone'));
}
