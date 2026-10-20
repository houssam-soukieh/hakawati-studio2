// Reliability: nothing waits forever, a throttling gateway is ridden out, a critic that cannot answer never costs a
// repaint, a job never overwrites the producer's edits, and a fallback engine takes over when the main one gives up.
// No GPU, no real engine: a fake gateway (fake-gateway.mjs) that stalls / answers empty on demand, the faithful fake
// ComfyUI, the edge-tts shim. Everything runs in a temp folder (sandbox.mjs).
//   PATH=<edge-tts shim>:$PATH HAKAWATI_CHROME=<chromium> node --test test/reliability/reliability.test.mjs
import '../sandbox.mjs'; // first: settings and projects in a temp folder, never the owner's
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { STUDIO, ROOT, writeJSON, readJSON, run, track, pool, sleep } from '../../lib/util.mjs';
import { DEFAULTS, saveSettings, publicSettings, loadSettings } from '../../lib/settings.mjs';
import { askText, engineLoad, testEngine } from '../../lib/llm.mjs';
import { critiquePictures, UNREVIEWED } from '../../lib/critic.mjs';
import { createProject, loadProject, saveProject, allShots, fileOf, assetSnapshot, saveJobChanges } from '../../lib/project.mjs';
import { runSteps, shotStatus } from '../../lib/pipeline.mjs';
import { startWatchdog } from '../../lib/jobs.mjs';
import { closeBrowser } from '../../lib/render.mjs';
import { startFakeGateway } from './fake-gateway.mjs';
import { startFakeComfy } from '../fake-comfy.mjs';

process.env.HAKAWATI_RETRY_SCALE = '0.002'; // the patient waits (10…60 s) become 20…120 ms
const SETTINGS = path.join(STUDIO, 'settings.json');
const USAGE = path.join(STUDIO, 'llm-usage.jsonl');
const STORY = fs.readFileSync(path.join(ROOT, 'docs/test-story.txt'), 'utf8');
let gw, gw2, comfy;

const image = (patch = {}) => ({ ...DEFAULTS.image, engine: 'comfyui', url: comfy.url, checkpoint: 'RealVisXL_V5.0_Lightning_fp16', ipadapter: false, candidates: 2, critic: true, minScore: 7, maxRounds: 2, ...patch });
/** The fake gateway as the engine (Anthropic format, like CodeCraft), stall limits of 1 s. */
const useGateway = (engine = {}, img = {}) => writeJSON(SETTINGS, { engine: { ...DEFAULTS.engine, preset: 'codecraft', protocol: 'anthropic', baseURL: gw.url, model: 'fake-opus', apiKey: 'sk-test-0000', concurrency: 2, idleSeconds: 1, firstByteSeconds: 1, ...engine }, ui: { lang: 'en' }, image: image(img) });
const useMock = (img = {}) => writeJSON(SETTINGS, { engine: { ...DEFAULTS.engine }, ui: { lang: 'en' }, image: image(img) });
const png = (size, brightness = 0) => spawnSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=s=${size}`, '-frames:v', '1', '-vf', `eq=brightness=${brightness}`, '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'], { maxBuffer: 64 << 20 }).stdout;
const usage = () => (fs.existsSync(USAGE) ? fs.readFileSync(USAGE, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const until = async (cond, ms = 30e3, what = 'condition') => { const end = Date.now() + ms; while (Date.now() < end) { if (await cond()) return; await sleep(50); } throw new Error(`timed out waiting for ${what}`); };
const sp0 = { title: 'T', artStyle: 'photoreal film', cast: [{ id: 'orion', name: 'Orion', kind: 'being', look: 'a faceless translucent being woven from cyan light threads' }], locations: [{ id: 'room', look: 'a dark bedroom at 3 AM' }] };
const shot0 = { id: 's1-1', visual: 'Kira lies awake; her phone lights her face.', action: 'She reads a message.', shotType: 'close-up', lens: '85mm', light: '3 AM, cold phone glow, dark room', camera: 'push-in', cast: ['orion'], location: 'room' };

before(async () => {
  gw = await startFakeGateway();
  gw2 = await startFakeGateway();
  comfy = await startFakeComfy({ port: 0, delay: 40 });
});
after(async () => {
  await closeBrowser();
  await Promise.all([gw?.close(), gw2?.close(), comfy?.close()]);
});

describe('time limits: nothing waits forever', () => {
  for (const [mode, re] of [['midstream', /sent nothing for 1 s in the middle of its answer/], ['headers', /sent nothing for 1 s/], ['nothing', /did not start answering within 1 s/]]) {
    it(`engine call, mode "${mode}": stopped by the time limit, retried, answered`, async () => {
      useGateway();
      let n = 0;
      gw.state.hook = () => (n++ === 0 ? mode : 'ok');
      const before = gw.state.closedStalls, logs = [], t0 = Date.now();
      const text = await askText({ purpose: 'shot', label: 's9-9 prompt', system: 'terse', user: 'Reply with exactly: hello world', log: m => logs.push(m) });
      const sec = (Date.now() - t0) / 1000;
      assert.equal(text, 'hello world');
      assert.ok(sec >= 0.9 && sec < 4, `stopped after ~1 s, took ${sec}`);
      assert.equal(logs.length, 1); assert.match(logs[0], re); assert.match(logs[0], /s9-9 prompt: .* — retry 2\/6 in 10 s/);
      const row = usage().filter(r => r.purpose === 'shot').at(-2);
      assert.equal(row.ok, false); assert.equal(row.kind, 'idle');
      await until(() => gw.state.closedStalls > before, 3000, 'the stalled connection to be closed');
      console.log(`    ${mode}: ${sec.toFixed(2)} s — ${logs[0].trim()}`);
    });
  }

  it('run(): a child past its timeout is killed and reported', async () => {
    const t0 = Date.now();
    const r = await run(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { timeout: 400 });
    assert.equal(r.timedOut, true); assert.equal(r.code, -1); assert.match(r.stderr, /did not finish in 0 s — stopped/);
    assert.ok(Date.now() - t0 < 3000);
  });

  it('pool(): a failed task stops new ones and waits for those running', async () => {
    const started = [], finished = [];
    await assert.rejects(pool([1, 2, 3, 4, 5, 6], 2, async x => { started.push(x); await sleep(x === 1 ? 10 : 150); if (x === 1) throw new Error('boom'); finished.push(x); }), /boom/);
    assert.deepEqual(started, [1, 2], 'nothing new starts after the failure'); assert.deepEqual(finished, [2], 'the running one is waited for');
  });

  it('watchdog: a silent job says its stage and what it waits on (and is not stopped)', async () => {
    const lines = [], w = track('ffmpeg (test wait)');
    const dog = startWatchdog({ minutes: 0.005, log: m => lines.push(m), stage: () => 'Drawing 3/5' });
    await sleep(800);
    dog.touch();
    const n = lines.length;
    await sleep(150);
    dog.stop(); w.done();
    assert.ok(n >= 1, 'warned at least once'); assert.equal(lines.length, n, 'touch() resets the silence');
    assert.match(lines[0], /No news from this job for [\d.]+ min — stage: Drawing 3\/5 — waiting on: .*ffmpeg \(test wait\) \d+ s/);
    console.log(`    ${lines[0]}`);
  });
});

describe('calls in flight', () => {
  for (const conc of [2, 3]) {
    it(`never more than engine.concurrency (${conc}) calls, never more than one with pictures`, async () => {
      useGateway({ concurrency: conc });
      gw.state.hook = () => 'ok'; gw.state.delay = 120; gw.state.maxInFlight = 0; gw.state.maxVision = 0;
      const pic = { type: 'image', mime: 'image/png', data: png('64x64').toString('base64') };
      const calls = [
        ...Array.from({ length: 7 }, (_, i) => askText({ purpose: 'test', system: 'terse', user: `Reply with exactly: t${i}` })),
        ...Array.from({ length: 4 }, () => askText({ purpose: 'test', system: 'terse', user: [pic, { type: 'text', text: 'colour?' }] })),
      ];
      const out = await Promise.all(calls);
      gw.state.delay = 0;
      assert.deepEqual(out.slice(0, 7), Array.from({ length: 7 }, (_, i) => `t${i}`)); assert.ok(out.slice(7).every(x => x === 'Red'));
      assert.equal(gw.state.maxInFlight, conc, `in flight at most (and reaching) ${conc}`); assert.equal(gw.state.maxVision, 1);
      assert.deepEqual(engineLoad(), { calls: 0, vision: 0, waiting: 0 });
      console.log(`    11 calls at once → at most ${gw.state.maxInFlight} in flight, ${gw.state.maxVision} with pictures`);
    });
  }
});

describe('the picture critic', () => {
  it('rides out empty answers, 429 and a stalled stream, then judges (small pictures, rubric facts)', async () => {
    useGateway();
    const modes = ['empty', '429', 'midstream'];
    let k = 0;
    gw.state.hook = c => (c.kind === 'critic' ? modes[k++] ?? 'ok' : 'ok');
    const from = gw.state.calls.length, logs = [];
    const r = await critiquePictures({ sp: sp0, options: { style: 'photoreal', aspect: '16:9' }, shot: shot0, prompt: 'a woman in bed', candidates: [png('1344x768', -0.2), png('1344x768', 0.1)], refs: [{ name: 'Orion', kind: 'being', look: sp0.cast[0].look, buf: png('1024x1024') }], log: m => logs.push(m) });
    assert.deepEqual(r.scores, [8, 8]);
    const critic = gw.state.calls.slice(from).filter(c => c.kind === 'critic');
    assert.equal(critic.length, 4);
    assert.equal(logs.filter(l => /s1-1 critic: .* — retry \d\/6 in \d+ s/.test(l)).length, 3, logs.join('\n'));
    const last = critic.at(-1);
    for (const im of last.images) {
      assert.equal(im.mime, 'image/jpeg'); assert.equal(im.declared, 'image/jpeg');
      assert.ok(Math.max(im.w, im.h) <= (im.label.startsWith('REFERENCE') ? 384 : 640), JSON.stringify(im));
    }
    assert.match(last.text, /Orion \[BEING — not a human\]: a faceless translucent being/);
    assert.match(last.text, /LIGHT AND TIME OF DAY \(must be visible\): 3 AM, cold phone glow/); assert.match(last.text, /close-up shot, lens 85mm/);
    assert.match(last.labels.join('\n'), /REFERENCE PORTRAIT of Orion \[BEING — not a human\]/);
    console.log(`    ${logs.map(l => l.trim()).join('\n    ')}\n    pictures sent: ${last.images.map(i => `${i.label.split(' ')[0]} ${i.w}×${i.h}`).join(', ')}`);
  });
});

describe('unreviewed pictures are judged again later, never repainted for nothing', () => {
  let id, story, byVisual;
  const shotOf = c => byVisual.get(c.text.match(/WHAT WE SEE: (.*)/)?.[1]);
  const paints = () => comfy.state.prompts.filter(x => x.ok && x.prompt?.[4]?.inputs?.width === 1344).length;
  const critics = from => gw.state.calls.slice(from).filter(c => c.kind === 'critic');

  before(async () => {
    useMock();
    id = createProject({ title: 'reliability', story: STORY, options: { length: 30, style: 'photoreal', language: 'en' } }).id;
    await runSteps(id, ['script']);
    const p = loadProject(id); // the offline director repeats visuals; the fake critic tells shots apart by theirs
    for (const sc of p.screenplay.scenes) for (const sh of sc.shots) if (sh.kind === 'shot') sh.visual = `${sh.visual} (${sh.id})`;
    saveProject(p);
    await runSteps(id, ['voice']);
    story = allShots(loadProject(id)).filter(s => s.kind === 'shot');
    byVisual = new Map(story.map(s => [s.visual, s.id]));
    assert.equal(byVisual.size, story.length, 'every story shot has its own visual');
    assert.ok(story.length >= 3);
    gw.state.maxInFlight = 0; gw.state.maxVision = 0;
  });

  it('run 1: the critic answers only for the first shot → the others keep their best candidate, marked unreviewed', async () => {
    useGateway();
    const ok = story[0].id;
    gw.state.hook = c => (c.kind === 'critic' && shotOf(c) !== ok ? 'empty' : 'ok');
    const from = gw.state.calls.length, logs = [];
    await runSteps(id, ['cast', 'art'], { log: m => logs.push(m) });
    const p = loadProject(id), st = shotStatus(p);
    for (const s of story) {
      const a = p.assets.art[s.id];
      assert.equal(a.candidates.length, 2); for (const c of a.candidates) assert.ok(fs.existsSync(fileOf(id, c.file)));
      if (s.id === ok) { assert.equal(a.reviewed, true); assert.equal(a.score, 8); assert.deepEqual(a.problems, []); assert.equal(st[s.id].reviewed, true); continue; }
      assert.equal(a.reviewed, false); assert.equal(a.score, null); assert.equal(a.critique, ''); assert.deepEqual(a.problems, [UNREVIEWED]);
      assert.equal(st[s.id].reviewed, false); assert.equal(st[s.id].art, true);
      assert.equal(critics(from).filter(c => shotOf(c) === s.id).length, 6, `${s.id}: 6 attempts`);
    }
    assert.ok(logs.some(l => /UNREVIEWED; the next art run judges it again without repainting/.test(l)));
    console.log(`    ${story.length - 1} shots unreviewed after 6 critic attempts each; ${ok} reviewed (8/10)`);
  });

  it('run 2: a working critic judges what is on disk — 0 paints; a shot whose critic still fails stays as it was', async () => {
    const stuck = story[1].id, keepOk = story[0].id;
    const before = loadProject(id).assets.art;
    gw.state.hook = c => (c.kind === 'critic' && shotOf(c) === stuck ? 'empty' : 'ok');
    const from = gw.state.calls.length, paintsBefore = paints(), logs = [];
    await runSteps(id, ['art'], { log: m => logs.push(m) });
    const p = loadProject(id);
    assert.equal(paints() - paintsBefore, 0, 'no picture painted');
    assert.equal(gw.state.calls.slice(from).filter(c => c.kind === 'prompt').length, 0, 'no new picture prompt written');
    assert.deepEqual(p.assets.art[keepOk], before[keepOk], 'a reviewed shot is not touched');
    assert.equal(critics(from).filter(c => shotOf(c) === keepOk).length, 0);
    assert.deepEqual(p.assets.art[stuck], before[stuck], 'still unreviewed: asset unchanged');
    for (const s of story.slice(2)) {
      const a = p.assets.art[s.id];
      assert.equal(a.reviewed, true); assert.equal(a.score, 8); assert.deepEqual(a.problems, []); assert.equal(a.rounds, 1);
      assert.deepEqual(a.candidates.map(c => c.file), before[s.id].candidates.map(c => c.file));
      assert.equal(critics(from).filter(c => shotOf(c) === s.id).length, 1);
      assert.equal(critics(from).find(c => shotOf(c) === s.id).labels.filter(l => /^CANDIDATE/.test(l)).length, 2);
    }
    assert.ok(logs.some(l => new RegExp(`${stuck}: still not reviewed`).test(l)));
    console.log(`    re-judged ${story.length - 2} shots from disk, 0 paints; ${stuck} still unreviewed and untouched`);
  });

  it('a picture from before this change whose critic failed (2 candidates, no score, no "reviewed") is re-judged too', async () => {
    const legacy = story[2].id;
    const p = loadProject(id), a = p.assets.art[legacy];
    Object.assign(a, { score: null, critique: '', problems: [] }); delete a.reviewed;
    for (const c of a.candidates) c.score = null;
    saveProject(p);
    assert.equal(shotStatus(loadProject(id))[legacy].reviewed, false);
    gw.state.hook = c => (c.kind === 'critic' && shotOf(c) !== legacy ? 'empty' : 'ok');
    const from = gw.state.calls.length, paintsBefore = paints();
    await runSteps(id, ['art']);
    const b = loadProject(id).assets.art[legacy];
    assert.equal(paints() - paintsBefore, 0); assert.equal(b.reviewed, true); assert.equal(b.score, 8);
    assert.equal(critics(from).filter(c => shotOf(c) === legacy).length, 1);
  });

  it('run 3: a re-judged best under minScore gets the normal repaint round (only that shot)', async () => {
    const low = story[1].id;
    let first = true;
    gw.state.hook = () => 'ok';
    gw.state.score = (c, n) => (shotOf(c) === low && first ? ((first = false), Array(n).fill(4)) : null);
    const paintsBefore = paints(), from = gw.state.calls.length;
    await runSteps(id, ['art']);
    gw.state.score = () => null;
    const a = loadProject(id).assets.art[low];
    assert.equal(paints() - paintsBefore, 2, 'two new candidates for that shot only');
    assert.equal(a.reviewed, true); assert.equal(a.rounds, 2); assert.equal(a.score, 8); assert.equal(a.candidates.length, 4);
    assert.equal(critics(from).length, 2, 'judge the old ones, then best + new ones');
    for (const c of a.candidates) assert.ok(fs.existsSync(fileOf(id, c.file)));
    assert.ok(gw.state.maxInFlight <= 2 && gw.state.maxVision === 1, `limits held in the art step: ${gw.state.maxInFlight}/${gw.state.maxVision}`);
    console.log(`    ${low}: judged 4/10 → repainted 2 → ${a.score}/10; engine calls in flight ≤ ${gw.state.maxInFlight}, with pictures ≤ ${gw.state.maxVision}`);
  });

  it('run 4: pictures painted from the offline template while the engine was away are kept while it still is, repainted from its prompt once it is back', async () => {
    const away = [story[0].id, story[2].id], other = story[1].id;
    const p = loadProject(id);
    for (const s of away) p.assets.art[s].promptSource = 'template';
    saveProject(p);
    const before = loadProject(id).assets.art;
    // still away: the prompt fails → the template pictures stay, nothing painted, nothing judged
    gw.state.hook = c => (c.kind === 'prompt' ? '400' : 'ok');
    let paintsBefore = paints(), logs = [];
    await runSteps(id, ['art'], { log: m => logs.push(m) });
    assert.equal(paints() - paintsBefore, 0, 'nothing painted while the engine is away');
    for (const s of away) {
      assert.deepEqual(loadProject(id).assets.art[s], before[s]);
      assert.ok(logs.some(l => new RegExp(`${s}: the text engine is still away`).test(l)), logs.join('\n'));
    }
    // back: those two shots (only) are repainted from the engine's own prompt
    gw.state.hook = () => 'ok';
    paintsBefore = paints(); logs = [];
    const from = gw.state.calls.length;
    await runSteps(id, ['art'], { log: m => logs.push(m) });
    const q = loadProject(id);
    assert.equal(paints() - paintsBefore, 4, '2 candidates for each of the two shots');
    assert.deepEqual(gw.state.calls.slice(from).filter(c => c.kind === 'prompt').map(shotOf).sort(), [...away].sort());
    for (const s of away) { assert.equal(q.assets.art[s].promptSource, 'engine'); assert.equal(q.assets.art[s].reviewed, true); }
    assert.deepEqual(q.assets.art[other], before[other], 'an engine-written shot is not touched');
    await runSteps(id, ['art']);
    assert.equal(paints() - paintsBefore, 4, 'a third run has nothing to do');
    console.log(`    ${away.join(', ')}: kept while the engine was away, repainted from its prompts when it came back`);
  });
});

describe('saving: a job writes only what it made', () => {
  it('saveJobChanges keeps edits made on disk meanwhile and drops entries of deleted shots', async () => {
    useMock({ engine: 'none' });
    const id = createProject({ title: 'merge', story: STORY, options: { length: 30, language: 'en' } }).id;
    await runSteps(id, ['script']);
    const job = loadProject(id), base = assetSnapshot(job);
    const [a, b] = allShots(job).filter(s => s.kind === 'shot').slice(-2);
    // the producer, meanwhile: edits a shot, a note, and deletes the last shot
    const disk = loadProject(id);
    const sc = disk.screenplay.scenes.find(x => x.shots.some(s => s.id === a.id));
    sc.shots.find(s => s.id === a.id).visual = 'EDITED BY THE PRODUCER';
    for (const x of disk.screenplay.scenes) x.shots = x.shots.filter(s => s.id !== b.id);
    disk.options.notes = 'producer note';
    disk.assets.art.manual = { note: 'not the job’s' };
    saveProject(disk);
    // the job, with its old copy: paints both shots
    job.assets.art[a.id] = { image: 'images/a.png', key: 'k1' };
    job.assets.art[b.id] = { image: 'images/b.png', key: 'k2' };
    job.assets.final = { file: 'final/x.mp4' };
    const next = saveJobChanges(job, base);
    const out = loadProject(id);
    assert.equal(allShots(out).find(s => s.id === a.id).visual, 'EDITED BY THE PRODUCER');
    assert.equal(out.options.notes, 'producer note');
    assert.deepEqual(out.assets.art[a.id], { image: 'images/a.png', key: 'k1' });
    assert.equal(out.assets.art[b.id], undefined, 'the deleted shot gets no asset');
    assert.deepEqual(out.assets.art.manual, { note: 'not the job’s' });
    assert.deepEqual(out.assets.final, { file: 'final/x.mp4' });
    assert.deepEqual(next, assetSnapshot(job));
    // and the script step writes its screenplay
    job.screenplay = { ...job.screenplay, title: 'NEW' }; job.title = 'NEW';
    saveJobChanges(job, next, { screenplay: true });
    assert.equal(loadProject(id).screenplay.title, 'NEW');
  });

  it('an edit made through the Studio API while an art job runs survives the job', async () => {
    const slow = await startFakeComfy({ port: 0, delay: 700 });
    const port = 48900 + Math.floor(Math.random() * 90);
    useMock({ url: slow.url });
    const srv = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], { env: { ...process.env, HAKAWATI_PORT: String(port), HAKAWATI_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let srvErr = '';
    srv.stderr.on('data', d => { srvErr += d; });
    try {
      await new Promise((resolve, reject) => { srv.stdout.on('data', d => /Hakawati Studio/.test(d) && resolve()); srv.once('exit', c => reject(new Error(`server exited ${c}: ${srvErr}`))); });
      const api = async (method, url, body) => { const r = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }); return r.json(); };
      const done = async jid => { await until(async () => ['done', 'failed', 'stopped'].includes((await api('GET', `/api/jobs/${jid}`)).status), 120e3, `job ${jid}`); return api('GET', `/api/jobs/${jid}`); };
      const { id } = await api('POST', '/api/projects', { story: STORY, options: { length: 30, style: 'photoreal', language: 'en' } });
      assert.equal((await done((await api('POST', `/api/projects/${id}/run`, { steps: ['script'] })).id)).status, 'done');
      const shots = allShots(loadProject(id)).filter(s => s.kind === 'shot');
      const job = await api('POST', `/api/projects/${id}/run`, { steps: ['art'] });
      const painted = p => shots.filter(s => p.assets.art[s.id]?.image).length;
      await until(async () => painted(await api('GET', `/api/projects/${id}`)) >= 1, 60e3, 'the first picture');
      // the producer edits the last shot and a note while the job still paints
      const p = await api('GET', `/api/projects/${id}`);
      const sp = structuredClone(p.screenplay), last = shots.at(-1).id;
      for (const sc of sp.scenes) for (const s of sc.shots) if (s.id === last) s.visual = 'EDITED WHILE PAINTING';
      const put = await api('PUT', `/api/projects/${id}`, { screenplay: sp, options: { notes: 'edited during the job' } });
      assert.equal(allShots(put).find(s => s.id === last).visual, 'EDITED WHILE PAINTING');
      const mid = await api('GET', `/api/jobs/${job.id}`);
      assert.equal(mid.status, 'running', 'the edit landed while the job was running');
      assert.ok(painted(put) < shots.length, `the job had more pictures to save after the edit (${painted(put)}/${shots.length})`);
      const end = await done(job.id);
      assert.equal(end.status, 'done', end.error);
      const out = await api('GET', `/api/projects/${id}`);
      assert.equal(allShots(out).find(s => s.id === last).visual, 'EDITED WHILE PAINTING', 'the screenplay edit survived the job');
      assert.equal(out.options.notes, 'edited during the job', 'the options edit survived the job');
      assert.equal(painted(out), shots.length, 'and every picture the job made is saved');
      console.log(`    edit landed with ${painted(put)}/${shots.length} pictures saved; after the job: edit kept, ${painted(out)}/${shots.length} pictures`);
    } finally {
      srv.kill('SIGTERM');
      await slow.close();
    }
  });
});

describe('fallback engine', () => {
  const FB = () => ({ preset: 'lmstudio', protocol: 'openai', baseURL: `${gw2.url}/v1`, model: 'local-qwen', apiKey: '' });

  it('the main engine keeps answering empty → the fallback answers that call (no key needed on this PC)', async () => {
    useGateway({ fallback: FB() });
    gw.state.hook = () => 'empty'; gw2.state.hook = () => 'ok';
    const from = gw2.state.calls.length, logs = [];
    const text = await askText({ purpose: 'shot', label: 's2-1 prompt', system: 'terse', user: 'Reply with exactly: from the fallback', log: m => logs.push(m) });
    assert.equal(text, 'from the fallback');
    const got = gw2.state.calls.slice(from);
    assert.equal(got.length, 1); assert.equal(got[0].protocol, 'openai'); assert.equal(got[0].model, 'local-qwen'); assert.equal(got[0].auth, 'Bearer local');
    assert.equal(logs.filter(l => /retry \d\/6/.test(l)).length, 5);
    assert.match(logs.at(-1), /s2-1 prompt: CodeCraft \(gateway\) · fake-opus gave up \(Empty answer from the engine\) — the fallback engine LM Studio \(local\) · local-qwen takes over this call/);
    assert.equal(usage().at(-1).engine, 'fallback');
    console.log(`    ${logs.at(-1).trim()}`);
  });

  it('a call with pictures falls back only to a fallback that can see', async () => {
    useGateway({ fallback: FB() });
    gw.state.hook = () => 'empty'; gw2.state.hook = () => 'ok'; gw2.state.blind = false;
    const args = { sp: sp0, options: { style: 'photoreal', aspect: '16:9' }, shot: shot0, prompt: 'p', candidates: [png('1344x768'), png('1344x768', 0.1)] };
    let from = gw2.state.calls.length;
    const r = await critiquePictures({ ...args, log: () => {} });
    assert.deepEqual(r.scores, [8, 8]);
    assert.deepEqual(gw2.state.calls.slice(from).map(c => c.kind), ['probe', 'critic']);
    from = gw2.state.calls.length;
    await critiquePictures({ ...args, log: () => {} });
    assert.deepEqual(gw2.state.calls.slice(from).map(c => c.kind), ['critic'], 'the vision check is remembered');
    // a text-only local model never gets the pictures
    useGateway({ fallback: { ...FB(), model: 'local-text-only' } });
    gw2.state.blind = true;
    from = gw2.state.calls.length;
    const logs = [];
    await assert.rejects(critiquePictures({ ...args, log: m => logs.push(m) }), /Empty answer from the engine/);
    assert.deepEqual(gw2.state.calls.slice(from).map(c => c.kind), ['probe']);
    assert.ok(logs.some(l => /fallback engine LM Studio \(local\) · local-text-only cannot see pictures/.test(l)), logs.join('\n'));
    gw2.state.blind = false;
  });

  it('no fallback for errors that are not the engine’s weather (HTTP 400); both failing names both', async () => {
    useGateway({ fallback: FB() });
    gw.state.hook = () => '400';
    let from = gw2.state.calls.length;
    await assert.rejects(askText({ purpose: 'shot', system: 's', user: 'x' }), /HTTP 400/);
    assert.equal(gw2.state.calls.length, from);
    gw.state.hook = () => 'empty'; gw2.state.hook = () => 'empty';
    await assert.rejects(askText({ purpose: 'shot', system: 's', user: 'x' }), /Empty answer from the engine — fallback LM Studio \(local\) · local-qwen: Empty answer/);
    gw2.state.hook = () => 'ok';
  });

  it('Settings → Test reports the fallback, never falls back for the main engine’s own test', async () => {
    useGateway({ fallback: FB() });
    gw.state.hook = () => 'ok';
    const r = await testEngine();
    assert.equal(r.ok, true); assert.equal(r.vision, true);
    assert.deepEqual({ ok: r.fallback.ok, vision: r.fallback.vision, reply: r.fallback.reply, model: r.fallback.model }, { ok: true, vision: true, reply: 'Ready ✓', model: 'local-qwen' });
    gw.state.hook = () => 'empty';
    const from = gw2.state.calls.length;
    await assert.rejects(testEngine(), /Empty answer/);
    assert.ok(gw2.state.calls.slice(from).every(c => c.text.startsWith('Reply with exactly') || c.kind === 'probe'), 'only the fallback’s own test');
    gw.state.hook = () => 'ok';
    console.log(`    test: ${JSON.stringify(r.fallback)}`);
  });

  it('the fallback key is masked for the browser and kept only for the same address', () => {
    useGateway();
    saveSettings({ engine: { fallback: { ...FB(), apiKey: 'lm-secret-key-1234' } } });
    const pub = publicSettings().engine.fallback;
    assert.equal(pub.apiKey, 'lm-s••••••••1234'); assert.equal(pub.hasKey, true);
    saveSettings({ engine: { fallback: { ...pub } } }); // the form sends the masked key back
    assert.equal(loadSettings().engine.fallback.apiKey, 'lm-secret-key-1234'); assert.equal('hasKey' in loadSettings().engine.fallback, false);
    saveSettings({ engine: { model: 'x', apiKey: '' } }); // the main engine's form, without the fallback
    assert.equal(loadSettings().engine.fallback.apiKey, 'lm-secret-key-1234');
    saveSettings({ engine: { fallback: { ...pub, baseURL: 'http://elsewhere.example/v1' } } }); // a new address never gets the old key
    assert.equal(loadSettings().engine.fallback.apiKey, '');
    saveSettings({ engine: { fallback: null } });
    assert.equal(loadSettings().engine.fallback, null); assert.equal(publicSettings().engine.fallback, null);
    assert.equal(readJSON(SETTINGS).engine.apiKey, 'sk-test-0000', 'the main key is untouched');
  });
});
