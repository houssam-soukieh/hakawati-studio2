// End to end: story → film with pictures from ComfyUI (the fake one in test/fake-comfy.mjs, so no GPU needed).
//   node test/e2e-pictures.mjs            needs ffmpeg/ffprobe, Chrome (HAKAWATI_CHROME or installed Chrome) and edge-tts
//                                         (or a shim on PATH); E2E_UPSCALER=1 also films with 4x upscaled pictures.
// 1. Starts the fake ComfyUI on a free port and points .studio/settings.json at it (the old file is put back at the end).
// 2. Checks the ComfyUI client: model names (Windows paths), clear errors (missing checkpoint/sampler/upscaler,
//    IP-Adapter missing, out of memory, ComfyUI down), the 400 shape, upscaling to an exact size, IP-Adapter uploads,
//    and stop → POST /queue {delete} + POST /interrupt.
// 3. Makes the whole film from docs/test-story.txt (photoreal) with `make.mjs` and checks cast portraits, every shot's
//    picture + thumbnail + clip, that the clips show the picture (not the dark fallback), the final MP4, and that a
//    second run repaints nothing.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startFakeComfy } from './fake-comfy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SETTINGS = path.join(ROOT, '.studio', 'settings.json');
const t0 = Date.now();
let failed = 0;
const ok = (cond, what, extra = '') => { console.log(`${cond ? '✓' : '✗'} ${what}${extra ? ` — ${extra}` : ''}`); if (!cond) failed++; return cond; };
const rejects = async (p, re, what) => { try { await p; return ok(false, what, 'did not fail'); } catch (e) { return ok(re.test(e.message) || (re.source === 'cancelled' && e.cancelled), what, e.message.slice(0, 220)); } };
const until = async (cond, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await cond()) return true; await new Promise(r => setTimeout(r, 50)); } return false; };
const yavg = (file, at) => { // mean brightness 0–255 of one frame
  const r = spawnSync('ffmpeg', ['-hide_banner', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-f', 'null', '-'], { encoding: 'utf8' });
  return Number(/YAVG=([\d.]+)/.exec(r.stderr)?.[1] ?? NaN);
};
const probe = file => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file], { encoding: 'utf8' }).stdout || '{}');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hakawati-e2e-'));
const fake = await startFakeComfy({ port: 0, delay: 500, firstLoad: 1200, dir: path.join(scratch, 'comfy') });
const fake2 = await startFakeComfy({ port: 0, delay: 200, ipadapterModels: false, dir: path.join(scratch, 'comfy-nomodels') });
const fake3 = await startFakeComfy({ port: 0, delay: 200, ipadapter: false, dir: path.join(scratch, 'comfy-nonodes') });
console.log(`fake ComfyUI: ${fake.url} · ${fake2.url} (no IP-Adapter models) · ${fake3.url} (no IP-Adapter nodes)`);

const saved = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS) : null;
const image = { engine: 'comfyui', url: fake.url, checkpoint: 'RealVisXL_V5.0_Lightning_fp16', ipadapter: true, ipWeight: 0.7, upscaler: '' };
const setImage = patch => {
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify({ engine: { preset: 'mock', protocol: 'mock', model: 'mock' }, render: { fps: 24, quality: '720p' }, ui: { lang: 'en' }, image: { ...image, ...patch } }, null, 2));
};

try {
  setImage({});
  const img = await import('../lib/image.mjs');
  const { pngSize } = img;
  const logs = [];
  const log = m => logs.push(m);

  // ---------------------------------------------------------------- the client against the fake
  console.log('\n— ComfyUI client');
  const test = await img.testImageEngine();
  ok(test.ok && test.gpu === 'NVIDIA GeForce RTX 3060 Ti' && test.vram === 8, 'Settings → Test reads /system_stats', `${test.version} · ${test.gpu} ${test.vram} GB`);
  ok(test.checkpoint === 'RealVisXL_V5.0_Lightning_fp16.safetensors', 'a checkpoint name without extension resolves to ComfyUI’s spelling', test.checkpoint);
  ok(test.ipadapter && test.upscalers.includes('4x-UltraSharp.pth') && test.samplers.includes('dpmpp_sde') && test.schedulers.includes('karras'), 'IP-Adapter ready, upscalers (V3 COMBO), samplers and schedulers listed');

  const a = await img.paint({ prompt: 'a lighthouse at dusk, cinematic', aspect: '16:9', seed: 1, log, label: 's1-1' });
  const sa = pngSize(a);
  ok(sa?.w === 1344 && sa?.h === 768, 'paint() returns the SDXL picture', `${sa?.w}×${sa?.h}, ${a.length} bytes`);
  ok(logs.some(l => /s1-1: 1344×768 painted/.test(l)), 'the job log says what was painted', logs.at(-1));
  const g1 = fake.state.prompts.at(-1).prompt;
  ok(g1['5'].inputs.sampler_name === 'dpmpp_sde' && g1['5'].inputs.scheduler === 'karras' && g1['7'].inputs.filename_prefix === 'hakawati/s1-1', 'graph: KSampler dpmpp_sde/karras, SaveImage into output/hakawati/');
  const b = await img.paint({ prompt: 'a desert caravan at night, cinematic', aspect: '16:9', seed: 1, label: 's1-2' });
  ok(!a.equals(b), 'different prompts → different pictures');

  setImage({ checkpoint: 'SDXL/juggernautXL_juggXILightningByRD.safetensors' });
  await img.paint({ prompt: 'probe', aspect: '1:1', seed: 2 });
  ok(fake.state.prompts.at(-1).prompt['1'].inputs.ckpt_name === 'SDXL\\juggernautXL_juggXILightningByRD.safetensors', 'a "SDXL/x" name finds the Windows "SDXL\\x" checkpoint');

  setImage({ checkpoint: 'nope_xl.safetensors' });
  await rejects(img.paint({ prompt: 'x', aspect: '16:9', seed: 1 }), /not in ComfyUI\/models\/checkpoints.*RealVisXL_V5\.0_Lightning_fp16\.safetensors/, 'missing checkpoint → error lists the available ones');
  setImage({ sampler: 'dpmpp_sde_x' });
  await rejects(img.paint({ prompt: 'x', aspect: '16:9', seed: 1 }), /sampler_name “dpmpp_sde_x”.*dpmpp_2m/, 'unknown sampler → error lists the valid ones');
  setImage({ upscaler: 'nope.pth' });
  await rejects(img.paint({ prompt: 'x', aspect: '16:9', seed: 1 }), /upscaler “nope\.pth”.*4x-UltraSharp\.pth/, 'missing upscaler → error lists the available ones');
  setImage({});
  await rejects(img.paint({ prompt: 'a FAIL_OOM test', aspect: '16:9', seed: 1 }), /out of GPU memory in KSampler \(1344×768\).*--lowvram/, 'execution_error OutOfMemory → clear advice');
  const closed = await new Promise(r => { const sv = http.createServer().listen(0, '127.0.0.1', () => { const port = sv.address().port; sv.close(() => r(port)); }); });
  setImage({ url: `http://127.0.0.1:${closed}` });
  await rejects(img.paint({ prompt: 'x', aspect: '16:9', seed: 1 }), /ComfyUI is not answering at http:\/\/127\.0\.0\.1:\d+ \(ECONNREFUSED\)/, 'ComfyUI down → clear error');
  setImage({ url: fake.url.replace('127.0.0.1', 'localhost').replace('http://', '') });
  ok(pngSize(await img.paint({ prompt: 'host without scheme', aspect: '9:16', seed: 3 }))?.h === 1344, 'url "localhost:port" (no http://) works, 9:16 is 768×1344');

  // the 400 shape, as POST /prompt really returns it
  const bad = await fetch(`${fake.url}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: img.buildWorkflow({ prompt: 'x', negative: '', width: 1344, height: 768, seed: 1, checkpoint: 'missing.safetensors', steps: 6, cfg: 2, sampler: 'dpmpp_sde', scheduler: 'karras' }) }) });
  const badText = await bad.text(), badJson = JSON.parse(badText);
  ok(bad.status === 400 && badJson.error.type === 'prompt_outputs_failed_validation' && badJson.node_errors['1']?.errors[0].type === 'value_not_in_list', 'fake: 400 {error, node_errors} with value_not_in_list on the loader');
  ok(/CheckpointLoaderSimple #1: Value not in list — ckpt_name: 'missing\.safetensors' not in/.test(img.rejection('/prompt', 400, badText)), 'client turns node_errors into a readable message', img.rejection('/prompt', 400, badText).slice(0, 160));
  const unk = await (await fetch(`${fake.url}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: { 1: { class_type: 'IPAdapterUnifiedLoaderX', inputs: {} } } }) })).text();
  ok(/IPAdapterUnifiedLoaderX' not found\. The custom node may not be installed/.test(img.rejection('/prompt', 400, unk)), 'unknown node class → "custom node may not be installed"');

  // upscaler: same graph, three more nodes, exact size for 1080p + camera headroom
  setImage({ upscaler: '4x-UltraSharp' });
  const up = pngSize(await img.paint({ prompt: 'upscaled', aspect: '16:9', seed: 4 }));
  const gu = fake.state.prompts.at(-1).prompt;
  ok(up?.w === 2208 && up?.h === 1242 && gu['20']?.inputs.model_name === '4x-UltraSharp.pth' && gu['22']?.inputs.crop === 'center' && gu['7'].inputs.images[0] === '22', 'upscaler → UpscaleModelLoader + ImageUpscaleWithModel + ImageScale to exactly 2208×1242', `${up?.w}×${up?.h}`);
  ok(pngSize(await img.paint({ prompt: 'portrait', aspect: '1:1', seed: 4, upscale: false }))?.w === 1024, 'upscale: false skips the upscaler (cast portraits)');
  setImage({});

  // IP-Adapter: upload once (same content → same name), LoadImage "hakawati/ref-….png"
  const refFile = path.join(scratch, 'hero.png');
  fs.writeFileSync(refFile, a);
  await img.paint({ prompt: 'the hero walks', aspect: '16:9', seed: 5, reference: refFile });
  await img.paint({ prompt: 'the hero runs', aspect: '16:9', seed: 6, reference: refFile });
  const gi = fake.state.prompts.at(-1).prompt, ups = fake.state.uploads.slice(-2);
  ok(/^hakawati\/ref-[0-9a-f]{16}\.png$/.test(gi['10']?.inputs.image ?? '') && gi['11'].inputs.preset === 'PLUS (high strength)' && gi['12'].inputs.weight_type === 'standard' && gi['5'].inputs.model[0] === '12', 'IP-Adapter graph: LoadImage → UnifiedLoader PLUS → IPAdapter → KSampler', gi['10']?.inputs.image);
  ok(ups.length === 2 && ups[0].name === ups[1].name && ups[1].dup, 'the same portrait is uploaded under the same name, not rewritten');

  setImage({ url: fake2.url });
  const l2 = [], l2log = m => l2.push(m);
  await img.paint({ prompt: 'x', aspect: '16:9', seed: 1, reference: refFile, log: l2log });
  await img.paint({ prompt: 'y', aspect: '16:9', seed: 2, reference: refFile, log: l2log });
  ok(l2.filter(l => /IP-Adapter models are missing.*ip-adapter-plus_sdxl_vit-h.*CLIP-ViT-H-14/.test(l)).length === 1 && !fake2.state.prompts.at(-1).prompt['12'], 'IP-Adapter models missing → one warning naming the files, paints without the reference');
  ok((await img.testImageEngine()).ipadapterMissing.length === 2, 'Settings → Test reports the two missing IP-Adapter files');
  setImage({ url: fake3.url });
  const l3 = [];
  await img.paint({ prompt: 'x', aspect: '16:9', seed: 1, reference: refFile, log: m => l3.push(m) });
  ok(l3.some(l => /IP-Adapter nodes are not installed/.test(l)), 'IP-Adapter nodes missing → warning, paints without the reference');
  setImage({});

  // stop: a running picture is interrupted, a queued one is deleted from the queue
  const c1 = new AbortController(), c2 = new AbortController(), ql = [];
  const p1 = img.paint({ prompt: 'SLOW running one', aspect: '16:9', seed: 7, signal: c1.signal, label: 'run' });
  await until(() => fake.state.running?.[3]?.client_id?.startsWith('hakawati-'));
  const runningId = fake.state.running?.[1];
  const p2 = img.paint({ prompt: 'queued one', aspect: '16:9', seed: 8, signal: c2.signal, label: 'wait', log: m => ql.push(m) });
  await until(() => ql.some(l => /waiting in the ComfyUI queue \(1 ahead\)/.test(l)), 8000);
  ok(ql.some(l => /wait: waiting in the ComfyUI queue \(1 ahead\)/.test(l)), 'a queued picture logs its queue position', ql[0]);
  const queuedId = fake.state.queue[0]?.[1];
  c2.abort();
  await rejects(p2, /cancelled/, 'stopping a queued picture → Cancelled');
  ok(queuedId && fake.state.deleted.includes(queuedId) && !fake.state.queue.length, 'stopping a queued picture removes it: POST /queue {delete:[id]}');
  c1.abort();
  await rejects(p1, /cancelled/, 'stopping the running picture → Cancelled');
  await until(() => fake.state.history.get(runningId));
  ok(fake.state.interrupts.includes(runningId) && fake.state.history.get(runningId)?.status.messages.some(m => m[0] === 'execution_interrupted'), 'stopping the running picture: POST /interrupt {prompt_id} → execution_interrupted');

  // the blank-picture guard
  const flat = path.join(scratch, 'flat.png');
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=1344x768', '-frames:v', '1', flat]);
  const fs1 = pngSize(fs.readFileSync(flat));
  ok(fs1.idat < 1344 * 768 * 0.004 && sa.idat > 1344 * 768 * 0.004, 'a single-colour PNG is caught as blank, a real one is not', `black ${fs1.idat} B vs picture ${sa.idat} B of pixel data`);

  // ---------------------------------------------------------------- the whole film
  console.log('\n— the film (make.mjs, mock director, pictures from the fake ComfyUI)');
  const upscaler = process.env.E2E_UPSCALER ? '4x-UltraSharp.pth' : '';
  setImage({ upscaler });
  const make = (args, tag) => new Promise((resolve, reject) => {
    const ch = spawn(process.execPath, ['make.mjs', ...args], { cwd: ROOT, env: process.env });
    let out = '';
    const pipe = d => { out += d; for (const line of String(d).split('\n')) if (line.trim() && !/^PROGRESS/.test(line)) console.log(`   ${tag} │ ${line}`); };
    ch.stdout.on('data', pipe); ch.stderr.on('data', pipe);
    ch.on('close', code => (code === 0 ? resolve(out) : reject(new Error(`make.mjs ${args.join(' ')} → exit ${code}`))));
  });
  const id = (await make(['new', 'docs/test-story.txt', '--style', 'photoreal', '--aspect', '16:9', '--length', '40', '--lang', 'ar'], 'new')).trim().split('\n').pop();
  ok(/^\d{4}-\d{2}-\d{2}-/.test(id), 'project created', id);
  const before = fake.state.prompts.length;
  const tf = Date.now();
  await make(['run', id, 'all'], 'run');
  const filmSec = Math.round((Date.now() - tf) / 1000);
  const dir = path.join(ROOT, 'projects', id), p = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
  const shots = p.screenplay.scenes.flatMap(s => s.shots), story = shots.filter(s => s.kind === 'shot');
  const want = upscaler ? { w: 2208, h: 1242 } : { w: 1344, h: 768 };

  // with an upscaler the portraits come out 1242² until the cast step passes paint({ upscale: false }) (pipeline.mjs)
  const sizes = p.screenplay.cast.map(c => { const f = p.assets.castImages?.[c.id]?.file; return f && pngSize(fs.readFileSync(path.join(dir, f))); });
  ok(sizes.length > 0 && sizes.every(z => z?.h === z?.w && (z.w === 1024 || (upscaler && z.w === 1242))), 'every character has a square reference portrait',
    `${p.screenplay.cast.map((c, i) => `${p.assets.castImages?.[c.id]?.file} ${sizes[i]?.w}²`).join(', ')}${sizes.some(z => z?.w === 1242) ? ' (upscaled: the cast step should pass upscale: false)' : ''}`);
  const pics = story.map(s => ({ id: s.id, a: p.assets.art[s.id] }));
  ok(pics.every(({ id: sid, a }) => a?.image === `images/${sid}.png` && pngSize(fs.readFileSync(path.join(dir, a.image)))?.w === want.w), `every story shot has images/<id>.png at ${want.w}×${want.h}`, `${pics.length} shots`);
  ok(pics.every(({ a }) => a?.thumb && fs.statSync(path.join(dir, a.thumb)).size > 2000), 'every story shot has a thumbnail');
  const withRef = fake.state.done.filter(d => d.at >= tf && d.ipadapter).length;
  ok(withRef === story.filter(s => s.cast?.length).length, 'shots with characters were painted with the cast portrait through IP-Adapter', `${withRef} of ${story.length}`);
  ok(fake.state.prompts.length - before === p.screenplay.cast.length + story.length && fake.state.prompts.slice(before).every(x => x.ok), 'one valid prompt per portrait and per shot, none rejected', `${fake.state.prompts.length - before} prompts`);
  ok(shots.every(s => p.assets.clips[s.id]?.file && fs.existsSync(path.join(dir, p.assets.clips[s.id].file))), 'every shot (title and end cards too) has a clip', `${shots.length} clips`);
  const bright = story.map(s => { const f = path.join(dir, p.assets.clips[s.id].file); return { id: s.id, y: yavg(f, Math.max(0.1, Number(probe(f).format?.duration ?? 1) / 2)) }; });
  const fallback = (() => { // what a clip looks like without its picture: the player's dark fallback
    const f = path.join(scratch, 'dark.png');
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x111111:s=640x360', '-frames:v', '1', f]);
    return yavg(f, 0);
  })();
  ok(bright.every(b => b.y > 60), `the rendered clips show the picture (mean brightness > 60; the dark fallback is ${Math.round(fallback)})`, bright.map(b => `${b.id} ${Math.round(b.y)}`).join(' · '));
  const final = p.assets.final && path.join(dir, p.assets.final.file), pr = final && fs.existsSync(final) ? probe(final) : {};
  const v = pr.streams?.find(s => s.codec_type === 'video');
  ok(!!v && pr.streams.some(s => s.codec_type === 'audio') && Number(pr.format.duration) > 10, 'the final MP4 exists with picture and sound', final ? `${path.relative(ROOT, final)} · ${v?.width}×${v?.height} · ${Number(pr.format?.duration).toFixed(1)} s · ${(fs.statSync(final).size / 1048576).toFixed(1)} MB · made in ${filmSec} s` : 'missing');
  ok(yavg(final, Number(pr.format?.duration ?? 2) / 2) > 60, 'the middle of the final film shows a picture');

  const n = fake.state.prompts.length;
  await make(['run', id, 'all'], 'again');
  ok(fake.state.prompts.length === n, 'running "all" again repaints nothing (stable cache keys)');
} catch (e) {
  failed++;
  console.error(`✗ ${e.stack ?? e}`);
} finally {
  if (saved) fs.writeFileSync(SETTINGS, saved); else fs.rmSync(SETTINGS, { force: true });
  await Promise.all([fake.close(), fake2.close(), fake3.close()]);
  fs.rmSync(scratch, { recursive: true, force: true });
  console.log(`\n${failed ? `✗ ${failed} check(s) failed` : '✓ all checks passed'} in ${Math.round((Date.now() - t0) / 1000)} s`);
  process.exit(failed ? 1 : 0);
}
