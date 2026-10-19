// Real pictures from a local ComfyUI (SDXL on the GPU). The text engine writes one image prompt per shot from the
// screenplay; ComfyUI paints the keyframe; the player then moves the camera over it and lays the captions on top.
// The image model never draws text. ComfyUI API: POST /prompt → GET /history/{id} → GET /view.
// Character consistency: each character gets a reference portrait in the cast step; shots that show that character
// pass it through IP-Adapter (ComfyUI_IPAdapter_plus nodes) when they are installed and turned on.
import fs from 'node:fs';
import path from 'node:path';
import { loadSettings } from './settings.mjs';
import { IMAGE_SIZES } from './styles.mjs';
import { hash, sleep, checkAbort } from './util.mjs';
import { t } from './i18n.mjs';

export const imageOn = (s = loadSettings()) => s.image.engine === 'comfyui';
/** Everything in the settings that changes a picture (part of each image's cache key). */
export const imageSig = (s = loadSettings()) => (imageOn(s) ? hash(s.image.checkpoint, s.image.steps, s.image.cfg, s.image.sampler, s.image.scheduler, s.image.negative, s.image.ipadapter, s.image.ipWeight) : '');

const base = s => String(s.image.url || 'http://127.0.0.1:8188').replace(/\/+$/, '');

async function comfy(s, route, { method = 'GET', body, signal, raw = false } = {}) {
  let res;
  try {
    res = await fetch(`${base(s)}${route}`, { method, body: body instanceof FormData ? body : body && JSON.stringify(body), headers: body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}, signal: signal ?? AbortSignal.timeout(30000) });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(t('comfyDown', { url: base(s), e: e.cause?.code ?? e.message }));
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = text.slice(0, 600);
    try { const j = JSON.parse(text); msg = [j.error?.message, ...Object.values(j.node_errors ?? {}).flatMap(n => (n.errors ?? []).map(e => `${n.class_type}: ${e.message} ${e.details ?? ''}`))].filter(Boolean).join(' · ') || msg; } catch { /* plain text */ }
    throw new Error(`ComfyUI ${route.split('?')[0]} → HTTP ${res.status}: ${msg}`);
  }
  return raw ? Buffer.from(await res.arrayBuffer()) : res.json();
}

/** Settings → "Test": is ComfyUI up, which GPU, which checkpoints, is IP-Adapter installed. */
export async function testImageEngine() {
  const s = loadSettings();
  const stats = await comfy(s, '/system_stats');
  const ckpt = await comfy(s, '/object_info/CheckpointLoaderSimple');
  const checkpoints = ckpt?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [];
  const dev = stats.devices?.[0] ?? {};
  return {
    ok: true, version: stats.system?.comfyui_version ?? '', gpu: dev.name ?? '', vram: dev.vram_total ? Math.round(dev.vram_total / 2 ** 30 * 10) / 10 : 0,
    checkpoints, ipadapter: await hasNode(s, 'IPAdapterUnifiedLoader'),
  };
}

const nodeCache = new Map();
async function hasNode(s, cls) {
  const k = `${base(s)}|${cls}`;
  if (!nodeCache.has(k)) {
    nodeCache.set(k, comfy(s, `/object_info/${cls}`).then(j => !!j?.[cls]).catch(() => false));
  }
  return nodeCache.get(k);
}

/** The ComfyUI graph (API format): SDXL text-to-image, optionally steered by a reference image (IP-Adapter). */
export function buildWorkflow({ prompt, negative, width, height, seed, checkpoint, steps, cfg, sampler, scheduler, reference, ipWeight = 0.7, prefix = 'hakawati' }) {
  const g = {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['1', 1] } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['1', 1] } },
    4: { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    5: { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0], seed, steps, cfg, sampler_name: sampler, scheduler, denoise: 1 } },
    6: { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: prefix } },
  };
  if (reference) {
    g[10] = { class_type: 'LoadImage', inputs: { image: reference } };
    g[11] = { class_type: 'IPAdapterUnifiedLoader', inputs: { model: ['1', 0], preset: 'PLUS (high strength)' } };
    g[12] = { class_type: 'IPAdapter', inputs: { model: ['11', 0], ipadapter: ['11', 1], image: ['10', 0], weight: ipWeight, start_at: 0, end_at: 1, weight_type: 'standard' } };
    g[5].inputs.model = ['12', 0];
  }
  return g;
}

async function upload(s, file, signal) {
  const fd = new FormData();
  fd.append('image', new Blob([fs.readFileSync(file)], { type: 'image/png' }), `hakawati-${hash(fs.statSync(file).mtimeMs, file)}${path.extname(file)}`);
  fd.append('overwrite', 'true');
  const r = await comfy(s, '/upload/image', { method: 'POST', body: fd, signal });
  return r.subfolder ? `${r.subfolder}/${r.name}` : r.name;
}

/** Paint one picture. Returns a PNG Buffer. `reference` = a local image file for IP-Adapter (optional). */
export async function paint({ prompt, aspect, seed, reference, signal, log = () => {}, label = '' }) {
  const s = loadSettings();
  if (!s.image.checkpoint) throw new Error(t('noCheckpoint'));
  const { w, h } = IMAGE_SIZES[aspect] ?? IMAGE_SIZES['16:9'];
  let ref = null;
  if (reference && s.image.ipadapter) {
    if (await hasNode(s, 'IPAdapterUnifiedLoader')) ref = await upload(s, reference, signal);
    else log(t('noIpAdapter'));
  }
  const graph = buildWorkflow({ prompt, negative: s.image.negative, width: w, height: h, seed, checkpoint: s.image.checkpoint,
    steps: Number(s.image.steps) || 6, cfg: Number(s.image.cfg) || 2, sampler: s.image.sampler, scheduler: s.image.scheduler, reference: ref, ipWeight: Number(s.image.ipWeight) || 0.7 });
  const started = Date.now();
  const { prompt_id: id } = await comfy(s, '/prompt', { method: 'POST', body: { prompt: graph, client_id: 'hakawati' }, signal });
  for (;;) { // poll; the first picture after a start also loads the checkpoint (~20-40 s)
    checkAbort(signal);
    await sleep(800);
    const hist = (await comfy(s, `/history/${encodeURIComponent(id)}`, { signal }))[id];
    if (!hist) {
      if (Date.now() - started > 15 * 60e3) throw new Error(t('comfyTimeout'));
      continue;
    }
    if (hist.status?.status_str === 'error') {
      const err = hist.status.messages?.find(m => m[0] === 'execution_error')?.[1];
      throw new Error(`ComfyUI: ${err ? `${err.node_type}: ${err.exception_message}` : 'execution error'}`.trim());
    }
    const img = Object.values(hist.outputs ?? {}).flatMap(o => o.images ?? []).find(i => i.type === 'output') ?? Object.values(hist.outputs ?? {}).flatMap(o => o.images ?? [])[0];
    if (!img) { if (hist.status?.completed) throw new Error('ComfyUI: no image in the output'); continue; }
    const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? '', type: img.type ?? 'output' });
    const buf = await comfy(s, `/view?${q}`, { raw: true, signal });
    log(t('painted', { label, sec: Math.round((Date.now() - started) / 100) / 10, w, h }));
    return buf;
  }
}

/** A stable seed per picture, so re-running gives the same image unless the producer asks for a new one. */
export const seedFor = (...parts) => parseInt(hash(...parts).slice(0, 8), 16);
