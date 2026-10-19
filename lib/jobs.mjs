// One queue, one job at a time (all render jobs share Chrome and the CPU). Live log + progress go to every open
// Studio tab over one SSE stream.
import { runSteps } from './pipeline.mjs';
import { t } from './i18n.mjs';

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
  const log = line => { j.log.push(line); if (j.log.length > 2000) j.log.shift(); emit({ type: 'log', id: j.id, project: j.project, line }); };
  let lastEmit = 0;
  const progress = (k, stage) => { j.progress = k; j.stage = stage; if (Date.now() - lastEmit > 400 || k >= 1) { lastEmit = Date.now(); emit({ type: 'job', job: summary(j) }); } };
  try {
    await runSteps(j.project, j.steps, { ...j.opts, signal: j.ctl.signal, log, progress });
    j.status = 'done'; j.progress = 1; j.stage = t('done');
  } catch (e) {
    if (e.cancelled || j.ctl.signal.aborted) { j.status = 'stopped'; log(t('stopped')); }
    else { j.status = 'failed'; j.error = e.message; log(`❌ ${e.message}`); console.error(e); }
  } finally {
    j.endedAt = Date.now();
    emit({ type: 'job', job: summary(j) });
    emit({ type: 'project', id: j.project });
    running = null;
    pump();
  }
}
