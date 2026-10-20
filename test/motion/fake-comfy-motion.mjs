// A minimal stand-in for ComfyUI, just enough for the motion tests (no GPU here): it checks the graphs it is sent
// against the real node names and inputs, and "renders" test patterns with ffmpeg:
//   EmptyLatentImage graph (SDXL keyframe)  → a smooth random texture (no repeats, so shifts can be measured)
//   DepthAnythingV2Preprocessor graph       → a vertical gradient: top black (far) → bottom white (near)
//   Wan22ImageToVideoLatent graph           → `length` frames, each a barcode of its own frame number (8 bars, bit i
//                                             = bar i, white = 1), so the test can read back which frame is on screen;
//                                             a run that starts from a barcode frame (a chained run) continues its
//                                             numbering, so a joined chain reads 0, 1, 2… across the seam
//   ImageUpscaleWithModel graph             → the LoadImage frames (ImageBatch order) scaled to ImageScale's size,
//                                             saved by SaveWEBM (VP9 .webm) or PreviewImage (temp PNGs)
// Uploads honour type=temp, and LoadImage resolves "sub/name.png [temp]" like ComfyUI's annotated paths.
// The full fake for the picture step lives on another branch (test/fake-comfy.mjs); this one only covers motion.
//   node test/motion/fake-comfy-motion.mjs [--port 8195] [--dir /tmp/x] [--no-depth] [--no-upscaler]
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const REQUIRED = {
  CheckpointLoaderSimple: ['ckpt_name'], CLIPTextEncode: ['text', 'clip'], EmptyLatentImage: ['width', 'height', 'batch_size'],
  KSampler: ['model', 'positive', 'negative', 'latent_image', 'seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'],
  VAEDecode: ['samples', 'vae'], SaveImage: ['images', 'filename_prefix'], LoadImage: ['image'],
  DepthAnythingV2Preprocessor: ['image'],
  UNETLoader: ['unet_name', 'weight_dtype'], CLIPLoader: ['clip_name', 'type'], VAELoader: ['vae_name'], ModelSamplingSD3: ['model', 'shift'],
  Wan22ImageToVideoLatent: ['vae', 'width', 'height', 'length', 'batch_size'],
  UpscaleModelLoader: ['model_name'], ImageUpscaleWithModel: ['upscale_model', 'image'], ImageScale: ['image', 'upscale_method', 'width', 'height', 'crop'],
  ImageBatch: ['image1', 'image2'], SaveWEBM: ['images', 'filename_prefix', 'codec', 'fps', 'crf'], PreviewImage: ['images'],
};
const DEPTH_CKPTS = ['depth_anything_v2_vitg.pth', 'depth_anything_v2_vitl.pth', 'depth_anything_v2_vitb.pth', 'depth_anything_v2_vits.pth'];
const INFO = {
  CheckpointLoaderSimple: { input: { required: { ckpt_name: [['fake-sdxl.safetensors']] } } },
  DepthAnythingV2Preprocessor: { input: { required: { image: ['IMAGE'] }, optional: { ckpt_name: [DEPTH_CKPTS, { default: 'depth_anything_v2_vitl.pth' }], resolution: ['INT', { default: 512, min: 64, max: 16384, step: 64 }] } } },
  Wan22ImageToVideoLatent: { input: { required: { vae: ['VAE'], width: ['INT', { default: 1280, step: 32 }], height: ['INT', { default: 704, step: 32 }], length: ['INT', { default: 49, step: 4 }], batch_size: ['INT', { default: 1 }] }, optional: { start_image: ['IMAGE'] } } },
};

function ff(args, input) {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { input });
  if (r.status !== 0) throw new Error(`ffmpeg: ${String(r.stderr).slice(-300)}`);
}
function sizeOf(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
  const [w, h] = String(r.stdout).trim().split(',').map(Number);
  return { w, h };
}

/** Where an annotated LoadImage name ("sub/x.png [temp]") lives. */
function resolveImage(name, dirs) {
  const m = /^(.*) \[(input|temp|output)\]$/.exec(name);
  const [rel, type] = m ? [m[1], m[2]] : [name, 'input'];
  const root = dirs[type], file = path.join(root, rel);
  return file.startsWith(root) ? file : null;
}
/** The frame number a barcode picture shows, or null when it is not a barcode (e.g. a painted keyframe). */
function barcodeOf(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'scale=64:8:flags=neighbor,format=gray', '-f', 'rawvideo', 'pipe:1']);
  const px = r.stdout;
  if (!px || px.length < 512) return null;
  let n = 0;
  for (let i = 0; i < 8; i++) {
    const col = Array.from({ length: 8 }, (_, y) => px[y * 64 + i * 8 + 4]);
    if (col.every(v => v > 200)) n |= 1 << i; else if (!col.every(v => v < 50)) return null;
  }
  return n;
}

/** Problems with a graph, ComfyUI-style ({ nodeId: { class_type, errors: [{message, details}] } }). */
function validate(g, opts) {
  const errs = {};
  const bad = (id, message, details = '') => { (errs[id] ??= { class_type: g[id]?.class_type, errors: [] }).errors.push({ message, details }); };
  for (const [id, n] of Object.entries(g)) {
    const need = REQUIRED[n.class_type];
    if (!need || (n.class_type === 'DepthAnythingV2Preprocessor' && opts.noDepth)) { bad(id, `unknown node ${n.class_type}`); continue; }
    for (const k of need) if (n.inputs?.[k] === undefined) bad(id, 'Required input is missing', k);
    for (const [k, v] of Object.entries(n.inputs ?? {})) if (Array.isArray(v) && (v.length !== 2 || !g[v[0]])) bad(id, 'bad link', `${k} → ${JSON.stringify(v)}`);
    const i = n.inputs ?? {};
    if (n.class_type === 'Wan22ImageToVideoLatent') {
      if (i.width % 32 || i.height % 32) bad(id, 'width/height must be multiples of 32', `${i.width}×${i.height}`);
      if ((i.length - 1) % 4) bad(id, 'length must be 4k+1', String(i.length));
      if (!Array.isArray(i.start_image)) bad(id, 'image-to-video needs start_image');
    }
    if (n.class_type === 'CLIPLoader' && !['wan', 'stable_diffusion', 'sd3'].includes(i.type)) bad(id, 'bad type', i.type);
    if (n.class_type === 'UNETLoader' && !['default', 'fp8_e4m3fn', 'fp8_e4m3fn_fast', 'fp8_e5m2'].includes(i.weight_dtype)) bad(id, 'bad weight_dtype', i.weight_dtype);
    if (n.class_type === 'DepthAnythingV2Preprocessor' && ((i.resolution ?? 512) % 64 || (i.ckpt_name && !DEPTH_CKPTS.includes(i.ckpt_name)))) bad(id, 'bad depth inputs', JSON.stringify(i));
    if (n.class_type === 'LoadImage' && !(resolveImage(String(i.image), opts.dirs) && fs.existsSync(resolveImage(String(i.image), opts.dirs)))) bad(id, `Invalid image file: ${i.image}`);
    if (n.class_type === 'UpscaleModelLoader' && !opts.upscalers.includes(i.model_name)) bad(id, 'Value not in list', `model_name: '${i.model_name}' not in ${JSON.stringify(opts.upscalers)}`);
    if (n.class_type === 'ImageScale' && (!['nearest-exact', 'bilinear', 'area', 'bicubic', 'lanczos'].includes(i.upscale_method) || !['disabled', 'center'].includes(i.crop))) bad(id, 'bad ImageScale inputs', JSON.stringify(i));
    if (n.class_type === 'SaveWEBM' && !['vp9', 'av1'].includes(i.codec)) bad(id, 'bad codec', i.codec);
  }
  return errs;
}

export function startFakeComfy({ port = 8195, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-comfy-')), noDepth = false, upscalers = ['4x-UltraSharp.pth'], noWebm = false } = {}) {
  const IN = path.join(dir, 'input'), OUT = path.join(dir, 'output'), TMP = path.join(dir, 'temp');
  for (const d of [IN, OUT, TMP]) fs.mkdirSync(d, { recursive: true });
  const dirs = { input: IN, output: OUT, temp: TMP };
  const history = {}, opts = { noDepth, upscalers, dirs };
  const absent = cls => (noDepth && cls === 'DepthAnythingV2Preprocessor') || (noWebm && cls === 'SaveWEBM');
  let n = 0;
  const save = (prefix, count, make) => { // ComfyUI's naming: <subfolder>/<name>_00001_.png …
    const sub = path.dirname(prefix) === '.' ? '' : path.dirname(prefix), name = path.basename(prefix);
    fs.mkdirSync(path.join(OUT, sub), { recursive: true });
    const pattern = path.join(OUT, sub, `${name}_%05d_.png`);
    make(pattern);
    return Array.from({ length: count }, (_, i) => ({ filename: `${name}_${String(i + 1).padStart(5, '0')}_.png`, subfolder: sub, type: 'output' }));
  };
  function runGraph(g) {
    const node = cls => Object.values(g).find(x => x.class_type === cls);
    const upscale = node('ImageUpscaleWithModel');
    if (upscale) { // frames (in ImageBatch order) → the size ImageScale asks for → one .webm (SaveWEBM) or temp PNGs (PreviewImage)
      const frames = link => { const n = g[link[0]]; return n.class_type === 'ImageBatch' ? [...frames(n.inputs.image1), ...frames(n.inputs.image2)] : [resolveImage(n.inputs.image, dirs)]; };
      const list = frames(upscale.inputs.image), sc = node('ImageScale').inputs, seq = fs.mkdtempSync(path.join(dir, 'seq-'));
      list.forEach((f, i) => fs.copyFileSync(f, path.join(seq, `${String(i).padStart(5, '0')}.png`)));
      const vf = `scale=${sc.width}:${sc.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${sc.width}:${sc.height}`;
      const [id, webm] = Object.entries(g).find(([, x]) => x.class_type === 'SaveWEBM') ?? [];
      if (webm) {
        const prefix = webm.inputs.filename_prefix, sub = path.dirname(prefix) === '.' ? '' : path.dirname(prefix), file = `${path.basename(prefix)}_00001_.webm`;
        fs.mkdirSync(path.join(OUT, sub), { recursive: true });
        ff(['-framerate', String(webm.inputs.fps), '-start_number', '0', '-i', path.join(seq, '%05d.png'), '-vf', vf, '-c:v', 'libvpx-vp9', '-crf', String(webm.inputs.crf), '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p', path.join(OUT, sub, file)]);
        fs.rmSync(seq, { recursive: true, force: true });
        return { [id]: { images: [{ filename: file, subfolder: sub, type: 'output' }], animated: [true] } };
      }
      const [pid] = Object.entries(g).find(([, x]) => x.class_type === 'PreviewImage'), name = `ComfyUI_temp_${Math.random().toString(36).slice(2, 7)}`;
      ff(['-framerate', '24', '-start_number', '0', '-i', path.join(seq, '%05d.png'), '-vf', vf, '-start_number', '1', path.join(TMP, `${name}_%05d_.png`)]);
      fs.rmSync(seq, { recursive: true, force: true });
      return { [pid]: { images: list.map((_, i) => ({ filename: `${name}_${String(i + 1).padStart(5, '0')}_.png`, subfolder: '', type: 'temp' })) } };
    }
    const saveNode = Object.entries(g).find(([, x]) => x.class_type === 'SaveImage');
    const prefix = saveNode[1].inputs.filename_prefix;
    const wan = node('Wan22ImageToVideoLatent'), depth = node('DepthAnythingV2Preprocessor'), empty = node('EmptyLatentImage');
    let images;
    if (wan) {
      const { width: w, height: h, length } = wan.inputs;
      const fps = 24, from = barcodeOf(resolveImage(node('LoadImage').inputs.image, dirs)) ?? 0; // a chained run goes on counting
      images = save(prefix, length, pat => ff(['-f', 'lavfi', '-i', `color=c=gray:s=${w}x${h}:r=${fps}`, '-frames:v', String(length),
        '-vf', `geq=lum='if(bitand(N+${from}\\,pow(2\\,floor(X*8/W)))\\,235\\,16)':cb=128:cr=128`, '-start_number', '1', pat]));
    } else if (depth) {
      const src = resolveImage(node('LoadImage').inputs.image, dirs);
      const { w, h } = sizeOf(src), r = depth.inputs.resolution ?? 512, k = r / Math.min(w, h);
      const ew = v => Math.round(v * k / 2) * 2;
      images = save(prefix, 1, pat => ff(['-f', 'lavfi', '-i', `color=c=black:s=${ew(w)}x${ew(h)}`, '-frames:v', '1', '-vf', "format=gray,geq=lum='255*Y/(H-1)'", '-start_number', '1', pat]));
    } else if (empty) {
      // seeded colour noise at 1/4 size, upscaled smoothly: blobs of a few pixels that never repeat
      const { width: w, height: h } = empty.inputs, sw = w / 4, sh = h / 4;
      let a = (Number(node('KSampler')?.inputs.seed) || 1) >>> 0;
      const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const raw = Buffer.alloc(sw * sh * 3);
      for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(rnd() * 256);
      images = save(prefix, 1, pat => ff(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${sw}x${sh}`, '-i', 'pipe:0', '-frames:v', '1',
        '-vf', `scale=${w}:${h}:flags=bicubic`, '-start_number', '1', pat], raw));
    } else throw new Error('fake comfy: nothing to do for this graph');
    return { [saveNode[0]]: { images } };
  }

  const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const body = req => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname === '/system_stats') return json(res, 200, { system: { comfyui_version: 'fake-motion' }, devices: [{ name: 'cuda:0 Fake RTX 3060 Ti', vram_total: 8 * 2 ** 30 }] });
      if (url.pathname.startsWith('/object_info/')) {
        const cls = decodeURIComponent(url.pathname.slice(13));
        const info = cls === 'UpscaleModelLoader' ? { input: { required: { model_name: ['COMBO', { options: upscalers }] } } } : INFO[cls];
        return json(res, 200, REQUIRED[cls] && !absent(cls) ? { [cls]: info ?? { input: { required: {} } } } : {});
      }
      if (url.pathname === '/upload/image' && req.method === 'POST') {
        const fd = await new Request('http://x/', { method: 'POST', headers: req.headers, body: await body(req) }).formData();
        const f = fd.get('image'), type = ['temp', 'output'].includes(fd.get('type')) ? fd.get('type') : 'input', sub = String(fd.get('subfolder') ?? '').replace(/\.\./g, '');
        fs.mkdirSync(path.join(dirs[type], sub), { recursive: true });
        fs.writeFileSync(path.join(dirs[type], sub, path.basename(f.name)), Buffer.from(await f.arrayBuffer()));
        return json(res, 200, { name: path.basename(f.name), subfolder: sub, type });
      }
      if (url.pathname === '/prompt' && req.method === 'POST') {
        const { prompt: g } = JSON.parse(await body(req));
        fs.appendFileSync(path.join(dir, 'graphs.jsonl'), `${JSON.stringify(g)}\n`);
        const errs = validate(g, opts);
        if (Object.keys(errs).length) return json(res, 400, { error: { type: 'prompt_outputs_failed_validation', message: 'Prompt outputs failed validation' }, node_errors: errs });
        const id = `fake-${++n}`;
        json(res, 200, { prompt_id: id, number: n, node_errors: {} });
        setTimeout(() => { // finish a moment later, like a real queue
          try { history[id] = { status: { status_str: 'success', completed: true, messages: [] }, outputs: runGraph(g) }; }
          catch (e) { history[id] = { status: { status_str: 'error', completed: false, messages: [['execution_error', { node_type: 'fake', exception_message: e.message }]] }, outputs: {} }; }
        }, 150);
        return;
      }
      if (url.pathname.startsWith('/history/')) { const id = decodeURIComponent(url.pathname.slice(9)); return json(res, 200, history[id] ? { [id]: history[id] } : {}); }
      if (url.pathname === '/view') {
        const root = dirs[url.searchParams.get('type')] ?? OUT;
        const file = path.join(root, url.searchParams.get('subfolder') ?? '', path.basename(url.searchParams.get('filename') ?? ''));
        if (!file.startsWith(root) || !fs.existsSync(file)) return json(res, 404, { error: 'not found' });
        res.writeHead(200, { 'content-type': file.endsWith('.webm') ? 'video/webm' : 'image/png' });
        return res.end(fs.readFileSync(file));
      }
      json(res, 404, { error: 'unknown route' });
    } catch (e) { json(res, 500, { error: { message: e.message } }); }
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, dir, port, graphs: () => fs.readFileSync(path.join(dir, 'graphs.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)), close: () => new Promise(r => server.close(r)) })));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const f = await startFakeComfy({ port: Number(arg('port', 8195)), dir: arg('dir') && (fs.mkdirSync(arg('dir'), { recursive: true }), arg('dir')), noDepth: process.argv.includes('--no-depth'), ...(process.argv.includes('--no-upscaler') && { upscalers: [] }) });
  console.log(`fake ComfyUI (motion) on http://127.0.0.1:${f.port} — files in ${f.dir}`);
}
