// End to end: story → film with pictures from ComfyUI (the fake one in test/fake-comfy.mjs, so no GPU needed).
//   node test/e2e-pictures.mjs            needs ffmpeg/ffprobe, Chrome (HAKAWATI_CHROME or installed Chrome) and edge-tts
//                                         (or a shim on PATH); E2E_UPSCALER=1 also films with 4x upscaled pictures.
// 1. Starts the fake ComfyUI on a free port and points .studio/settings.json at it (the old file is put back at the end).
// 2. Checks the ComfyUI client: model names (Windows paths), clear errors (missing checkpoint/sampler/upscaler,
//    IP-Adapter missing, out of memory, ComfyUI down), the 400 shape, upscaling to an exact size, IP-Adapter uploads,
//    and stop → POST /queue {delete} + POST /interrupt.
// 3. Looks: human portraits are identity references cropped to the face (IP-Adapter 0.55, 'prompt is more important',
//    end_at 0.85), beings are painted as non-human entities (being portrait prompt, human terms in the negative, their
//    portrait whole as 'style transfer' at 0.3), the content-safety terms are always in the negative, old settings move
//    to the new IP-Adapter defaults, and an IPAdapter without 'style transfer' paints beings without a reference.
// 4. Makes the whole film from docs/test-story.txt (photoreal) with `make.mjs` and checks cast portraits, every shot's
//    picture + thumbnail + clip, that the clips show the picture (not the dark fallback), the final MP4, and that a
//    second run repaints nothing.
import './sandbox.mjs'; // first: settings and projects in a temp folder, never the owner's
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startFakeComfy } from './fake-comfy.mjs';
import { STUDIO, PROJECTS } from '../lib/util.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SETTINGS = path.join(STUDIO, 'settings.json');
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
const fake4 = await startFakeComfy({ port: 0, delay: 200, weightTypes: ['standard'], dir: path.join(scratch, 'comfy-oldipa') });
console.log(`fake ComfyUI: ${fake.url} · ${fake2.url} (no IP-Adapter models) · ${fake3.url} (no IP-Adapter nodes) · ${fake4.url} (IPAdapter with 'standard' only)`);

const saved = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS) : null;
const image = { engine: 'comfyui', url: fake.url, checkpoint: 'RealVisXL_V5.0_Lightning_fp16', ipadapter: true, upscaler: '' };
const setImage = (patch, exact = false) => {
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify({ engine: { preset: 'mock', protocol: 'mock', model: 'mock' }, render: { fps: 24, quality: '720p' }, ui: { lang: 'en' }, image: exact ? patch : { ...image, ...patch } }, null, 2));
};
const uploaded = (f, u) => path.join(f.dir, 'input', u.subfolder ?? '', u.name); // a file the client uploaded to fake ComfyUI f

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
  ok(/^hakawati\/ref-[0-9a-f]{16}\.png$/.test(gi['10']?.inputs.image ?? '') && gi['11'].inputs.preset === 'PLUS (high strength)' && gi['12'].inputs.weight_type === 'prompt is more important' && gi['5'].inputs.model[0] === '12', 'IP-Adapter graph: LoadImage → UnifiedLoader PLUS → IPAdapter → KSampler', gi['10']?.inputs.image);
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

  // ---------------------------------------------------------------- looks: humans and beings
  console.log('\n— looks: humans and beings');
  const prompts = await import('../lib/prompts.mjs');
  const { loadSettings, SAFE_NEGATIVE, withTerms } = await import('../lib/settings.mjs');
  const bible = { // docs/pilot/bible.md §3–4, word for word; the Eye has no kind (a screenplay from before kinds existed)
    kira: '22-year-old woman, olive skin, oval face, tired dark-brown eyes, thick dark eyebrows, long dark-brown hair in a loose messy knot with one silver-white streak at the left temple, faded mustard-yellow work overshirt over a charcoal T-shirt, cheap black wristwatch',
    orion: 'translucent slender humanoid woven from fine glowing cyan-blue light threads, smooth faceless head with two soft white eye-points, three thin rings of light on each wrist, lower body unravelling into a stream of threads that flows from a phone screen',
    eye: 'colossal ring of cold white light hanging flat under the ceiling, concentric thin silver rings inside it, no face, an empty dark centre, hundreds of hair-thin white filaments descending from it to every camera and screen',
    broker: 'tall elegant humanoid of flowing molten-gold light and warm golden smoke, smooth eyeless golden face with a wide fixed smile, silhouette of a tailored suit, long thin fingers trailing fine golden strings, pouring out of a dark screen like liquid',
  };
  const sp = { artStyle: '', cast: [{ id: 'kira', name: 'Kira', kind: 'human', look: bible.kira }, { id: 'orion', name: 'Orion', kind: 'being', look: bible.orion },
    { id: 'the-eye', name: 'The Eye', look: bible.eye }, { id: 'the-broker', name: 'The Broker', kind: 'human', look: bible.broker }] }; // the Broker: a being the director left at 'human'
  const [kiraC, orionC, eyeC, brokerC] = sp.cast;
  const HUMAN_TERMS = 'human face, human skin, realistic person, woman, man, body, torso, nude, cleavage', ONE_TERMS = 'two people, duplicate, twins, clone, multiple figures';
  const hasTerms = (text, list) => list.split(', ').every(x => String(text).split(/\s*,\s*/).includes(x)); // every term, in any order
  ok(prompts.castKind(kiraC) === 'human' && prompts.castKind(orionC) === 'being' && prompts.castKind(eyeC) === 'being' && prompts.castKind(brokerC) === 'being' && prompts.castKind({ look: 'old man, round steel-rimmed glasses, a glass of tea' }) === 'human',
    'kinds: the screenplay’s kind, else read from the look (faceless, eyeless, ring of light…); a human with glasses stays human');
  const base = loadSettings().image.negative;
  ok(SAFE_NEGATIVE.split(', ').every(x => base.includes(x)) && /plastic skin/.test(base), 'Settings → Negative by default: the old terms + nsfw, nude, nudity, topless, cleavage, lingerie, sexualized');
  const kiraP = prompts.castImagePrompt(sp, { style: 'photoreal' }, kiraC), orionP = prompts.castImagePrompt(sp, { style: 'photoreal' }, orionC), eyeP = prompts.castImagePrompt(sp, { style: 'photoreal' }, eyeC);
  ok([orionP, eyeP].every(x => /non-human luminous entity/.test(x) && /no human face, no skin, not a person/.test(x) && /pure black background/.test(x) && !/portrait|upper body|head-and-shoulders|skin and fabric|neutral expression/.test(x)) && orionP.includes(bible.orion),
    'a being’s reference prompt: the whole non-human entity per its look, no face, no skin, not a person, on black', orionP.slice(0, 120));
  ok(kiraP.includes(bible.kira) && /tight head-and-shoulders/.test(kiraP) && /soft even frontal light, plain mid-grey background/.test(kiraP) && !/rim light|volumetric|35mm|film grain|three-quarter/.test(kiraP),
    'a human’s reference prompt: a head-and-shoulders identity photo, even light, mid-grey ground, none of the film’s lens/light/grade', kiraP.slice(0, 120));

  // the portraits, painted as the cast step paints them (+ the per-character negative)
  const portrait = async (c, prompt, seed) => {
    const png = await img.paint({ prompt, negative: prompts.castNegative(c, base), aspect: '1:1', seed, label: c.id, upscale: false });
    const file = path.join(scratch, `${c.id}.png`);
    fs.writeFileSync(file, png);
    return { file, g: fake.state.prompts.at(-1).prompt };
  };
  const kiraR = await portrait(kiraC, kiraP, 21), orionR = await portrait(orionC, orionP, 22);
  ok(orionR.g['2'].inputs.text === orionP && hasTerms(orionR.g['3'].inputs.text, HUMAN_TERMS) && hasTerms(orionR.g['3'].inputs.text, ONE_TERMS),
    'a being’s portrait reaches ComfyUI with the being prompt and the human terms in its negative');
  ok(!/human face|realistic person/.test(kiraR.g['3'].inputs.text) && hasTerms(kiraR.g['3'].inputs.text, ONE_TERMS) && hasTerms(kiraR.g['3'].inputs.text, SAFE_NEGATIVE),
    'a human’s portrait: one person, no anti-human terms, the safety terms');

  // shot negatives
  const negO = prompts.shotNegative(sp, { cast: ['orion'], visual: 'Orion bows at her shoulder' }, base), negKO = prompts.shotNegative(sp, { cast: ['kira', 'orion'] }, base);
  const negK = prompts.shotNegative(sp, { cast: ['kira'] }, base), negCrowd = prompts.shotNegative(sp, { cast: ['kira'], visual: 'Kira crosses a crowd of passers-by' }, base);
  ok(negO.startsWith(base) && hasTerms(negO, HUMAN_TERMS) && hasTerms(negO, ONE_TERMS),
    'a being shot’s negative: Settings → Negative + the human terms + no copies (one being in frame)', negO.slice(base.length, base.length + 140));
  ok(!/realistic person|human skin|woman/.test(negKO) && /second person, extra person/.test(negKO) && /two people, duplicate/.test(negK) && !/two people/.test(negCrowd) && prompts.shotNegative(sp, { cast: ['orion', 'the-eye'] }, base).includes('realistic person'),
    'a human with a being: the human stays a person, no second one; one human: no copies (unless the shot has extras); two beings: still no person');

  // shot prompts: a being-only frame never gets human words from the writer or the style; humans go first in a shared frame
  const comp = prompts.composePrompt({ text: '[[orion]] bowing slightly, a woman\'s bare chest glowing, hair-thin threads around it, low angle', people: [orionC], location: { look: 'frozen workshop' }, shot: { lens: '50mm', light: 'moonlight' }, style: 'cinematic film still, photorealistic, highly detailed skin and fabric texture' });
  const shared = prompts.composePrompt({ text: '[[orion]] at her shoulder', people: [orionC, kiraC], location: { look: 'workshop' }, shot: { lens: '35mm', light: 'phone glow' }, style: 'film still' });
  ok(comp.includes(bible.orion) && !/woman|chest|skin/.test(comp) && /hair-thin threads/.test(comp) && shared.indexOf(bible.kira) < shared.indexOf(bible.orion),
    'a being-only shot prompt keeps the bible look and drops human anatomy phrases; a shared frame puts the human first', comp.slice(bible.orion.length, bible.orion.length + 100));

  // IP-Adapter: a human's reference is the face, 0.55 'prompt is more important'; a being's is whole, 0.3 'style transfer'
  await img.paint({ prompt: 'kira at 3 am, phone glow, extreme close-up', negative: negK, aspect: '16:9', seed: 23, reference: kiraR.file, refKind: 'human', label: 'kira-shot' });
  const gh = fake.state.prompts.at(-1).prompt, uh = fake.state.uploads.at(-1), faceSize = pngSize(fs.readFileSync(uploaded(fake, uh))), kiraSize = pngSize(fs.readFileSync(kiraR.file));
  ok(faceSize && faceSize.w === faceSize.h && faceSize.w === Math.trunc(Math.min(kiraSize.w, kiraSize.h) * 0.6 / 2) * 2 && faceSize.w < kiraSize.w,
    'a human’s reference is uploaded cropped to the face (a centred square from the top, smaller than the portrait)', `${faceSize?.w}×${faceSize?.h} of ${kiraSize.w}×${kiraSize.h}`);
  ok(gh['12'].inputs.weight === 0.55 && gh['12'].inputs.weight_type === 'prompt is more important' && gh['12'].inputs.end_at === 0.85 && gh['12'].inputs.start_at === 0 && gh['3'].inputs.text === withTerms(negK, SAFE_NEGATIVE),
    'IP-Adapter for a human: weight 0.55, “prompt is more important”, end_at 0.85; the shot’s negative is used', `${gh['12'].inputs.weight} · ${gh['12'].inputs.weight_type} · ${gh['12'].inputs.end_at}`);
  await img.paint({ prompt: 'orion bows', negative: negO, aspect: '16:9', seed: 24, reference: orionR.file, refKind: 'being', label: 'orion-shot' });
  const gb = fake.state.prompts.at(-1).prompt, ub = fake.state.uploads.at(-1);
  ok(gb['12'].inputs.weight === 0.3 && gb['12'].inputs.weight_type === 'style transfer' && gb['12'].inputs.end_at === 0.85 && fs.readFileSync(uploaded(fake, ub)).equals(fs.readFileSync(orionR.file)) && gb['3'].inputs.text.includes('realistic person'),
    'IP-Adapter for a being: its whole portrait, weight 0.3, “style transfer”; its negative carries the human terms', `${gb['12'].inputs.weight} · ${gb['12'].inputs.weight_type}`);
  const run4 = fake.state.done.filter(d => d.ipadapter).slice(-2);
  ok(run4.length === 2 && run4[0].ipadapter.end_at === 0.85 && run4[1].ipadapter.weight_type === 'style transfer' && run4.every(d => d.ok && /nsfw/.test(d.negative)), 'the fake ran both graphs: IPAdapter end_at 0.85, the negative with the safety terms');

  // Settings → Negative without the safety terms still gets them; old settings move to the new defaults
  setImage({ negative: 'text, logo' });
  await img.paint({ prompt: 'a quiet street', aspect: '16:9', seed: 25 });
  ok(fake.state.prompts.at(-1).prompt['3'].inputs.text === `text, logo, ${SAFE_NEGATIVE}`, 'the safety terms are added to any Negative', fake.state.prompts.at(-1).prompt['3'].inputs.text);
  setImage({ ...image, ipWeight: 0.7, negative: 'text, letters, words, caption, watermark, logo, signature, frame, blurry, lowres, jpeg artifacts, deformed, disfigured, extra fingers, bad hands, bad anatomy, cross-eyed, cartoon, 3d render, plastic skin' }, true);
  const old = loadSettings().image;
  setImage({ ipWeight: 0.7, ipWeightType: 'standard' });
  const kept = loadSettings().image;
  setImage({ ipWeightType: 'bogus' });
  ok(old.ipWeight === 0.55 && old.ipWeightType === 'prompt is more important' && old.negative.endsWith(SAFE_NEGATIVE) && kept.ipWeight === 0.7 && kept.ipWeightType === 'standard' && loadSettings().image.ipWeightType === 'prompt is more important',
    'settings saved before this version move to 0.55 / “prompt is more important” / the safe negative; a chosen weight and type are kept; an unknown type falls back');
  setImage({});
  const sigA = img.imageSig(loadSettings());
  setImage({ ipWeightType: 'standard' });
  ok(img.imageSig(loadSettings()) !== sigA, 'the IP-Adapter weight type is part of the picture cache key (changing it repaints)');

  // an older IPAdapter node with 'standard' only: humans fall back to it, beings go without their reference (one warning)
  setImage({ url: fake4.url });
  const l4 = [], log4 = m => l4.push(m); // one job, one log
  await img.paint({ prompt: 'kira', aspect: '16:9', seed: 26, reference: kiraR.file, log: log4 });
  const g4h = fake4.state.prompts.at(-1).prompt;
  await img.paint({ prompt: 'orion', aspect: '16:9', seed: 27, reference: orionR.file, refKind: 'being', log: log4 });
  await img.paint({ prompt: 'orion again', aspect: '16:9', seed: 28, reference: orionR.file, refKind: 'being', log: log4 });
  ok(g4h['12']?.inputs.weight_type === 'standard' && !fake4.state.prompts.at(-1).prompt['12'] && l4.filter(l => /no “style transfer” weight type/.test(l)).length === 1 && fake4.state.prompts.every(x => x.ok),
    'IPAdapter without “style transfer”: humans use “standard”, beings are painted without the reference, one warning');
  setImage({});

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
  const dir = path.join(PROJECTS, id), p = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
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
  const faces = fake.state.done.filter(d => d.at >= tf && d.ipadapter).map(d => d.ipadapter);
  ok(faces.length && faces.every(x => x.weight === 0.55 && x.weight_type === 'prompt is more important' && x.end_at === 0.85) && fake.state.uploads.slice(-faces.length).every(u => pngSize(fs.readFileSync(uploaded(fake, u)))?.w === 614),
    'the film’s shots carry their human portrait as a 614² face crop, IP-Adapter 0.55 / “prompt is more important”');

  // a story with a being (a whisper line): the cast step paints the being as a non-human entity
  const beingStory = path.join(scratch, 'being-story.txt');
  fs.writeFileSync(beingStory, 'The hero mends an old phone late at night. «Orion: He is tired, and he does not know I am here.» The phone glows in the dark.');
  const bid = (await make(['new', beingStory, '--style', 'photoreal', '--aspect', '16:9', '--length', '20', '--lang', 'en'], 'new')).trim().split('\n').pop();
  const b0 = fake.state.prompts.length;
  await make(['run', bid, 'script,cast'], 'cast');
  const bp = JSON.parse(fs.readFileSync(path.join(PROJECTS, bid, 'project.json'), 'utf8')), being = bp.screenplay.cast.find(c => c.kind === 'being');
  const castGraphs = fake.state.prompts.slice(b0).map(x => x.prompt['2'].inputs.text);
  const beingGraph = castGraphs.find(x => being && x.includes(being.look));
  ok(being && bp.assets.castImages?.[being.id]?.prompt === beingGraph && /non-human luminous entity/.test(beingGraph) && /no human face, no skin, not a person/.test(beingGraph) && castGraphs.filter(x => /identity reference/.test(x)).length === bp.screenplay.cast.length - 1,
    'the cast step paints a being from the being prompt and every human as an identity reference', being ? `${being.id}: ${beingGraph?.slice(0, 90)}…` : 'no being in the cast');
} catch (e) {
  failed++;
  console.error(`✗ ${e.stack ?? e}`);
} finally {
  if (saved) fs.writeFileSync(SETTINGS, saved); else fs.rmSync(SETTINGS, { force: true });
  await Promise.all([fake.close(), fake2.close(), fake3.close(), fake4.close()]);
  fs.rmSync(scratch, { recursive: true, force: true });
  console.log(`\n${failed ? `✗ ${failed} check(s) failed` : '✓ all checks passed'} in ${Math.round((Date.now() - t0) / 1000)} s`);
  process.exit(failed ? 1 : 0);
}
