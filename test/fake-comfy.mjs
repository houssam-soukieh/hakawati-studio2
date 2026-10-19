// A faithful fake ComfyUI for tests: no GPU, no Python, no deps (node:http + ffmpeg). Same routes, same validation
// rules and error shapes as comfyanonymous/ComfyUI (server.py, execution.py validate_prompt/validate_inputs — read
// from master, 2026-10), one prompt running at a time, history in the real format, PNGs at the size the graph asks.
//
//   node test/fake-comfy.mjs --port 8188 [--host 127.0.0.1] [--delay 1200] [--first-load 0] [--dir <folder>]
//        [--checkpoints a.safetensors,b.safetensors] [--upscalers 4x-UltraSharp.pth] [--no-ipadapter] [--no-ipadapter-models]
//   import { startFakeComfy } from './fake-comfy.mjs'  →  { url, port, state, close() }
//
// Switches inside a prompt's text: FAIL_OOM → execution_error (torch.OutOfMemoryError) in the KSampler, like a real
// out-of-memory; SLOW → the KSampler takes 8 s (to test stop → /queue delete + /interrupt).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- node definitions (a realistic subset)
// comfy/samplers.py KSAMPLER_NAMES + ["ddim", "uni_pc", "uni_pc_bh2"], SCHEDULER_HANDLERS keys
const SAMPLERS = ['euler', 'euler_cfg_pp', 'euler_ancestral', 'euler_ancestral_cfg_pp', 'heun', 'heunpp2', 'exp_heun_2_x0', 'exp_heun_2_x0_sde', 'dpm_2', 'dpm_2_ancestral',
  'lms', 'dpm_fast', 'dpm_adaptive', 'dpmpp_2s_ancestral', 'dpmpp_2s_ancestral_cfg_pp', 'dpmpp_sde', 'dpmpp_sde_gpu', 'dpmpp_2m', 'dpmpp_2m_cfg_pp', 'dpmpp_2m_sde',
  'dpmpp_2m_sde_gpu', 'dpmpp_2m_sde_heun', 'dpmpp_2m_sde_heun_gpu', 'dpmpp_3m_sde', 'dpmpp_3m_sde_gpu', 'ddpm', 'lcm', 'ipndm', 'ipndm_v', 'deis', 'cfgpp_ud10_ab',
  'res_multistep', 'res_multistep_cfg_pp', 'res_multistep_ancestral', 'res_multistep_ancestral_cfg_pp', 'gradient_estimation', 'gradient_estimation_cfg_pp', 'er_sde',
  'seeds_2', 'seeds_3', 'sa_solver', 'sa_solver_pece', 'ddim', 'uni_pc', 'uni_pc_bh2'];
const SCHEDULERS = ['simple', 'sgm_uniform', 'karras', 'exponential', 'ddim_uniform', 'beta', 'normal', 'linear_quadratic', 'kl_optimal'];
const MAX_RES = 16384;
const IPA_PRESETS = ['LIGHT - SD1.5 only (low strength)', 'STANDARD (medium strength)', 'VIT-G (medium strength)', 'PLUS (high strength)', 'PLUS FACE (portraits)', 'FULL FACE - SD1.5 only (portraits stronger)'];

function nodeDefs(cfg) {
  const inputFiles = () => (fs.existsSync(cfg.input) ? fs.readdirSync(cfg.input).filter(f => fs.statSync(path.join(cfg.input, f)).isFile() && /\.(png|jpe?g|webp)$/i.test(f)).sort() : []);
  const defs = {
    CheckpointLoaderSimple: { required: { ckpt_name: [cfg.checkpoints, { tooltip: 'The name of the checkpoint (model) to load.' }] }, output: ['MODEL', 'CLIP', 'VAE'], category: 'loaders' },
    CLIPTextEncode: { required: { text: ['STRING', { multiline: true, dynamicPrompts: true }], clip: ['CLIP', {}] }, output: ['CONDITIONING'], category: 'conditioning' },
    EmptyLatentImage: { required: { width: ['INT', { default: 1024, min: 16, max: MAX_RES, step: 8 }], height: ['INT', { default: 1024, min: 16, max: MAX_RES, step: 8 }], batch_size: ['INT', { default: 1, min: 1, max: 4096 }] }, output: ['LATENT'], category: 'latent' },
    KSampler: {
      required: {
        model: ['MODEL', {}], seed: ['INT', { default: 0, min: 0, max: 0xffffffffffffffff, control_after_generate: true }], steps: ['INT', { default: 20, min: 1, max: 10000 }],
        cfg: ['FLOAT', { default: 8.0, min: 0.0, max: 100.0, step: 0.1, round: 0.01 }], sampler_name: [SAMPLERS, {}], scheduler: [SCHEDULERS, {}],
        positive: ['CONDITIONING', {}], negative: ['CONDITIONING', {}], latent_image: ['LATENT', {}], denoise: ['FLOAT', { default: 1.0, min: 0.0, max: 1.0, step: 0.01 }],
      },
      output: ['LATENT'], category: 'sampling',
    },
    VAEDecode: { required: { samples: ['LATENT', {}], vae: ['VAE', {}] }, output: ['IMAGE'], category: 'latent' },
    SaveImage: { required: { images: ['IMAGE', {}], filename_prefix: ['STRING', { default: 'ComfyUI' }] }, hidden: { prompt: 'PROMPT', extra_pnginfo: 'EXTRA_PNGINFO' }, output: ['IMAGE'], output_name: ['images'], output_node: true, category: 'image' },
    PreviewImage: { required: { images: ['IMAGE', {}] }, hidden: { prompt: 'PROMPT', extra_pnginfo: 'EXTRA_PNGINFO' }, output: [], output_node: true, category: 'image' },
    LoadImage: { required: { image: [inputFiles(), { image_upload: true }] }, output: ['IMAGE', 'MASK'], category: 'image', validate: ['image'] },
    ImageScale: { required: { image: ['IMAGE', {}], upscale_method: [['nearest-exact', 'bilinear', 'area', 'bicubic', 'lanczos'], {}], width: ['INT', { default: 512, min: 0, max: MAX_RES, step: 1 }], height: ['INT', { default: 512, min: 0, max: MAX_RES, step: 1 }], crop: [['disabled', 'center'], {}] }, output: ['IMAGE'], category: 'image/upscaling' },
    // V3 nodes (comfy_extras/nodes_upscale_model.py): object_info lists their combos as ["COMBO", {options}]
    UpscaleModelLoader: { required: { model_name: ['COMBO', { options: cfg.upscalers, multiselect: false }] }, output: ['UPSCALE_MODEL'], category: 'loaders', v3: true },
    ImageUpscaleWithModel: { required: { upscale_model: ['UPSCALE_MODEL', {}], image: ['IMAGE', {}] }, output: ['IMAGE'], category: 'image/upscaling', v3: true },
    CLIPVisionLoader: { required: { clip_name: [cfg.clipVision, {}] }, output: ['CLIP_VISION'], category: 'loaders' },
  };
  if (cfg.ipadapter) Object.assign(defs, { // cubiq/ComfyUI_IPAdapter_plus IPAdapterPlus.py
    IPAdapterUnifiedLoader: { required: { model: ['MODEL', {}], preset: [IPA_PRESETS, {}] }, optional: { ipadapter: ['IPADAPTER', {}] }, output: ['MODEL', 'IPADAPTER'], output_name: ['model', 'ipadapter'], category: 'ipadapter' },
    IPAdapter: {
      required: { model: ['MODEL', {}], ipadapter: ['IPADAPTER', {}], image: ['IMAGE', {}], weight: ['FLOAT', { default: 1.0, min: -1, max: 3, step: 0.05 }], start_at: ['FLOAT', { default: 0.0, min: 0.0, max: 1.0, step: 0.001 }], end_at: ['FLOAT', { default: 1.0, min: 0.0, max: 1.0, step: 0.001 }], weight_type: [['standard', 'prompt is more important', 'style transfer'], {}] },
      optional: { attn_mask: ['MASK', {}] }, output: ['MODEL'], category: 'ipadapter',
    },
    IPAdapterModelLoader: { required: { ipadapter_file: [cfg.ipadapterFiles, {}] }, output: ['IPADAPTER'], category: 'ipadapter/loaders' },
  });
  return defs;
}

/** GET /object_info/{class} entry, in the V1 shape server.py node_info() builds. */
function objectInfo(name, d) {
  const input = { required: d.required, ...(d.optional ? { optional: d.optional } : {}), ...(d.hidden ? { hidden: d.hidden } : {}) };
  return {
    input, input_order: Object.fromEntries(Object.entries(input).map(([k, v]) => [k, Object.keys(v)])), is_input_list: false,
    output: d.output, output_is_list: d.output.map(() => false), output_name: d.output_name ?? d.output, name, display_name: name, description: '',
    python_module: d.v3 ? 'comfy_extras.nodes_upscale_model' : /^IPAdapter/.test(name) ? 'custom_nodes.ComfyUI_IPAdapter_plus' : 'nodes',
    category: d.category, output_node: !!d.output_node, has_intermediate_output: false, search_aliases: [],
  };
}

// ---------------------------------------------------------------- validation (execution.py, faithfully)
class PyError extends Error { constructor(type, msg) { super(msg); this.pyType = type; } }
const pyRepr = v => (typeof v === 'string' ? (w => (w.includes("'") && !w.includes('"') ? `"${w}"` : `'${w.replace(/'/g, "\\'")}'`))(v.replace(/\\/g, '\\\\')) : v === null || v === undefined ? 'None' : v === true ? 'True' : v === false ? 'False' : Array.isArray(v) ? `[${v.map(pyRepr).join(', ')}]` : typeof v === 'object' ? JSON.stringify(v) : String(v));
const comboOf = (type, extra) => (Array.isArray(type) ? type : type === 'COMBO' ? extra?.options ?? [] : null);
const typeOk = (got, want) => got === want || got === '*' || want === '*' || (typeof got === 'string' && typeof want === 'string' && got.split(',').some(a => want.split(',').includes(a)));

function toInt(v) {
  if (typeof v === 'boolean') return +v;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && /^\s*[-+]?\d+\s*$/.test(v)) return Number(v);
  throw new PyError('ValueError', typeof v === 'string' ? `invalid literal for int() with base 10: ${pyRepr(v)}` : `int() argument must be a string, a bytes-like object or a real number, not '${v === null ? 'NoneType' : Array.isArray(v) ? 'list' : typeof v}'`);
}
function toFloat(v) {
  if (typeof v === 'boolean') return +v;
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  throw new PyError(typeof v === 'string' ? 'ValueError' : 'TypeError', typeof v === 'string' ? `could not convert string to float: ${pyRepr(v)}` : `float() argument must be a string or a real number, not '${v === null ? 'NoneType' : typeof v}'`);
}

function validateInputs(fake, prompt, id, validated, visiting = []) {
  if (validated.has(id)) return validated.get(id);
  if (visiting.includes(id)) {
    const cyc = [...visiting.slice(visiting.indexOf(id)), id];
    const nodes = [...new Set(cyc)];
    for (const n of nodes) validated.set(n, [false, [{ type: 'dependency_cycle', message: 'Dependency cycle detected', details: cyc.map(x => `${x} (${prompt[x].class_type})`).join(' -> '), extra_info: { node_id: n, cycle_nodes: nodes } }], n]);
    return validated.get(id);
  }
  const node = prompt[id], def = fake.defs[node.class_type];
  const inputs = node.inputs && typeof node.inputs === 'object' ? node.inputs : {};
  const errors = [];
  let valid = true;
  const custom = def.validate ?? [];
  for (const [cat, group] of [['required', def.required], ['optional', def.optional ?? {}]]) {
    for (const [x, [type, extra = {}]] of Object.entries(group)) {
      const info = [type, extra];
      if (!(x in inputs)) {
        if (cat === 'required') errors.push({ type: 'required_input_missing', message: 'Required input is missing', details: x, extra_info: { input_name: x } });
        continue;
      }
      let val = inputs[x];
      if (Array.isArray(val)) {
        if (val.length !== 2) { errors.push({ type: 'bad_linked_input', message: 'Bad linked input, must be a length-2 list of [node_id, slot_index]', details: x, extra_info: { input_name: x, input_config: info, received_value: val } }); continue; }
        const [oid, slot] = val;
        const src = typeof oid === 'string' ? prompt[oid] : undefined; // JSON keys are strings: a numeric id never matches
        if (!src) throw new PyError('KeyError', pyRepr(oid));
        const outs = fake.defs[src.class_type]?.output ?? [];
        if (typeof slot !== 'number' || !Number.isInteger(slot)) throw new PyError('TypeError', `tuple indices must be integers or slices, not ${slot === null ? 'NoneType' : typeof slot === 'string' ? 'str' : typeof slot}`);
        if (slot >= outs.length || slot < -outs.length) throw new PyError('IndexError', 'tuple index out of range');
        const got = outs.at(slot);
        if (!typeOk(got, Array.isArray(type) ? 'COMBO' : type)) { errors.push({ type: 'return_type_mismatch', message: 'Return type mismatch between linked nodes', details: `${x}, received_type(${got}) mismatch input_type(${Array.isArray(type) ? pyRepr(type) : type})`, extra_info: { input_name: x, input_config: info, received_type: got, linked_node: val } }); continue; }
        try {
          visiting.push(id);
          let r;
          try { r = validateInputs(fake, prompt, oid, validated, visiting); } finally { visiting.pop(); }
          if (r[0] === false) { valid = false; continue; }
        } catch (ex) {
          valid = false;
          validated.set(oid, [false, [{ type: 'exception_during_inner_validation', message: 'Exception when validating inner node', details: ex.message, extra_info: { input_name: x, input_config: info, exception_message: ex.message, exception_type: ex.pyType ?? 'Exception', traceback: [], linked_node: val } }], oid]);
        }
        continue;
      }
      try {
        if (val && typeof val === 'object' && '__value__' in val) val = inputs[x] = val.__value__;
        if (type === 'INT') val = inputs[x] = toInt(val);
        if (type === 'FLOAT') val = inputs[x] = toFloat(val);
        if (type === 'STRING') val = inputs[x] = typeof val === 'string' ? val : pyRepr(val);
        if (type === 'BOOLEAN') val = inputs[x] = !!val;
      } catch (ex) {
        errors.push({ type: 'invalid_input_type', message: `Failed to convert an input value to a ${type} value`, details: `${x}, ${pyRepr(val)}, ${ex.message}`, extra_info: { input_name: x, input_config: info, received_value: val, exception_message: ex.message } });
        continue;
      }
      if (custom.includes(x)) continue; // VALIDATE_INPUTS takes this input: no min/max/list checks
      if ('min' in extra && val < extra.min) { errors.push({ type: 'value_smaller_than_min', message: `Value ${val} smaller than min of ${extra.min}`, details: x, extra_info: { input_name: x, input_config: info, received_value: val } }); continue; }
      if ('max' in extra && val > extra.max) { errors.push({ type: 'value_bigger_than_max', message: `Value ${val} bigger than max of ${extra.max}`, details: x, extra_info: { input_name: x, input_config: info, received_value: val } }); continue; }
      const combo = comboOf(type, extra);
      if (combo && !combo.includes(val)) {
        const big = combo.length > 20;
        errors.push({ type: 'value_not_in_list', message: 'Value not in list', details: `${x}: ${pyRepr(val)} not in ${big ? `(list of length ${combo.length})` : pyRepr(combo)}`, extra_info: { input_name: x, input_config: big ? null : info, received_value: val } });
      }
    }
  }
  // LoadImage.VALIDATE_INPUTS: the file must exist under input/ ("sub/name.png" allowed, never outside)
  if (custom.includes('image') && typeof inputs.image === 'string') {
    const f = path.resolve(fake.cfg.input, inputs.image.replace(/ \[input\]$/, ''));
    if (!f.startsWith(path.resolve(fake.cfg.input) + path.sep) || !fs.existsSync(f)) errors.push({ type: 'custom_validation_failed', message: 'Custom validation failed for node', details: `image - Invalid image file: ${inputs.image}`, extra_info: { input_name: 'image' } });
  }
  const prev = validated.get(id) ?? [true, [], id];
  const ret = [prev[0] && valid && !errors.length, [...prev[1], ...errors.filter(e => !prev[1].includes(e))], id];
  validated.set(id, ret);
  return ret;
}

function validatePrompt(fake, prompt) {
  const fail = (error, node_errors = {}) => ({ ok: false, error, node_errors });
  if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) return fail({ type: 'invalid_prompt', message: 'Cannot execute because the prompt is not an object', details: '', extra_info: {} });
  const outputs = [];
  for (const [x, node] of Object.entries(prompt)) {
    const title = node?._meta?.title;
    if (!node || typeof node !== 'object' || !('class_type' in node)) return fail({ type: 'missing_node_type', message: `Node '${title || `ID #${x}`}' has no class_type. The workflow may be corrupted or a custom node is missing.`, details: `Node ID '#${x}'`, extra_info: { node_id: x, class_type: null, node_title: title } });
    const def = fake.defs[node.class_type];
    if (!def) return fail({ type: 'missing_node_type', message: `Node '${title ?? node.class_type}' not found. The custom node may not be installed.`, details: `Node ID '#${x}'`, extra_info: { node_id: x, class_type: node.class_type, node_title: title ?? node.class_type } });
    if (def.output_node) outputs.push(x);
  }
  if (!outputs.length) return fail({ type: 'prompt_no_outputs', message: 'Prompt has no outputs', details: '', extra_info: {} });
  const validated = new Map(), node_errors = {}, good = [], errs = [];
  for (const o of outputs) {
    let m;
    try { m = validateInputs(fake, prompt, o, validated); }
    catch (ex) { m = [false, [{ type: 'exception_during_validation', message: 'Exception when validating node', details: ex.message, extra_info: { exception_type: ex.pyType ?? 'Exception', traceback: [] } }], o]; validated.set(o, m); }
    if (m[0]) { good.push(o); continue; }
    errs.push([o, m[1]]);
    for (const [nid, r] of validated) {
      if (r[0] === true || !r[1].length) continue; // downstream nodes of a bad node are invalid but carry no errors
      node_errors[nid] ??= { errors: r[1], dependent_outputs: [], class_type: prompt[nid].class_type };
      node_errors[nid].dependent_outputs.push(o);
    }
  }
  if (!good.length) return fail({ type: 'prompt_outputs_failed_validation', message: 'Prompt outputs failed validation', details: errs.flatMap(([, es]) => es.map(e => `${e.message}: ${e.details}`)).join('\n'), extra_info: {} }, node_errors);
  return { ok: true, outputs: good, node_errors };
}

// ---------------------------------------------------------------- execution
const ffmpegPng = (file, w, h, seedHex) => new Promise((resolve, reject) => {
  // two colours from the prompt hash (different prompts → different pictures), mid lightness, plus grain like a photo
  const hue = parseInt(seedHex.slice(0, 4), 16) % 360, hsl = (hh, s, l) => {
    const k = n => (n + hh / 30) % 12, a = s * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return `0x${[f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
  };
  const src = `gradients=s=${w}x${h}:c0=${hsl(hue, 0.6, 0.62)}:c1=${hsl((hue + 50) % 360, 0.55, 0.38)}:x0=0:y0=0:x1=${w}:y1=${h}:nb_colors=2:seed=${parseInt(seedHex.slice(4, 10), 16)},noise=alls=7:allf=u,format=rgb24`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', src, '-frames:v', '1', file], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', d => { err += d; });
  p.on('error', reject);
  p.on('close', c => (c === 0 ? resolve() : reject(new Error(`ffmpeg: ${err.slice(-300)}`))));
});

/** folder_paths.get_save_image_path: "<sub>/<name>_00001_.png", the counter continues from the files there. */
function savePath(outDir, prefix) {
  const sub = path.dirname(path.normalize(prefix)), name = path.basename(prefix);
  const dir = path.join(outDir, sub === '.' ? '' : sub);
  if (!path.resolve(dir).startsWith(path.resolve(outDir))) throw new PyError('Exception', `**** ERROR: Saving image outside the output folder is not allowed.\n full_output_folder: ${dir}\n output_dir: ${outDir}`);
  fs.mkdirSync(dir, { recursive: true });
  const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d{5})_`);
  const n = Math.max(0, ...fs.readdirSync(dir).map(f => Number(re.exec(f)?.[1] ?? 0))) + 1;
  return { file: path.join(dir, `${name}_${String(n).padStart(5, '0')}_.png`), filename: `${name}_${String(n).padStart(5, '0')}_.png`, subfolder: sub === '.' ? '' : sub };
}

const sleepTick = (fake, ms) => new Promise((resolve, reject) => {
  const end = Date.now() + ms;
  const tick = () => { if (fake.interruptFlag) return reject(new PyError('comfy.model_management.InterruptProcessingException', '')); if (Date.now() >= end) return resolve(); setTimeout(tick, Math.min(40, end - Date.now())); };
  tick();
});

async function runNode(fake, ctx, id) {
  if (ctx.values.has(id)) return ctx.values.get(id);
  const node = ctx.prompt[id], inp = {};
  for (const [k, v] of Object.entries(node.inputs ?? {})) inp[k] = Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && ctx.prompt[v[0]] ? (await runNode(fake, ctx, v[0])).at(v[1]) : v;
  ctx.current = { id, type: node.class_type, inputs: inp };
  if (fake.interruptFlag) throw new PyError('comfy.model_management.InterruptProcessingException', '');
  let out;
  switch (node.class_type) {
    case 'CheckpointLoaderSimple':
      if (!fake.loaded.has(inp.ckpt_name)) { await sleepTick(fake, fake.cfg.firstLoad); fake.loaded.add(inp.ckpt_name); }
      out = [{ kind: 'MODEL', ckpt: inp.ckpt_name }, { kind: 'CLIP' }, { kind: 'VAE' }]; break;
    case 'CLIPTextEncode': out = [{ kind: 'CONDITIONING', text: String(inp.text) }]; break;
    case 'EmptyLatentImage': out = [{ kind: 'LATENT', w: inp.width, h: inp.height }]; break;
    case 'KSampler': {
      const text = inp.positive?.text ?? '';
      await sleepTick(fake, fake.cfg.delay + (/SLOW/.test(text) ? 8000 : 0));
      if (/FAIL_OOM/.test(text)) throw new PyError('torch.OutOfMemoryError', 'Allocation on device \nThis error means you ran out of memory on your GPU.\n\nTIPS: If the workflow worked before you might have accidentally set the batch_size to a large number.');
      out = [{ kind: 'LATENT', w: inp.latent_image.w, h: inp.latent_image.h, text, seed: inp.seed, ref: inp.model?.ref ?? null }]; break;
    }
    case 'VAEDecode': out = [{ kind: 'IMAGE', ...inp.samples }]; break;
    case 'LoadImage': out = [{ kind: 'IMAGE', w: 1024, h: 1024, file: inp.image }, { kind: 'MASK' }]; break;
    case 'IPAdapterUnifiedLoader':
      if (!fake.cfg.clipVision.some(f => /(ViT.H.14.*s32B.b79K|ipadapter.*sd15|sd1.?5.*model)\.(bin|safetensors)/i.test(f))) throw new PyError('Exception', 'ClipVision model not found.');
      if (!fake.cfg.ipadapterFiles.some(f => /plus.sdxl.vit.h\.(safetensors|bin)$/i.test(f))) throw new PyError('Exception', 'IPAdapter model not found.');
      out = [inp.model, { kind: 'IPADAPTER', preset: inp.preset }]; break;
    case 'IPAdapter': out = [{ ...inp.model, ref: inp.image?.file ?? null, weight: inp.weight }]; ctx.record.ipadapter = { image: inp.image?.file, weight: inp.weight, weight_type: inp.weight_type }; break;
    case 'UpscaleModelLoader': { // the scale is in the file name: 4x-UltraSharp, RealESRGAN_x2plus
      const k = /(?:^|[^a-z0-9])([1-8])x|x([1-8])(?:\D|$)/i.exec(inp.model_name);
      out = [{ kind: 'UPSCALE_MODEL', name: inp.model_name, scale: Number(k?.[1] ?? k?.[2] ?? 4) }]; break;
    }
    case 'ImageUpscaleWithModel': out = [{ ...inp.image, w: inp.image.w * inp.upscale_model.scale, h: inp.image.h * inp.upscale_model.scale }]; break;
    case 'ImageScale': {
      let { width: w, height: h } = inp;
      if (!w && !h) ({ w, h } = inp.image);
      else if (!w) w = Math.max(1, Math.round(inp.image.w * h / inp.image.h));
      else if (!h) h = Math.max(1, Math.round(inp.image.h * w / inp.image.w));
      out = [{ ...inp.image, w, h }]; break;
    }
    case 'SaveImage': case 'PreviewImage': {
      const temp = node.class_type === 'PreviewImage';
      const img = inp.images;
      const sp = savePath(temp ? fake.cfg.temp : fake.cfg.output, temp ? `ComfyUI_temp_${crypto.randomBytes(3).toString('hex')}` : String(inp.filename_prefix ?? 'ComfyUI'));
      await ffmpegPng(sp.file, img.w, img.h, crypto.createHash('sha1').update(`${img.text}|${img.seed}|${img.ref ?? ''}`).digest('hex'));
      ctx.ui[id] = { images: [{ filename: sp.filename, subfolder: sp.subfolder, type: temp ? 'temp' : 'output' }] };
      out = temp ? [] : [img]; break;
    }
    case 'CLIPVisionLoader': out = [{ kind: 'CLIP_VISION' }]; break;
    case 'IPAdapterModelLoader': out = [{ kind: 'IPADAPTER' }]; break;
    default: throw new PyError('Exception', `fake ComfyUI cannot run ${node.class_type}`);
  }
  ctx.executed.push(id);
  ctx.values.set(id, out);
  return out;
}

async function worker(fake) {
  if (fake.running || fake.closed) return;
  fake.queue.sort((a, b) => a[0] - b[0]);
  const item = fake.queue.shift();
  if (!item) return;
  fake.running = item;
  fake.interruptFlag = false;
  const [number, id, prompt, extra, outputs] = item;
  const ts = () => Date.now();
  const messages = [['execution_start', { prompt_id: id, timestamp: ts() }], ['execution_cached', { nodes: [], prompt_id: id, timestamp: ts() }]];
  const ctx = { prompt: structuredClone(prompt), values: new Map(), ui: {}, executed: [], record: { id, number, at: Date.now() } };
  let ok = true;
  try {
    for (const o of outputs) await runNode(fake, ctx, o);
    messages.push(['execution_success', { prompt_id: id, timestamp: ts() }]);
  } catch (ex) {
    ok = false;
    const cur = ctx.current ?? { id: outputs[0], type: prompt[outputs[0]].class_type, inputs: {} };
    if (ex.pyType === 'comfy.model_management.InterruptProcessingException') messages.push(['execution_interrupted', { prompt_id: id, node_id: cur.id, node_type: cur.type, executed: ctx.executed, timestamp: ts() }]);
    else messages.push(['execution_error', { prompt_id: id, node_id: cur.id, node_type: cur.type, executed: ctx.executed, exception_message: `${ex.message}\n`, exception_type: ex.pyType ?? 'Exception', traceback: ['  File "execution.py", line 1, in execute\n'], current_inputs: Object.fromEntries(Object.entries(cur.inputs).map(([k, v]) => [k, [v && typeof v === 'object' ? `<${v.kind ?? 'object'}>` : v]])), current_outputs: [], timestamp: ts() }]);
  }
  fake.history.set(id, {
    prompt: [number, id, prompt, extra, outputs], outputs: ctx.ui, status: { status_str: ok ? 'success' : 'error', completed: ok, messages },
    meta: Object.fromEntries(Object.keys(ctx.ui).map(n => [n, { node_id: n, display_node: n, parent_node: null, real_node_id: n }])),
  });
  fake.done.push({ ...ctx.record, ok, messages: messages.map(m => m[0]), images: Object.values(ctx.ui).flatMap(u => u.images) });
  fake.running = null;
  setImmediate(() => worker(fake));
}

// ---------------------------------------------------------------- HTTP
function readBody(req, limit = 64 << 20) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** multipart/form-data → { field: string | { filename, data } } (enough for /upload/image). */
function multipart(buf, ctype) {
  const b = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype ?? '');
  if (!b) return {};
  const sep = Buffer.from(`--${b[1] ?? b[2]}`), out = {};
  let at = buf.indexOf(sep);
  while (at >= 0) {
    const start = at + sep.length;
    if (buf.slice(start, start + 2).toString() === '--') break;
    const next = buf.indexOf(sep, start);
    if (next < 0) break;
    const part = buf.slice(start + 2, next - 2); // skip CRLF after the boundary and before the next one
    const he = part.indexOf('\r\n\r\n');
    const head = part.slice(0, he).toString('utf8'), data = part.slice(he + 4);
    const name = /name="([^"]*)"/i.exec(head)?.[1], filename = /filename="([^"]*)"/i.exec(head)?.[1];
    if (name) out[name] = filename !== undefined ? { filename, data } : data.toString('utf8');
    at = next;
  }
  return out;
}

const dirOfType = (fake, type) => ({ input: fake.cfg.input, output: fake.cfg.output, temp: fake.cfg.temp })[type ?? 'output'];
const queueItems = list => list.map(x => x.slice(0, 5));

async function handle(fake, req, res) {
  const u = new URL(req.url, 'http://x');
  const route = u.pathname.replace(/^\/api(?=\/)/, ''); // the real server also serves every route under /api
  const json = (code, body) => { const b = JSON.stringify(body); res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(b) }); res.end(b); };
  const empty = code => { res.writeHead(code, { 'content-length': 0 }); res.end(); };
  fake.requests.push(`${req.method} ${route}`);
  const m = req.method;

  if (m === 'GET' && route === '/system_stats') return json(200, {
    system: { os: 'win32', ram_total: 17045651456, ram_free: 9663676416, comfyui_version: '0.3.75', required_frontend_version: '1.28.8', python_version: '3.12.10 (tags/v3.12.10) [MSC v.1943 64 bit (AMD64)]', pytorch_version: '2.8.0+cu128', embedded_python: true, argv: ['ComfyUI\\main.py', '--windows-standalone-build'] },
    devices: [{ name: 'cuda:0 NVIDIA GeForce RTX 3060 Ti : cudaMallocAsync', type: 'cuda', index: 0, vram_total: 8589410304, vram_free: 7408779264, torch_vram_total: 0, torch_vram_free: 0 }],
  });
  if (m === 'GET' && route === '/object_info') { fake.defs = nodeDefs(fake.cfg); return json(200, Object.fromEntries(Object.entries(fake.defs).map(([k, d]) => [k, objectInfo(k, d)]))); }
  if (m === 'GET' && route.startsWith('/object_info/')) {
    fake.defs = nodeDefs(fake.cfg);
    const cls = decodeURIComponent(route.slice('/object_info/'.length));
    return json(200, fake.defs[cls] ? { [cls]: objectInfo(cls, fake.defs[cls]) } : {});
  }
  if (m === 'GET' && route === '/embeddings') return json(200, []);
  if (m === 'GET' && route.startsWith('/models/')) {
    const lists = { checkpoints: fake.cfg.checkpoints, upscale_models: fake.cfg.upscalers, clip_vision: fake.cfg.clipVision, ipadapter: fake.cfg.ipadapterFiles };
    const l = lists[route.slice(8)];
    return l ? json(200, l) : empty(404);
  }
  if (m === 'GET' && route === '/prompt') return json(200, { exec_info: { queue_remaining: fake.queue.length + (fake.running ? 1 : 0) } });
  if (m === 'POST' && route === '/prompt') {
    let body;
    try { body = JSON.parse((await readBody(req)).toString('utf8')); } catch { return empty(400); } // aiohttp: request.json() fails → 500 in the real one; a bad body never reaches validation
    const number = typeof body.number === 'number' ? body.number : body.front ? -fake.number : fake.number;
    if (typeof body.number !== 'number') fake.number++;
    if (!('prompt' in body)) return json(400, { error: { type: 'no_prompt', message: 'No prompt provided', details: 'No prompt provided', extra_info: {} }, node_errors: {} });
    let id = crypto.randomUUID();
    if (body.prompt_id != null) {
      if (typeof body.prompt_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.prompt_id)) return json(400, { error: { type: 'invalid_prompt_id', message: 'prompt_id must be a valid UUID', details: 'prompt_id must be a UUID string in canonical lowercase hyphenated form; omit it to let the server generate one', extra_info: {} }, node_errors: {} });
      id = body.prompt_id;
    }
    fake.defs = nodeDefs(fake.cfg);
    const v = validatePrompt(fake, body.prompt);
    fake.prompts.push({ id, prompt: body.prompt, ok: v.ok, error: v.ok ? null : v.error, node_errors: v.node_errors });
    if (!v.ok) return json(400, { error: v.error, node_errors: v.node_errors });
    const extra = { ...(body.extra_data ?? {}), ...(body.client_id ? { client_id: body.client_id } : {}), create_time: Date.now() };
    fake.queue.push([number, id, body.prompt, extra, v.outputs]);
    setImmediate(() => worker(fake));
    return json(200, { prompt_id: id, number, node_errors: v.node_errors });
  }
  if (m === 'GET' && route === '/queue') return json(200, { queue_running: fake.running ? queueItems([fake.running]) : [], queue_pending: queueItems([...fake.queue].sort((a, b) => a[0] - b[0])) });
  if (m === 'POST' && route === '/queue') {
    let body = {};
    try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); } catch { /* the real one would 500 */ }
    if (body.clear) fake.queue.length = 0;
    for (const d of body.delete ?? []) { const i = fake.queue.findIndex(x => x[1] === d); if (i >= 0) { fake.queue.splice(i, 1); fake.deleted.push(d); } }
    return empty(200);
  }
  if (m === 'POST' && route === '/interrupt') {
    let body = {};
    try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); } catch { /* no body: global interrupt */ }
    const pid = body.prompt_id;
    if (!pid || fake.running?.[1] === pid) { fake.interruptFlag = !!fake.running; fake.interrupts.push(pid ?? '(global)'); }
    return empty(200);
  }
  if (m === 'GET' && route === '/history') {
    const max = Number(u.searchParams.get('max_items')) || Infinity;
    return json(200, Object.fromEntries([...fake.history].slice(-max)));
  }
  if (m === 'GET' && route.startsWith('/history/')) {
    const id = decodeURIComponent(route.slice('/history/'.length));
    return json(200, fake.history.has(id) ? { [id]: fake.history.get(id) } : {});
  }
  if (m === 'POST' && route === '/history') {
    let body = {};
    try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); } catch { /* ignore */ }
    if (body.clear) fake.history.clear();
    for (const d of body.delete ?? []) fake.history.delete(d);
    return empty(200);
  }
  if (m === 'POST' && route === '/upload/image') {
    const f = multipart(await readBody(req), req.headers['content-type']);
    const img = f.image;
    if (!img?.filename) return empty(400);
    const type = ['input', 'temp', 'output'].includes(f.type) ? f.type : 'input';
    const sub = f.subfolder ?? '', dir = path.join(dirOfType(fake, type), path.normalize(sub));
    let name = img.filename, file = path.resolve(dir, name);
    if (!file.startsWith(path.resolve(dirOfType(fake, type)) + path.sep)) return empty(400);
    fs.mkdirSync(dir, { recursive: true });
    let dup = false;
    if (f.overwrite !== 'true' && f.overwrite !== '1') {
      const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
      for (let i = 1; fs.existsSync(file); i++) {
        if (fs.readFileSync(file).equals(img.data)) { dup = true; break; } // same picture: keep it, same name (ComfyUI #3465)
        name = `${stem} (${i})${ext}`; file = path.join(dir, name);
      }
    }
    if (!dup) fs.writeFileSync(file, img.data);
    fake.uploads.push({ name, subfolder: sub, type, dup });
    return json(200, { name, subfolder: sub, type });
  }
  if (m === 'GET' && route === '/view') {
    const filename = u.searchParams.get('filename');
    if (filename === null) return empty(404);
    if (!filename || filename[0] === '/' || filename.includes('..')) return empty(400);
    const base = dirOfType(fake, u.searchParams.get('type') ?? 'output');
    if (!base) return empty(400);
    const dir = path.resolve(base, u.searchParams.get('subfolder') ?? '');
    if (!(dir + path.sep).startsWith(path.resolve(base) + path.sep)) return empty(403);
    const file = path.join(dir, path.basename(filename));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return empty(404);
    const data = fs.readFileSync(file);
    res.writeHead(200, { 'content-type': /\.png$/i.test(file) ? 'image/png' : /\.jpe?g$/i.test(file) ? 'image/jpeg' : 'application/octet-stream', 'content-length': data.length, 'content-disposition': `filename="${path.basename(file)}"`, 'x-content-type-options': 'nosniff' });
    return res.end(data);
  }
  return empty(404);
}

const arg = (argv, n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const list = v => String(v).split(',').map(x => x.trim()).filter(Boolean);

/** Start a fake ComfyUI. Options mirror the CLI flags. `state` exposes what it received (for assertions). */
export function startFakeComfy({ port = 0, host = '127.0.0.1', delay = 1200, firstLoad = 0, dir, checkpoints, upscalers, ipadapter = true, ipadapterModels = true } = {}) {
  const root = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'fake-comfy-'));
  const cfg = {
    delay, firstLoad, ipadapter, input: path.join(root, 'input'), output: path.join(root, 'output'), temp: path.join(root, 'temp'),
    checkpoints: checkpoints ?? ['RealVisXL_V5.0_Lightning_fp16.safetensors', 'SDXL\\juggernautXL_juggXILightningByRD.safetensors', 'sd_xl_base_1.0.safetensors'],
    upscalers: upscalers ?? ['4x-UltraSharp.pth', 'RealESRGAN_x2plus.pth'],
    clipVision: ipadapterModels ? ['CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors'] : [],
    ipadapterFiles: ipadapterModels ? ['ip-adapter-plus_sdxl_vit-h.safetensors', 'ip-adapter_sdxl_vit-h.safetensors'] : [],
  };
  for (const d of [cfg.input, cfg.output, cfg.temp]) fs.mkdirSync(d, { recursive: true });
  const fake = { cfg, defs: nodeDefs(cfg), queue: [], running: null, history: new Map(), number: 0, interruptFlag: false, loaded: new Set(), closed: false,
    prompts: [], uploads: [], deleted: [], interrupts: [], done: [], requests: [] };
  const server = http.createServer((req, res) => handle(fake, req, res).catch(e => { if (!res.headersSent) { res.writeHead(500, { 'content-type': 'text/plain' }); res.end(String(e.stack ?? e)); } }));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const p = server.address().port;
      resolve({ url: `http://${host}:${p}`, port: p, dir: root, state: fake, close: () => new Promise(r => { fake.closed = true; fake.interruptFlag = true; server.closeAllConnections?.(); server.close(() => r()); }) });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv;
  const f = await startFakeComfy({
    port: Number(arg(a, 'port', 8188)), host: arg(a, 'host', '127.0.0.1'), delay: Number(arg(a, 'delay', 1200)), firstLoad: Number(arg(a, 'first-load', 0)), dir: arg(a, 'dir'),
    checkpoints: arg(a, 'checkpoints') ? list(arg(a, 'checkpoints')) : undefined, upscalers: arg(a, 'upscalers') !== undefined ? list(arg(a, 'upscalers')) : undefined,
    ipadapter: !a.includes('--no-ipadapter'), ipadapterModels: !a.includes('--no-ipadapter-models'),
  });
  console.log(`fake ComfyUI on ${f.url} (files in ${f.dir})`);
  const stop = () => f.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
