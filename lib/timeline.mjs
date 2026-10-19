// The film's clock. From the voice lengths it fixes every shot's duration, the overlap of each transition and
// when each line is heard — the single source for the art (drawn to length), the renderer, the assembler,
// the subtitles and the in-browser animatic, so all of them agree to the frame.
// A shot's whispers (the beings' private language, lib/whisper.mjs) play after its narration line, one after another.
import { allShots } from './project.mjs';
import { whisperStyle } from './whisper.mjs';

export const LEAD = 0.4;   // silence before a line starts in its shot
export const TAIL = 0.45;  // breathing room after it, before the next transition begins
export const WHISPER_AFTER = 0.35; // from the end of the narration line to the first whisper
export const WHISPER_GAP = 0.3;    // between two whispers
/** On screen at least as long as it takes to read once the glyph burst has resolved (≈ 17 characters a second). */
export const whisperHold = (text, dur) => Math.max(dur, 0.6 + String(text).length / 17, 1.2);
/** Seconds of a whisper clip before it is made: speech at ≈ 2.4 words/s plus the echo tail. */
export const whisperGuess = text => String(text).split(/\s+/).filter(Boolean).length / 2.4 + 0.75;
export const TRANSITION_SECONDS = { cut: 0, fade: 0.6, 'fade-black': 1.0, 'wipe-left': 0.6, 'wipe-right': 0.6, 'slide-left': 0.55, 'slide-right': 0.55, 'circle-open': 0.8, 'zoom-in': 0.6, smooth: 0.7 };
export const XFADE = { cut: 'fade', fade: 'fade', 'fade-black': 'fadeblack', 'wipe-left': 'wipeleft', 'wipe-right': 'wiperight', 'slide-left': 'slideleft', 'slide-right': 'slideright', 'circle-open': 'circleopen', 'zoom-in': 'zoomin', smooth: 'smoothleft' };

/** Split a line into subtitle cards that fit the frame (by words, never mid-word). */
export function captionCards(text, maxChars) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const cards = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > maxChars) { cards.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) cards.push(cur);
  // don't leave a lonely last word
  if (cards.length > 1 && cards[cards.length - 1].split(' ').length === 1) { const last = cards.pop(); cards[cards.length - 1] += ` ${last}`; }
  return cards;
}

export function buildTimeline(p, fps = 30) {
  const shots = allShots(p);
  const frame = 1 / fps;
  const cast = p.screenplay?.cast ?? [];
  const maxChars = p.options.aspect === '9:16' ? 34 : p.options.aspect === '1:1' ? 44 : 58;
  let start = 0;
  const out = shots.map((s, i) => {
    const v = p.assets.voice[s.id];
    const voiceDur = s.narration && v?.dur ? v.dur : 0;
    const isLast = i === shots.length - 1;
    const T = isLast ? 0 : Math.max(frame, TRANSITION_SECONDS[s.transition] ?? 0);
    const prevT = i ? Math.max(frame, TRANSITION_SECONDS[shots[i - 1].transition] ?? 0) : 0;
    // the line starts after the incoming transition has mostly finished, and ends before the outgoing one
    const lead = LEAD + prevT * 0.6;
    // whispers: after the narration line (or alone), each for its clip's length (a guess until the voice step made it)
    const made = p.assets.whispers?.[s.id] ?? [];
    let wt = voiceDur ? lead + voiceDur + WHISPER_AFTER : lead;
    const whispers = (s.whispers ?? []).filter(w => w?.text).map((w, j) => {
      const a = made[j], dur = a?.dur || whisperGuess(w.text), st = whisperStyle(cast, w.speaker);
      const row = { speaker: w.speaker ?? '', name: st.name, color: st.color, glyph: st.glyph, text: w.text, ...(w.plain && { plain: true }), start: wt, end: wt + whisperHold(w.text, dur), dur, ...(a?.file && { file: a.file }) };
      wt = row.end + WHISPER_GAP;
      return row;
    });
    const lineEnd = whispers.length ? whispers[whispers.length - 1].end : voiceDur ? lead + voiceDur : 0;
    const need = lineEnd ? lineEnd + TAIL + T : 0;
    let D = Math.max(s.seconds ?? 4, need, 1.5);
    if (lineEnd) D = Math.min(D, need + 2.5); // never hold a shot long after its line
    D = Math.round(D * fps) / fps;
    // subtitle cards share the line's time by length
    const cards = captionCards(s.narration, maxChars);
    const total = cards.reduce((a, c) => a + c.length, 0) || 1;
    let t = lead;
    const captions = voiceDur ? cards.map(c => { const d = voiceDur * (c.length / total); const cap = { text: c, start: t, end: t + d }; t += d; return cap; }) : [];
    const row = { id: s.id, kind: s.kind, sceneId: s.sceneId, D, T, transition: isLast ? 'cut' : s.transition, xfade: XFADE[s.transition] ?? 'fade', start, voiceStart: lead, voiceDur, captions, whispers, camera: s.camera };
    start += D - T;
    return row;
  });
  const total = out.length ? out[out.length - 1].start + out[out.length - 1].D : 0;
  return { shots: out, total, fps };
}

/** Subtitles for the whole film (SRT): narration cards and whispers ("Speaker: line") in time order. */
export function toSrt(tl) {
  const ts = s => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 3600e3), m = Math.floor(ms / 60e3) % 60, sec = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
  const cues = tl.shots.flatMap(s => [
    ...s.captions.map(c => ({ a: s.start + c.start, b: s.start + c.end, text: c.text })),
    ...(s.whispers ?? []).map(w => ({ a: s.start + w.start, b: s.start + w.end, text: w.name ? `${w.name}: ${w.text}` : w.text })),
  ]).sort((x, y) => x.a - y.a);
  return cues.map((c, i) => `${i + 1}\n${ts(c.a)} --> ${ts(c.b)}\n${c.text}\n`).join('\n');
}
