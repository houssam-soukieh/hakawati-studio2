// Narrator: Microsoft neural voices through edge-tts (python -m edge_tts, needs internet), like Nurai Director.
// The voice is made BEFORE the art, so every shot is drawn for its real length. Clips are cached by
// voice + rate + pitch + text, so re-running never re-synthesises an unchanged line.
import fs from 'node:fs';
import path from 'node:path';
import { STUDIO, hash, run, sleep, durationOf, checkAbort, readJSON, writeJSON } from './util.mjs';
import { t } from './i18n.mjs';

const CACHE = path.join(STUDIO, 'voice-cache');

// edge-tts checks certificates against its own list (certifi). On a PC whose antivirus or VPN inspects HTTPS, that
// list rejects the inspector's certificate ("self signed certificate in certificate chain"); with truststore installed,
// Python trusts the Windows certificate store instead, as curl and the browsers already do.
export const EDGE_BOOT = [
  'import sys, runpy',
  'try:',
  '    import truststore; truststore.inject_into_ssl()',
  'except Exception:',
  '    pass',
  'sys.argv = ["edge-tts"] + sys.argv[1:]',
  'runpy.run_module("edge_tts", run_name="__main__", alter_sys=True)',
].join('\n');
const edgeTts = (args, opts) => run('python', ['-c', EDGE_BOOT, ...args], opts);

/** What the voice should say: numbers and symbols a TTS voice misreads are softened. */
export function speakable(text) {
  return String(text ?? '')
    .replace(/[«»"“”]/g, '')
    .replace(/\s*[—–]\s*/g, /[\u0600-\u06FF]/.test(text) ? '، ' : ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function voiceFor(p, settings) {
  return p.options.voice || settings.voice[p.options.language] || settings.voice.en;
}

export async function synth(text, { name, rate = '+0%', pitch = '+0Hz' }, file, signal) {
  fs.mkdirSync(CACHE, { recursive: true });
  const key = hash(name, rate, pitch, text);
  const cached = path.join(CACHE, `${key}.mp3`);
  if (!fs.existsSync(cached) || fs.statSync(cached).size === 0) {
    let err = '';
    for (let attempt = 1; attempt <= 5; attempt++) {
      checkAbort(signal);
      const r = await edgeTts(['--voice', name, `--rate=${rate}`, `--pitch=${pitch}`, '--text', text, '--write-media', cached], { signal });
      if (r.code === 0 && fs.existsSync(cached) && fs.statSync(cached).size > 0) { err = ''; break; }
      err = r.stderr.trim().split('\n').slice(-2).join(' ');
      fs.rmSync(cached, { force: true });
      await sleep(1500 * attempt);
    }
    if (err) throw new Error(t('edgeTts', { e: err || 'failed' }));
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(cached, file);
  return durationOf(file);
}

let voiceList = null;
/** Voices for the settings / story form (cached on disk for a week). */
export async function listVoices() {
  if (voiceList) return voiceList;
  const f = path.join(STUDIO, 'voices.json');
  const c = readJSON(f);
  if (c && Date.now() - c.at < 7 * 864e5) return (voiceList = c.voices);
  const r = await edgeTts(['--list-voices']);
  const voices = r.stdout.split('\n').map(l => l.trim().split(/\s{2,}/)).filter(a => /^[a-z]{2,3}-[A-Z]{2}/.test(a[0] ?? ''))
    .map(([name, gender]) => ({ name, gender, lang: name.split('-')[0] }));
  if (voices.length) writeJSON(f, { at: Date.now(), voices });
  return (voiceList = voices);
}
