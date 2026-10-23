// Motion for painted keyframes — the motion ladder on the local ComfyUI:
//   L1  a depth map per keyframe (Depth Anything V2, comfyui_controlnet_aux) → 2.5D parallax in the player; it is
//       also what a shot shows while its clip is missing
//   L2  a real video clip per story shot (Wan 2.2 TI2V-5B image-to-video, ComfyUI's native nodes): every story shot by
//       default (video.coverage 'all'), or only shots marked motion: 2 ('marked'). Title and end cards stay stills.
// A clip covers its whole shot, to the frame — the player never sits on a frozen last frame:
//   shot ≤ one Wan run (video.seconds, default 3 s = 73 frames; the model's limit is 121 = 5 s, and its quality falls
//   well before: 2–3 s runs are clean on the 3060 Ti, 8 s single runs fall apart)
//                                                            one run at the shot's length (4k+1 frames), trimmed
//   longer, up to ×video.maxStretch (1.6)                    one run, time-stretched by motion-compensated interpolation
//   longer still                                             chained runs: each next run starts from the last frame of
//                                                            the one before (same prompt + "continuing"), joined, and
//                                                            stretched only if still short
// Every frame is then enlarged to the film's size — 4x-UltraSharp in ComfyUI as small separate jobs once Wan is done
// (so the two never share the 8 GB card, and RAM never holds a whole clip at 4×), or ffmpeg lanczos + a light unsharp
// when there is no upscale model — and stored as VP9 in MP4 (real Chrome and the open-source Chromium both decode it).
// The Wan runs are kept on their own (motion/<id>.r<k>.mp4): a new length, film size or upscaler redoes only the cheap
// part, and a chain cut short (a stopped job, a reboot) resumes at the run it was making. Seconds per frame of every
// stage are measured and remembered (.studio/motion-rates.json) for the time estimate logged before the clips start.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSettings } from './settings.mjs';
import { fileOf } from './project.mjs';
import { outputSize } from './styles.mjs';
import { STUDIO, hash, sleep, checkAbort, run, round, clamp, readJSON, writeJSON } from './util.mjs';
import { addMessages, t, uiLang } from './i18n.mjs';

addMessages({
  motionStart: { en: v => `🌀 Motion: ${v.depth ? 'depth maps for parallax' : ''}${v.depth && v.clips ? ' + ' : ''}${v.clips ? `${v.clips} moving clip(s)` : ''} for ${v.n} shot(s)…`, ar: v => `🌀 الحركة: ${v.depth ? 'خرائط العمق للبارالاكس' : ''}${v.depth && v.clips ? ' + ' : ''}${v.clips ? `${v.clips} مقطع متحرك` : ''} لـ ${v.n} لقطة…` },
  motionNone: { en: '🌀 Motion: nothing to do (no painted keyframes, or parallax and image-to-video are off)', ar: '🌀 الحركة: لا شيء (لا صور مرسومة، أو البارالاكس والفيديو معطّلان)' },
  stMotion: { en: v => `Motion ${v.i}/${v.n}`, ar: v => `الحركة ${v.i}/${v.n}` },
  stClip: { en: v => `Video ${v.i}/${v.n}: ${v.id}`, ar: v => `الفيديو ${v.i}/${v.n}: ${v.id}` },
  motionDone: { en: '✅ Motion ready', ar: '✅ الحركة جاهزة' },
  noDepthNode: { en: '   ⚠ Depth Anything V2 is not installed in ComfyUI (comfyui_controlnet_aux) — shots keep the flat camera move', ar: '   ⚠ Depth Anything V2 غير مثبّت في ComfyUI (comfyui_controlnet_aux) — تبقى حركة الكاميرا المسطّحة' },
  depthDone: { en: v => `   🌗 ${v.id}: depth map in ${v.sec} s`, ar: v => `   🌗 ${v.id}: خريطة العمق في ${v.sec} ث` },
  depthFail: { en: v => `   ⚠ ${v.id}: no depth map (${v.e}) — parallax off for this run`, ar: v => `   ⚠ ${v.id}: لا خريطة عمق (${v.e}) — البارالاكس معطّل في هذه الجولة` },
  noWanNode: { en: 'ComfyUI has no Wan 2.2 nodes (Wan22ImageToVideoLatent) — update ComfyUI, or set Motion → engine to none', ar: 'لا توجد عُقد Wan 2.2 في ComfyUI (Wan22ImageToVideoLatent) — حدّث ComfyUI أو اجعل محرك الحركة «بلا»' },
  i2vEmpty: { en: 'ComfyUI returned no frames for the clip', ar: 'لم يُرجع ComfyUI أي إطار للمقطع' },
  comfyLate: { en: v => `ComfyUI did not finish in ${v.min} minutes`, ar: v => `لم ينهِ ComfyUI العمل خلال ${v.min} دقيقة` },
  comfyDown2: { en: v => `ComfyUI is not answering at ${v.url} (${v.e})`, ar: v => `ComfyUI لا يجيب على ${v.url} (${v.e})` },
  clipPlan: { en: v => `🎬 Video: ${v.n} story shot(s) become moving clips — ${v.make} to make, ${v.ready} ready${v.still ? `; ${v.still} stay still (only shots marked “Image to video” get clips)` : ''}`, ar: v => `🎬 الفيديو: ${v.n} لقطة تصير مقاطع متحركة — ${v.make} للصنع و${v.ready} جاهزة${v.still ? `؛ ${v.still} تبقى ثابتة (المقاطع للّقطات المعلَّمة «فيديو من الصورة» فقط)` : ''}` },
  budget: { en: v => `⏱ Estimated GPU time: ${v.total} — Wan ${v.wan} frame(s) ≈ ${v.wanT}${v.up ? `, enlarging ${v.up} frame(s) with ${v.how} ≈ ${v.upT}` : ''}, stretching/encoding ≈ ${v.otherT} (${v.src})`, ar: v => `⏱ الوقت المقدّر على كرت الشاشة: ${v.total} — Wan ‏${v.wan} إطاراً ≈ ${v.wanT}${v.up ? `، تكبير ${v.up} إطاراً بـ${v.how} ≈ ${v.upT}` : ''}، المطّ والترميز ≈ ${v.otherT} (${v.src})` },
  rateGuess: { en: 'first guesses for an 8 GB card; they adjust to this PC after the first clip', ar: 'تقديرات أولية لبطاقة 8 GB تتعدّل على هذا الجهاز بعد أول مقطع' },
  rateMeasured: { en: 'rates measured on this PC', ar: 'معدّلات مقيسة على هذا الجهاز' },
  clipStart: { en: v => `   🎬 [${v.i}/${v.n}] ${v.id}: ${v.sec} s shot → ${v.runs}${v.stretch ? `, stretched ×${v.stretch}` : ''}${v.target ? `, enlarged to ${v.target}` : ''} (≈ ${v.eta})`, ar: v => `   🎬 [${v.i}/${v.n}] ${v.id}: لقطة ${v.sec} ث ← ${v.runs}${v.stretch ? `، مطّ ×${v.stretch}` : ''}${v.target ? `، تكبير إلى ${v.target}` : ''} (≈ ${v.eta})` },
  runsNew: { en: v => (v.n === 1 ? `1 Wan run of ${v.frames} frames` : `${v.n} chained Wan runs of ${v.frames} frames${v.kept ? ` (${v.kept} already made)` : ''}`), ar: v => (v.n === 1 ? `تشغيل Wan واحد بـ${v.frames} إطاراً` : `${v.n} تشغيلات Wan متسلسلة بـ${v.frames} إطاراً${v.kept ? ` (${v.kept} مصنوعة سابقاً)` : ''}`) },
  runsKept: { en: v => `the ${v.frames} Wan frames made earlier`, ar: v => `إطارات Wan المصنوعة سابقاً (${v.frames})` },
  wanRun: { en: v => `   🎥 ${v.id}: Wan run ${v.k}/${v.n} — ${v.w}×${v.h}, ${v.frames} frames${v.fp8 ? ', fp8 weights' : ''}${v.cont ? ', continuing from the last frame' : ''}`, ar: v => `   🎥 ${v.id}: تشغيل Wan ${v.k}/${v.n} — ${v.w}×${v.h}، ${v.frames} إطاراً${v.fp8 ? '، أوزان fp8' : ''}${v.cont ? '، متابعةً من آخر إطار' : ''}` },
  wanRunDone: { en: v => `   ✓ ${v.id}: Wan run ${v.k}/${v.n} in ${v.took} (${v.spf} s a frame)`, ar: v => `   ✓ ${v.id}: تشغيل Wan ${v.k}/${v.n} في ${v.took} (${v.spf} ث للإطار)` },
  stretched: { en: v => `   ↔ ${v.id}: ${v.from} → ${v.to} frames (×${v.k}, ${v.how}) in ${v.sec} s`, ar: v => `   ↔ ${v.id}: ${v.from} ← ${v.to} إطاراً (×${v.k}، ${v.how}) في ${v.sec} ث` },
  enlarged: { en: v => `   🔍 ${v.id}: ${v.frames} frames enlarged to ${v.w}×${v.h} with ${v.how} in ${v.took} (${v.spf} s a frame)`, ar: v => `   🔍 ${v.id}: كُبّر ${v.frames} إطاراً إلى ${v.w}×${v.h} بـ${v.how} في ${v.took} (${v.spf} ث للإطار)` },
  upFallback: { en: v => `   ⚠ ${v.why} — clips are enlarged with ffmpeg (lanczos + light sharpening) instead`, ar: v => `   ⚠ ${v.why} — تُكبَّر المقاطع بـ ffmpeg (lanczos مع شحذ خفيف) بدلاً منه` },
  noUpNodes: { en: 'ComfyUI has no UpscaleModelLoader / ImageUpscaleWithModel / ImageScale node', ar: 'لا توجد في ComfyUI عُقد UpscaleModelLoader / ImageUpscaleWithModel / ImageScale' },
  noUpModel: { en: 'no upscale model in ComfyUI/models/upscale_models (4x-UltraSharp.pth is the one to use)', ar: 'لا يوجد نموذج تكبير في ComfyUI/models/upscale_models (المطلوب 4x-UltraSharp.pth)' },
  upModelGone: { en: v => `the upscale model “${v.name}” is not in ComfyUI/models/upscale_models (there: ${v.list})`, ar: v => `نموذج التكبير «${v.name}» غير موجود في ComfyUI/models/upscale_models (الموجود: ${v.list})` },
  upFailed: { en: v => `${v.id}: the upscale model failed (${v.e})`, ar: v => `${v.id}: فشل نموذج التكبير (${v.e})` },
  stages: { en: v => [v.wan && `Wan ${v.wan}`, v.stretch && `stretch ${v.stretch}`, v.up && `enlarge ${v.up}`, v.enc && `encode ${v.enc}`].filter(Boolean).join(', '), ar: v => [v.wan && `Wan ${v.wan}`, v.stretch && `مطّ ${v.stretch}`, v.up && `تكبير ${v.up}`, v.enc && `ترميز ${v.enc}`].filter(Boolean).join('، ') },
  clipDone: { en: v => `   ✅ ${v.id}: video ready — ${v.frames} frames = ${v.sec} s (${v.stages}) · elapsed ${v.el}, about ${v.left} left`, ar: v => `   ✅ ${v.id}: الفيديو جاهز — ${v.frames} إطاراً = ${v.sec} ث (${v.stages}) · مضى ${v.el}، بقي نحو ${v.left}` },
  clipFail: { en: v => `   ⚠ ${v.id}: no video clip (${v.e}) — the shot keeps its still picture for now; run Motion again to retry`, ar: v => `   ⚠ ${v.id}: لا مقطع فيديو (${v.e}) — تبقى اللقطة صورة ثابتة الآن؛ شغّل الحركة مجدداً للمحاولة` },
  clipsFailed: { en: v => `⚠ ${v.n} clip(s) not made: ${v.ids} — those shots show a still with a camera move until Motion runs again`, ar: v => `⚠ لم يُصنع ${v.n} مقطع: ${v.ids} — تظهر هذه اللقطات صوراً ثابتة بحركة كاميرا حتى تُشغَّل الحركة مجدداً` },
  clipsDone: { en: v => `🎬 ${v.n} clip(s) made in ${v.took}`, ar: v => `🎬 صُنع ${v.n} مقطع في ${v.took}` },
});

/** "2 h 46 min", "12 min", "45 s" (Arabic: س / د / ث). */
export function dur(sec) {
  const ar = uiLang() === 'ar', s = Math.max(0, Math.round(Number(sec) || 0));
  const [H, M, S] = ar ? ['س', 'د', 'ث'] : ['h', 'min', 's'];
  if (s < 90) return `${s} ${S}`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} ${M}` : `${Math.floor(m / 60)} ${H} ${m % 60} ${M}`;
}

// ---------------------------------------------------------------- a small ComfyUI client
// (a copy of image.mjs's helper on purpose: that module belongs to the picture step)
const base = s => String(s.image.url || 'http://127.0.0.1:8188').replace(/\/+$/, '');

// A kept-alive connection that the server closed just as it was reused fails with ECONNRESET / "other side closed"
// before the request reached ComfyUI: such a request is sent again (a night of clips must not end on one of them).
const RESET = /ECONNRESET|EPIPE|UND_ERR_SOCKET|other side closed/i;
async function comfy(s, route, { method = 'GET', body, signal, raw = false } = {}) {
  let res;
  for (let attempt = 0; ; attempt++) {
    const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(120e3)]) : AbortSignal.timeout(120e3);
    try {
      res = await fetch(`${base(s)}${route}`, { method, body: body instanceof FormData ? body : body && JSON.stringify(body), headers: body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}, signal: sig });
      break;
    } catch (e) {
      checkAbort(signal);
      const code = e.cause?.code ?? e.message;
      if (attempt < 3 && RESET.test(`${code} ${e.cause?.message ?? ''}`)) { await sleep(300 * (attempt + 1)); continue; }
      throw Object.assign(new Error(t('comfyDown2', { url: base(s), e: code })), { comfyDown: true });
    }
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
/** The choices of a node input: V1 nodes send [[…choices], {…}], V3 nodes ["COMBO", {options:[…]}]. */
function choices(info, input) {
  const spec = info?.input?.required?.[input] ?? info?.input?.optional?.[input];
  if (!Array.isArray(spec)) return null;
  return Array.isArray(spec[0]) ? spec[0] : spec[0] === 'COMBO' ? spec[1]?.options ?? [] : null;
}
/** ComfyUI's own spelling of a model file ("x.pth", "sub\\x.pth", "x" all find it when only one file matches). */
function pickModel(list, want) {
  if (!want || !list?.length) return null;
  if (list.includes(want)) return want;
  const norm = x => String(x).replace(/\\/g, '/').toLowerCase(), file = x => norm(x).split('/').pop(), stem = x => file(x).replace(/\.(safetensors|ckpt|pth?|bin)$/, '');
  for (const key of [norm, file, stem]) {
    const hits = list.filter(x => key(x) === key(want));
    if (hits.length === 1) return hits[0];
  }
  return null;
}

/** Upload a picture. `type: 'temp'` puts it in ComfyUI's temp folder (emptied when ComfyUI starts); LoadImage then
 *  takes it as "sub/name.png [temp]" (folder_paths.annotated_filepath). */
async function upload(s, file, signal, { type, subfolder, name } = {}) {
  const data = fs.readFileSync(file);
  const fd = new FormData();
  fd.append('image', new Blob([data], { type: 'image/png' }), name ?? `hakawati-${crypto.createHash('sha1').update(data).digest('hex').slice(0, 16)}${path.extname(file) || '.png'}`);
  fd.append('overwrite', 'true');
  if (type) fd.append('type', type);
  if (subfolder) fd.append('subfolder', subfolder);
  const r = await comfy(s, '/upload/image', { method: 'POST', body: fd, signal });
  const ref = r.subfolder ? `${r.subfolder}/${r.name}` : r.name;
  return r.type && r.type !== 'input' ? `${ref} [${r.type}]` : ref;
}

/** Queue a graph, wait for it, return every file it saved ({filename, subfolder, type}: SaveImage's PNGs, SaveWEBM's
 *  video, PreviewImage's temp PNGs) in file-name order. */
async function execute(s, graph, { signal, minutes }) {
  const started = Date.now();
  const { prompt_id: id } = await comfy(s, '/prompt', { method: 'POST', body: { prompt: graph, client_id: 'hakawati-motion' }, signal });
  for (let polls = 0; ; polls++) {
    checkAbort(signal);
    await sleep(polls < 5 ? 250 : 1000);
    if (Date.now() - started > minutes * 60e3) throw new Error(t('comfyLate', { min: minutes })); // whatever history says
    const hist = (await comfy(s, `/history/${encodeURIComponent(id)}`, { signal }))[id];
    if (!hist) continue;
    if (hist.status?.status_str === 'error') {
      const err = hist.status.messages?.find(m => m[0] === 'execution_error')?.[1];
      throw new Error(`ComfyUI: ${err ? `${err.node_type}: ${err.exception_message}` : 'execution error'}`.trim());
    }
    const files = Object.values(hist.outputs ?? {}).flatMap(o => Object.values(o ?? {}).flatMap(x => (Array.isArray(x) ? x : [])))
      .filter(i => i && typeof i === 'object' && i.filename && ['output', 'temp'].includes(i.type ?? 'output'));
    if (files.length) return files.sort((a, b) => a.filename.localeCompare(b.filename));
    if (hist.status?.completed) return [];
  }
}
const view = (s, img, signal) => comfy(s, `/view?${new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? '', type: img.type ?? 'output' })}`, { raw: true, signal });

function sizeOf(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { timeout: 60e3, windowsHide: true });
  const [w, h] = String(r.stdout).trim().split(',').map(Number);
  return w && h ? { w, h } : null;
}
/** Frames in a video file (packets of the first video stream: one per frame for VP9/H.264 without B-frame tricks). */
export function frameCount(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file], { timeout: 120e3, windowsHide: true });
  return parseInt(String(r.stdout).trim(), 10) || 0;
}
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hakawati-motion-'));
const pngs = dir => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^\d{5}\.png$/.test(f)).length : 0);
const pad = i => String(i).padStart(5, '0');
async function ffmpeg(args, signal) {
  const r = await run('ffmpeg', ['-y', '-loglevel', 'error', ...args], { signal, timeout: 30 * 60e3 });
  checkAbort(signal);
  if (r.code !== 0) throw new Error(`ffmpeg: ${r.stderr.slice(-400)}`);
}
const seqInput = (dir, fps) => ['-framerate', String(fps), '-start_number', '0', '-i', path.join(dir, '%05d.png')];
/** VP9 in MP4, a keyframe every 12 frames so the player's frame-exact seeks stay cheap. */
async function encode({ input, out, fps, frames, vf, crf = 20, signal }) {
  await ffmpeg([...input, ...(vf ? ['-vf', vf] : []), '-frames:v', String(frames), '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-crf', String(crf), '-b:v', '0',
    '-g', '12', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-r', String(fps), '-movflags', '+faststart', out], signal);
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
// The 5B model's native size is 1280×704 / 704×1280 at up to 121 frames (5 s at 24 fps). On an 8 GB card that is
// ~30-45 min per 5 s, so smaller cards get 832×480 (about a third of the work), enlarged afterwards.
export const I2V_SIZES = {
  native: { '16:9': { w: 1280, h: 704 }, '9:16': { w: 704, h: 1280 }, '1:1': { w: 960, h: 960 } },
  safe: { '16:9': { w: 832, h: 480 }, '9:16': { w: 480, h: 832 }, '1:1': { w: 640, h: 640 } },
};
// Wan's recommended negative prompt (from the official ComfyUI template; the model was trained with it, in Chinese).
export const WAN_NEGATIVE = '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走';
export const WAN_MAX = 121;
/** Frames Wan can make for a length: 4k+1 (its VAE packs 4 frames per latent), 5…121. */
export const wanFrames = (seconds, fps) => Math.min(WAN_MAX, Math.max(5, 4 * Math.round(seconds * fps / 4) + 1));
/** The smallest 4k+1 frame count ≥ n (5…121). */
export const wanUp = n => Math.min(WAN_MAX, Math.max(5, 4 * Math.ceil((n - 1) / 4) + 1));
/** Every 'continuing' run adds this to the shot's prompt. */
export const CONTINUE = 'Continuing the same shot from this exact frame: the same motion carries on smoothly, same scene, same light, same subject';

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
 * Enlarging a few frames in ComfyUI: the frames (uploaded to temp) → one batch → the upscale model (4×) → ImageScale
 * to the exact film size (centre crop) → SaveWEBM (VP9, a few MB per chunk instead of hundreds of MB of PNGs in
 * ComfyUI/output), or PreviewImage (temp PNGs) on a ComfyUI without SaveWEBM.
 */
export function buildUpscaleGraph({ images, model, width, height, fps = 24, webm = true, crf = 12, prefix = 'hakawati/up' }) {
  const g = { 1: { class_type: 'UpscaleModelLoader', inputs: { model_name: model } } };
  let last = null, id = 10;
  for (const image of images) {
    g[id] = { class_type: 'LoadImage', inputs: { image } };
    if (last) { g[id + 1] = { class_type: 'ImageBatch', inputs: { image1: last, image2: [String(id), 0] } }; last = [String(id + 1), 0]; } else last = [String(id), 0];
    id += 2;
  }
  g[2] = { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['1', 0], image: last } };
  g[3] = { class_type: 'ImageScale', inputs: { image: ['2', 0], upscale_method: 'lanczos', width, height, crop: 'center' } };
  g[4] = webm ? { class_type: 'SaveWEBM', inputs: { images: ['3', 0], filename_prefix: prefix, codec: 'vp9', fps, crf } } : { class_type: 'PreviewImage', inputs: { images: ['3', 0] } };
  return g;
}

// ---------------------------------------------------------------- what a shot's clip is made of
const bool = (x, d) => (x === undefined || x === null || x === '' ? d : x !== false && x !== 'false' && x !== 0 && x !== '0');
/** The video block of the settings, normalised (a form may send strings; files saved before a key existed lack it). */
export function videoSettings(s = loadSettings()) {
  const v = s.video ?? {}, fps = clamp(Number(v.fps) || 24, 8, 60);
  return {
    ...v, fps,
    engine: v.engine === 'wan22' ? 'wan22' : 'none',
    coverage: v.coverage === 'marked' ? 'marked' : 'all',
    upscale: bool(v.upscale, true),
    upscaler: String(v.upscaler ?? '').trim(),
    maxStretch: clamp(Number(v.maxStretch) || 1.6, 1, 2),
    seconds: clamp(Number(v.seconds) || 3, 0.5, WAN_MAX / fps),
    steps: Number(v.steps) || 20, cfg: Number(v.cfg) || 5,
    depth: bool(v.depth, true),
  };
}

/** Does this shot get a moving clip? Story shots only — every one ('all'), or those marked motion: 2 ('marked'). */
export function wantsClip(shot, s = loadSettings()) {
  const v = videoSettings(s);
  return v.engine === 'wan22' && (shot.kind ?? 'shot') === 'shot' && (v.coverage === 'all' || Number(shot.motion ?? 1) === 2);
}

/**
 * How a shot of D seconds is covered. need = frames that cover [0, D) at the clip's fps; runs = the frame count of each
 * Wan run (4k+1, ≤ one run's maximum), the fewest runs whose frames, stretched by at most maxStretch, reach `need`;
 * split evenly and long enough to need no stretch when that many runs can cover the shot.
 * raw = frames after joining (each later run repeats the previous run's last frame, which is dropped).
 */
export function clipPlan(D, v) {
  const fps = v.fps, segMax = wanFrames(Math.min(v.seconds, WAN_MAX / fps), fps);
  const need = Math.max(2, Math.ceil(D * fps - 1e-6));
  const cap = n => segMax + (n - 1) * (segMax - 1);
  let n = 1;
  while (cap(n) * v.maxStretch < need && n < 60) n++;
  const target = Math.min(need, cap(n));
  const per = Math.min(segMax, wanUp(Math.ceil((target - 1) / n) + 1));
  const raw = per + (n - 1) * (per - 1);
  return { fps, need, segMax, runs: Array(n).fill(per), raw, stretch: need > raw ? round(need / raw, 3) : 1 };
}

// What moves in a scene, read from the keyframe's prompt and the shot — Wan animates what the prompt names.
const ENV_CUES = [
  [/\b(rain|drizzle|storm|downpour)/i, 'rain keeps falling'],
  [/\bsnow/i, 'snow drifts down'],
  [/\b(fog|mist|haze|smoke|steam|vapou?r|incense)/i, 'mist and smoke drift and curl'],
  [/\b(fire|flames?|candles?|lanterns?|torch|embers?|hearth)/i, 'flames flicker'],
  [/\b(sea|ocean|waves?|river|lake|water|stream|pool|fountain)/i, 'water ripples and moves'],
  [/\b(trees?|leaves|leaf|grass|forest|field|olive|wheat|flowers?|garden)/i, 'leaves and grass sway in the breeze'],
  [/\b(dust|motes|particles|sparks|pollen)/i, 'dust motes drift through the light'],
  [/\b(city|street|traffic|cars?|neon|skyline|signs?)/i, 'distant lights and traffic move'],
  [/\b(screens?|monitors?|phones?|laptops?|displays?|hologram|keyboard)/i, 'screen light flickers and shifts softly'],
  [/\b(crowd|people|market|passers?-?by|commuters?)/i, 'people in the background move naturally'],
  [/\b(clouds?|sky|sunset|dawn|dusk)/i, 'clouds drift slowly'],
  [/\b(hair|scarf|cloth|curtains?|dress|coat|cloak|flag|veil)/i, 'hair and fabric move gently'],
];
// A director's "static" shot leaves the player's camera still, so the clip itself may move a little
const CLIP_CAMERA = {
  establishing: 'a slow, steady glide across the scene', wide: 'a slow lateral camera drift', medium: 'a gentle handheld drift',
  'over-shoulder': 'a gentle handheld drift', pov: 'a gentle handheld sway, as if walking', close: 'a very slow, subtle push-in',
  'extreme-close': 'a very slow, subtle push-in', insert: 'a very slow, subtle push-in',
};

/**
 * The Wan prompt of a shot: what moves (the shot's action), that the scene stays alive (cues from the keyframe's
 * prompt), how the beings move (light, threads, smoke — never a human body), the camera (steady when the player adds
 * its own move on top; a subtle move inside the clip for a static shot), then the picture itself.
 */
export function wanPrompt(p, shot) {
  const sp = p.screenplay ?? {}, pic = String(p.assets?.art?.[shot.id]?.prompt ?? '').replace(/\[\[|\]\]/g, '').replace(/\s+/g, ' ').trim();
  const inShot = (sp.cast ?? []).filter(c => (shot.cast ?? []).includes(c.id));
  const beings = inShot.filter(c => c.kind === 'being'), humans = inShot.filter(c => c.kind !== 'being');
  const what = String(shot.action || shot.visual || '').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  const env = ENV_CUES.filter(([re]) => re.test(`${pic} ${shot.visual ?? ''} ${shot.action ?? ''}`)).map(([, cue]) => cue).slice(0, 3);
  const parts = [
    what && `${what} — one continuous, natural movement that lasts the whole shot`,
    `The scene is alive: ${env.length ? env.join(', ') : 'air, light and small details move subtly'}`,
    ...beings.map(c => `${c.name || c.id} is not a person but a being of light: it moves as flowing light, glowing threads and drifting smoke that pulse, unfurl and re-form — never a human body, no walking, no limbs, no human face`),
    shot.camera === 'static' ? `Camera: ${CLIP_CAMERA[shot.shotType] ?? CLIP_CAMERA.medium}` : 'The camera holds steady: fixed shot, no camera movement, no zoom',
    pic && `Scene: ${pic}`,
  ];
  const prompt = parts.filter(Boolean).join('. ').slice(0, 1500);
  const negative = beings.length && !humans.length ? `${WAN_NEGATIVE}，human body, human face, bare skin, walking person, arms, legs` : WAN_NEGATIVE;
  return { prompt, negative };
}

/** The size a clip is enlarged to: the film's output size plus room for the camera's push-in (the player zooms ≤ 1.14×). */
export function clipTarget(p, s = loadSettings()) {
  if (!videoSettings(s).upscale) return null;
  const o = outputSize(p.options.aspect, p.options.quality || s.render.quality || '720p'), even = x => Math.round(x * 1.15 / 2) * 2;
  return { w: even(o.w), h: even(o.h) };
}

/** What the clip of a shot is made from, and its cache keys: `base` (the Wan runs: model, prompt, seed, keyframe) and
 *  `key` (the finished clip: + its length to the frame, the run plan, the stretch limit, the enlarged size). */
export function i2vJob(p, shot, D, s = loadSettings()) {
  const v = videoSettings(s), plan = clipPlan(D || 5, v), { prompt, negative } = wanPrompt(p, shot);
  const seed = parseInt(hash(p.id, shot.id, 'i2v').slice(0, 8), 16), aspect = p.options.aspect, target = clipTarget(p, s);
  const base = imgHash => hash('wan-v2', imgHash, v.unet, v.clip, v.vae, v.steps, v.cfg, plan.fps, aspect, prompt, negative, seed);
  return {
    prompt, negative, seed, fps: plan.fps, aspect, plan, target, seconds: round(plan.need / plan.fps, 3), base,
    key: imgHash => hash(base(imgHash), plan.need, plan.runs, v.maxStretch, target ? [target.w, target.h, v.upscaler || 'auto'] : 'native'),
  };
}

/** Can the Wan runs already made for a shot be used, and how many of the planned runs are already there? */
function chainState(p, m, job, ih, v, force) {
  const base = job.base(ih), plan = job.plan, runs = m?.runs ?? [];
  const ok = r => !!r?.file && fs.existsSync(fileOf(p.id, r.file));
  // a small change of length keeps the frames: stretch them a little, or trim them, instead of a new Wan run
  if (!force && m?.chain?.base === base && runs.length === m.chain.n && runs.every(ok) && m.chain.frames * v.maxStretch >= plan.need && m.chain.frames >= 0.85 * plan.raw) return { reuse: true, keep: runs.length, wan: 0, frames: m.chain.frames };
  let keep = 0;
  while (!force && keep < plan.runs.length && runs[keep]?.key === hash(base, plan.runs.slice(0, keep + 1)) && ok(runs[keep])) keep++;
  return { reuse: false, keep, wan: plan.runs.slice(keep).reduce((a, b) => a + b, 0) };
}

// ---------------------------------------------------------------- measured speed, for the time estimate
const RATES = () => path.join(STUDIO, 'motion-rates.json');
// seconds per frame: Wan at the 8 GB size (832×480, 20 steps, fp8 weights) / the native size; enlarging with the model
// (4x-UltraSharp on a 3060 Ti, transfers and the chunk encode included) / with ffmpeg; stretching + the final encode
const RATE0 = { wan: { safe: 4.5, native: 14 }, up: { model: 2.5, lanczos: 0.05, none: 0.02 }, conform: 0.12 };
function rates() {
  const r = readJSON(RATES(), {});
  return { wan: { ...RATE0.wan, ...r.wan }, up: { ...RATE0.up, ...r.up }, conform: Number(r.conform) || RATE0.conform, measured: r.measured ?? {} };
}
function learn(group, key, spf) {
  if (!(spf > 0) || !Number.isFinite(spf)) return;
  try {
    const r = readJSON(RATES(), {}), id = `${group}.${key}`, seen = r.measured?.[id];
    const cur = group === 'conform' ? r.conform : r[group]?.[key];
    const next = round(seen && cur ? cur * 0.5 + spf * 0.5 : spf, 4); // the first measurement replaces the guess
    if (group === 'conform') r.conform = next; else (r[group] ??= {})[key] = next;
    r.measured = { ...r.measured, [id]: true };
    writeJSON(RATES(), r);
  } catch { /* best effort */ }
}

// ---------------------------------------------------------------- the clip of one shot
/** Wan size and weights for this ComfyUI: 832×480 + fp8 storage under 12 GB of VRAM, the native size from 15 GB. */
async function wanContext(s, aspect, signal) {
  const v = videoSettings(s);
  if (!(await hasNode(s, 'Wan22ImageToVideoLatent', signal))) throw new Error(t('noWanNode'));
  const stats = await comfy(s, '/system_stats', { signal }).catch(e => { checkAbort(signal); return {}; });
  const vram = (stats.devices?.[0]?.vram_total ?? 0) / 2 ** 30, cls = vram >= 15 ? 'native' : 'safe';
  // the fp16 5B weights are 9.3 GB: on a small card store them as fp8 (≈4.7 GB) so they fit next to the activations
  // and 16 GB of RAM still holds the 6.3 GB text encoder too
  return { ...(I2V_SIZES[cls][aspect] ?? I2V_SIZES[cls]['16:9']), cls, fp8: vram > 0 && vram < 12 && !/fp8/i.test(v.unet) };
}

/** How clips get enlarged on this ComfyUI: the upscale model when it is there, else ffmpeg (said why, once). */
async function upscalerFor(s, signal) {
  const v = videoSettings(s);
  if (!v.upscale) return { method: 'none' };
  if (/^(lanczos|ffmpeg|fast)$/i.test(v.upscaler)) return { method: 'lanczos' };
  try {
    const [loader, apply, scale] = await Promise.all(['UpscaleModelLoader', 'ImageUpscaleWithModel', 'ImageScale'].map(c => nodeInfo(s, c, signal)));
    if (!loader || !apply || !scale) return { method: 'lanczos', wanted: true, why: t('noUpNodes') };
    const list = choices(loader, 'model_name') ?? [];
    const model = [v.upscaler, s.image?.upscaler].filter(Boolean).map(w => pickModel(list, w)).find(Boolean) ?? list.find(f => /ultra.?sharp/i.test(f));
    if (!model) return { method: 'lanczos', wanted: true, why: v.upscaler ? t('upModelGone', { name: v.upscaler, list: list.slice(0, 8).join(', ') || '—' }) : t('noUpModel') };
    const [batch, webm] = await Promise.all([hasNode(s, 'ImageBatch', signal), hasNode(s, 'SaveWEBM', signal)]);
    return { method: 'model', wanted: true, model, batch, webm };
  } catch (e) {
    checkAbort(signal);
    return { method: 'lanczos', wanted: true, why: e.message };
  }
}

/** One Wan run: keyframe (or the last frame of the run before) → `length` PNG frames in outDir. */
async function wanRun(s, ctx, { imageFile, prompt, negative, length, seed, label, signal, outDir }) {
  const v = videoSettings(s);
  const name = await upload(s, imageFile, signal);
  const graph = buildI2VGraph({ image: name, prompt, negative, width: ctx.w, height: ctx.h, length, seed, steps: v.steps, cfg: v.cfg,
    unet: v.unet, clip: v.clip, vae: v.vae, weightDtype: ctx.fp8 ? 'fp8_e4m3fn' : 'default', prefix: `hakawati/i2v-${hash(label, seed, Date.now())}` });
  const imgs = await execute(s, graph, { signal, minutes: 120 });
  if (!imgs.length) throw new Error(t('i2vEmpty'));
  fs.mkdirSync(outDir, { recursive: true });
  for (const [i, img] of imgs.entries()) { checkAbort(signal); fs.writeFileSync(path.join(outDir, `${pad(i)}.png`), await view(s, img, signal)); }
  return imgs.length;
}

/** F frames → exactly `need`: motion-compensated interpolation (frame blending if that fails); the first and the
 *  last frame stay where they are, everything between is spread evenly. minterpolate stops a couple of frames before
 *  its last input, so the input gets a few copies of its last frame first — the tail is interpolated, not cloned. */
async function stretchFrames(src, F, need, fps, dst, signal) {
  fs.mkdirSync(dst, { recursive: true });
  const k = (need - 1) / Math.max(1, F - 1);
  const pre = `tpad=stop_mode=clone:stop=4,settb=1/${fps * 10000},setpts=N*${k.toFixed(6)}/${fps}/TB`;
  for (const [how, mi] of [['mci', 'mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=none'], ['blend', 'mi_mode=blend:scd=none']]) {
    for (const f of fs.readdirSync(dst)) fs.rmSync(path.join(dst, f), { force: true });
    try {
      await ffmpeg([...seqInput(src, fps), '-vf', `${pre},minterpolate=fps=${fps}:${mi}`, '-frames:v', String(need), '-fps_mode', 'passthrough', '-start_number', '0', path.join(dst, '%05d.png')], signal);
      const n = pngs(dst);
      if (n >= need - 1) { if (n < need) fs.copyFileSync(path.join(dst, `${pad(n - 1)}.png`), path.join(dst, `${pad(n)}.png`)); return how; }
    } catch (e) { if (e.cancelled || signal?.aborted) throw e; }
  }
  throw new Error('ffmpeg could not stretch the clip');
}

/** Enlarge frames 0…need-1 of `src` with the upscale model, a chunk of frames per ComfyUI job, into the clip `out`. */
async function upscaleWithModel(s, up, { src, need, target, fps, tag, out, dir, signal }) {
  const K = up.batch ? 12 : 1, parts = path.join(dir, 'parts');
  fs.mkdirSync(parts, { recursive: true });
  const got = [];
  for (let i0 = 0; i0 < need; i0 += K) {
    checkAbort(signal);
    const images = [];
    for (let i = i0; i < Math.min(need, i0 + K); i++) images.push(await upload(s, path.join(src, `${pad(i)}.png`), signal, { type: 'temp', subfolder: 'hakawati', name: `${tag}-${pad(i)}.png` }));
    const files = await execute(s, buildUpscaleGraph({ images, model: up.model, width: target.w, height: target.h, fps, webm: up.webm, prefix: `hakawati/up-${tag}-${pad(i0)}` }), { signal, minutes: 20 });
    if (!files.length) throw new Error(t('i2vEmpty'));
    for (const f of files) { const local = path.join(parts, `${pad(got.length)}${path.extname(f.filename) || '.png'}`); fs.writeFileSync(local, await view(s, f, signal)); got.push(local); }
  }
  if (up.webm) { // the chunks are short VP9 videos: joined by ffmpeg's concat demuxer and encoded once more
    const list = path.join(parts, 'list.txt');
    fs.writeFileSync(list, got.map(f => `file '${path.basename(f)}'`).join('\n'));
    await encode({ input: ['-f', 'concat', '-safe', '0', '-i', list], vf: `setpts=N/(${fps}*TB),scale=${target.w}:${target.h}`, out, fps, frames: need, signal });
  } else await encode({ input: seqInput(parts, fps), vf: `scale=${target.w}:${target.h}`, out, fps, frames: need, signal });
}

/**
 * Make (or finish) the clip of one shot: the Wan runs that are missing, joined; stretched or trimmed to the shot's
 * frames; enlarged; encoded. Fills m.runs / m.chain / m.video and calls save() after every run.
 */
async function makeClip(p, sh, { D, img, ih, s, ctx, up, force, signal, log, save, onRun = () => {} }) {
  const v = videoSettings(s), job = i2vJob(p, sh, D, s), plan = job.plan, m = p.assets.motion[sh.id];
  const st = chainState(p, m, job, ih, v, force), baseKey = job.base(ih), sec = { wan: 0, stretch: 0, up: 0, enc: 0 };
  const dir = tmpDir();
  try {
    // 1. the Wan runs — each next one starts from the last frame of the one before
    if (!st.reuse) {
      m.runs = (m.runs ?? []).slice(0, st.keep); m.chain = null;
      let last = null; // the last frame of the newest run, straight from ComfyUI (lossless)
      for (let k = st.keep; k < plan.runs.length; k++) {
        checkAbort(signal);
        if (k && !last) { // resuming a chain: the last frame of the run made earlier
          const r = m.runs[k - 1];
          last = path.join(dir, `last${k}.png`);
          await ffmpeg(['-i', fileOf(p.id, r.file), '-vf', `select=eq(n\\,${r.frames - 1})`, '-fps_mode', 'passthrough', '-frames:v', '1', last], signal);
        }
        log(t('wanRun', { id: sh.id, k: k + 1, n: plan.runs.length, w: ctx.w, h: ctx.h, frames: plan.runs[k], fp8: ctx.fp8, cont: k > 0 }));
        const t0 = Date.now(), out = path.join(dir, `run${k}`);
        const n = await wanRun(s, ctx, { imageFile: k ? last : img, prompt: k ? `${job.prompt}. ${CONTINUE}` : job.prompt, negative: job.negative, length: plan.runs[k], seed: job.seed + k, label: sh.id, signal, outDir: out });
        const took = (Date.now() - t0) / 1000;
        sec.wan += took; learn('wan', ctx.cls, took / n);
        const file = `motion/${sh.id}.r${k + 1}.mp4`;
        fs.mkdirSync(fileOf(p.id, 'motion'), { recursive: true });
        await encode({ input: seqInput(out, plan.fps), out: fileOf(p.id, file), fps: plan.fps, frames: n, crf: 10, signal }); // the master: visually lossless
        m.runs[k] = { key: hash(baseKey, plan.runs.slice(0, k + 1)), file, frames: n, w: ctx.w, h: ctx.h, sec: round(took, 1) };
        last = path.join(out, `${pad(n - 1)}.png`);
        m.at = Date.now(); save();
        log(t('wanRunDone', { id: sh.id, k: k + 1, n: plan.runs.length, took: dur(took), spf: round(took / n, 2) }));
        onRun(k + 1, plan.runs.length);
      }
      for (let k = plan.runs.length; fs.existsSync(fileOf(p.id, `motion/${sh.id}.r${k + 1}.mp4`)); k++) fs.rmSync(fileOf(p.id, `motion/${sh.id}.r${k + 1}.mp4`), { force: true }); // runs of a longer plan
      m.chain = { base: baseKey, n: m.runs.length, frames: m.runs.reduce((a, r, k) => a + r.frames - (k ? 1 : 0), 0) };
      save();
    }
    // 2. joined: every run after the first drops its first frame (the start picture, already the last of the run before)
    const t1 = Date.now(), chain = path.join(dir, 'chain');
    fs.mkdirSync(chain);
    for (const [k, r] of m.runs.entries()) await ffmpeg(['-i', fileOf(p.id, r.file), ...(k ? ['-vf', 'select=gte(n\\,1)'] : []), '-fps_mode', 'passthrough', '-start_number', String(pngs(chain)), path.join(chain, '%05d.png')], signal);
    const F = pngs(chain);
    // 3. to the shot's length, to the frame
    let src = chain, how = '';
    if (F < plan.need) {
      src = path.join(dir, 'conform');
      how = await stretchFrames(chain, F, plan.need, plan.fps, src, signal);
      sec.stretch = (Date.now() - t1) / 1000;
      log(t('stretched', { id: sh.id, from: F, to: plan.need, k: round(plan.need / F, 2), how, sec: round(sec.stretch, 1) }));
    }
    // 4. enlarged and encoded
    const t2 = Date.now(), out = path.join(dir, 'clip.mp4'), target = job.target;
    let upWith = 'native', fallback = false;
    if (target && up.method === 'model') {
      try {
        await upscaleWithModel(s, up, { src, need: plan.need, target, fps: plan.fps, tag: hash(p.id, sh.id, Date.now()).slice(0, 10), out, dir, signal });
        upWith = up.model;
      } catch (e) {
        if (e.cancelled || signal?.aborted) throw e;
        log(t('upFallback', { why: t('upFailed', { id: sh.id, e: e.message.slice(0, 200) }) }));
        fallback = true;
      }
    }
    if (target && upWith === 'native') {
      await encode({ input: seqInput(src, plan.fps), vf: `scale=${target.w}:${target.h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${target.w}:${target.h},unsharp=5:5:0.6:5:5:0,setsar=1`, out, fps: plan.fps, frames: plan.need, signal });
      upWith = 'lanczos'; fallback ||= !!up.wanted;
    } else if (!target) await encode({ input: seqInput(src, plan.fps), out, fps: plan.fps, frames: plan.need, signal });
    const took = (Date.now() - t2) / 1000;
    if (target) { sec.up = took; learn('up', upWith === 'lanczos' ? 'lanczos' : 'model', took / plan.need); } else sec.enc = took;
    learn('conform', '', ((Date.now() - t1) / 1000 - (target ? took : 0)) / plan.need);
    if (target) log(t('enlarged', { id: sh.id, frames: plan.need, w: target.w, h: target.h, how: upWith, took: dur(took), spf: round(took / plan.need, 2) }));
    const file = `motion/${sh.id}.mp4`;
    fs.mkdirSync(fileOf(p.id, 'motion'), { recursive: true });
    fs.copyFileSync(out, fileOf(p.id, file));
    const size = sizeOf(out) ?? { w: ctx.w, h: ctx.h }, frames = frameCount(out) || plan.need;
    m.video = { key: job.key(ih), file, fps: plan.fps, frames, w: size.w, h: size.h, runs: m.runs.length, raw: F, stretch: F < plan.need ? round(plan.need / F, 3) : 1, how: how || (F > plan.need ? 'trim' : 'exact'),
      upscaled: upWith, ...(fallback && { fallback: true }), sec: Object.fromEntries(Object.entries(sec).map(([k, x]) => [k, round(x, 1)])) };
    m.at = Date.now(); save();
    return m.video;
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

/** The depth map and clip the player may use for a shot: made from the current keyframe, and switched on. A clip made
 *  for an older length still plays (the player slows it to fit rather than freezing); the storyboard calls it pending. */
export function motionOf(p, shot, s = loadSettings()) {
  const m = p.assets.motion?.[shot.id], a = p.assets.art?.[shot.id];
  if (!m || !a?.image || !fs.existsSync(fileOf(p.id, a.image)) || m.key !== fileHash(fileOf(p.id, a.image))) return { depth: null, video: null };
  const ok = x => !!x?.file && fs.existsSync(fileOf(p.id, x.file));
  return { depth: videoSettings(s).depth && ok(m.depth) ? m.depth : null, video: wantsClip(shot, s) && ok(m.video) ? m.video : null };
}

/**
 * The motion step. Depth maps first for every story shot with a painted keyframe (quick; the film already has
 * parallax if the night is cut short), then a clip for every shot that wants one (see wantsClip), logging the time
 * estimate first and elapsed/left after each clip. Cached in p.assets.motion[id] = { key: keyframe hash,
 * depth: {key, file}, runs: [{key, file, frames…}], chain: {base, n, frames}, video: {key, file, fps, frames, w, h…}, at }.
 * One failing clip does not stop the others (it is logged, and its shot keeps the still); ComfyUI going away does.
 */
export async function makeMotion(p, { shots, tl, force, signal, log = () => {}, prog = () => {}, save = () => {} }) {
  const s = loadSettings(), v = videoSettings(s);
  p.assets.motion ??= {};
  for (const id of Object.keys(p.assets.motion)) if (!tl.shots.some(r => r.id === id)) delete p.assets.motion[id];
  const has = f => !!f && fs.existsSync(fileOf(p.id, f));
  const list = shots.filter(sh => sh.kind === 'shot' && has(p.assets.art[sh.id]?.image));
  const clips = list.filter(sh => wantsClip(sh, s));
  if (!list.length || (!v.depth && !clips.length)) { log(t('motionNone')); save(); return; }
  log(t('motionStart', { n: list.length, depth: v.depth, clips: clips.length }));
  const kf = new Map();
  for (const sh of list) {
    const img = fileOf(p.id, p.assets.art[sh.id].image), ih = fileHash(img);
    if (p.assets.motion[sh.id]?.key !== ih) p.assets.motion[sh.id] = { key: ih, depth: null, video: null, runs: [], chain: null, at: Date.now() }; // a new keyframe: start over
    kf.set(sh.id, { img, ih });
  }
  const D = id => tl.shots.find(r => r.id === id)?.D;

  // what the clips need, before anything runs: their GPU time is the long part of the night
  const jobs = clips.map(sh => {
    const { ih } = kf.get(sh.id), m = p.assets.motion[sh.id], job = i2vJob(p, sh, D(sh.id), s);
    const done = !force && m.video?.key === job.key(ih) && has(m.video.file);
    return { sh, job, done, st: chainState(p, m, job, ih, v, force) };
  });
  let todo = jobs.filter(j => !j.done), ctx = null, up = { method: 'none' };
  const upgradable = jobs.filter(j => j.done && p.assets.motion[j.sh.id].video?.fallback);
  if (todo.length || upgradable.length) {
    try {
      ctx = await wanContext(s, p.options.aspect, signal);
      up = await upscalerFor(s, signal);
    } catch (e) { if (e.cancelled || signal?.aborted || todo.length) throw e; ctx = null; } // nothing to make: an absent ComfyUI is no error
    if (ctx && up.method === 'model') todo = [...todo, ...upgradable]; // enlarged with ffmpeg last time: the model is here now
  }
  const R = rates(), upHow = j => (j.job.target ? (up.method === 'model' ? 'model' : 'lanczos') : 'none');
  const est = (j, r = rates()) => j.st.wan * r.wan[ctx?.cls ?? 'safe'] + j.job.plan.need * (r.up[upHow(j)] + r.conform);
  if (clips.length) log(t('clipPlan', { n: clips.length, make: todo.length, ready: jobs.length - todo.length, still: v.coverage === 'marked' ? list.length - clips.length : 0 }));
  if (todo.length) {
    if (up.why) log(t('upFallback', { why: up.why }));
    const wan = todo.reduce((a, j) => a + j.st.wan, 0), upF = todo.reduce((a, j) => a + (j.job.target ? j.job.plan.need : 0), 0), all = todo.reduce((a, j) => a + j.job.plan.need, 0);
    const how = up.method === 'model' ? up.model : 'ffmpeg lanczos', keys = [`wan.${ctx.cls}`, ...(upF ? [`up.${up.method === 'model' ? 'model' : 'lanczos'}`] : [])];
    log(t('budget', { total: dur(todo.reduce((a, j) => a + est(j, R), 0)), wan, wanT: dur(wan * R.wan[ctx.cls]), up: upF, how, upT: dur(upF * R.up[up.method === 'model' ? 'model' : 'lanczos']),
      otherT: dur(all * R.conform), src: keys.every(k => R.measured[k]) ? t('rateMeasured') : t('rateGuess') }));
  }

  // L1: depth maps
  let depthOn = v.depth;
  const share = todo.length ? 0.05 : 1;
  for (const [i, sh] of list.entries()) {
    checkAbort(signal);
    if (!depthOn) break;
    const { img, ih } = kf.get(sh.id), m = p.assets.motion[sh.id];
    if (force || m.depth?.key !== depthKey(ih) || !has(m.depth.file)) {
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
    prog(share * (i + 1) / list.length, t('stMotion', { i: i + 1, n: list.length }));
  }

  // L2: the clips, one after another
  const t0 = Date.now(), failed = [];
  for (const [i, j] of todo.entries()) {
    checkAbort(signal);
    const { sh, job, st } = j, { img, ih } = kf.get(sh.id), plan = job.plan;
    const at = k => prog(share + (1 - share) * Math.min(1, (i + k) / todo.length), t('stClip', { i: i + 1, n: todo.length, id: sh.id }));
    at(0);
    log(t('clipStart', { i: i + 1, n: todo.length, id: sh.id, sec: round(D(sh.id) ?? plan.need / plan.fps, 2),
      runs: st.reuse ? t('runsKept', { frames: st.frames }) : t('runsNew', { n: plan.runs.length, frames: plan.runs[0], kept: st.keep }),
      stretch: (st.reuse ? st.frames : plan.raw) < plan.need ? round(plan.need / (st.reuse ? st.frames : plan.raw), 2) : 0, target: job.target ? `${job.target.w}×${job.target.h}` : '', eta: dur(est(j)) }));
    try {
      const r = await makeClip(p, sh, { D: D(sh.id), img, ih, s, ctx, up, force, signal, log, save, onRun: (k, n) => at(0.8 * k / n) });
      const left = todo.slice(i + 1).reduce((a, x) => a + est({ ...x, st: chainState(p, p.assets.motion[x.sh.id], x.job, kf.get(x.sh.id).ih, v, force) }), 0);
      log(t('clipDone', { id: sh.id, frames: r.frames, sec: round(r.frames / r.fps, 2), el: dur((Date.now() - t0) / 1000), left: dur(left),
        stages: t('stages', { wan: r.sec.wan ? dur(r.sec.wan) : '', stretch: r.sec.stretch ? dur(r.sec.stretch) : '', up: r.sec.up ? dur(r.sec.up) : '', enc: r.sec.enc ? dur(r.sec.enc) : '' }) }));
    } catch (e) {
      if (e.cancelled || signal?.aborted || e.comfyDown) throw e;
      failed.push(sh.id);
      log(t('clipFail', { id: sh.id, e: String(e.message).slice(0, 300) }));
    }
    at(1);
  }
  if (todo.length) log(t('clipsDone', { n: todo.length - failed.length, took: dur((Date.now() - t0) / 1000) }));
  if (failed.length) log(t('clipsFailed', { n: failed.length, ids: failed.join(', ') }));
  save();
  log(t('motionDone'));
}
