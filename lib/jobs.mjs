// One queue, one job at a time (all render jobs share Chrome and the CPU). Live log + progress go to every open
// Studio tab over one SSE stream. A watchdog says so in the log when a running job has been silent for
// `engine.watchdogMinutes` (default 20; 0 = off), naming its stage and what it is waiting on. It never stops the job.
import { runSteps } from './pipeline.mjs';
import { t, addMessages } from './i18n.mjs';
import { loadSettings } from './settings.mjs';
import { pendingWaits } from './util.mjs';

addMessages({
  watchdog: {
    en: v => `⏰ No news from this job for ${v.min} min — stage: ${v.stage || '?'}${v.waits ? ` — waiting on: ${v.waits}` : ''}. It is NOT stopped: press Stop if it stays stuck.`,
    ar: v => `⏰ لا جديد من هذه المهمة منذ ${v.min} دقيقة — المرحلة: ${v.stage || '?'}${v.waits ? ` — تنتظر: ${v.waits}` : ''}. لم تُوقَف: اضغط «إيقاف» إن بقيت عالقة.`,
  },
});

/** Minutes of silence before the watchdog speaks (fractions allowed, 0 = off). */
export function watchdogMinutes(s = loadSettings()) {
  const m = Number(s.engine.watchdogMinutes);
  return s.engine.watchdogMinutes !== '' && Number.isFinite(m) && m >= 0 ? m : 20;
}
const fmtWaits = () => pendingWaits().map(w => `${w.what} ${w.sec >= 120 ? `${Math.round(w.sec / 60)} min` : `${w.sec} s`}${w.quiet >= 60 && w.quiet < w.sec - 5 ? ` (last data ${Math.round(w.quiet / 60)} min ago)` : ''}`).join('; ');

/**
 * Watch a job's log: call touch() on every log line. After `minutes` without one, log(t('watchdog')) with the stage
 * (from stage()) and every external wait in flight; again after each further `minutes`. → { touch, stop }.
 */
export function startWatchdog({ log, stage = () => '', minutes = watchdogMinutes() }) {
  const ms = minutes * 60e3;
  let quietSince = Date.now(), warnedAt = 0;
  const timer = ms > 0 ? setInterval(() => {
    const now = Date.now();
    if (now - quietSince < ms || now - Math.max(warnedAt, quietSince) < ms) return;
    warnedAt = now;
    log(t('watchdog', { min: Math.round((now - quietSince) / 6e3) / 10, stage: stage(), waits: fmtWaits() }), { watchdog: true });
  }, Math.max(200, Math.min(60e3, ms / 4))) : null;
  timer?.unref?.();
  return { touch: () => { quietSince = Date.now(); warnedAt = 0; }, stop: () => clearInterval(timer) };
}

const jobs = [];
const clients = new Set();
let seq = 0, running = null;

const summary = j => ({ id: j.id, project: j.project, label: j.label, steps: j.steps, status: j.status, progress: j.progress, stage: j.stage, error: j.error, startedAt: j.startedAt, endedAt: j.endedAt, shots: j.opts.shots });
function emit(ev) { const data = `data: ${JSON.stringify(ev)}\n\n`; for (const c of clients) c.write(data); }

export function subscribe(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.write(`data: ${JSON.stringify({ type: 'hello', jobs: jobs.slice(-20).map(summary) })}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  res.on('close', () => { clearInterval(ping); clients.delete(res); });
}

export const listJobs = () => jobs.slice(-30).map(summary).reverse();
export const getJob = id => { const j = jobs.find(x => x.id === id); return j ? { ...summary(j), log: j.log } : null; };

export function enqueue({ project, steps, label, opts = {} }) {
  const j = { id: `j${++seq}`, project, steps, label, opts, status: 'queued', progress: 0, stage: t('queued'), log: [], ctl: new AbortController() };
  jobs.push(j);
  emit({ type: 'job', job: summary(j) });
  pump();
  return summary(j);
}

export function stopJob(id) {
  const j = jobs.find(x => x.id === id);
  if (!j) return false;
  if (j.status === 'queued') { j.status = 'stopped'; j.endedAt = Date.now(); emit({ type: 'job', job: summary(j) }); return true; }
  j.ctl.abort();
  return true;
}

async function pump() {
  if (running) return;
  const j = jobs.find(x => x.status === 'queued');
  if (!j) return;
  running = j;
  j.status = 'running'; j.startedAt = Date.now();
  emit({ type: 'job', job: summary(j) });
  let dog = null;
  const log = (line, { watchdog } = {}) => {
    if (!watchdog) dog?.touch();
    j.log.push(line); if (j.log.length > 2000) j.log.shift(); emit({ type: 'log', id: j.id, project: j.project, line });
  };
  dog = startWatchdog({ log, stage: () => j.stage });
  let lastEmit = 0;
  const progress = (k, stage) => { j.progress = k; j.stage = stage; if (Date.now() - lastEmit > 400 || k >= 1) { lastEmit = Date.now(); emit({ type: 'job', job: summary(j) }); } };
  try {
    await runSteps(j.project, j.steps, { ...j.opts, signal: j.ctl.signal, log, progress });
    j.status = 'done'; j.progress = 1; j.stage = t('done');
  } catch (e) {
    if (e.cancelled || j.ctl.signal.aborted) { j.status = 'stopped'; log(t('stopped')); }
    else { j.status = 'failed'; j.error = e.message; log(`❌ ${e.message}`); console.error(e); }
  } finally {
    dog.stop();
    j.endedAt = Date.now();
    emit({ type: 'job', job: summary(j) });
    emit({ type: 'project', id: j.project });
    running = null;
    pump();
  }
}
