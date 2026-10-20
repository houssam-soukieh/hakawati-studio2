// The picture critic end to end, with no GPU and no real engine: starts fake-llm + fake-comfy-lite, points the
// Studio at them (the real .studio/settings.json is put back afterwards) and checks
//   1. testEngine: vision true on openai and anthropic, false on a model that refuses images
//   2. critiquePictures on a dark and a bright picture (both protocols): the bright one wins; offline scores are stable
//   3. paintBest with an engine that never answers JSON: keeps candidate #0 instead of failing the job
//   4. a whole project: script (offline director) → voice, cast, art on the fakes: N candidates painted, the critic
//      sees them (JPEG ≤768 px), repaints under minScore, keeps the best over the rounds, stores the asset fields.
//      --anthropic runs it on the Anthropic format (default OpenAI); --film also renders and assembles the MP4;
//      --keep leaves the test project in projects/.
//   PATH=<edge-tts shim>:$PATH node test/critic/e2e.mjs [--anthropic] [--film] [--keep]
import '../sandbox.mjs'; // first: settings and projects in a temp folder, never the owner's
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { STUDIO, ROOT, writeJSON } from '../../lib/util.mjs';
import { DEFAULTS } from '../../lib/settings.mjs';
import { testEngine } from '../../lib/llm.mjs';
import { critiquePictures, paintBest } from '../../lib/critic.mjs';
import { createProject, loadProject, allShots, fileOf, dirOf } from '../../lib/project.mjs';
import { runSteps, shotStatus } from '../../lib/pipeline.mjs';
import { closeBrowser } from '../../lib/render.mjs';

const LLM_PORT = 48771, COMFY_PORT = 48772;
const here = path.dirname(new URL(import.meta.url).pathname);
const SETTINGS = path.join(STUDIO, 'settings.json');
const saved = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS) : null;
const kids = [];
const ok = m => console.log(`  ✓ ${m}`);

function start(file, port) {
  const child = spawn(process.execPath, [path.join(here, file), String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  kids.push(child);
  return new Promise((resolve, reject) => {
    child.stdout.once('data', d => (/on http/.test(d) ? resolve() : reject(new Error(String(d)))));
    child.once('exit', c => reject(new Error(`${file} exited ${c}`)));
  });
}
const llmLog = async () => (await fetch(`http://127.0.0.1:${LLM_PORT}/__log`)).json();
const comfyLog = async () => (await fetch(`http://127.0.0.1:${COMFY_PORT}/__log`)).json();
const engine = (protocol, model) => (protocol === 'mock' ? { ...DEFAULTS.engine } : {
  ...DEFAULTS.engine, preset: 'custom', protocol, model, apiKey: 'sk-test-0000', concurrency: 3,
  baseURL: protocol === 'anthropic' ? `http://127.0.0.1:${LLM_PORT}` : `http://127.0.0.1:${LLM_PORT}/v1`,
});
const use = (protocol, model, image = {}) => writeJSON(SETTINGS, { engine: engine(protocol, model), ui: { lang: 'en' },
  image: { ...DEFAULTS.image, engine: 'comfyui', url: `http://127.0.0.1:${COMFY_PORT}`, checkpoint: 'fake-xl-lightning.safetensors', ...image } });
const png = brightness => spawnSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1344x768', '-frames:v', '1', '-vf', `eq=brightness=${brightness}`, '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'], { maxBuffer: 64 << 20 }).stdout;

const sp = { title: 'Test', artStyle: 'photoreal film', cast: [{ id: 'hero', name: 'Hero', look: 'a tall woman in a red coat' }], locations: [{ id: 'hills', look: 'green hills at dusk' }] };
const shot = { id: 's1-1', visual: 'A woman stands on a hill at dusk.', action: 'Her coat moves in the wind.', shotType: 'wide', camera: 'push-in', cast: ['hero'], location: 'hills', narration: 'She waited.' };
const options = { style: 'photoreal', aspect: '16:9' };

let projectId = null;
try {
  await Promise.all([start('fake-llm.mjs', LLM_PORT), start('fake-comfy-lite.mjs', COMFY_PORT)]);

  console.log('1. testEngine vision probe');
  for (const protocol of ['openai', 'anthropic']) {
    use(protocol, 'fake-vision');
    const r = await testEngine();
    assert.equal(r.ok, true); assert.equal(r.vision, true, JSON.stringify(r)); assert.equal(r.reply, 'Ready ✓');
    ok(`${protocol}: ${JSON.stringify({ reply: r.reply, vision: r.vision, models: r.models })}`);
  }
  use('openai', 'fake-blind');
  const blind = await testEngine();
  assert.equal(blind.vision, false); ok(`blind model: vision ${blind.vision} (${blind.visionError})`);
  use('openai', 'fake-vision-nostream');
  assert.equal((await testEngine()).vision, true); ok('non-streamed answer: vision true');
  use('mock');
  assert.equal((await testEngine()).vision, true); ok('mock: vision true');
  const probes = (await llmLog()).filter(r => r.kind === 'probe');
  assert.ok(probes.every(r => r.images.length === 1 && r.images[0].mime === 'image/jpeg' && r.images[0].w === 64));
  ok(`probe image arrived as ${probes[0].images[0].mime} ${probes[0].images[0].w}×${probes[0].images[0].h}, mean luma ${probes[0].images[0].luma}`);

  console.log('2. critiquePictures');
  const dark = png(-0.3), bright = png(0.3);
  const refs = [{ name: 'Hero', look: 'a tall woman in a red coat', buf: png(0) }];
  for (const protocol of ['openai', 'anthropic']) {
    use(protocol, 'fake-vision');
    const r = await critiquePictures({ sp, options, shot, prompt: 'a woman on a hill', candidates: [dark, bright], refs });
    assert.equal(r.best, 1); assert.ok(r.scores[1] >= 7 && r.scores[0] < 7); assert.equal(r.fixPrompt, null);
    const low = await critiquePictures({ sp, options, shot, prompt: 'a woman on a hill', candidates: [dark, dark] });
    assert.ok(low.fixPrompt?.includes('bright clean daylight'));
    ok(`${protocol}: [dark, bright] → best #${r.best} scores ${r.scores} fixPrompt ${r.fixPrompt}; [dark, dark] → scores ${low.scores}, fixPrompt “${low.fixPrompt.slice(0, 70)}…”`);
  }
  const call = (await llmLog()).filter(r => r.kind === 'critic').at(-4);
  assert.deepEqual(call.images.map(i => i.label.split(' ')[0]), ['REFERENCE', 'CANDIDATE', 'CANDIDATE']);
  assert.ok(call.images.every(i => i.mime === 'image/jpeg' && Math.max(i.w, i.h) <= 768));
  ok(`critic call carried ${call.images.map(i => `${i.label.slice(0, 22)} ${i.w}×${i.h} ${i.bytes} B`).join(' | ')}; temperature ${call.temperature}`);
  use('mock');
  const m1 = await critiquePictures({ sp, options, shot, prompt: 'p', candidates: [dark, bright] });
  const m2 = await critiquePictures({ sp, options, shot, prompt: 'p', candidates: [dark, bright] });
  assert.deepEqual(m1, m2); ok(`mock critic is stable: ${JSON.stringify(m1)}`);

  console.log('3. critic failure falls back');
  use('openai', 'fake-badjson', { candidates: 2 });
  const lines = [];
  const fb = await paintBest({ sp, options, shot, prompt: 'a woman', critic: true, paint: async (pr, k) => (k ? bright : dark), log: m => lines.push(m) });
  assert.equal(fb.png, dark); assert.equal(fb.score, null); assert.equal(fb.candidates.length, 2);
  ok(`no JSON after 3 tries → kept candidate #0; log: ${lines.at(-1).trim()}`);

  console.log(`4. a whole project on the fakes (${process.argv.includes('--anthropic') ? 'anthropic' : 'openai'} format)`);
  use('mock');
  projectId = createProject({ title: 'critic e2e', story: fs.readFileSync(path.join(ROOT, 'docs/test-story.txt'), 'utf8'), options: { length: 30, style: 'photoreal' } }).id;
  await runSteps(projectId, ['script'], {});
  use(process.argv.includes('--anthropic') ? 'anthropic' : 'openai', 'fake-vision', { candidates: 2, critic: true, minScore: 7, maxRounds: 2 });
  const before = (await llmLog()).length, comfyBefore = (await comfyLog()).length;
  const log = [];
  const steps = process.argv.includes('--film') ? ['voice', 'cast', 'art', 'render', 'assemble'] : ['voice', 'cast', 'art'];
  await runSteps(projectId, steps, { log: m => { log.push(m); if (/👁|↺|🖼 s1-1|✓|⚠|🏁/.test(m)) console.log(`    ${m}`); } });
  const p = loadProject(projectId);
  const shots = allShots(p).filter(s => s.kind === 'shot');
  const calls = (await llmLog()).slice(before), painted = (await comfyLog()).slice(comfyBefore);
  assert.equal(calls.filter(r => r.kind === 'probe').length, 1, 'one vision probe per job');
  for (const s of shots) {
    const a = p.assets.art[s.id];
    assert.equal(typeof a.score, 'number'); assert.ok(a.critique); assert.equal(a.rounds, 2); assert.equal(a.candidates.length, 4);
    assert.ok(a.score >= 7 && a.prompt.includes('bright clean daylight'), `${s.id}: the repaint should win`);
    for (const c of a.candidates) assert.ok(fs.existsSync(fileOf(projectId, c.file)), c.file);
    const win = a.candidates.find(c => c.score === a.score && fs.readFileSync(fileOf(projectId, c.file)).equals(fs.readFileSync(fileOf(projectId, a.image))));
    assert.ok(win, `${s.id}: images/${s.id}.png is one of the best-scored candidates`);
    assert.ok(a.candidates.slice(0, 2).every(c => c.score < 7));
  }
  ok(`${shots.length} shots: every one painted 2 + 2 candidates, repainted once, the bright repaint won`);
  const critic = calls.filter(r => r.kind === 'critic');
  assert.equal(critic.length, shots.length * 2);
  assert.ok(critic.every(r => r.protocol === (process.argv.includes('--anthropic') ? 'anthropic' : 'openai') && r.stream));
  const cand = r => r.images.filter(i => i.label.startsWith('CANDIDATE'));
  assert.deepEqual([...new Set(critic.map(r => cand(r).length))].sort(), [2, 3]);
  assert.ok(critic.every(r => r.images.every(i => i.mime === 'image/jpeg' && i.w === 768 && i.h === 438 || i.label.startsWith('REFERENCE'))));
  ok(`${critic.length} critic calls (round 1: 2 candidates, round 2: best so far + 2 new = 3), refs per call: ${critic.map(r => r.images.length - cand(r).length).join(',')}; candidates sent as JPEG 768×438`);
  assert.equal(painted.filter(x => x.width === 1344).length, shots.length * 4);
  assert.equal(new Set(painted.filter(x => x.width === 1344).map(x => x.seed)).size, shots.length * 4, 'every candidate has its own seed');
  ok(`ComfyUI painted ${painted.length} pictures (${painted.filter(x => x.width === 1024).length} cast portraits), ${painted.filter(x => x.bright).length} from corrected prompts, all seeds distinct`);
  const st = shotStatus(p);
  assert.ok(shots.every(s => typeof st[s.id].score === 'number' && st[s.id].critique && st[s.id].prompt && st[s.id].art));
  ok(`shotStatus(${shots[0].id}) = ${JSON.stringify({ art: st[shots[0].id].art, score: st[shots[0].id].score, critique: st[shots[0].id].critique, prompt: `${st[shots[0].id].prompt.slice(0, 50)}…` })}`);
  console.log(`  asset art[${shots[0].id}] = ${JSON.stringify(p.assets.art[shots[0].id], null, 0).slice(0, 700)}`);

  log.length = 0;
  await runSteps(projectId, ['art'], { log: m => log.push(m) });
  assert.equal((await llmLog()).slice(before + calls.length).length, 0, 'nothing to redo → no engine call');
  ok('second art run: everything up to date, no paint and no critic call');
  if (steps.includes('assemble')) {
    const f = loadProject(projectId).assets.final;
    ok(`film: ${f.file} ${f.seconds} s, ${f.size} bytes`);
  }
  console.log('ALL OK');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  if (saved) fs.writeFileSync(SETTINGS, saved); else fs.rmSync(SETTINGS, { force: true });
  for (const k of kids) k.kill();
  await closeBrowser();
  if (projectId && !process.argv.includes('--keep')) fs.rmSync(dirOf(projectId), { recursive: true, force: true });
  else if (projectId) console.log(`project kept: projects/${projectId}`);
}
