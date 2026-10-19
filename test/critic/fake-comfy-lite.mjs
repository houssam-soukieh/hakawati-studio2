// A minimal fake ComfyUI for the critic tests (the faithful one is test/fake-comfy.mjs, built elsewhere). Paints
// ffmpeg's testsrc2 at the graph's size; its brightness tells the fake critic what happened: dark for a plain prompt,
// bright once the prompt carries the fake critic's correction ("bright clean daylight"); the seed shifts it a little so
// candidates differ. Routes: POST /prompt, GET /history/{id}, GET /view, GET /object_info/{cls}, GET /system_stats,
// POST /upload/image, GET /__log.
//   node test/critic/fake-comfy-lite.mjs [port=4872]
import http from 'node:http';
import { spawnSync } from 'node:child_process';

const PORT = Number(process.argv[2] || process.env.FAKE_COMFY_PORT || 4872);
const jobs = new Map(), files = new Map(), LOG = [];
let n = 0;

function picture({ width, height, brightness }) {
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=s=${width}x${height}`, '-frames:v', '1', '-vf', `eq=brightness=${brightness}`, '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'], { maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(String(r.stderr));
  return r.stdout;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  let body = Buffer.alloc(0);
  for await (const c of req) body = Buffer.concat([body, c]);
  const [, a, b] = url.pathname.split('/');
  if (req.method === 'GET' && a === '__log') return send(200, LOG);
  if (req.method === 'GET' && a === 'system_stats') return send(200, { system: { comfyui_version: 'fake-lite' }, devices: [{ name: 'Fake GPU 8 GB', vram_total: 8 * 2 ** 30 }] });
  if (req.method === 'GET' && a === 'object_info') {
    if (b === 'CheckpointLoaderSimple') return send(200, { CheckpointLoaderSimple: { input: { required: { ckpt_name: [['fake-xl-lightning.safetensors']] } } } });
    return send(200, {}); // no IP-Adapter here
  }
  if (req.method === 'POST' && a === 'upload' && b === 'image') return send(200, { name: `upload-${++n}.png`, subfolder: '', type: 'input' });
  if (req.method === 'POST' && a === 'prompt') {
    const g = JSON.parse(String(body)).prompt ?? {};
    const text = g[2]?.inputs?.text, latent = g[4]?.inputs, seed = g[5]?.inputs?.seed;
    if (typeof text !== 'string' || !latent?.width || !Number.isInteger(seed) || !g[1]?.inputs?.ckpt_name) return send(400, { error: { message: 'bad graph' }, node_errors: {} });
    const id = `fake-${++n}`;
    const bright = /bright clean daylight/.test(text);
    const brightness = (bright ? 0.2 : -0.3) + (seed % 5) * 0.03;
    jobs.set(id, { at: Date.now(), file: `hakawati_${String(n).padStart(5, '0')}_.png`, width: latent.width, height: latent.height, brightness });
    LOG.push({ id, seed, width: latent.width, height: latent.height, bright, brightness: Math.round(brightness * 100) / 100, prompt: text.slice(0, 200) });
    return send(200, { prompt_id: id, number: n, node_errors: {} });
  }
  if (req.method === 'GET' && a === 'history') {
    const j = jobs.get(decodeURIComponent(b));
    if (!j || Date.now() - j.at < 300) return send(200, {}); // still "painting"
    if (!files.has(j.file)) files.set(j.file, picture(j));
    return send(200, { [b]: { outputs: { 7: { images: [{ filename: j.file, subfolder: '', type: 'output' }] } }, status: { status_str: 'success', completed: true, messages: [] } } });
  }
  if (req.method === 'GET' && a === 'view') {
    const f = files.get(url.searchParams.get('filename'));
    if (!f) return send(404, { error: 'no such file' });
    res.writeHead(200, { 'content-type': 'image/png' });
    return res.end(f);
  }
  send(404, { error: `no route ${url.pathname}` });
}).listen(PORT, '127.0.0.1', () => console.log(`fake-comfy-lite on http://127.0.0.1:${PORT}`));
