// «الهمس» end to end: a short Arabic story with two whisper lines and the "typing…" dots → make.mjs (offline director,
// edge-tts or the TTS shim, frame-exact render, montage) → checks on the final MP4 and in the player:
//   c  sound: each whisper clip at its time (energy above 1 kHz, where only whispers live), under a still-loud narration
//   d  frames: the whisper subtitle in its being's colour at its time (glyph burst first), the typing bubble on the
//      shot marked overlay: 'typing' only, its dots moving; a captured frame is the same every time
//   e  Arabic shaping: the whisper line is one RTL text node and renders like the same text in a plain element
//      (and unlike the same letters forced apart)
// Plus the 5-minute pilot through script + voice: every whisper line gets its clip, its being's voice and its place.
//   PATH=<dir with the edge-tts shim>:$PATH HAKAWATI_CHROME=/path/to/chrome node test/whisper/e2e.mjs [--keep]
// Runs on a private copy of the Studio in a temp dir (its own .studio and projects/).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'hakawati-whisper-e2e-'));
for (const d of ['lib', 'public']) fs.cpSync(path.join(REPO, d), path.join(ROOT, d), { recursive: true });
for (const f of ['server.mjs', 'make.mjs', 'package.json']) fs.copyFileSync(path.join(REPO, f), path.join(ROOT, f));
fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(ROOT, 'node_modules'), 'dir');
fs.mkdirSync(path.join(ROOT, '.studio'), { recursive: true });
fs.writeFileSync(path.join(ROOT, '.studio', 'settings.json'), JSON.stringify({ engine: { preset: 'mock', protocol: 'mock', model: 'mock' }, image: { engine: 'none' }, video: { engine: 'none' }, render: { fps: 24, quality: '720p' }, ui: { lang: 'en' } }));
const mod = name => import(pathToFileURL(path.join(ROOT, 'lib', `${name}.mjs`)).href);
const [{ loadProject, saveProject, fileOf, allShots }, { buildTimeline }, { buildBundle, openPlayer, closeBrowser }, { shotStatus }] = await Promise.all(['project', 'timeline', 'render', 'pipeline'].map(mod));

const t0 = Date.now();
let failed = 0;
const ok = (cond, what, extra = '') => { console.log(`${cond ? '✓' : '✗'} ${what}${extra ? ` — ${extra}` : ''}`); if (!cond) failed++; return cond; };
const make = (...args) => {
  const r = spawnSync(process.execPath, ['make.mjs', ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  for (const l of `${r.stdout}${r.stderr}`.split('\n')) if (l.trim() && !/^PROGRESS/.test(l)) console.log(`   │ ${l}`);
  if (r.status !== 0) throw new Error(`make.mjs ${args.join(' ')} → exit ${r.status}`);
  return r.stdout.trim().split('\n').pop();
};
const db = x => 20 * Math.log10(Math.max(x, 1e-9));
const rms = (a, from, to) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, to - from)); };
const ffOut = (args, input) => spawnSync('ffmpeg', ['-v', 'error', ...args], { input, maxBuffer: 1 << 28 }).stdout;
const W = 1280, H = 720;
/** One frame of a video as RGB (W×H). */
const frameAt = (file, t) => ffOut(['-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
const png = buf => ffOut(['-f', 'image2pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], buf);
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
/** Pixels of colour c (± tol per channel) inside the box [x0, x1) × [y0, y1) in fractions of the frame. */
const count = (rgb, c, [x0, y0, x1, y1], tol = 40) => {
  let n = 0;
  for (let y = Math.round(y0 * H); y < Math.round(y1 * H); y++) for (let x = Math.round(x0 * W); x < Math.round(x1 * W); x++) {
    const i = (y * W + x) * 3;
    if (Math.abs(rgb[i] - c[0]) <= tol && Math.abs(rgb[i + 1] - c[1]) <= tol && Math.abs(rgb[i + 2] - c[2]) <= tol) n++;
  }
  return n;
};
const meanDiff = (a, b) => { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]); return s / n; };

const STORY = `في الليل كانت الورشة صامتة، وعلى الشاشة ثلاث نقاط: يكتب…

«العين: هذا الاسم محذوف. أغلِق المحادثة.»

«أوريون: إنها ابنته. تسأل عن أبيها.»

ثم عاد الضوء دافئاً كما كان، ونامت المدينة.`;
const MAGENTA = '#ff3bd4', CYAN = '#4fd1e8'; // set in the cast tab, as the owner would — far from anything in a placeholder frame
const TOP = [0.1, 0.03, 0.9, 0.2], BUBBLE = [0.42, 0.49, 0.58, 0.63];

try {
  fs.writeFileSync(path.join(ROOT, 'story.txt'), STORY);
  const id = make('new', 'story.txt', '--length', '20', '--lang', 'ar');
  make('run', id, 'script');
  let p = loadProject(id);
  const [eye, orion] = p.screenplay.cast.filter(c => c.kind === 'being');
  ok(eye?.name === 'العين' && orion?.name === 'أوريون', 'the offline director made the two speakers beings of the cast', p.screenplay.cast.map(c => `${c.id}:${c.name}:${c.kind}`).join(' '));
  eye.color = MAGENTA; orion.color = CYAN;
  p.options.music = false; // the first cut without a score, so every window of the soundtrack can be measured
  saveProject(p);
  const tf = Date.now();
  make('run', id, 'film');
  p = loadProject(id);
  const tl = buildTimeline(p, 24), final = fileOf(id, p.assets.final.file);
  const row = tl.shots.find(r => r.whispers.length), plain = tl.shots.find(r => r.kind === 'shot' && !r.whispers.length);
  const [w1, w2] = row.whispers, A1 = row.start + w1.start, A2 = row.start + w2.start;
  ok(row.whispers.length === 2 && w1.color === MAGENTA && w2.color === CYAN && w1.file && w2.file, `film made in ${Math.round((Date.now() - tf) / 1000)} s: ${row.id} has narration + 2 whispers with their clips`,
    `voice ${row.voiceStart.toFixed(2)}–${(row.voiceStart + row.voiceDur).toFixed(2)} s, whispers ${w1.start.toFixed(2)}–${w1.end.toFixed(2)} and ${w2.start.toFixed(2)}–${w2.end.toFixed(2)} s, D ${row.D.toFixed(2)} s`);
  ok(Object.values(shotStatus(p)).every(s => s.voice), 'the storyboard shows every shot\'s voice (narration + whispers) as made');

  // ---------------------------------------------------------------- c: the soundtrack
  console.log('\n— c: sound');
  const pcm = filter => { const b = ffOut(['-i', final, ...(filter ? ['-af', filter] : []), '-f', 'f32le', '-ac', '1', '-ar', '16000', 'pipe:1']); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.length & ~3))); };
  const full = pcm(), hi = pcm('highpass=f=1000,highpass=f=1000');
  const win = (a, x, y) => db(rms(a, Math.round(x * 16000), Math.round(y * 16000)));
  const narr = [row, plain].map(r => [r.start + r.voiceStart + 0.2, r.start + r.voiceStart + r.voiceDur - 0.2]);
  const wins = [[A1, w1], [A2, w2]].map(([A, w]) => [A + 0.15, A + w.dur - 0.45]); // the voiced part of each clip (the last 0.35 s is the echo tail)
  const gap = [A1 + w1.dur + 0.05, A2 - 0.05];
  const hiW = wins.map(([x, y]) => win(hi, x, y)), hiN = narr.map(([x, y]) => win(hi, x, y)), hiGap = win(hi, ...gap);
  ok(hiW.every(v => v - Math.max(...hiN) > 12 && v - hiGap > 20), 'each whisper clip is heard at its time (energy above 1 kHz)',
    `whispers ${hiW.map(v => v.toFixed(1)).join(', ')} dB vs narration ${hiN.map(v => v.toFixed(1)).join(', ')} dB and the gap between them ${hiGap.toFixed(1)} dB`);
  const fullW = wins.map(([x, y]) => win(full, x, y)), fullN = narr.map(([x, y]) => win(full, x, y));
  ok(Math.min(...fullN) - Math.max(...fullW) > 8, 'the whispers sit well under the narration',
    `narration ${fullN.map(v => v.toFixed(1)).join(', ')} dBFS, whispers ${fullW.map(v => v.toFixed(1)).join(', ')} dBFS`);
  const srt = fs.readFileSync(fileOf(id, p.assets.final.srt), 'utf8');
  ok(srt.includes('العين: هذا الاسم محذوف. أغلِق المحادثة.') && srt.includes('أوريون: إنها ابنته. تسأل عن أبيها.') && !p.screenplay.scenes.flatMap(s => s.shots).some(s => s.narration.includes('محذوف')),
    'the subtitles file has the whispers as "Speaker: line"; the narration never reads them');

  // ---------------------------------------------------------------- d: the frames
  console.log('\n— d: frames');
  const mg = hex(MAGENTA), cy = hex(CYAN), grey = hex('#3a3e48');
  const tN = row.start + row.voiceStart + 1, f = {
    narr: frameAt(final, tN), burst: frameAt(final, A1 + 0.12), one: frameAt(final, A1 + 1.2), two: frameAt(final, A2 + 1.2),
    plain: frameAt(final, plain.start + Math.min(2, plain.D / 2)), dots: frameAt(final, tN + 0.33),
  };
  const c = Object.fromEntries(Object.entries(f).map(([k, rgb]) => [k, { mg: count(rgb, mg, TOP), cy: count(rgb, cy, TOP), grey: count(rgb, grey, BUBBLE, 16), white: count(rgb, [255, 255, 255], BUBBLE, 30) }]));
  ok(c.narr.mg < 20 && c.narr.cy < 20, 'during the narration: no whisper on screen', JSON.stringify(c.narr));
  ok(c.one.mg > 400 && c.one.cy < 20, `whisper 1 at ${(A1 + 1.2).toFixed(2)} s: the line in the Eye's colour, upper third`, `${c.one.mg} magenta px`);
  ok(c.burst.mg > 15 && c.burst.mg < c.one.mg / 2, 'its first frames are the glyph burst (a few marks in its colour, no text yet)', `${c.burst.mg} magenta px`);
  ok(c.two.cy > 400 && c.two.mg < 20, `whisper 2 at ${(A2 + 1.2).toFixed(2)} s: Orion's line in his colour, the Eye's gone`, `${c.two.cy} cyan px`);
  ok(c.narr.grey > 1500 && c.narr.white > 60 && c.one.grey > 1500, `the typing bubble on ${row.id} (overlay: 'typing')`, `${c.narr.grey} bubble px, ${c.narr.white} dot px`);
  ok(c.plain.grey < 100, `no bubble on ${plain.id}`, `${c.plain.grey} bubble px`);
  const crop = (rgb, [x0, y0, x1, y1]) => { const o = []; for (let y = Math.round(y0 * H); y < Math.round(y1 * H); y++) o.push(rgb.subarray((y * W + Math.round(x0 * W)) * 3, (y * W + Math.round(x1 * W)) * 3)); return Buffer.concat(o); };
  ok(meanDiff(crop(f.narr, BUBBLE), crop(f.dots, BUBBLE)) > 1, 'the three dots pulse', `mean change ${meanDiff(crop(f.narr, BUBBLE), crop(f.dots, BUBBLE)).toFixed(2)} over 0.33 s`);

  // ---------------------------------------------------------------- e: Arabic shaping, in the player
  console.log('\n— e: Arabic shaping (player)');
  const bundle = buildBundle(p, tl, row.id);
  ok(bundle.whispers?.length === 2 && bundle.overlay === 'typing' && bundle.whispers[0].name === 'العين' && bundle.whispers[0].color === MAGENTA, 'the render bundle carries the whispers (timing, name, colour, glyphs) and the overlay',
    JSON.stringify(bundle.whispers[0]));
  ok(!('whispers' in buildBundle(p, tl, plain.id)) && !('overlay' in buildBundle(p, tl, plain.id)), 'a shot without them keeps its old bundle (and its render cache key)');
  const { ctx, page, errors } = await openPlayer(bundle, { w: W, h: H });
  try {
    const seek = t => page.evaluate(async x => { await window.__seek(x); }, t);
    await seek(w1.start + 1.2);
    const info = await page.evaluate(() => {
      const box = [...document.querySelectorAll('#wsp .w')].find(b => b.style.display === 'block'), txt = box.querySelector('.txt'), r = txt.getBoundingClientRect();
      return { nodes: txt.childNodes.length, isText: txt.firstChild?.nodeType === 3, elements: txt.querySelectorAll('*').length, text: txt.textContent, dir: txt.dir, cssDir: getComputedStyle(txt).direction,
        font: getComputedStyle(txt).fontFamily, tag: box.querySelector('.tag').textContent, rect: { x: Math.floor(r.left), y: Math.floor(r.top), width: Math.ceil(r.width), height: Math.ceil(r.height) } };
    });
    ok(info.nodes === 1 && info.isText && info.elements === 0 && info.dir === 'rtl' && info.cssDir === 'rtl' && info.text === w1.text && info.tag === 'العين',
      'the whisper line is ONE right-to-left text node (no per-letter spans), under its speaker tag', `${info.text} · dir=${info.dir} · ${info.font}`);
    const shotA = await page.screenshot({ clip: info.rect }), shotA2 = (await seek(w1.start + 1.2), await page.screenshot({ clip: info.rect }));
    ok(shotA.equals(shotA2), 'the same t gives the same pixels (capture is exact)');
    const fresh = await seek(w1.start + 0.12).then(() => page.screenshot({ clip: info.rect }));
    ok(!fresh.equals(shotA), 'at the burst the line is glyphs, not text yet');
    await seek(w1.start + 1.2);
    // the same text in a plain element with the same computed style, over the same spot
    const reference = async text => page.evaluate(([t, r]) => {
      const box = [...document.querySelectorAll('#wsp .w')].find(b => b.style.display === 'block'), txt = box.querySelector('.txt'), cs = getComputedStyle(txt);
      let ref = document.getElementById('ref');
      if (!ref) { ref = document.createElement('div'); ref.id = 'ref'; document.getElementById('stage').appendChild(ref); }
      ref.dir = 'rtl'; ref.textContent = t;
      Object.assign(ref.style, { position: 'absolute', left: `${txt.getBoundingClientRect().left}px`, top: `${txt.getBoundingClientRect().top}px`, width: `${txt.getBoundingClientRect().width}px`, margin: '0', boxSizing: 'border-box', // the rect includes the padding
        padding: cs.padding, font: cs.font, color: cs.color, textShadow: cs.textShadow, background: cs.background, borderRadius: cs.borderRadius, textAlign: cs.textAlign, letterSpacing: cs.letterSpacing, whiteSpace: cs.whiteSpace });
      txt.style.visibility = 'hidden';
    }, [text, info.rect]).then(() => page.screenshot({ clip: info.rect }));
    const same = await reference(w1.text), apart = await reference([...w1.text].join('‌')); // ZWNJ: the letters cannot join
    const dSame = meanDiff(png(shotA), png(same)), dApart = meanDiff(png(shotA), png(apart));
    ok(dSame < 1.5 && dApart > 4 * Math.max(dSame, 0.5), 'it renders like the same text in a plain element (shaped, joined), unlike the letters forced apart',
      `mean pixel difference ${dSame.toFixed(2)} vs ${dApart.toFixed(2)} with the joins broken`);
    fs.writeFileSync(path.join(ROOT, 'whisper-line.png'), shotA);
    ok(!errors.length, 'no script errors in the player', errors.join(' | '));
  } finally { await ctx.close().catch(() => {}); }
  await closeBrowser();

  // the narration is as loud as in a cut without the whispers (Settings → whisper sound off)
  const settingsFile = path.join(ROOT, '.studio', 'settings.json'), saved = fs.readFileSync(settingsFile, 'utf8');
  fs.writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(saved), voice: { whisper: { enabled: false } } }));
  make('run', id, 'assemble');
  const bare = (b => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.length & ~3))))(ffOut(['-i', final, '-f', 'f32le', '-ac', '1', '-ar', '16000', 'pipe:1']));
  const bareN = narr.map(([x, y]) => win(bare, x, y)), bareW = wins.map(([x, y]) => win(bare, x, y));
  // (loudnorm's dynamic mode moves a line by a dB or two either way when the rest of the programme changes)
  ok(bareN.every((v, i) => fullN[i] >= v - 1.5) && bareW.every(v => v < -90), 'the whispers do not push the narration down: as loud as in the same film without them',
    `narration ${fullN.map(v => v.toFixed(1)).join(', ')} dBFS with whispers, ${bareN.map(v => v.toFixed(1)).join(', ')} dBFS without (whisper windows then ${bareW.map(v => v.toFixed(0)).join(', ')} dB)`);
  fs.writeFileSync(settingsFile, saved);

  // the score, ducking under the whispers too: one more cut of the same film with music
  p = loadProject(id); p.options.music = true; saveProject(p);
  make('run', id, 'assemble');
  const scored = (b => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.length & ~3))))(ffOut(['-i', fileOf(id, loadProject(id).assets.final.file), '-af', 'highpass=f=1000,highpass=f=1000', '-f', 'f32le', '-ac', '1', '-ar', '16000', 'pipe:1']));
  ok(wins.every(([x, y]) => win(scored, x, y) - win(scored, ...gap) > 10), 'with the score on, the whispers are still there (the mix with music and ducking runs)');

  // ---------------------------------------------------------------- the pilot through script + voice
  console.log('\n— the pilot: script + voice');
  fs.copyFileSync(path.join(REPO, 'docs', 'pilot', 'pilot-ar.txt'), path.join(ROOT, 'pilot.txt'));
  const pid = make('new', 'pilot.txt', '--length', '300', '--lang', 'ar');
  const tv = Date.now();
  make('run', pid, 'script,voice');
  const pp = loadProject(pid), ptl = buildTimeline(pp, 30), lines = allShots(pp).flatMap(sh => (sh.whispers ?? []).map((w, i) => ({ sh, w, a: pp.assets.whispers[sh.id]?.[i] })));
  ok(lines.length === 16 && lines.every(x => x.a && fs.existsSync(fileOf(pid, x.a.file)) && x.a.dur > 1), `all 16 whisper lines have their clip (${Math.round((Date.now() - tv) / 1000)} s for script + voice)`);
  const speakers = new Set(lines.map(x => x.w.speaker)), keys = new Set(lines.map(x => x.a.key));
  ok(speakers.size === 5 && keys.size === new Set(lines.map(x => `${x.w.speaker}|${x.w.text}`)).size, '5 beings, one clip per line');
  const placed = ptl.shots.filter(r => r.whispers.length).every(r => r.whispers.every((w, i) => w.start >= (i ? r.whispers[i - 1].end : r.voiceDur ? r.voiceStart + r.voiceDur : r.voiceStart - 1e-9) && w.end <= r.D - r.T && w.end - w.start >= w.dur - 1e-9));
  ok(placed, 'with the real clip lengths, every whisper follows its narration and ends inside its shot', `film ${ptl.total.toFixed(1)} s`);
  ok(Object.values(shotStatus(pp)).every(s => s.voice), 'no shot asks for its voice again');
} catch (e) {
  failed++;
  console.error(`✗ ${e.stack ?? e}`);
} finally {
  await closeBrowser().catch(() => {});
  if (process.argv.includes('--keep')) console.log(`kept: ${ROOT}`); else fs.rmSync(ROOT, { recursive: true, force: true });
  console.log(`\n${failed ? `✗ ${failed} check(s) failed` : '✓ all checks passed'} in ${Math.round((Date.now() - t0) / 1000)} s`);
  process.exit(failed ? 1 : 0);
}
