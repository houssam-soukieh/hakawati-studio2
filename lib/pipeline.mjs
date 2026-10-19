// Story → film, step by step. Each step is incremental (content hashes in project.assets), so "make the film"
// after a small edit only redoes the shots that changed.
//   script   the director writes the montage (scenes → shots)
//   voice    narration for every shot → exact durations
//   cast     the character model sheet (one SVG library reused by every shot)
//   art      one animated SVG per shot, test-rendered and corrected
//   render   frame-exact clips
//   assemble transitions + voice + score + loudness → final MP4 + SRT + thumbnail
import fs from 'node:fs';
import path from 'node:path';
import { hash, pool, checkAbort, round, writeJSON, run } from './util.mjs';
import { loadProject, saveProject, allShots, fileOf, pruneAssets } from './project.mjs';
import { loadSettings } from './settings.mjs';
import { writeScreenplay } from './director.mjs';
import { drawCast, drawShot } from './art.mjs';
import { synth, speakable, voiceFor } from './voice.mjs';
import { buildTimeline } from './timeline.mjs';
import { buildBundle, testShot, renderClip, stillFrame, closeBrowser } from './render.mjs';
import { makeMusic, assemble, thumbnail } from './assemble.mjs';
import { ASPECTS } from './styles.mjs';
import { imageOn, imageSig, paint, seedFor } from './image.mjs';
import { shotImagePrompt, castImagePrompt } from './prompts.mjs';
import { criticSig, criticReady, criticSettings, paintBest } from './critic.mjs';
import { t } from './i18n.mjs';

export const STEPS = ['script', 'voice', 'cast', 'art', 'render', 'assemble'];
export const FILM = ['voice', 'cast', 'art', 'render', 'assemble'];
const rel = (...p) => p.join('/');
const exists = (p, f) => !!f && fs.existsSync(fileOf(p.id, f));
const fpsOf = (p, s) => Number(p.options.fps) || Number(s.render.fps) || 30;
const qualityOf = (p, s) => p.options.quality || s.render.quality || '720p';

export function artKey(p, shot) {
  const sp = p.screenplay;
  const s = loadSettings();
  const pics = imageOn(s) ? [imageSig(s), s.image.ipadapter ? (shot.cast ?? []).map(id => p.assets.castImages?.[id]?.key ?? '') : '', criticSig(s)] : '';
  return hash(shot.visual, shot.action, shot.cast, shot.shotType, shot.location, shot.narration, sp.palette, sp.artStyle, p.options.style, p.options.aspect, p.assets.cast?.key ?? '', shot.note ?? '', pics);
}
const fitsLength = (a, D) => a && (!!a.image || Math.abs((a.D ?? 0) - D) <= Math.max(0.8, D * 0.22)); // a still picture fits any length
const artExists = (p, a) => exists(p, a?.file) || exists(p, a?.image);

/** What each shot needs (for the storyboard badges). */
export function shotStatus(p) {
  const s = loadSettings();
  const tl = p.screenplay ? buildTimeline(p, fpsOf(p, s)) : { shots: [] };
  const out = {};
  for (const sh of allShots(p)) {
    const row = tl.shots.find(r => r.id === sh.id);
    const v = p.assets.voice[sh.id], a = p.assets.art[sh.id], c = p.assets.clips[sh.id];
    const voiceOk = !sh.narration || (v?.key === hash(speakable(sh.narration), voiceFor(p, s), s.voice.rate, s.voice.pitch) && exists(p, v.file));
    const artOk = sh.kind !== 'shot' || (a?.key === artKey(p, sh) && fitsLength(a, row?.D ?? 0) && artExists(p, a));
    out[sh.id] = { voice: voiceOk, art: artOk, clip: !!c && exists(p, c.file), D: row?.D, thumb: a?.thumb && exists(p, a.thumb) ? `/files/${p.id}/${a.thumb}?v=${a.at ?? ''}` : null, problems: a?.problems ?? [], rounds: a?.rounds, prompt: a?.prompt, score: a?.score ?? null, critique: a?.critique ?? '' };
  }
  return out;
}

export async function runSteps(projectId, steps, { shots: only, note, force, signal, log = () => {}, progress = () => {} } = {}) {
  let p = loadProject(projectId);
  const s = loadSettings();
  const want = STEPS.filter(x => steps.includes(x));
  const stepShare = 1 / want.length;
  let stepIndex = 0;
  const prog = (k, label) => progress(Math.min(0.999, (stepIndex + k) * stepShare), label);
  const save = () => saveProject(p);
  const subset = sh => !only?.length || only.includes(sh.id);

  for (const step of want) {
    checkAbort(signal);
    if (step !== 'script' && !p.screenplay) throw new Error(t('needScript'));

    if (step === 'script') {
      log(t('scriptStart')); prog(0, t('stScript'));
      if (p.screenplay) { // keep the old montage
        fs.mkdirSync(fileOf(p.id, 'history'), { recursive: true });
        writeJSON(fileOf(p.id, 'history', `screenplay-${Date.now()}.json`), p.screenplay);
      }
      const sp = await writeScreenplay(p, { signal, log });
      p = loadProject(projectId); // the user may have edited options meanwhile
      p.screenplay = sp; p.title = sp.title;
      pruneAssets(p); save();
      const n = allShots(p).filter(x => x.kind === 'shot').length;
      log(t('scriptDone', { title: sp.title, scenes: sp.scenes.length, shots: n, cast: sp.cast.length, sec: sp.estSeconds }));
    }

    if (step === 'voice') {
      const list = allShots(p).filter(sh => sh.narration && subset(sh));
      const voice = voiceFor(p, s);
      log(t('voiceStart', { voice, n: list.length }));
      let done = 0;
      await pool(list, 4, async sh => {
        const text = speakable(sh.narration);
        const key = hash(text, voice, s.voice.rate, s.voice.pitch);
        const cur = p.assets.voice[sh.id];
        if (!force && cur?.key === key && exists(p, cur.file)) { done++; return; }
        const file = rel('audio', `${sh.id}.mp3`);
        const dur = await synth(text, { name: voice, rate: s.voice.rate, pitch: s.voice.pitch }, fileOf(p.id, file), signal);
        p.assets.voice[sh.id] = { key, file, dur: round(dur, 3) };
        done++; prog(done / list.length, t('stVoice', { i: done, n: list.length }));
        save();
      }, signal);
      for (const sh of allShots(p)) if (!sh.narration) delete p.assets.voice[sh.id];
      save();
      const tl = buildTimeline(p, fpsOf(p, s));
      log(t('voiceDone', { sec: round(tl.total, 1) }));
    }

    if (step === 'cast') {
      const sp = p.screenplay;
      if (imageOn(s)) {
        if (!sp.cast.length) log(t('castOff'));
        else {
          log(t('castPortraits', { names: sp.cast.map(c => c.name).join(', ') })); prog(0.05, t('stCast'));
          fs.mkdirSync(fileOf(p.id, 'cast'), { recursive: true });
          for (const [i, c] of sp.cast.entries()) {
            checkAbort(signal);
            const prompt = castImagePrompt(sp, p.options, c);
            const key = hash(prompt, imageSig(s));
            const cur = p.assets.castImages[c.id];
            if (!force && cur?.key === key && exists(p, cur.file)) continue;
            const png = await paint({ prompt, aspect: '1:1', seed: seedFor(p.id, c.id, force ? Date.now() : ''), signal, log, label: c.name });
            const file = rel('cast', `${c.id}.png`);
            fs.writeFileSync(fileOf(p.id, file), png);
            p.assets.castImages[c.id] = { key, file, prompt, at: Date.now() };
            prog((i + 1) / sp.cast.length, t('stCast'));
            save();
          }
          for (const id of Object.keys(p.assets.castImages)) if (!sp.cast.some(c => c.id === id)) delete p.assets.castImages[id];
          save();
          log(t('castPortraitsDone'));
        }
      } else if (!p.options.consistentCast || !sp.cast.length) { log(t('castOff')); p.assets.cast = null; save(); }
      else {
        const key = hash(sp.cast.map(c => [c.id, c.look]), sp.artStyle, sp.palette, p.options.style);
        if (!force && p.assets.cast?.key === key && exists(p, p.assets.cast.file)) log(t('castKept'));
        else {
          log(t('castStart', { names: sp.cast.map(c => c.name).join(', ') })); prog(0.1, t('stCast'));
          const { svg, issues } = await drawCast(sp, p.options, { signal, log });
          const file = 'cast.svg';
          fs.writeFileSync(fileOf(p.id, file), svg);
          p.assets.cast = { key, file, at: Date.now(), issues };
          save();
          log(t('castDone', { notes: issues.join('; ') }));
        }
      }
    }

    if (step === 'art') {
      const tl = buildTimeline(p, fpsOf(p, s));
      const sp = p.screenplay;
      const castSvg = p.assets.cast?.file && exists(p, p.assets.cast.file) ? fs.readFileSync(fileOf(p.id, p.assets.cast.file), 'utf8') : '';
      const story = allShots(p).filter(sh => sh.kind === 'shot');
      const todo = allShots(p).filter(sh => {
        if (!subset(sh)) return false;
        const row = tl.shots.find(r => r.id === sh.id);
        const a = p.assets.art[sh.id];
        if (sh.kind !== 'shot') return force || !(a?.thumb && exists(p, a.thumb) && a.key === hash(sp.title, sp.logline, sp.palette, row.D, p.options.aspect));
        return force || note || !(a?.key === artKey(p, sh) && fitsLength(a, row.D) && artExists(p, a));
      });
      const conc = Math.max(1, Math.min(6, Number(s.engine.concurrency) || 3));
      let critic = null; // asked once per job: can the text engine see?
      log(imageOn(s) ? t('picStart', { n: todo.filter(x => x.kind === 'shot').length }) : t('artStart', { n: todo.length, conc }));
      if (imageOn(s)) fs.mkdirSync(fileOf(p.id, 'images'), { recursive: true });
      let done = 0;
      fs.mkdirSync(fileOf(p.id, 'art'), { recursive: true });
      fs.mkdirSync(fileOf(p.id, 'thumbs'), { recursive: true });
      await pool(todo, conc, async sh => {
        const row = tl.shots.find(r => r.id === sh.id);
        if (sh.kind !== 'shot') { // title/end cards: just a thumbnail
          const { w, h } = ASPECTS[p.options.aspect];
          const jpg = await stillFrame(buildBundle(p, tl, sh.id), sh.kind === 'end' ? row.D * 0.5 : row.D * 0.85, { w: Math.round(w / 2), h: Math.round(h / 2) });
          const thumb = rel('thumbs', `${sh.id}.jpg`);
          fs.writeFileSync(fileOf(p.id, thumb), jpg);
          p.assets.art[sh.id] = { key: hash(sp.title, sp.logline, sp.palette, row.D, p.options.aspect), thumb, at: Date.now(), D: row.D };
        } else if (imageOn(s)) { // real pictures from ComfyUI, best of N by the critic; the player moves the camera over it
          const prevArt = p.assets.art[sh.id];
          log(t('artShot', { id: sh.id, type: sh.shotType, sec: round(row.D, 1), note }));
          const prompt = await shotImagePrompt({ sp, options: p.options, shot: sh, location: sp.locations?.find(l => l.id === sh.location), note, signal, log });
          log(t('picPrompt', { id: sh.id, prompt: prompt.length > 160 ? `${prompt.slice(0, 160)}…` : prompt }));
          const ref = sh.cast.map(id => p.assets.castImages?.[id]).find(x => x && exists(p, x.file));
          const refs = sh.cast.map(id => ({ c: sp.cast.find(x => x.id === id), a: p.assets.castImages?.[id] })).filter(x => x.c && x.a && exists(p, x.a.file))
            .map(x => ({ name: x.c.name, look: x.c.look, buf: fs.readFileSync(fileOf(p.id, x.a.file)) }));
          const salt = note || force ? Date.now() : '';
          const cand = k => rel('images', `${sh.id}.c${k}.png`);
          const r = await paintBest({ sp, options: p.options, shot: sh, prompt, refs, critic: await (critic ??= criticReady({ signal, log })), signal, log,
            paint: async (pr, k) => {
              const png = await paint({ prompt: pr, aspect: p.options.aspect, seed: seedFor(p.id, sh.id, salt, k), reference: ref ? fileOf(p.id, ref.file) : null, signal, log, label: `${sh.id}.c${k}` });
              fs.writeFileSync(fileOf(p.id, cand(k)), png);
              return png;
            } });
          for (const f of fs.readdirSync(fileOf(p.id, 'images'))) { // candidates left over from an earlier painting of this shot
            const k = f.startsWith(`${sh.id}.c`) && f.slice(sh.id.length + 2).match(/^(\d+)\.png$/)?.[1];
            if (k && Number(k) >= r.candidates.length) fs.rmSync(fileOf(p.id, 'images', f), { force: true });
          }
          const file = rel('images', `${sh.id}.png`), thumb = rel('thumbs', `${sh.id}.jpg`);
          if (note && prevArt?.image && exists(p, prevArt.image)) fs.copyFileSync(fileOf(p.id, prevArt.image), fileOf(p.id, rel('images', `${sh.id}.v${Date.now()}.png`)));
          fs.writeFileSync(fileOf(p.id, file), r.png);
          await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', fileOf(p.id, file), '-vf', 'scale=640:-2', '-q:v', '3', fileOf(p.id, thumb)], { signal });
          const shotRef = allShots(p).find(x => x.id === sh.id);
          const low = r.score != null && r.score < criticSettings(s).minScore;
          p.assets.art[sh.id] = { key: artKey(p, shotRef), image: file, thumb, D: row.D, problems: low ? [r.critique] : [], rounds: r.rounds, prompt: r.prompt,
            score: r.score, critique: r.critique, candidates: r.candidates.map(c => ({ file: cand(c.k), score: c.score })), at: Date.now() };
          log(t('artShotDone', { id: sh.id, rounds: r.rounds, left: low ? `${r.score}/10 ${r.critique.slice(0, 120)}` : '' }));
        } else {
          const i = story.findIndex(x => x.id === sh.id);
          const prevArt = p.assets.art[sh.id];
          const previousSvg = note && prevArt?.file && exists(p, prevArt.file) ? fs.readFileSync(fileOf(p.id, prevArt.file), 'utf8') : null;
          log(t('artShot', { id: sh.id, type: sh.shotType, sec: round(row.D, 1), note }));
          const r = await drawShot({ sp, options: p.options, shot: sh, prev: story[i - 1], next: story[i + 1], duration: row.D, castSvg, note, previousSvg },
            { signal, log, test: svg => testShot(buildBundle(p, tl, sh.id, { svg })) });
          const file = rel('art', `${sh.id}.svg`), thumb = rel('thumbs', `${sh.id}.jpg`);
          if (prevArt?.file && exists(p, prevArt.file) && note) fs.copyFileSync(fileOf(p.id, prevArt.file), fileOf(p.id, rel('art', `${sh.id}.v${Date.now()}.svg`)));
          fs.writeFileSync(fileOf(p.id, file), r.svg);
          if (r.poster) fs.writeFileSync(fileOf(p.id, thumb), r.poster);
          const shotRef = allShots(p).find(x => x.id === sh.id);
          p.assets.art[sh.id] = { key: artKey(p, shotRef), file, thumb, D: row.D, problems: r.problems, rounds: r.rounds, at: Date.now() };
          log(t('artShotDone', { id: sh.id, rounds: r.rounds, left: r.problems.slice(0, 2).join(' · ') }));
        }
        done++; prog(done / Math.max(1, todo.length), t('stArt', { i: done, n: todo.length }));
        save();
      }, signal);
      log(t('artDone'));
    }

    if (step === 'render') {
      const fps = fpsOf(p, s), quality = qualityOf(p, s);
      const tl = buildTimeline(p, fps);
      const list = allShots(p);
      const missing = list.filter(sh => sh.kind === 'shot' && !artExists(p, p.assets.art[sh.id]));
      if (missing.length) throw new Error(t('noArt', { ids: missing.map(m => m.id).join(', ') }));
      log(t('renderStart', { n: list.length, quality, fps }));
      fs.mkdirSync(fileOf(p.id, 'clips'), { recursive: true });
      for (const [i, sh] of list.entries()) {
        checkAbort(signal);
        const bundle = buildBundle(p, tl, sh.id);
        const key = hash(bundle, fps, quality);
        const cur = p.assets.clips[sh.id];
        if (!force && cur?.key === key && exists(p, cur.file)) continue;
        const file = rel('clips', `${sh.id}.mp4`);
        const started = Date.now();
        const r = await renderClip(bundle, fileOf(p.id, file), { fps, quality, signal, onProgress: k => prog((i + k) / list.length, t('stRender', { id: sh.id })) });
        p.assets.clips[sh.id] = { key, file, D: bundle.D };
        save();
        log(t('renderShot', { id: sh.id, frames: r.frames, sec: round((Date.now() - started) / 1000, 1), err: r.errors[0] }));
      }
      await closeBrowser();
      log(t('renderDone'));
    }

    if (step === 'assemble') {
      const fps = fpsOf(p, s);
      const tl = buildTimeline(p, fps);
      const clips = tl.shots.map(r => {
        const c = p.assets.clips[r.id];
        if (!c || !exists(p, c.file)) throw new Error(t('notRendered', { id: r.id }));
        if (Math.abs(c.D - r.D) > 1 / fps + 1e-6) throw new Error(t('lengthChanged', { id: r.id }));
        return { file: fileOf(p.id, c.file), D: r.D, T: r.T, xfade: r.xfade };
      });
      const voices = tl.shots.filter(r => r.voiceDur).map(r => ({ file: fileOf(p.id, p.assets.voice[r.id].file), at: r.start + r.voiceStart }));
      let music = null;
      if (p.options.music) {
        music = fileOf(p.id, 'final', 'score.wav');
        fs.mkdirSync(path.dirname(music), { recursive: true });
        log(t('music', { mood: p.screenplay.mood }));
        await makeMusic(p.screenplay.mood, tl.total, music, signal);
      }
      const name = (p.id.replace(/^\d{4}-\d{2}-\d{2}-/, '') || 'film');
      const out = fileOf(p.id, 'final', `${name}.mp4`), srt = fileOf(p.id, 'final', `${name}.srt`), thumbFile = fileOf(p.id, 'final', 'thumbnail.jpg');
      prog(0.2, t('stAssemble'));
      await assemble({ clips, voices, music, total: tl.total, fps, out, srt, tl, signal, log });
      const titleRow = tl.shots.find(r => r.kind === 'title');
      await thumbnail(out, titleRow ? titleRow.D * 0.8 : 1, thumbFile);
      p.assets.final = { file: rel('final', `${name}.mp4`), srt: rel('final', `${name}.srt`), thumb: rel('final', 'thumbnail.jpg'), seconds: round(tl.total, 2), at: Date.now(), size: fs.statSync(out).size };
      save();
      log(t('filmDone', { sec: round(tl.total, 1), mb: (p.assets.final.size / 1048576).toFixed(1) }));
    }
    stepIndex++;
  }
  progress(1, t('done'));
  return loadProject(projectId);
}
