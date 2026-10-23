// The director, the script doctor and the picture prompts, against a fake language model (both wire formats).
//   node --test 'test/director/*.test.mjs'
// Runs on a private copy of the Studio in a temp dir, so the real .studio/settings.json and projects/ are untouched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startFakeLLM, fixture } from './fake-llm.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'hakawati-director-'));
for (const d of ['lib', 'public']) fs.cpSync(path.join(REPO, d), path.join(ROOT, d), { recursive: true });
for (const f of ['server.mjs', 'package.json']) fs.copyFileSync(path.join(REPO, f), path.join(ROOT, f));
fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(ROOT, 'node_modules'), 'dir');
const mod = name => import(pathToFileURL(path.join(ROOT, 'lib', `${name}.mjs`)).href);

const STORY = fs.readFileSync(path.join(REPO, 'docs', 'test-story.txt'), 'utf8');
const project = (o = {}) => ({ id: 'test', title: '', story: STORY, options: { language: 'ar', style: 'photoreal', aspect: '16:9', length: 45, audience: '', notes: '', ...o } });
const storyShots = sp => sp.scenes.flatMap(sc => sc.shots).filter(s => s.kind === 'shot');

let fake, director, prompts, i18n;
const settings = engine => {
  fs.mkdirSync(path.join(ROOT, '.studio'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, '.studio', 'settings.json'), JSON.stringify({ engine: { preset: 'custom', model: 'claude-test', apiKey: 'test-key', ...engine }, ui: { lang: 'en' } }));
};
const openai = (extra = {}) => settings({ protocol: 'openai', baseURL: `http://127.0.0.1:${fake.port}/v1`, ...extra });
const anthropic = (extra = {}) => settings({ protocol: 'anthropic', baseURL: `http://127.0.0.1:${fake.port}`, ...extra });
async function write(p = project()) {
  const logs = [];
  const sp = await director.writeScreenplay(p, { log: m => logs.push(m) });
  return { sp, logs };
}

before(async () => {
  fake = await startFakeLLM();
  settings({ protocol: 'mock' });
  [director, prompts, i18n] = await Promise.all([mod('director'), mod('prompts'), mod('i18n')]);
  i18n.setUiLang('en');
});
after(async () => { await fake.close(); fs.rmSync(ROOT, { recursive: true, force: true }); });

test('3-call flow over the OpenAI protocol: director → doctor → revision', async () => {
  fake.reset(); openai({ doctorPasses: 1 });
  const { sp, logs } = await write();
  assert.deepEqual(fake.roles(), ['director', 'doctor', 'revise']);
  for (const r of fake.requests) {
    assert.equal(r.path, '/v1/chat/completions');
    assert.equal(r.body.stream, true);
    assert.equal(r.body.model, 'claude-test');
    assert.equal(r.headers.authorization, 'Bearer test-key');
  }
  const [dir, doc, rev] = fake.requests;
  assert.ok(dir.user.includes(STORY.trim()), 'the director reads the story');
  assert.match(dir.system, /VISUAL BIBLE/);
  assert.match(dir.system, /hakawati/);
  assert.match(dir.user, /"motion": 1 or 2/);
  assert.match(dir.user, /the story is Arabic: keep its names/);
  // the doctor: story + measured facts + the draft without platform bookkeeping
  assert.ok(doc.user.includes(STORY.trim()));
  assert.match(doc.user, /MEASURED BY THE EDITING SUITE/);
  assert.match(doc.user, /s1-2 → s1-3: two medium shots in a row/);
  assert.match(doc.user, /s2-3: 2\d words ≈ .* in a 4 s shot/);
  assert.match(doc.user, /location:hills look names no time of day/);
  assert.ok(doc.user.includes(fixture('draft').scenes[1].shots[1].narration));
  assert.ok(!doc.user.includes('"kind"') && !doc.user.includes('"id":"title"'));
  assert.match(doc.system, /script doctor/);
  // the revision gets every note and its fix, plus the full brief
  for (const x of fixture('doctor-1').issues) assert.ok(rev.user.includes(x.fix), `fix for ${x.shot} passed on`);
  assert.match(rev.user, /return the FULL corrected screenplay/);
  assert.match(rev.user, /^STORY:/);
  // the result is the normalised revision
  assert.equal(sp.scenes.length, 4);
  assert.equal(storyShots(sp).length, 10);
  assert.equal(sp.scenes[0].shots[0].id, 'title');
  assert.equal(sp.scenes.at(-1).shots.at(-1).id, 'end');
  assert.ok(!storyShots(sp).some(s => s.narration.includes('جدّتِها')), 'the invented grandmother is gone');
  assert.match(sp.locations.find(l => l.id === 'hills').look, /moonlight/);
  assert.deepEqual(sp.doctor.map(d => d.issues), [5]);
  assert.match(sp.doctor[0].top[0], /^\[high\] s2-2 \(faithfulness\)/);
  // the log: pass, count, the three most important notes, the revision
  const i = logs.findIndex(l => /Pass 1: 5 notes/.test(l));
  assert.ok(i > 0, logs.join('\n'));
  assert.match(logs[i - 1], /script doctor is reviewing the montage \(pass 1\/1\)/);
  assert.match(logs[i + 1], /· \[high\] s2-2 \(faithfulness\)/);
  assert.match(logs[i + 2], /· \[medium\] s1-3 \(montage\)/);
  assert.match(logs[i + 3], /· \[medium\] s2-3 \(narration\)/);
  assert.ok(!/\[low\]/.test(logs[i + 4] ?? ''));
  assert.ok(logs.some(l => /Revised: 4 scenes, 10 shots/.test(l)));
});

test('Anthropic protocol, 2 passes: the loop stops once the doctor has no notes', async () => {
  fake.reset(); anthropic({ doctorPasses: 2 });
  const { sp, logs } = await write();
  assert.deepEqual(fake.roles(), ['director', 'doctor', 'revise', 'doctor']);
  for (const r of fake.requests) {
    assert.equal(r.path, '/v1/messages');
    assert.equal(r.headers['x-api-key'], 'test-key');
    assert.equal(r.headers['anthropic-version'], '2023-06-01');
    assert.equal(typeof r.body.system, 'string');
    assert.equal(r.body.stream, true);
  }
  const second = fake.requests[3];
  assert.match(second.user, /YOUR NOTES ON THE PREVIOUS DRAFT/);
  assert.ok(second.user.includes('[high] s2-2 (faithfulness)'));
  assert.ok(!/two medium shots in a row/.test(second.user), 'measured on the revision, not the draft');
  assert.deepEqual(sp.doctor.map(d => d.issues), [5, 0]);
  assert.ok(logs.some(l => /no more notes/.test(l)));
  assert.equal(storyShots(sp).length, 10);
});

test('doctorPasses 0 → one call, the draft as written; 3 passes are allowed, 9 are clamped to 3', async () => {
  fake.reset(); openai({ doctorPasses: 0 });
  const { sp } = await write();
  assert.deepEqual(fake.roles(), ['director']);
  assert.equal(storyShots(sp).length, 8);
  assert.equal(sp.doctor, undefined);
  fake.reset(); openai({ doctorPasses: 9 });
  for (let k = 0; k < 4; k++) fake.queue.push({ role: 'doctor', json: fixture('doctor-1') });
  await write();
  assert.deepEqual(fake.roles(), ['director', 'doctor', 'revise', 'doctor', 'revise', 'doctor', 'revise']);
});

test('a broken screenplay is sent back with the problem and retried', async () => {
  fake.reset(); openai({ doctorPasses: 1 });
  const bad = fixture('draft');
  delete bad.scenes[1].shots[0].visual;
  fake.queue.push({ role: 'director', json: bad });
  const { sp, logs } = await write();
  assert.deepEqual(fake.roles(), ['director', 'director', 'doctor', 'revise']);
  assert.match(fake.requests[1].user, /Your previous answer had a problem: shot s2-1: "visual" is missing/);
  assert.ok(logs.some(l => /did not match the shape asked for/.test(l)));
  assert.equal(storyShots(sp).length, 10);
});

test('language guards: Arabic story text stays Arabic, painter text stays English', async () => {
  fake.reset(); openai({ doctorPasses: 1 });
  const english = fixture('revised');
  for (const sc of english.scenes) for (const sh of sc.shots) sh.narration = 'Layla looked at the stars and walked on.';
  english.title = "Layla's Star";
  for (const sc of english.scenes) sc.title = 'A scene';
  for (const c of english.cast) c.name = c.id;
  fake.queue.push({ role: 'revise', json: english });
  const arabicVisual = fixture('draft');
  arabicVisual.scenes[0].shots[0].visual = 'قرية صغيرة نائمة عند سفح جبل مظلم تحت سماء مزدحمة بالنجوم وعلى أحد السطوح ليلى جالسة مع فانوسها الصغير';
  arabicVisual.cast[0].look = 'فتاة في الثامنة بشعر أسود طويل وثوب نيلي ووشاح زعفراني';
  arabicVisual.locations[0].look = 'سطح بيت حجري في قرية جبلية ليلاً تحت سماء مليئة بالنجوم';
  fake.queue.push({ role: 'director', json: arabicVisual });
  const { sp } = await write();
  assert.deepEqual(fake.roles(), ['director', 'director', 'doctor', 'revise', 'revise']);
  assert.match(fake.requests[1].user, /cast:layla look, location:village-roof look, s1-1 visual: .*must be in English \(they go to the image model\)/);
  assert.match(fake.requests[4].user, /must be in Modern Standard Arabic/);
  assert.ok(storyShots(sp).every(s => /[؀-ۿ]/.test(s.narration)));
  assert.equal(sp.title, 'نجمة ليلى');
});

test('a revision that drops most shots is refused and retried', async () => {
  fake.reset(); openai({ doctorPasses: 1 });
  const partial = fixture('revised');
  partial.scenes = partial.scenes.slice(0, 1);
  fake.queue.push({ role: 'revise', json: partial });
  const { sp } = await write();
  assert.deepEqual(fake.roles(), ['director', 'doctor', 'revise', 'revise']);
  assert.match(fake.requests[3].user, /the revision has 3 shots where the screenplay had 8 — return the FULL screenplay/);
  assert.equal(storyShots(sp).length, 10);
});

test('a doctor that never answers in JSON is skipped: the draft is kept, the step does not fail', async () => {
  fake.reset(); openai({ doctorPasses: 2 });
  for (let k = 0; k < 3; k++) fake.queue.push({ role: 'doctor', text: 'I think the script is lovely, well done!' });
  const { sp, logs } = await write();
  assert.deepEqual(fake.roles(), ['director', 'doctor', 'doctor', 'doctor']);
  assert.equal(storyShots(sp).length, 8);
  assert.ok(logs.some(l => /could not review this draft/.test(l)));
  assert.equal(sp.doctor, undefined);
});

test('a revision that keeps failing leaves the previous version in place', async () => {
  fake.reset(); openai({ doctorPasses: 2 });
  for (let k = 0; k < 3; k++) fake.queue.push({ role: 'revise', text: '{"scenes": []}' });
  const { sp, logs } = await write();
  assert.deepEqual(fake.roles(), ['director', 'doctor', 'revise', 'revise', 'revise']);
  assert.equal(storyShots(sp).length, 8);
  assert.ok(logs.some(l => /The revision failed/.test(l)));
  assert.deepEqual(sp.doctor.map(d => d.issues), [5]);
});

test('HTTP 503 from the gateway is retried (with back-off)', async () => {
  fake.reset(); openai({ doctorPasses: 1 });
  fake.queue.push({ role: 'doctor', status: 503, text: 'upstream overloaded' });
  const { sp, logs } = await write();
  assert.deepEqual(fake.roles(), ['director', 'doctor', 'doctor', 'revise']);
  assert.ok(logs.some(l => /HTTP 503.*retry 2\/\d/.test(l))); // job calls retry patiently (lib/llm.mjs RETRY)
  assert.equal(storyShots(sp).length, 10);
});

test('the log speaks Arabic when the Studio does', async () => {
  fake.reset(); openai({ doctorPasses: 2 });
  i18n.setUiLang('ar');
  try {
    const { logs } = await write();
    assert.ok(logs.some(l => /طبيب السيناريو يراجع المونتاج \(الجولة 1\/2\)/.test(l)));
    assert.ok(logs.some(l => /الجولة 1: 5 ملاحظة — أهمّها:/.test(l)));
    assert.ok(logs.some(l => /لا ملاحظات أخرى/.test(l)));
  } finally { i18n.setUiLang('en'); }
});

test('normalizeScreenplay: motion / lens / light defaults, the image-to-video budget, idempotence', () => {
  const o = project().options;
  const raw = fixture('draft');
  const s0 = raw.scenes[0].shots[0];
  delete s0.motion; delete s0.lens; delete s0.light;
  raw.scenes[0].shots[1].motion = '2';
  raw.scenes[0].shots[2].motion = 7;
  let sp = director.normalizeScreenplay(raw, o);
  const shots = storyShots(sp);
  assert.deepEqual([shots[0].motion, shots[0].lens, shots[0].light], [1, '', '']);
  assert.equal(shots[1].motion, 2); // "2" accepted
  assert.equal(shots[2].motion, 1); // nonsense → 1
  for (const card of sp.scenes.flatMap(sc => sc.shots).filter(s => s.kind !== 'shot')) assert.deepEqual([card.motion, card.lens, card.light], [1, '', '']);
  // everything marked 2 → trimmed to ~30%, shots with characters kept first
  const greedy = fixture('draft');
  for (const sc of greedy.scenes) for (const sh of sc.shots) sh.motion = 2;
  greedy.scenes[0].shots[0].cast = [];
  sp = director.normalizeScreenplay(greedy, o);
  const moving = storyShots(sp).filter(s => s.motion === 2);
  assert.equal(moving.length, director.motionCap(8));
  assert.ok(moving.every(s => s.cast.length));
  // a normalised screenplay (minus the cards) normalises to itself
  const again = director.normalizeScreenplay({ ...sp, scenes: sp.scenes.map(sc => ({ ...sc, shots: sc.shots.filter(s => s.kind === 'shot') })) }, o);
  assert.deepEqual(again, sp);
});

test('offline engine: instant, no requests, every bible field filled', async () => {
  fake.reset(); settings({ protocol: 'mock' });
  const t0 = Date.now();
  const { sp, logs } = await write();
  assert.ok(Date.now() - t0 < 500);
  assert.equal(fake.requests.length, 0);
  assert.ok(logs.some(l => /Script check \(offline engine/.test(l)));
  const shots = storyShots(sp);
  assert.ok(shots.every(s => s.lens && s.light && [1, 2].includes(s.motion)));
  assert.ok(shots.some(s => s.motion === 2) && shots.filter(s => s.motion === 2).length <= director.motionCap(shots.length));
  assert.ok(sp.cast.every(c => c.look.split(/\s+/).length <= 45));
  assert.ok(!director.measure(sp, project().options).notes.some(n => /time of day|no look|no lens|no light/.test(n)));
});

test('picture prompts (text engine): bible pasted verbatim, lens + light, neighbours for continuity', async () => {
  fake.reset(); openai();
  const sp = director.normalizeScreenplay(fixture('revised'), project().options);
  const shots = sp.scenes.flatMap(sc => sc.shots.filter(s => s.kind === 'shot').map(s => ({ ...s, location: sc.location }))); // as allShots() gives them
  const i = shots.findIndex(s => s.id === 's4-1');
  const shot = shots[i], prev = { ...shots[i - 1], prompt: 'tiny girl and fox on a hilltop, a star rising up a lantern beam' };
  const location = sp.locations.find(l => l.id === shot.location);
  const prompt = await prompts.shotImagePrompt({ sp, options: project().options, shot, location, prev, next: shots[i + 1], log: () => {} });
  assert.deepEqual(fake.roles(), ['prompt']);
  const req = fake.requests[0].user;
  assert.match(req, /PREVIOUS SHOT \(s3-2, wide, 24mm wide, light: moonlight/);
  assert.match(req, /its picture prompt: tiny girl and fox/);
  assert.match(req, /NEXT SHOT: \(none — this is the last story shot\)/);
  assert.match(req, /lens 35mm/);
  assert.match(req, /\[\[layla\]\] = ليلى/);
  const layla = sp.cast.find(c => c.id === 'layla').look, fox = sp.cast.find(c => c.id === 'fox').look;
  assert.ok(prompt.includes(layla) && prompt.includes(fox), prompt);
  assert.equal(prompt.split(layla).length, 2, 'each look pasted once');
  assert.ok(prompt.includes(location.look));
  assert.ok(prompt.includes(shot.light));
  assert.ok(prompt.endsWith('colour graded, film grain'), 'style keywords last');
  assert.ok(!prompt.includes('[['));
  assert.equal(prompt.split('35mm').length, 2, "the shot's lens replaces the style's own");
  assert.match(req, /pick the single most telling instant/);
  // an image-to-video shot is painted as the clip's first frame
  fake.reset();
  const flight = shots.find(s => s.id === 's3-2');
  assert.equal(flight.motion, 2);
  await prompts.shotImagePrompt({ sp, options: project().options, shot: flight, location: sp.locations.find(l => l.id === flight.location), log: () => {} });
  assert.match(fake.requests[0].user, /FIRST FRAME of a short image-to-video clip/);
  // the old call (no prev/next) still works
  fake.reset();
  const legacy = await prompts.shotImagePrompt({ sp, options: project().options, shot, location, log: () => {} });
  assert.match(fake.requests[0].user, /PREVIOUS SHOT: \(none/);
  assert.ok(legacy.includes(layla));
});

test('picture prompts (offline template) use the same bible pieces', async () => {
  settings({ protocol: 'mock' });
  const p = project();
  const sp = await director.writeScreenplay(p, { log: () => {} });
  const sc = sp.scenes[0], shot = sc.shots.find(s => s.kind === 'shot');
  const location = sp.locations.find(l => l.id === sc.location);
  const prompt = await prompts.shotImagePrompt({ sp, options: p.options, shot: { ...shot, location: sc.location }, location, note: 'warmer light' });
  for (const id of shot.cast) assert.ok(prompt.includes(sp.cast.find(c => c.id === id).look));
  for (const piece of [location.look, shot.lens, shot.light, `${shot.shotType} shot`, 'warmer light', 'cinematic film still']) assert.ok(prompt.includes(piece), piece);
  assert.ok(!prompt.includes('[['));
});

// docs/pilot/bible.md §3–4, word for word
const KIRA = { id: 'kira', name: 'Kira', kind: 'human', look: '22-year-old woman, olive skin, oval face, tired dark-brown eyes, thick dark eyebrows, long dark-brown hair in a loose messy knot with one silver-white streak at the left temple, faded mustard-yellow work overshirt over a charcoal T-shirt, cheap black wristwatch' };
const ORION = { id: 'orion', name: 'Orion', kind: 'being', look: 'translucent slender humanoid woven from fine glowing cyan-blue light threads, smooth faceless head with two soft white eye-points, three thin rings of light on each wrist, lower body unravelling into a stream of threads that flows from a phone screen' };
const WORKSHOP = { id: 'workshop-hidden', name: 'workshop', look: 'the same narrow phone-repair workshop frozen in time, desaturated cold blue-grey, dust motes suspended in mid-air' };
const beingSp = () => ({ title: 'T', artStyle: 'Photoreal contemporary drama', cast: [KIRA, ORION], locations: [WORKSHOP], scenes: [] });
const beingShot = (o = {}) => ({ id: 's2-3', kind: 'shot', shotType: 'medium', lens: '50mm', light: 'cold moonlight from the window', camera: 'static', location: WORKSHOP.id, cast: ['orion'], visual: 'Orion bows at the shoulder of the frozen room, his rings tightening.', action: 'The rings tighten.', motion: 1, ...o });

test('picture prompts: beings are marked for the writer and never get human anatomy', async () => {
  fake.reset(); openai();
  fake.queue.push({ role: 'prompt', json: { prompt: '[[orion]] bowing slightly at the left third, a beautiful woman with bare skin and a glowing chest, his three wrist rings tightening, low angle, cold stillness' } });
  const prompt = await prompts.shotImagePrompt({ sp: beingSp(), options: project({ language: 'en' }).options, shot: beingShot(), location: WORKSHOP, log: () => {} });
  const req = fake.requests[0];
  assert.match(req.system, /hidden BEINGS/);
  assert.match(req.user, /\[\[orion\]\] = Orion; BEING — not a person/);
  assert.ok(prompt.startsWith(ORION.look), prompt);
  assert.ok(!/woman|skin|chest/.test(prompt.replace(ORION.look, '')), prompt);
  assert.match(prompt, /wrist rings tightening/);
  assert.equal(prompts.promptSource(beingSp(), 's2-3'), '', 'per screenplay object');
  // a human with a being: the human is marked human and goes first when the writer left both looks out
  fake.reset();
  fake.queue.push({ role: 'prompt', json: { prompt: 'a young woman bent over the workbench, a glowing figure at her shoulder, warm phone glow on her face, medium shot' } });
  const shared = await prompts.shotImagePrompt({ sp: beingSp(), options: project({ language: 'en' }).options, shot: beingShot({ cast: ['orion', 'kira'] }), location: WORKSHOP, log: () => {} });
  assert.match(fake.requests[0].user, /\[\[kira\]\] = Kira; human;/);
  assert.ok(shared.indexOf(KIRA.look) === 0 && shared.indexOf(ORION.look) > 0, shared);
  // the negatives and the reference choice for the same frames
  const sp = beingSp(), base = 'text, logo';
  assert.match(prompts.shotNegative(sp, beingShot(), base), /^text, logo, human face, human skin, realistic person, woman, man, body, torso, nude, cleavage, flesh, skin pores, fingernails, knuckles, facial features, nose, nostrils, lips, mouth, eyebrows, human eyes, two people, duplicate, twins, clone, multiple figures$/);
  // a faceless humanoid being: a weighted blank head after its look (shots and portrait); with a human in the frame the
  // features stay out of the negative (the human keeps a face)
  assert.match(prompt, /flows from a phone screen, otherworldly entity, \(smooth blank featureless oval head like frosted glass:1\.3\)/);
  assert.match(prompts.castImagePrompt(sp, project({ language: 'en' }).options, ORION), /flows from a phone screen, \(smooth blank featureless oval head/);
  assert.ok(!/blank featureless/.test(prompts.castImagePrompt(sp, project({ language: 'en' }).options, KIRA)));
  assert.ok(!/nose/.test(prompts.shotNegative(sp, beingShot({ cast: ['kira', 'orion'] }), base)));
  assert.equal(prompts.shotNegative(sp, beingShot({ cast: ['kira', 'orion'] }), base), 'text, logo, nude, cleavage, bare torso, second person, extra person, twins');
  assert.equal(prompts.refCast(sp, beingShot({ cast: ['orion', 'kira'] }))?.id, 'kira');
  assert.equal(prompts.refCast(sp, beingShot({ cast: ['orion', 'kira'] }), id => id === 'orion')?.id, 'orion');
});

test('picture prompts: the engine fails → the offline template (logged, marked); a stopped job still throws', async () => {
  fake.reset(); openai();
  const sp = beingSp(), options = project({ language: 'en' }).options, logs = [];
  fake.queue.push({ role: 'prompt', status: 400, text: 'model overloaded' });
  const shot = beingShot({ cast: ['kira', 'orion'], visual: 'Kira bends over the workbench at 3 a.m.; Orion watches from her shoulder.' });
  const prompt = await prompts.shotImagePrompt({ sp, options, shot, location: WORKSHOP, note: 'colder light', log: m => logs.push(m) });
  assert.equal(fake.requests.length, 1);
  assert.ok(logs.some(l => /s2-3: the text engine could not write the picture prompt \(HTTP 400.*model overloaded.*offline template/.test(l)), logs.join('\n'));
  for (const piece of [KIRA.look, ORION.look, WORKSHOP.look, '50mm lens', shot.light, 'medium shot', 'colder light', 'cinematic film still']) assert.ok(prompt.includes(piece), piece);
  assert.ok(prompt.indexOf(KIRA.look) < prompt.indexOf(ORION.look) && !prompt.includes('[['), prompt);
  assert.equal(prompts.promptSource(sp, 's2-3'), 'template');
  // the engine is back: the same shot is written by it again
  fake.reset();
  await prompts.shotImagePrompt({ sp, options, shot, location: WORKSHOP, log: () => {} });
  assert.equal(prompts.promptSource(sp, 's2-3'), 'engine');
  // stopped: no fallback, the job's Cancelled comes through
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(prompts.shotImagePrompt({ sp, options, shot, location: WORKSHOP, signal: ctl.signal, log: () => {} }), e => e.cancelled === true);
  settings({ protocol: 'mock' });
  await prompts.shotImagePrompt({ sp, options, shot, location: WORKSHOP });
  assert.equal(prompts.promptSource(sp, 's2-3'), 'offline');
});

test('composePrompt: unplaced looks go first, duplicates and unknown placeholders are dropped', () => {
  const people = [{ id: 'a', look: 'old man, grey beard' }, { id: 'b', look: 'young woman, red coat' }];
  const out = prompts.composePrompt({ text: '[[b]] waves, [[b]] smiles, [[zz]] watches', people, location: { look: 'harbour at dawn' }, shot: { lens: '50mm', light: 'soft dawn light' }, style: 'film still' });
  assert.equal(out, 'old man, grey beard, young woman, red coat waves, smiles, watches, harbour at dawn, 50mm lens, soft dawn light, film still');
});

test('the script step of the pipeline runs the doctor and saves the new fields', async () => {
  fake.reset(); openai({ doctorPasses: 1 });
  const { createProject, loadProject } = await mod('project');
  const { runSteps } = await mod('pipeline');
  const p = createProject({ title: '', story: STORY, options: project().options });
  const logs = [];
  await runSteps(p.id, ['script'], { log: m => logs.push(m) });
  const saved = loadProject(p.id).screenplay;
  assert.deepEqual(fake.roles(), ['director', 'doctor', 'revise']);
  assert.deepEqual(saved.doctor.map(d => d.issues), [5]);
  assert.ok(storyShots(saved).every(s => [1, 2].includes(s.motion) && typeof s.lens === 'string' && typeof s.light === 'string'));
  assert.ok(logs.some(l => /“نجمة ليلى”: 4 scenes, 10 shots/.test(l)), logs.join('\n'));
});

test('server: storyboard edits keep motion (1|2), lens, light and the bible as strings', async () => {
  const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const n = s.address().port; s.close(() => r(n)); }); });
  const child = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, HAKAWATI_PORT: String(port), HAKAWATI_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => { child.stdout.on('data', d => /Hakawati Studio/.test(d) && resolve()); child.on('exit', c => reject(new Error(`server exited ${c}`))); });
    const api = (u, m = 'GET', b) => fetch(`http://127.0.0.1:${port}/api${u}`, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) }).then(r => r.json());
    const p = await api('/projects', 'POST', { story: STORY, options: project().options });
    const shot = (id, extra) => ({ id, narration: 'نص', visual: 'a girl on a roof', action: 'stars twinkle', cast: ['layla'], shotType: 'wide', camera: 'drift', transition: 'cut', seconds: 4, ...extra });
    const sp = {
      title: 'نجمة ليلى', cast: [{ id: 'layla', name: 'ليلى', look: 42 }, { id: '../evil', name: 'x', look: 'y' }], locations: [{ id: 'roof', name: 'سطح', look: 'flat roof at night' }],
      scenes: [{ id: 's1', title: 'المشهد', location: 'roof', shots: [shot('title', { motion: 2 }), shot('s1-1', { motion: '2', lens: '35mm', light: 'moonlight' }), shot('s1-2', { motion: 7, lens: 24 }), shot('s1-3', {})] }],
    };
    const out = (await api(`/projects/${p.id}`, 'PUT', { screenplay: sp })).screenplay;
    const [title, a, b, c] = out.scenes[0].shots;
    assert.deepEqual([title.motion, a.motion, b.motion, c.motion], [1, 2, 1, 1]);
    assert.deepEqual([a.lens, a.light, b.lens, c.lens, c.light], ['35mm', 'moonlight', '24', '', '']);
    assert.deepEqual(out.cast.map(x => [x.id, x.look]), [['layla', '42']]);
    assert.equal(out.locations[0].look, 'flat roof at night');
  } finally { child.kill(); }
});
