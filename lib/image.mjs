// Real pictures from a local ComfyUI (SDXL on the GPU). The text engine writes one image prompt per shot from the
// screenplay; ComfyUI paints the keyframe; the player then moves the camera over it and lays the captions on top.
// The image model never draws text. Character consistency: each character gets a reference portrait in the cast
// step; shots that show that character pass it through IP-Adapter (cubiq/ComfyUI_IPAdapter_plus) when installed.
// A human's portrait is cropped to the face first and weighted 'prompt is more important' (the face carries over, the
// portrait's pose, framing, background and light do not); a being's goes whole as 'style transfer' (material and
// colour only). Every picture's negative prompt carries SAFE_NEGATIVE.
//
// ComfyUI HTTP API (checked against comfyanonymous/ComfyUI master server.py + execution.py, 2026-10):
//   POST /prompt {prompt, client_id, prompt_id?} → {prompt_id, number, node_errors}; 400 → {error:{type,message,details},
//        node_errors:{id:{errors:[{type,message,details,extra_info}], class_type}}} (the detail is in node_errors).
//   GET /history/{id} → {} until the prompt is finished, then {id:{outputs:{node:{images:[{filename,subfolder,type}]}},
//        status:{status_str:'success'|'error', completed, messages:[[event, data]…]}}}; errors arrive as
//        ['execution_error', {node_type, exception_type, exception_message…}] or ['execution_interrupted', …].
//   GET /queue → {queue_running:[[number, id, …]], queue_pending:[…]}; POST /queue {delete:[id]}; POST /interrupt
//        {prompt_id} (older builds ignore the body and interrupt whatever runs — so we only call it when ours runs).
//   POST /upload/image multipart image|type|subfolder|overwrite → {name, subfolder, type}; LoadImage takes "sub/name".
//   GET /view?filename&subfolder&type (SaveImage → type 'output'). GET /object_info/{class}: V1 nodes list choices as
//        [[…], {…}], V3 nodes (UpscaleModelLoader…) as ["COMBO", {options:[…]}]. No websocket needed: we poll.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadSettings, DEFAULTS, IP_WEIGHT_TYPES, SAFE_NEGATIVE, withTerms } from './settings.mjs';
import { IMAGE_SIZES, outputSize } from './styles.mjs';
import { hash, Cancelled, STUDIO, run } from './util.mjs';
import { t, addMessages } from './i18n.mjs';

addMessages({
  comfyRejected: { en: v => `ComfyUI refused the picture graph: ${v.msg}`, ar: v => `رفض ComfyUI مخطط الصورة: ${v.msg}` },
  comfyNoAnswer: { en: v => `ComfyUI did not answer ${v.route} within ${v.sec} s`, ar: v => `لم يُجب ComfyUI على ${v.route} خلال ${v.sec} ث` },
  ckptMissing: { en: v => `The checkpoint “${v.name}” is not in ComfyUI/models/checkpoints. Available: ${v.list}`, ar: v => `النموذج «${v.name}» غير موجود في ComfyUI/models/checkpoints. المتاح: ${v.list}` },
  ckptNone: { en: 'ComfyUI has no checkpoints — put an SDXL checkpoint (e.g. RealVisXL V5 Lightning) in ComfyUI/models/checkpoints, then press Refresh in ComfyUI or restart it', ar: 'لا توجد نماذج في ComfyUI — ضع نموذج SDXL (مثل RealVisXL V5 Lightning) في ComfyUI/models/checkpoints ثم حدّث ComfyUI أو أعد تشغيله' },
  badChoice: { en: v => `ComfyUI has no ${v.what} “${v.v}”. Valid: ${v.list}`, ar: v => `لا يعرف ComfyUI ‏${v.what} «${v.v}». المتاح: ${v.list}` },
  upscalerMissing: { en: v => `The upscaler “${v.name}” is not in ComfyUI/models/upscale_models. Available: ${v.list} — or clear the upscaler in Settings`, ar: v => `المكبّر «${v.name}» غير موجود في ComfyUI/models/upscale_models. المتاح: ${v.list} — أو امسح المكبّر من الإعدادات` },
  noUpscaleNode: { en: 'This ComfyUI has no UpscaleModelLoader node — update ComfyUI, or clear the upscaler in Settings', ar: 'لا توجد عقدة UpscaleModelLoader في ComfyUI هذا — حدّث ComfyUI أو امسح المكبّر من الإعدادات' },
  ipaModels: { en: v => `   ⚠ IP-Adapter models are missing in ComfyUI (${v.files}) — painting without the character reference`, ar: v => `   ⚠ نماذج IP-Adapter ناقصة في ComfyUI ‏(${v.files}) — الرسم بلا صورة مرجعية للشخصية` },
  ipaModelsErr: { en: v => `IP-Adapter could not load its models — put ${v.files} in the ComfyUI folder, or turn IP-Adapter off in Settings`, ar: v => `تعذّر على IP-Adapter تحميل نماذجه — ضع ${v.files} في مجلد ComfyUI أو أوقف IP-Adapter من الإعدادات` },
  comfyOom: { en: v => `ComfyUI ran out of GPU memory in ${v.node} (${v.w}×${v.h}). Close other apps that use the GPU (games, video, other AI tools), turn off the upscaler or IP-Adapter, or restart ComfyUI with --lowvram`, ar: v => `نفدت ذاكرة كرت الشاشة في ComfyUI عند ${v.node} ‏(${v.w}×${v.h}). أغلق البرامج الأخرى التي تستعمل كرت الشاشة (ألعاب، فيديو، أدوات ذكاء أخرى)، أو أوقف المكبّر أو IP-Adapter، أو أعد تشغيل ComfyUI مع ‎--lowvram` },
  comfyExecErr: { en: v => `ComfyUI failed in ${v.node}: ${v.msg}`, ar: v => `فشل ComfyUI في ${v.node}: ${v.msg}` },
  comfyInterrupted: { en: 'The picture was stopped inside ComfyUI (Cancel was pressed there)', ar: 'أُوقفت الصورة من داخل ComfyUI (ضُغط «إلغاء» هناك)' },
  comfyLost: { en: 'The picture vanished from the ComfyUI queue (the queue was cleared, or ComfyUI restarted)', ar: 'اختفت الصورة من طابور ComfyUI (مُسح الطابور أو أُعيد تشغيل ComfyUI)' },
  comfyNoImage: { en: 'ComfyUI finished but returned no picture', ar: 'أنهى ComfyUI العمل دون أن يعيد صورة' },
  comfyQueued: { en: v => `   ⏳ ${v.label}: waiting in the ComfyUI queue (${v.n} ahead)`, ar: v => `   ⏳ ${v.label}: في طابور ComfyUI (قبلها ${v.n})` },
  comfyLoading: { en: v => `   ⏳ ${v.label}: still painting after ${v.sec} s — the first picture after ComfyUI starts also loads the model into the GPU`, ar: v => `   ⏳ ${v.label}: ما زالت تُرسم بعد ${v.sec} ث — أول صورة بعد تشغيل ComfyUI تحمّل النموذج إلى كرت الشاشة أيضاً` },
  badPng: { en: v => `ComfyUI sent something that is not a PNG picture (${v.bytes} bytes)`, ar: v => `أرسل ComfyUI شيئاً ليس صورة PNG ‏(${v.bytes} بايت)` },
  flatPng: { en: v => `ComfyUI returned a blank single-colour picture (${v.w}×${v.h}) — usually a broken checkpoint/VAE; try another checkpoint or start ComfyUI with --fp32-vae`, ar: v => `أعاد ComfyUI صورة فارغة بلون واحد (${v.w}×${v.h}) — غالباً نموذج أو VAE معطوب؛ جرّب نموذجاً آخر أو شغّل ComfyUI مع ‎--fp32-vae` },
  sizeOff: { en: v => `   ⚠ ${v.label}: ComfyUI painted ${v.gw}×${v.gh}, expected ${v.w}×${v.h}`, ar: v => `   ⚠ ${v.label}: رسم ComfyUI ‏${v.gw}×${v.gh} والمتوقع ${v.w}×${v.h}` },
  ipaNoStyle: { en: '   ⚠ This IP-Adapter has no “style transfer” weight type — the beings are painted without their reference (update ComfyUI_IPAdapter_plus)', ar: '   ⚠ لا يعرف IP-Adapter هذا نوع الوزن «style transfer» — تُرسم الكائنات بلا صورتها المرجعية (حدّث ComfyUI_IPAdapter_plus)' },
  ipaNoCrop: { en: v => `   ⚠ Could not crop the face from the reference portrait (${v.e}) — using the whole portrait`, ar: v => `   ⚠ تعذّر قصّ الوجه من الصورة المرجعية (${v.e}) — تُستعمل الصورة كاملة` },
});

export const imageOn = (s = loadSettings()) => s.image.engine === 'comfyui';
/** The negative prompt a picture really gets: the shot's own (or Settings → Negative) plus the content-safety terms. */
export const negativeOf = (s, negative) => withTerms(negative ?? s.image.negative, SAFE_NEGATIVE);
const ipWeightOf = s => { const w = Number(s.image.ipWeight); return Number.isFinite(w) && w > 0 ? w : DEFAULTS.image.ipWeight; };
const ipTypeOf = s => (IP_WEIGHT_TYPES.includes(s.image.ipWeightType) ? s.image.ipWeightType : DEFAULTS.image.ipWeightType);
/** Everything in the settings that changes a picture (part of each image's cache key). The upscaler joins only when
 *  set, so turning this feature on does not repaint pictures made before it existed. */
export const imageSig = (s = loadSettings()) => (imageOn(s) ? hash(s.image.checkpoint, s.image.steps, s.image.cfg, s.image.sampler, s.image.scheduler, negativeOf(s), s.image.ipadapter, ipWeightOf(s), ipTypeOf(s), IPA.version, ...(s.image.upscaler ? [s.image.upscaler] : [])) : '');

/** IP-Adapter as we use it: the unified loader's preset and the files that preset needs for SDXL. The patterns are
 *  the ones ComfyUI_IPAdapter_plus utils.py matches (get_ipadapter_file / get_clipvision_file).
 *  weightType/endAt: humans (the weight is Settings → ipWeight, the type Settings → ipWeightType); the last 15 % of the
 *  steps run without the reference, so the shot's own light and texture finish the picture. being: a being's
 *  portrait. crop: the face of a head-and-shoulders portrait, a centred square `side` × the short side, `top` below the
 *  top edge (CLIP Vision sees a centre square anyway). version: bump when what reaches IP-Adapter changes. */
export const IPA = {
  version: 2, preset: 'PLUS (high strength)', weightType: 'prompt is more important', endAt: 0.85,
  being: { weight: 0.4, weightType: 'style transfer' },
  crop: { side: 0.6, top: 0.04 },
  ipadapter: { re: /plus.sdxl.vit.h\.(safetensors|bin)$/i, file: 'models/ipadapter/ip-adapter-plus_sdxl_vit-h.safetensors' },
  clipVision: { re: /(ViT.H.14.*s32B.b79K|ipadapter.*sd15|sd1.?5.*model)\.(bin|safetensors)/i, file: 'models/clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors' },
};
const SAVE = '7'; // the SaveImage node of our graph
const CLIENT = `hakawati-${crypto.randomUUID()}`;

// "localhost" can resolve to ::1 first on Windows while ComfyUI listens on 127.0.0.1 only; a bare host gets http://
const base = s => {
  const u = String(s.image.url || 'http://127.0.0.1:8188').trim().replace(/\/+$/, '');
  return (/^https?:\/\//i.test(u) ? u : `http://${u}`).replace(/^(https?:\/\/)localhost(?=[:/]|$)/i, '$1127.0.0.1');
};

/** One request to ComfyUI. Every call has its own time limit (a stopped job also stops the call → Cancelled). */
async function comfy(s, route, { method = 'GET', body, signal, raw = false, timeout = 30e3 } = {}) {
  const json = body !== undefined && !(body instanceof FormData);
  const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
  const name = route.split('?')[0];
  const fail = e => {
    if (signal?.aborted) return new Cancelled();
    if (e?.name === 'TimeoutError') return new Error(t('comfyNoAnswer', { route: name, sec: Math.round(timeout / 1000) }));
    return new Error(t('comfyDown', { url: base(s), e: e?.cause?.code ?? e?.cause?.message ?? e?.message }));
  };
  let res;
  try {
    res = await fetch(`${base(s)}${route}`, { method, body: json ? JSON.stringify(body) : body, headers: json ? { 'content-type': 'application/json' } : {}, signal: sig });
  } catch (e) { throw fail(e); }
  try {
    if (!res.ok) throw Object.assign(new Error(rejection(name, res.status, await res.text().catch(() => ''))), { http: res.status });
    return raw ? Buffer.from(await res.arrayBuffer()) : await res.json();
  } catch (e) { throw e.http ? e : fail(e); }
}

/** A 400 from POST /prompt says little at the top ("Prompt outputs failed validation"); the cause is in node_errors. */
export function rejection(route, status, text) {
  let j;
  try { j = JSON.parse(text); } catch { return `ComfyUI ${route} → HTTP ${status}: ${text.slice(0, 300) || 'no details'}`; }
  const top = typeof j.error === 'string' ? j.error : [j.error?.message, j.error?.details].filter(Boolean).join(': ');
  const nodes = Object.entries(j.node_errors ?? {}).flatMap(([id, n]) => (n.errors ?? []).map(e => `${n.class_type} #${id}: ${e.message}${e.details ? ` — ${e.details}` : ''}`));
  const msg = (nodes.length ? nodes : [top]).filter(Boolean).join(' · ').slice(0, 900) || `HTTP ${status}`;
  return route === '/prompt' ? t('comfyRejected', { msg }) : `ComfyUI ${route} → HTTP ${status}: ${msg}`;
}

/** Node definitions, remembered for 30 s (models added while the Studio runs show up without a restart). */
const infoCache = new Map();
function nodeInfo(s, cls) {
  const k = `${base(s)}|${cls}`, hit = infoCache.get(k);
  if (hit && Date.now() - hit.at < 30e3) return hit.p;
  const p = comfy(s, `/object_info/${encodeURIComponent(cls)}`).then(j => j?.[cls] ?? null);
  infoCache.set(k, { at: Date.now(), p });
  p.catch(() => infoCache.delete(k)); // ComfyUI down: ask again next time
  return p;
}

/** The choices of a node input: V1 nodes send [[…choices], {…}], V3 nodes ["COMBO", {options:[…]}]. null = not a list. */
export function choices(info, input) {
  const spec = info?.input?.required?.[input] ?? info?.input?.optional?.[input];
  if (!Array.isArray(spec)) return null;
  return Array.isArray(spec[0]) ? spec[0] : spec[0] === 'COMBO' ? spec[1]?.options ?? [] : null;
}

/** ComfyUI's own spelling of a model file. On Windows models in subfolders are listed as "SDXL\\x.safetensors";
 *  "SDXL/x.safetensors", a bare "x.safetensors" or "x" find it too (when only one file matches). */
export function pickModel(list, want) {
  if (!want || !list?.length) return null;
  if (list.includes(want)) return want;
  const norm = x => String(x).replace(/\\/g, '/').toLowerCase(), file = x => norm(x).split('/').pop(), stem = x => file(x).replace(/\.(safetensors|ckpt|pth?|bin|sft|gguf)$/, '');
  for (const key of [norm, file, stem]) {
    const hits = list.filter(x => key(x) === key(want));
    if (hits.length === 1) return hits[0];
  }
  return null;
}

/** Can a shot use its character reference? Needs the nodes and the two model files of our preset. */
async function ipadapterState(s) {
  const [loader, apply, models, vision] = await Promise.all(['IPAdapterUnifiedLoader', 'IPAdapter', 'IPAdapterModelLoader', 'CLIPVisionLoader'].map(c => nodeInfo(s, c)));
  if (!loader || !apply) return { nodes: false, ready: false, why: t('noIpAdapter') };
  const missing = [];
  const ipaList = choices(models, 'ipadapter_file'), cvList = choices(vision, 'clip_name');
  if (ipaList && !ipaList.some(f => IPA.ipadapter.re.test(f))) missing.push(IPA.ipadapter.file);
  if (cvList && !cvList.some(f => IPA.clipVision.re.test(f))) missing.push(IPA.clipVision.file);
  const presets = choices(loader, 'preset'), types = choices(apply, 'weight_type');
  // the weight types this IPAdapter node offers; an older one without ours falls back to 'standard' for humans and
  // to no reference at all for beings (a 'standard' reference would copy the portrait's black ground and pose)
  const offered = x => (!types || types.includes(x) ? x : null);
  const weightType = offered(ipTypeOf(s)) ?? offered('standard') ?? types[0], beingType = offered(IPA.being.weightType);
  if (presets && !presets.includes(IPA.preset)) missing.push(`preset “${IPA.preset}” (update ComfyUI_IPAdapter_plus)`);
  return { nodes: true, ready: !missing.length, missing, weightType, beingType, why: missing.length ? t('ipaModels', { files: missing.join(' + ') }) : '' };
}

/** Settings → "Test": is ComfyUI up, which GPU, which models, is IP-Adapter usable, is the upscaler there. */
export async function testImageEngine() {
  const s = loadSettings();
  const stats = await comfy(s, '/system_stats');
  const [ckpt, ks, up, ipa] = await Promise.all([nodeInfo(s, 'CheckpointLoaderSimple'), nodeInfo(s, 'KSampler'), nodeInfo(s, 'UpscaleModelLoader').catch(() => null), ipadapterState(s)]);
  const checkpoints = choices(ckpt, 'ckpt_name') ?? [], upscalers = choices(up, 'model_name') ?? [];
  const dev = stats.devices?.[0] ?? {};
  return {
    ok: true, version: stats.system?.comfyui_version ?? '',
    gpu: String(dev.name ?? '').replace(/^\w+:\d+\s+/, '').replace(/\s+:\s+\w+$/, ''), // "cuda:0 NVIDIA … : cudaMallocAsync"
    vram: dev.vram_total ? Math.round(dev.vram_total / 2 ** 30 * 10) / 10 : 0,
    checkpoints, checkpoint: pickModel(checkpoints, s.image.checkpoint), samplers: choices(ks, 'sampler_name') ?? [], schedulers: choices(ks, 'scheduler') ?? [],
    upscalers, upscaler: s.image.upscaler ? pickModel(upscalers, s.image.upscaler) : '',
    ipadapter: ipa.ready, ipadapterNodes: ipa.nodes, ipadapterMissing: ipa.missing ?? [],
  };
}

/** Before queueing: resolve names to ComfyUI's spelling and fail early, with the list of what exists. */
async function preflight(s, { wantRef, wantUp, log }) {
  const [ckInfo, ksInfo] = await Promise.all([nodeInfo(s, 'CheckpointLoaderSimple'), nodeInfo(s, 'KSampler')]);
  const ckpts = choices(ckInfo, 'ckpt_name') ?? [];
  const checkpoint = pickModel(ckpts, s.image.checkpoint);
  if (!checkpoint) throw new Error(ckpts.length ? t('ckptMissing', { name: s.image.checkpoint, list: listed(ckpts) }) : t('ckptNone'));
  const sampler = s.image.sampler || 'dpmpp_sde', scheduler = s.image.scheduler || 'karras';
  for (const [what, v] of [['sampler_name', sampler], ['scheduler', scheduler]]) {
    const list = choices(ksInfo, what);
    if (list && !list.includes(v)) throw new Error(t('badChoice', { what, v, list: listed(list, 60) }));
  }
  let upscaler = null;
  if (wantUp) {
    const list = choices(await nodeInfo(s, 'UpscaleModelLoader'), 'model_name');
    if (!list) throw new Error(t('noUpscaleNode'));
    upscaler = pickModel(list, s.image.upscaler);
    if (!upscaler) throw new Error(t('upscalerMissing', { name: s.image.upscaler, list: listed(list) || '—' }));
  }
  let ipa = null;
  if (wantRef) {
    const st = await ipadapterState(s);
    if (st.ready) ipa = st; else warnOnce(log, st.why);
  }
  return { checkpoint, sampler, scheduler, upscaler, ipa };
}
const listed = (a, n = 15) => a.slice(0, n).join(', ') + (a.length > n ? ` … (+${a.length - n})` : '');
const warned = new WeakMap(); // one warning per job log, not one per shot
function warnOnce(log, msg) {
  if (!warned.has(log)) warned.set(log, new Set());
  if (!warned.get(log).has(msg)) { warned.get(log).add(msg); log(msg); }
}

/** With an upscaler the picture is made for 1080p plus room for the camera's push-in (the player zooms up to 1.14×),
 *  so it stays sharp at the end of a push-in. ImageScale crops the centre to this exact size. */
export function upscaledSize(aspect) {
  const o = outputSize(aspect, '1080p'), even = v => Math.round(v * 1.15 / 2) * 2;
  return { w: even(o.w), h: even(o.h) };
}

/** The ComfyUI graph (API format; links are [nodeId as string, output index]): SDXL text-to-image, optionally steered
 *  by a reference image (IP-Adapter) and/or enlarged with an upscale model to an exact size. */
export function buildWorkflow({ prompt, negative, width, height, seed, checkpoint, steps, cfg, sampler, scheduler, reference, ipWeight = DEFAULTS.image.ipWeight, weightType = IPA.weightType, endAt = IPA.endAt, upscaler, target, prefix = 'hakawati/pic' }) {
  const g = {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['1', 1] } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: negative ?? '', clip: ['1', 1] } },
    4: { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    5: { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0], seed, steps, cfg, sampler_name: sampler, scheduler, denoise: 1 } },
    6: { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    [SAVE]: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: prefix } },
  };
  if (reference) {
    g[10] = { class_type: 'LoadImage', inputs: { image: reference } };
    g[11] = { class_type: 'IPAdapterUnifiedLoader', inputs: { model: ['1', 0], preset: IPA.preset } };
    g[12] = { class_type: 'IPAdapter', inputs: { model: ['11', 0], ipadapter: ['11', 1], image: ['10', 0], weight: ipWeight, start_at: 0, end_at: endAt, weight_type: weightType } };
    g[5].inputs.model = ['12', 0];
  }
  if (upscaler && target) {
    g[20] = { class_type: 'UpscaleModelLoader', inputs: { model_name: upscaler } };
    g[21] = { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['20', 0], image: ['6', 0] } };
    g[22] = { class_type: 'ImageScale', inputs: { image: ['21', 0], upscale_method: 'lanczos', width: target.w, height: target.h, crop: 'center' } };
    g[SAVE].inputs.images = ['22', 0];
  }
  return g;
}

/** The reference portrait goes to ComfyUI's input/hakawati/, named by its content. No "overwrite": ComfyUI then keeps
 *  an identical file as is (no rewrite while another queued prompt may be reading it) and renames a different one. */
async function upload(s, file, signal) {
  const data = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase() || '.png';
  const fd = new FormData();
  fd.append('image', new Blob([data], { type: /\.jpe?g$/.test(ext) ? 'image/jpeg' : 'image/png' }), `ref-${crypto.createHash('sha1').update(data).digest('hex').slice(0, 16)}${ext}`);
  fd.append('type', 'input');
  fd.append('subfolder', 'hakawati');
  const r = await comfy(s, '/upload/image', { method: 'POST', body: fd, signal, timeout: 60e3 });
  return r.subfolder ? `${r.subfolder}/${r.name}` : r.name;
}

/** The face of a human's reference portrait, as its own PNG (cached by content in .studio/ref-cache): what IP-Adapter
 *  should carry into a shot is the face, not the portrait's framing, grey ground and studio light. On failure the
 *  whole portrait is used, with one warning. */
const cropping = new Map();
export async function faceCrop(file, { signal, log = () => {} } = {}) {
  const data = fs.readFileSync(file);
  const { side, top } = IPA.crop;
  const out = path.join(STUDIO, 'ref-cache', `${crypto.createHash('sha1').update(data).digest('hex').slice(0, 16)}.face-${side}-${top}.png`);
  if (fs.existsSync(out) && fs.statSync(out).size > 0) return out;
  if (!cropping.has(out)) {
    const job = (async () => {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const tmp = `${out}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.png`;
      // a centred square of `side` × the short side, `top` below the top edge (never past the bottom): works for 1:1
      // and for upright or wide portraits alike
      const sq = `trunc(min(iw\\,ih)*${side}/2)*2`;
      const vf = `crop=w=${sq}:h=${sq}:x=(iw-ow)/2:y=min(ih*${top}\\,ih-oh)`;
      const r = await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-vf', vf, '-frames:v', '1', tmp], { signal });
      if (r.code !== 0 || !fs.existsSync(tmp) || !fs.statSync(tmp).size) { fs.rmSync(tmp, { force: true }); throw new Error(r.stderr.trim().split('\n').pop() || `ffmpeg exit ${r.code}`); }
      fs.renameSync(tmp, out);
      return out;
    })();
    cropping.set(out, job);
    job.catch(() => {}).finally(() => cropping.delete(out));
  }
  try { return await cropping.get(out) ?? out; }
  catch (e) {
    if (signal?.aborted) throw new Cancelled();
    warnOnce(log, t('ipaNoCrop', { e: e.message.slice(0, 200) }));
    return file;
  }
}

const wait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new Cancelled());
  const on = () => { clearTimeout(tm); reject(new Cancelled()); };
  const tm = setTimeout(() => { signal?.removeEventListener('abort', on); resolve(); }, ms);
  signal?.addEventListener('abort', on, { once: true });
});

/** Stopped job: drop our prompt from the queue, and interrupt it only if it is the one running (an older ComfyUI
 *  ignores prompt_id and would stop whoever runs). Best effort, short time limits, never throws. */
async function cancelPrompt(s, id) {
  await comfy(s, '/queue', { method: 'POST', body: { delete: [id] }, raw: true, timeout: 5000 }).catch(() => {});
  const q = await comfy(s, '/queue', { timeout: 5000 }).catch(() => null);
  if (q?.queue_running?.some(x => x[1] === id)) await comfy(s, '/interrupt', { method: 'POST', body: { prompt_id: id }, raw: true, timeout: 5000 }).catch(() => {});
}

/** Why a finished prompt failed, in words the producer can act on. */
function explain(e, { w, h }) {
  const msg = String(e.exception_message ?? '').trim(), type = String(e.exception_type ?? '');
  if (/OutOfMemory/i.test(type) || /out of memory|Allocation on device/i.test(msg)) return t('comfyOom', { node: e.node_type ?? '?', w, h });
  if (/^(IPAdapter|ClipVision) model not found/i.test(msg)) return t('ipaModelsErr', { files: `${IPA.ipadapter.file} + ${IPA.clipVision.file}` });
  return t('comfyExecErr', { node: `${e.node_type ?? '?'} #${e.node_id ?? '?'}`, msg: msg.split('\n').filter(Boolean).slice(0, 3).join(' ').slice(0, 500) || type });
}

/** Wait for our prompt: GET /history/{id} stays {} until it is done. Meanwhile GET /queue tells "queued (n ahead)",
 *  "running" (the 15-minute limit counts from here, not while others' work runs) or "gone". */
async function waitFor(s, id, { signal, log, label, size }) {
  const t0 = Date.now();
  let runAt = 0, delay = 400, lastQ = 0, ahead = -1, gone = 0, fails = 0, slowSaid = false;
  for (;;) {
    await wait(delay, signal);
    let hist;
    try { hist = (await comfy(s, `/history/${encodeURIComponent(id)}`, { signal }))[id]; fails = 0; }
    catch (e) { if (e.cancelled || ++fails >= 3) throw e; continue; } // a hiccup is fine; ComfyUI gone is not
    if (hist) {
      const msgs = hist.status?.messages ?? [];
      const err = msgs.find(m => m[0] === 'execution_error')?.[1];
      if (err) throw new Error(explain(err, size));
      if (msgs.some(m => m[0] === 'execution_interrupted')) throw new Error(t('comfyInterrupted'));
      const imgs = hist.outputs?.[SAVE]?.images ?? Object.values(hist.outputs ?? {}).flatMap(o => o.images ?? []);
      const img = imgs.find(i => i.type === 'output') ?? imgs[0];
      if (img) return img;
      throw new Error(hist.status?.status_str === 'error' ? t('comfyExecErr', { node: '?', msg: 'execution error' }) : t('comfyNoImage'));
    }
    if (Date.now() - lastQ > 2500) {
      lastQ = Date.now();
      const q = await comfy(s, '/queue', { signal }).catch(e => { if (e.cancelled) throw e; return null; });
      const running = q?.queue_running ?? [], pending = q?.queue_pending ?? [];
      const mine = pending.find(x => x[1] === id);
      if (!q) { /* asked again next round */ }
      else if (running.some(x => x[1] === id)) { runAt ||= Date.now(); gone = 0; }
      else if (mine) {
        gone = 0;
        const n = running.length + pending.filter(x => x[0] < mine[0]).length;
        if (n !== ahead) { ahead = n; if (n) log(t('comfyQueued', { label, n })); }
      } else if (++gone >= 2) throw new Error(t('comfyLost')); // twice: once can be the instant it moved to history
    }
    const ran = runAt ? Date.now() - runAt : 0;
    if (!slowSaid && ran > 25e3) { slowSaid = true; log(t('comfyLoading', { label, sec: Math.round(ran / 1000) })); }
    if (ran > 15 * 60e3 || Date.now() - t0 > 60 * 60e3) throw new Error(t('comfyTimeout'));
    delay = Math.min(runAt ? 1500 : 2500, Math.round(delay * 1.4));
  }
}

/** Width/height of a PNG and how many bytes of pixel data it has (IHDR + IDAT chunks); null if it is not a PNG. */
export function pngSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  let idat = 0;
  for (let o = 8; o + 8 <= buf.length;) {
    const len = buf.readUInt32BE(o);
    if (buf.toString('latin1', o + 4, o + 8) === 'IDAT') idat += len;
    o += 12 + len;
  }
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), idat };
}

/** Paint one picture. Returns a PNG Buffer. `reference` = a local image file for IP-Adapter (optional), the portrait
 *  of a `refKind` 'human' (default: cropped to the face, Settings weight and type) or 'being' (whole, IPA.being);
 *  `negative` = this picture's negative prompt (default Settings → Negative; SAFE_NEGATIVE is always added);
 *  `upscale: false` skips the upscaler for this picture (e.g. cast portraits, which only feed IP-Adapter). */
export async function paint({ prompt, negative, aspect, seed, reference, refKind = 'human', signal, log = () => {}, label = '', upscale = true }) {
  const s = loadSettings();
  if (!s.image.checkpoint) throw new Error(t('noCheckpoint'));
  const { w, h } = IMAGE_SIZES[aspect] ?? IMAGE_SIZES['16:9'];
  const pre = await preflight(s, { wantRef: !!(reference && s.image.ipadapter), wantUp: !!(upscale && s.image.upscaler), log });
  const being = refKind === 'being';
  let ipa = pre.ipa;
  if (ipa && being && !ipa.beingType) { warnOnce(log, t('ipaNoStyle')); ipa = null; }
  const ref = ipa ? await upload(s, being ? reference : await faceCrop(reference, { signal, log }), signal) : null;
  const target = pre.upscaler ? upscaledSize(aspect) : null;
  const tag = String(label).normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'pic';
  const graph = buildWorkflow({ prompt, negative: negativeOf(s, negative), width: w, height: h, seed, checkpoint: pre.checkpoint,
    steps: Math.max(1, Math.round(Number(s.image.steps) || 6)), cfg: Number(s.image.cfg) || 2, sampler: pre.sampler, scheduler: pre.scheduler,
    reference: ref, ipWeight: being ? IPA.being.weight : ipWeightOf(s), weightType: being ? ipa?.beingType : ipa?.weightType, endAt: IPA.endAt,
    upscaler: pre.upscaler, target, prefix: `hakawati/${tag}` });
  const started = Date.now();
  // our own prompt_id (accepted by current ComfyUI) so a stop during the POST can still cancel it
  let id = crypto.randomUUID();
  try {
    const r = await comfy(s, '/prompt', { method: 'POST', body: { prompt: graph, client_id: CLIENT, prompt_id: id }, signal, timeout: 60e3 });
    id = r.prompt_id ?? id;
    const img = await waitFor(s, id, { signal, log, label, size: { w, h } }); // the OOM advice names the SDXL size
    const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? '', type: img.type ?? 'output' });
    const buf = await comfy(s, `/view?${q}`, { raw: true, signal, timeout: 120e3 });
    const got = pngSize(buf), want = target ?? { w, h };
    if (!got) throw new Error(t('badPng', { bytes: buf.length }));
    if (got.idat < got.w * got.h * 0.004) throw new Error(t('flatPng', got)); // a flat colour compresses to almost nothing
    if (got.w !== want.w || got.h !== want.h) log(t('sizeOff', { label, gw: got.w, gh: got.h, ...want }));
    log(t('painted', { label, sec: Math.round((Date.now() - started) / 100) / 10, w: got.w, h: got.h }));
    return buf;
  } catch (e) {
    if (signal?.aborted) { await cancelPrompt(s, id); throw new Cancelled(); }
    throw e;
  }
}

/** A stable seed per picture, so re-running gives the same image unless the producer asks for a new one. */
export const seedFor = (...parts) => parseInt(hash(...parts).slice(0, 8), 16);
