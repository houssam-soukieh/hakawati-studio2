// The editor's desk: clips joined with real transitions (ffmpeg xfade), every line placed at its frame, an
// ambient score generated for the film's mood that ducks under the voice (sidechain), loudness at −16 LUFS
// (YouTube/TikTok level), plus subtitles (.srt) and a thumbnail. The beings' whispers sit under the narration,
// each panned a little by its being, and the score ducks under them as it does under the voice.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { run, round } from './util.mjs';
import { toSrt } from './timeline.mjs';
import { t } from './i18n.mjs';

// Chord tones (Hz) per mood — a slow, breathing pad; quiet under the narration.
const CHORDS = {
  calm: [110, 164.81, 220, 261.63, 329.63, 493.88],
  wonder: [146.83, 220, 293.66, 369.99, 440, 659.25],
  tense: [98, 146.83, 196, 233.08, 277.18, 392],
  joyful: [130.81, 196, 261.63, 329.63, 392, 587.33],
  sad: [110, 164.81, 220, 261.63, 329.63, 392],
  epic: [73.42, 110, 146.83, 174.61, 220, 293.66],
  mysterious: [82.41, 123.47, 164.81, 196, 233.08, 293.66],
  warm: [87.31, 130.81, 174.61, 220, 261.63, 392],
};

/** Expression for ffmpeg aevalsrc: detuned partials with slow independent swells (no commas — filter-safe). */
function padExpr(mood, ch) {
  const f = CHORDS[mood] ?? CHORDS.warm;
  return f.map((hz, i) => {
    const amp = (0.16 / (1 + i * 0.35)).toFixed(3);
    const lfo = (0.045 + i * 0.017).toFixed(3), ph = (i * 1.7 + ch * 0.9).toFixed(2), det = (hz * (1 + (ch ? 0.0021 : -0.0021))).toFixed(2);
    return `${amp}*(0.55+0.45*sin(2*PI*${lfo}*t+${ph}))*(sin(2*PI*${hz}*t)+0.5*sin(2*PI*${det}*t))`;
  }).join('+');
}

export async function makeMusic(mood, seconds, out, signal) {
  const d = Math.ceil(seconds + 1);
  const expr = `${padExpr(mood, 0)}|${padExpr(mood, 1)}`;
  const r = await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `aevalsrc=exprs=${expr}:s=44100:d=${d}`,
    '-af', `lowpass=f=1400,highpass=f=70,aecho=0.8:0.75:90|170:0.32|0.22,afade=t=in:d=2.5,afade=t=out:st=${Math.max(0, d - 3.5)}:d=3.5,volume=0.55`,
    '-c:a', 'pcm_s16le', out], { signal, timeout: Math.max(10, Math.ceil(seconds / 60) * 5) * 60e3, what: 'ffmpeg (score)' });
  if (r.code !== 0) throw new Error(`music: ${r.stderr.slice(-300)}`);
}

/**
 * clips: [{file, D, T, xfade}] in order; voices: [{file, at}] absolute seconds; whispers: [{file, at, pan −1…1}],
 * mixed `whisperGain` dB under the voice; returns {file, seconds}.
 */
/** [width, height] of a video (ffprobe). */
const frameSize = file => String(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { timeout: 60e3, windowsHide: true }).stdout).trim().split(',').map(Number);

export async function assemble({ clips, voices, whispers = [], whisperGain = -14, music, total, fps, out, srt, tl, signal, log = () => {} }) {
  const dir = path.dirname(out);
  fs.mkdirSync(dir, { recursive: true });
  const args = ['-y', '-loglevel', 'error'];
  clips.forEach(c => args.push('-i', c.file));
  voices.forEach(v => args.push('-i', v.file));
  whispers.forEach(w => args.push('-i', w.file));
  if (music) args.push('-i', music);
  const lines = [];
  // video: chained xfades
  clips.forEach((c, i) => lines.push(`[${i}:v]settb=AVTB,fps=${fps},format=yuv420p[c${i}]`));
  let prev = 'c0', offset = 0;
  for (let i = 1; i < clips.length; i++) {
    offset += clips[i - 1].D - clips[i - 1].T;
    const T = Math.max(1 / fps, clips[i - 1].T);
    lines.push(`[${prev}][c${i}]xfade=transition=${clips[i - 1].xfade}:duration=${round(T, 3)}:offset=${round(offset, 3)}[x${i}]`);
    prev = `x${i}`;
  }
  lines.push(`[${prev}]trim=duration=${round(total, 3)},setpts=PTS-STARTPTS[vout]`);
  // audio: voices at their frames
  const vi = clips.length;
  voices.forEach((v, j) => { const ms = Math.round(v.at * 1000); lines.push(`[${vi + j}:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[v${j}]`); });
  const hasVoice = voices.length > 0;
  if (hasVoice) lines.push(`${voices.map((_, j) => `[v${j}]`).join('')}amix=inputs=${voices.length}:normalize=0:dropout_transition=0,apad=whole_dur=${round(total, 3)}[vox]`);
  const mi = vi + voices.length + whispers.length;
  if (whispers.length) {
    // whispers: mono, panned by being, at their frames. The score's sidechain key hears them at full level (so it
    // ducks under them like under the voice); the mix hears them `whisperGain` dB down.
    const wi = vi + voices.length;
    whispers.forEach((w, j) => {
      const ms = Math.round(w.at * 1000), pan = Math.max(-1, Math.min(1, Number(w.pan) || 0));
      lines.push(`[${wi + j}:a]aresample=44100,aformat=channel_layouts=mono,pan=stereo|c0=${round(1 - Math.max(0, pan), 3)}*c0|c1=${round(1 + Math.min(0, pan), 3)}*c0,adelay=${ms}|${ms}[w${j}]`);
    });
    lines.push(`${whispers.map((_, j) => `[w${j}]`).join('')}amix=inputs=${whispers.length}:normalize=0:dropout_transition=0,apad=whole_dur=${round(total, 3)},asplit=2[wsp][wkey]`);
    lines.push(`[wsp]volume=${round(Number(whisperGain) || 0, 2)}dB[wlow]`);
    if (hasVoice) lines.push('[vox]asplit=2[voxd][voxk]', '[voxd][wlow]amix=inputs=2:normalize=0:duration=first[dlg]', '[voxk][wkey]amix=inputs=2:normalize=0:duration=first[key]');
    else lines.push('[wlow]anull[dlg]', '[wkey]anull[key]');
    if (music) {
      lines.push(`[${mi}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=duration=${round(total, 3)}[mus]`);
      lines.push('[mus][key]sidechaincompress=threshold=0.02:ratio=9:attack=30:release=600:makeup=1[duck]');
      lines.push('[dlg][duck]amix=inputs=2:normalize=0:duration=first[mix]');
    } else lines.push('[dlg]anull[mix]', '[key]anullsink');
  } else if (music) {
    lines.push(`[${mi}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=duration=${round(total, 3)}[mus]`);
    if (hasVoice) {
      lines.push('[vox]asplit=2[voxa][voxb]');
      lines.push('[mus][voxb]sidechaincompress=threshold=0.02:ratio=9:attack=30:release=600:makeup=1[duck]');
      lines.push('[voxa][duck]amix=inputs=2:normalize=0:duration=first[mix]');
    } else lines.push('[mus]anull[mix]');
  } else if (hasVoice) lines.push('[vox]anull[mix]');
  else lines.push(`anullsrc=r=44100:cl=stereo,atrim=duration=${round(total, 3)}[mix]`);
  lines.push(`[mix]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100[aout]`);
  const script = path.join(dir, 'filter.txt');
  const tall = Math.min(...frameSize(clips[0].file)) >= 1000; // 1080p (any orientation) or larger
  fs.writeFileSync(script, lines.join(';\n'));
  args.push('-/filter_complex', script, '-map', '[vout]', '-map', '[aout]',
    // film grain changes every frame, so CRF alone balloons the file; cap it near streaming-site upload rates
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-maxrate', tall ? '10M' : '6M', '-bufsize', tall ? '20M' : '12M', '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', String(round(total, 3)), out);
  log(t('assembling', { clips: clips.length, voices: voices.length, music: !!music, sec: round(total, 1) }));
  // never forever: 15 minutes per minute of film (at least 30) is far beyond any real montage on this machine
  const limit = { signal, timeout: Math.max(30, Math.ceil(total / 60) * 15) * 60e3, what: 'ffmpeg (montage)' };
  let r = await run('ffmpeg', args, limit);
  if (r.code !== 0 && /Unrecognized option '\/filter_complex'|Option not found/.test(r.stderr)) {
    const i = args.indexOf('-/filter_complex'); args.splice(i, 2, '-filter_complex_script', script);
    r = await run('ffmpeg', args, limit);
  }
  if (r.code !== 0) throw new Error(`ffmpeg (montage): ${r.stderr.slice(-600)}`);
  if (srt && tl) fs.writeFileSync(srt, '﻿' + toSrt(tl));
  return { file: out, seconds: total };
}

export async function thumbnail(video, at, out) {
  const r = await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(at), '-i', video, '-frames:v', '1', '-q:v', '3', out], { timeout: 120e3, what: 'ffmpeg (film thumbnail)' });
  return r.code === 0;
}
