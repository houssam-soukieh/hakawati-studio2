// Command line (the Studio does the same with buttons):
//   node make.mjs new <story.txt> [--style shadow] [--aspect 9:16] [--length 60] [--lang ar] [--title "…"]
//   node make.mjs run <projectId> [script|film|voice,cast,art,render,assemble] [--shots s1-1,s2-3] [--note "…"] [--force]
import fs from 'node:fs';
import { createProject } from './lib/project.mjs';
import { runSteps, STEPS, FILM } from './lib/pipeline.mjs';
import { closeBrowser } from './lib/render.mjs';

const [cmd, a1, a2] = process.argv.slice(2);
const flag = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const log = m => console.log(m);
let lastPct = -1;
const progress = (k, label) => { const pct = Math.round(k * 100); if (pct !== lastPct && pct % 5 === 0) { lastPct = pct; console.log(`PROGRESS ${pct}% ${label}`); } };

try {
  if (cmd === 'new') {
    const story = fs.readFileSync(a1, 'utf8');
    const p = createProject({ title: flag('title', ''), story, options: { style: flag('style', 'cinematic'), aspect: flag('aspect', '16:9'), length: Number(flag('length', 60)), language: flag('lang', 'ar') } });
    console.log(p.id);
  } else if (cmd === 'run') {
    const which = !a2 || a2.startsWith('--') ? 'all' : a2;
    const steps = which === 'all' ? STEPS : which === 'film' ? FILM : which.split(',');
    await runSteps(a1, steps, { shots: flag('shots', '')?.split(',').filter(Boolean), note: flag('note'), force: process.argv.includes('--force'), log, progress });
  } else {
    console.log('usage: node make.mjs new <story.txt> [--style …] | node make.mjs run <id> [all|script|film|steps]');
  }
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exitCode = 1;
} finally {
  await closeBrowser();
}
