// A minimal stand-in for ComfyUI, just enough for the motion tests (no GPU here): it checks the graphs it is sent
// against the real node names and inputs, and "renders" test patterns with ffmpeg:
//   EmptyLatentImage graph (SDXL keyframe)  → a smooth random texture (no repeats, so shifts can be measured)
//   DepthAnythingV2Preprocessor graph       → a vertical gradient: top black (far) → bottom white (near)
//   Wan22ImageToVideoLatent graph           → `length` frames, each a barcode of its own frame number (8 bars, bit i
//                                             = bar i, white = 1), so the test can read back which frame is on screen
// The full fake for the picture step lives on another branch (test/fake-comfy.mjs); this one only covers motion.
//   node test/motion/fake-comfy-motion.mjs [--port 8195] [--dir /tmp/x] [--no-depth]
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
  }
  return errs;
}

export function startFakeComfy({ port = 8195, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-comfy-')), noDepth = false } = {}) {
  const IN = path.join(dir, 'input'), OUT = path.join(dir, 'output');
  fs.mkdirSync(IN, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
  const history = {}, opts = { noDepth };
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
    const saveNode = Object.entries(g).find(([, x]) => x.class_type === 'SaveImage');
    const prefix = saveNode[1].inputs.filename_prefix;
    const wan = node('Wan22ImageToVideoLatent'), depth = node('DepthAnythingV2Preprocessor'), empty = node('EmptyLatentImage');
    let images;
    if (wan) {
      const { width: w, height: h, length } = wan.inputs;
      const fps = 24;
      images = save(prefix, length, pat => ff(['-f', 'lavfi', '-i', `color=c=gray:s=${w}x${h}:r=${fps}`, '-frames:v', String(length),
        '-vf', "geq=lum='if(bitand(N\\,pow(2\\,floor(X*8/W)))\\,235\\,16)':cb=128:cr=128", '-start_number', '1', pat]));
    } else if (depth) {
      const src = path.join(IN, node('LoadImage').inputs.image);
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
        return json(res, 200, REQUIRED[cls] && !(noDepth && cls === 'DepthAnythingV2Preprocessor') ? { [cls]: INFO[cls] ?? { input: { required: {} } } } : {});
      }
      if (url.pathname === '/upload/image' && req.method === 'POST') {
        const fd = await new Request('http://x/', { method: 'POST', headers: req.headers, body: await body(req) }).formData();
        const f = fd.get('image');
        fs.writeFileSync(path.join(IN, path.basename(f.name)), Buffer.from(await f.arrayBuffer()));
        return json(res, 200, { name: path.basename(f.name), subfolder: '', type: 'input' });
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
        const root = url.searchParams.get('type') === 'input' ? IN : OUT;
        const file = path.join(root, url.searchParams.get('subfolder') ?? '', path.basename(url.searchParams.get('filename') ?? ''));
        if (!file.startsWith(root) || !fs.existsSync(file)) return json(res, 404, { error: 'not found' });
        res.writeHead(200, { 'content-type': 'image/png' });
        return res.end(fs.readFileSync(file));
      }
      json(res, 404, { error: 'unknown route' });
    } catch (e) { json(res, 500, { error: { message: e.message } }); }
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, dir, port, graphs: () => fs.readFileSync(path.join(dir, 'graphs.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)), close: () => new Promise(r => server.close(r)) })));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const f = await startFakeComfy({ port: Number(arg('port', 8195)), dir: arg('dir') && (fs.mkdirSync(arg('dir'), { recursive: true }), arg('dir')), noDepth: process.argv.includes('--no-depth') });
  console.log(`fake ComfyUI (motion) on http://127.0.0.1:${f.port} — files in ${f.dir}`);
}
