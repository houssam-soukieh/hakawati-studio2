// «الهمس» — the beings' private language, without a browser: the offline director on the pilot, the timeline, the
// whisper sound processing, the mix, and the storyboard's sanitising on the server.
//   PATH=<dir with the edge-tts shim>:$PATH node --test test/whisper/whisper.test.mjs
// Runs on a private copy of the Studio in a temp dir (its own .studio and projects/).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'hakawati-whisper-'));
for (const d of ['lib', 'public']) fs.cpSync(path.join(REPO, d), path.join(ROOT, d), { recursive: true });
for (const f of ['server.mjs', 'package.json']) fs.copyFileSync(path.join(REPO, f), path.join(ROOT, f));
fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(ROOT, 'node_modules'), 'dir');
fs.mkdirSync(path.join(ROOT, '.studio'), { recursive: true });
fs.writeFileSync(path.join(ROOT, '.studio', 'settings.json'), JSON.stringify({ engine: { preset: 'mock', protocol: 'mock', model: 'mock' }, image: { engine: 'none' }, ui: { lang: 'en' } }));
const mod = name => import(pathToFileURL(path.join(ROOT, 'lib', `${name}.mjs`)).href);

const PILOT = fs.readFileSync(path.join(REPO, 'docs', 'pilot', 'pilot-ar.txt'), 'utf8');
const OPTS = { language: 'ar', style: 'photoreal', aspect: '16:9', length: 300, audience: '', notes: '', captions: true, music: true };
const storyShots = sp => sp.scenes.flatMap(sc => sc.shots).filter(s => s.kind === 'shot');
const words = s => (String(s).match(/\S+/g) ?? []).length;
const db = x => 20 * Math.log10(Math.max(x, 1e-9));
const rms = (a, from = 0, to = a.length) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, to - from)); };

let director, timeline, whisper, i18n;
before(async () => {
  [director, timeline, whisper, i18n] = await Promise.all([mod('director'), mod('timeline'), mod('whisper'), mod('i18n')]);
  i18n.setUiLang('en');
});
after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

// ------------------------------------------------------------------ (a) the offline director on the pilot
test('mock screenplay of the pilot: every «Speaker: …» line is a whisper with the right speaker, none is narrated', async () => {
  const want = [...PILOT.matchAll(/«([^«»:]+):\s*([^«»]+?)\s*»/g)].map(m => [m[1].trim(), m[2].trim()]); // parsed independently
  assert.equal(want.length, 16);
  const sp = await director.writeScreenplay({ id: 't', title: '', story: PILOT, options: OPTS });
  const shots = storyShots(sp);
  const got = shots.flatMap(sh => sh.whispers.map(w => [sp.cast.find(c => c.id === w.speaker)?.name, w.text]));
  assert.deepEqual(got, want, 'the whispers, in story order, by the right speakers, word for word');
  for (const sh of shots) {
    assert.ok(!/«[^«»]*:/.test(sh.narration), `${sh.id}: no «Speaker: …» line in the narration`);
    for (const [, text] of want) if (words(text) > 1) assert.ok(!sh.narration.includes(text), `${sh.id} narrates a whisper: ${text}`);
    assert.ok(sh.whispers.length <= 2);
  }
  // nothing lost: the narration is the story minus its whisper lines
  const narrated = shots.reduce((a, sh) => a + words(sh.narration), 0), lines = want.reduce((a, [n, t]) => a + words(`«${n}: ${t}»`), 0);
  assert.equal(narrated, words(PILOT) - lines);
  // the beings, with the bible's colours and glyph dialects
  const being = name => sp.cast.find(c => c.name === name);
  assert.deepEqual(['الساعة', 'الثلّاجة', 'العين', 'أوريون', 'السمسار'].map(n => [being(n)?.kind, being(n)?.color, being(n)?.glyph]),
    [['being', '#b8f25c', 'dots'], ['being', '#cdebff', 'dots'], ['being', '#eaf2ff', 'rings'], ['being', '#4fd1e8', 'arcs'], ['being', '#e8a74f', 'curls']]);
  assert.ok(sp.cast.filter(c => c.kind === 'human').every(c => c.color === '' && c.glyph === ''));
  // the typing dots: on the shot that says «يكتب…» and on the last one
  const typing = shots.filter(sh => sh.overlay === 'typing');
  assert.ok(typing.some(sh => sh.narration.includes('يكتب…')) && typing.some(sh => sh.narration.includes('ثلاثُ نقاطٍ من جديد')), typing.map(s => s.id).join());
  assert.ok(shots.filter(sh => sh.overlay !== 'typing').every(sh => sh.overlay === ''));
  assert.ok(sp.scenes.flatMap(sc => sc.shots).filter(s => s.kind !== 'shot').every(c => Array.isArray(c.whispers) && !c.whispers.length && c.overlay === ''));
});

test('normalizeScreenplay: speakers by id or name, unknown → "", lines left in narration move out, idempotent', () => {
  const raw = {
    title: 'يكتب', cast: [{ id: 'kira', name: 'كيرا', look: 'young woman', kind: 'human' }, { id: 'the-eye', name: 'العين', look: 'ring of light', kind: 'being', color: '#EAF2FF', glyph: 'rings' },
      { id: 'orion', name: 'أوريون', look: 'threads of light', kind: 'Being', color: 'cyan', glyph: 'nope' }],
    scenes: [{ id: 's1', title: 'المحكمة', location: 'x', shots: [
      { narration: 'ثم يبرد الضوء. «العين: هذا الاسم محذوف.» وصمت.', visual: 'a ring', cast: ['the-eye'], overlay: 'typing',
        whispers: [{ speaker: 'أوريون', text: 'أوريون: إنها ابنته.' }, { speaker: 'ghost', text: '«كلام بلا صاحب»' }, { speaker: 'orion', text: '   ' }, 'junk', { speaker: 'orion', text: 'لا.', plain: true }] },
      { narration: '', visual: 'b', whispers: null, overlay: 'bogus' },
    ] }],
  };
  const sp = director.normalizeScreenplay(raw, OPTS);
  const [a, b] = storyShots(sp);
  assert.equal(a.narration, 'ثم يبرد الضوء. وصمت.');
  assert.deepEqual(a.whispers, [{ speaker: 'the-eye', text: 'هذا الاسم محذوف.' }, { speaker: 'orion', text: 'إنها ابنته.' }, { speaker: '', text: 'كلام بلا صاحب' }, { speaker: 'orion', text: 'لا.', plain: true }]);
  assert.deepEqual([a.overlay, b.overlay, b.whispers], ['typing', '', []]);
  assert.deepEqual(sp.cast.map(c => [c.id, c.kind, c.color, c.glyph]), [['kira', 'human', '', ''], ['the-eye', 'being', '#eaf2ff', 'rings'], ['orion', 'being', '#cdebff', 'dots']]);
  const m = director.measure(sp, OPTS);
  assert.ok(m.notes.some(n => /has no speaker in the cast/.test(n)), m.notes.join('\n'));
  const again = director.normalizeScreenplay({ ...sp, scenes: sp.scenes.map(sc => ({ ...sc, shots: sc.shots.filter(s => s.kind === 'shot') })) }, OPTS);
  assert.deepEqual(again, sp);
});

// ------------------------------------------------------------------ (b) the timeline
test('timeline: whispers play after the narration (or alone), in order, and the shot is long enough for them', async () => {
  const sp = await director.writeScreenplay({ id: 't', title: '', story: PILOT, options: OPTS });
  const fps = 30, shots = storyShots(sp);
  const voice = {}, made = {};
  for (const sh of shots) {
    if (sh.narration) voice[sh.id] = { dur: Math.round(words(sh.narration) / 2.3 * 1000) / 1000 };
    if (sh.whispers.length) made[sh.id] = sh.whispers.map((w, i) => ({ file: `audio/${sh.id}.w${i + 1}.mp3`, dur: 1.1 + words(w.text) / 2.6 }));
  }
  const p = { options: OPTS, screenplay: sp, assets: { voice, whispers: made } };
  const tl = timeline.buildTimeline(p, fps);
  let n = 0;
  for (const r of tl.shots) {
    const sh = shots.find(s => s.id === r.id);
    if (!sh) { assert.deepEqual(r.whispers, []); continue; }
    assert.equal(r.whispers.length, sh.whispers.length);
    assert.equal(r.captions.map(c => c.text).join(' '), sh.narration, 'captions carry the narration only');
    let at = r.voiceDur ? r.voiceStart + r.voiceDur + timeline.WHISPER_AFTER : r.voiceStart;
    r.whispers.forEach((w, i) => {
      n++;
      assert.ok(Math.abs(w.start - at) < 1e-9, `${r.id} whisper ${i} starts ${w.start}, expected ${at}`);
      assert.equal(w.dur, made[r.id][i].dur);
      assert.ok(w.end - w.start >= w.dur - 1e-9, 'held at least as long as its clip');
      assert.equal(w.file, made[r.id][i].file);
      const c = sp.cast.find(x => x.id === sh.whispers[i].speaker);
      assert.deepEqual([w.name, w.color, w.glyph, w.text], [c.name, c.color, c.glyph, sh.whispers[i].text]);
      at = w.end + timeline.WHISPER_GAP;
    });
    if (r.whispers.length) {
      const last = r.whispers[r.whispers.length - 1].end;
      assert.ok(r.D >= last + r.T, `${r.id}: the last whisper ends before the outgoing transition (D ${r.D}, ends ${last}, T ${r.T})`);
      assert.ok(r.D >= last + timeline.TAIL + r.T - 0.5 / fps, `${r.id}: and keeps its breathing room`);
      assert.ok(r.whispers.every(w => !r.captions.some(c => c.end + 0.25 > w.start)), `${r.id}: no narration caption is still on screen when a whisper starts`);
    }
  }
  assert.equal(n, 16);
  // the subtitles file: narration cards and "Speaker: line", in time order
  const srt = timeline.toSrt(tl), cues = srt.trim().split(/\n\n/);
  assert.equal(cues.length, tl.shots.reduce((a, r) => a + r.captions.length + r.whispers.length, 0));
  assert.ok(srt.includes('العين: سؤالٌ عن لاريك. هذا الاسم محذوف. أغلِق المحادثة.'));
  assert.ok(srt.includes('أوريون: لا.'));
  const starts = cues.map(c => c.split('\n')[1].slice(0, 12));
  assert.deepEqual([...starts].sort(), starts);
  // before the voice step: a guess from the words, so the storyboard already has the right shape
  const guess = timeline.buildTimeline({ ...p, assets: { voice, whispers: {} } }, fps);
  const g = guess.shots.find(r => r.whispers.length).whispers[0];
  assert.equal(g.dur, timeline.whisperGuess(g.text));
  assert.equal(g.file, undefined);
});

// ------------------------------------------------------------------ the sound
/** A voiced, syllabic test signal: 140 Hz voice with two vowel formants, four syllables a second, and pauses. */
function speechLike(sec, sr) {
  const n = Math.round(sec * sr), x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, f0 = 140 + 18 * Math.sin(2 * Math.PI * 0.7 * t), env = Math.max(0, Math.sin(2 * Math.PI * 3.6 * t)) ** 0.6 * (t % 1.3 < 1.05 ? 1 : 0);
    ph += 2 * Math.PI * f0 / sr;
    let v = 0;
    for (let k = 1; k <= 24; k++) { const f = k * f0, g = 1 / k + 1.6 * Math.exp(-(((f - 700) / 180) ** 2)) + 0.9 * Math.exp(-(((f - 1150) / 220) ** 2)); v += g * Math.sin(k * ph); }
    x[i] = 0.12 * env * v;
  }
  return x;
}
const frames = (x, sr, ms = 40) => { const h = Math.round(sr * ms / 1000), out = []; for (let i = 0; i + h <= x.length; i += h) out.push(rms(x, i, i + h)); return out; };
const corr = (a, b) => { const n = Math.min(a.length, b.length); let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n; let s = 0, sa = 0, sb = 0; for (let i = 0; i < n; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; } return s / Math.sqrt(sa * sb || 1); };
const lowShare = (x, sr, fc = 450) => { const a = 1 - Math.exp(-2 * Math.PI * fc / sr); let y1 = 0, y2 = 0; const lo = new Float32Array(x.length); for (let i = 0; i < x.length; i++) { y1 += a * (x[i] - y1); y2 += a * (y1 - y2); lo[i] = y2; } return rms(lo) / rms(x); };

test('whisper processing: keeps the rhythm of the speech, loses its voice and its words; deterministic', async t => {
  const sr = whisper.WHISPER_RATE, x = speechLike(2.4, sr);
  const y = await whisper.processWhisper(x, 1234);
  assert.ok(y.length >= x.length + 0.3 * sr, 'a tail for the echo');
  const ex = frames(x, sr), ey = frames(y.subarray(0, x.length), sr);
  const shape = corr(ex, ey), wave = corr(x, y.subarray(0, x.length));
  assert.ok(shape > 0.6, `human-shaped: the loudness follows the syllables (envelope correlation ${shape.toFixed(2)})`);
  assert.ok(Math.abs(wave) < 0.05, `not the speech itself (waveform correlation ${wave.toFixed(3)})`);
  const lx = lowShare(x, sr), ly = lowShare(y, sr);
  assert.ok(lx > 0.35 && ly < 0.2 && ly < lx / 2, `no chest voice: share under 450 Hz ${lx.toFixed(2)} → ${ly.toFixed(2)}`);
  assert.ok(Math.abs(db(rms(y.filter(v => Math.abs(v) > 1e-4))) - -20) < 1.5, 'levelled to about −20 dBFS');
  t.diagnostic(`envelope r=${shape.toFixed(2)}, waveform r=${wave.toFixed(3)}, share < 450 Hz ${lx.toFixed(2)} → ${ly.toFixed(2)}`);
  assert.deepEqual(await whisper.processWhisper(x, 1234), y, 'the same line gives the same clip');
});

test('makeWhisper: works on the TTS output (shim or edge-tts), cached by text + voice + processing version', async () => {
  const sp = { cast: [{ id: 'kira' }, { id: 'the-eye' }, { id: 'orion' }] };
  const v = whisper.whisperVoice(sp, 'the-eye', 'ar'), o = whisper.whisperVoice(sp, 'orion', 'ar');
  assert.ok(v.name !== o.name && v.pitch !== o.pitch && v.pan !== o.pan, 'each being its own voice, pitch and place');
  assert.deepEqual(whisper.whisperVoice(sp, 'the-eye', 'ar'), v, 'stable');
  assert.ok(![v.name, o.name].includes('ar-SY-LaithNeural'), 'never the narrator');
  const out = path.join(ROOT, 'w.mp3');
  const t0 = Date.now(), dur = await whisper.makeWhisper('هذا الاسم محذوف. أغلِق المحادثة.', v, out);
  const first = Date.now() - t0;
  assert.ok(dur > 1 && fs.statSync(out).size > 2000, `${dur} s`);
  const st = spawnSync('ffmpeg', ['-hide_banner', '-i', out, '-af', 'highpass=f=1000,astats=metadata=0', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  assert.ok(Number(/RMS level dB: (-?[\d.]+)/.exec(st)?.[1]) > -35, 'energy where a whisper lives (above 1 kHz)');
  const t1 = Date.now(), again = await whisper.makeWhisper('هذا الاسم محذوف. أغلِق المحادثة.', v, path.join(ROOT, 'w2.mp3'));
  assert.equal(again, dur);
  assert.ok(Date.now() - t1 < first, 'second time from the cache');
  assert.notEqual(whisper.whisperKey('x', v), whisper.whisperKey('x', o));
});

test('assemble: whispers under the voice, panned, and the score ducks under them', async t => {
  const { assemble } = await mod('assemble');
  const dir = path.join(ROOT, 'mix'), f = n => path.join(dir, n);
  fs.mkdirSync(dir, { recursive: true });
  const ff = args => assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]).status, 0, args.join(' '));
  ff(['-f', 'lavfi', '-i', 'color=c=0x223344:s=320x180:r=24:d=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f('v.mp4')]);
  ff(['-f', 'lavfi', '-i', 'sine=frequency=300:duration=1.2:sample_rate=44100', '-af', 'volume=1.131', f('voice.wav')]); // −20 dBFS RMS (the sine source is 1/8 full scale)
  ff(['-f', 'lavfi', '-i', 'anoisesrc=d=1.2:c=white:r=44100:a=0.5:s=7', '-af', 'highpass=f=1500,lowpass=f=4000', '-ac', '1', f('w.wav')]);
  ff(['-f', 'lavfi', '-i', 'sine=frequency=110:duration=9:sample_rate=44100', '-af', 'volume=-6dB', '-ac', '2', f('music.wav')]);
  // the whisper clip at −20 dBFS RMS, like makeWhisper's
  const raw = spawnSync('ffmpeg', ['-v', 'error', '-i', f('w.wav'), '-f', 'f32le', '-ac', '1', '-ar', '44100', 'pipe:1'], { maxBuffer: 1 << 26 }).stdout;
  const w = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length)), g = 0.1 / rms(w);
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', '44100', '-ac', '1', '-i', 'pipe:0', f('whisper.wav')], { input: Buffer.from(w.map(v => v * g).buffer) });
  const out = f('out.mp4');
  await assemble({ clips: [{ file: f('v.mp4'), D: 8, T: 0, xfade: 'fade' }], voices: [{ file: f('voice.wav'), at: 0.5 }], whispers: [{ file: f('whisper.wav'), at: 4, pan: 0.3 }],
    whisperGain: -14, music: f('music.wav'), total: 8, fps: 24, out });
  const pcm = filter => { const b = spawnSync('ffmpeg', ['-v', 'error', '-i', out, ...(filter ? ['-af', filter] : []), '-f', 'f32le', '-ar', '8000', '-ac', '2', 'pipe:1'], { maxBuffer: 1 << 26 }).stdout; return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
  const win = (a, ch, t0, t1) => { const s = []; for (let i = Math.round(t0 * 8000); i < Math.round(t1 * 8000); i++) s.push(a[2 * i + ch]); return rms(s); };
  const hi = pcm('highpass=f=1200,highpass=f=1200'), lo = pcm('lowpass=f=160,lowpass=f=160'), mid = pcm('bandpass=f=300:width_type=q:w=4');
  const wL = win(hi, 0, 4.2, 5), wR = win(hi, 1, 4.2, 5);
  assert.ok(db(wR / wL) > 2 && db(wR / wL) < 4.5, `panned right a little: R − L = ${db(wR / wL).toFixed(1)} dB`);
  const voice = db(win(mid, 0, 0.7, 1.5)), whisperLevel = db((wL + wR) / 2), quiet = db(win(hi, 0, 2.6, 3.6));
  assert.ok(voice - whisperLevel > 9, `the whisper sits under the voice: ${voice.toFixed(1)} vs ${whisperLevel.toFixed(1)} dB`);
  assert.ok(whisperLevel - quiet > 15, `and is there: ${whisperLevel.toFixed(1)} vs ${quiet.toFixed(1)} dB when silent`);
  const free = db(win(lo, 0, 3.0, 3.9)), ducked = db(win(lo, 0, 4.4, 5.1));
  assert.ok(free - ducked > 5, `the score ducks under the whisper: ${free.toFixed(1)} → ${ducked.toFixed(1)} dB`);
  t.diagnostic(`voice ${voice.toFixed(1)} dB, whisper ${whisperLevel.toFixed(1)} dB (R−L ${db(wR / wL).toFixed(1)} dB), silence ${quiet.toFixed(1)} dB, score ${free.toFixed(1)} → ${ducked.toFixed(1)} dB under the whisper`);
});

// ------------------------------------------------------------------ the storyboard's sanitising
test('server: storyboard edits keep whispers (sanitised, ≤ 20), overlay, cast kind/colour/glyph', async () => {
  const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const n = s.address().port; s.close(() => r(n)); }); });
  const child = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, HAKAWATI_PORT: String(port), HAKAWATI_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => { child.stdout.on('data', d => /Hakawati Studio/.test(d) && resolve()); child.on('exit', c => reject(new Error(`server exited ${c}`))); });
    const api = (u, m = 'GET', b) => fetch(`http://127.0.0.1:${port}/api${u}`, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) }).then(r => r.json());
    const p = await api('/projects', 'POST', { story: PILOT, options: OPTS });
    const many = Array.from({ length: 25 }, (_, i) => ({ speaker: 'the-eye', text: `سطر ${i + 1}` }));
    const sp = {
      title: 'يكتب', cast: [{ id: 'kira', name: 'كيرا', look: 'w', kind: 'human', color: 'red' }, { id: 'the-eye', name: 'العين', look: 'r', kind: 'being', color: '#EAF2FF', glyph: 'rings' }, { id: 'x', name: 'x', look: 'x', kind: 'alien', color: '#12345', glyph: 'nope' }],
      locations: [],
      scenes: [{ id: 's1', title: 'م', location: '', shots: [
        { id: 'title', overlay: 'typing', whispers: [{ speaker: 'the-eye', text: 'no' }] },
        { id: 's1-1', visual: 'v', overlay: 'typing', whispers: [{ speaker: 'the-eye', text: ' هذا\u0007 الاسم\nمحذوف ' }, { speaker: '../evil', text: 'a' }, { speaker: 'ghost', text: 'b' }, { speaker: 'the-eye', text: '' }, 'junk', null, { speaker: 'the-eye', text: 42, plain: 'yes' }, { speaker: 'the-eye', text: 'لا.', plain: true }] },
        { id: 's1-2', visual: 'v', overlay: 'bogus', whispers: many },
        { id: 's1-3', visual: 'v', whispers: 'nope' },
      ] }],
    };
    const out = (await api(`/projects/${p.id}`, 'PUT', { screenplay: sp })).screenplay;
    const [title, a, b, c] = out.scenes[0].shots;
    assert.deepEqual([title.overlay, title.whispers], ['', []], 'cards have neither');
    assert.deepEqual(a.whispers, [{ speaker: 'the-eye', text: 'هذا الاسم\nمحذوف' }, { speaker: '', text: 'a' }, { speaker: '', text: 'b' }, { speaker: 'the-eye', text: '42' }, { speaker: 'the-eye', text: 'لا.', plain: true }]);
    assert.deepEqual([a.overlay, b.overlay, b.whispers.length, b.whispers[19].text, c.whispers], ['typing', '', 20, 'سطر 20', []]);
    assert.deepEqual(out.cast.map(x => [x.id, x.kind, x.color, x.glyph]), [['kira', 'human', '', ''], ['the-eye', 'being', '#eaf2ff', 'rings'], ['x', 'human', '', '']]);
    // an edit of the shots only keeps the speakers of the saved cast
    const out2 = (await api(`/projects/${p.id}`, 'PUT', { screenplay: { scenes: [{ id: 's1', title: 'م', shots: [{ id: 's1-1', visual: 'v', whispers: [{ speaker: 'the-eye', text: 'ok' }, { speaker: 'orion', text: 'gone' }] }] }] } })).screenplay;
    assert.deepEqual(out2.scenes[0].shots[0].whispers, [{ speaker: 'the-eye', text: 'ok' }, { speaker: '', text: 'gone' }]);
  } finally { child.kill(); }
});
