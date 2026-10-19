// Hakawati Studio — the control panel. node:http on 127.0.0.1 only; foreign Host/Origin rejected (CSRF / DNS
// rebinding), ids checked before they touch the disk, media served with Range so videos seek.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, PROJECTS, SAFE_ID, readJSON } from './lib/util.mjs';
import { publicSettings, saveSettings } from './lib/settings.mjs';
import { testEngine } from './lib/llm.mjs';
import { testImageEngine } from './lib/image.mjs';
import { listVoices } from './lib/voice.mjs';
import { STYLES, CAMERAS, TRANSITIONS, SHOT_TYPES, ASPECTS } from './lib/styles.mjs';
import { listProjects, createProject, loadProject, saveProject, fileOf, pruneAssets, allShots } from './lib/project.mjs';
import { shotStatus, STEPS, FILM } from './lib/pipeline.mjs';
import { buildTimeline } from './lib/timeline.mjs';
import { buildBundle } from './lib/render.mjs';
import { expandCast, librarySymbols } from './lib/svg.mjs';
import { enqueue, subscribe, listJobs, getJob, stopJob } from './lib/jobs.mjs';
import { loadSettings } from './lib/settings.mjs';
import { t } from './lib/i18n.mjs';

const PORT = Number(process.env.HAKAWATI_PORT ?? 4848);
const PUBLIC = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.jpg': 'image/jpeg', '.png': 'image/png', '.srt': 'application/x-subrip; charset=utf-8', '.ico': 'image/x-icon' };

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBody = req => new Promise((resolve, reject) => {
  let s = '';
  req.on('data', d => { s += d; if (s.length > 5e6) { reject(new Error('body too large')); req.destroy(); } });
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('bad JSON')); } });
});

function serveFile(req, res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'not found' });
  const stat = fs.statSync(file), type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };
  if (new URL(req.url, 'http://x').searchParams.has('download')) headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`;
  if (range) {
    const start = range[1] ? Number(range[1]) : 0, end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, 'content-length': stat.size });
    fs.createReadStream(file).pipe(res);
  }
}

function projectView(id) {
  const p = loadProject(id);
  const s = loadSettings();
  const fps = Number(p.options.fps) || s.render.fps || 30;
  const tl = p.screenplay ? buildTimeline(p, fps) : null;
  const cast = p.assets.cast?.file && fs.existsSync(fileOf(id, p.assets.cast.file));
  const castImages = Object.fromEntries(Object.entries(p.assets.castImages ?? {}).filter(([, a]) => a?.file && fs.existsSync(fileOf(id, a.file))).map(([cid, a]) => [cid, `/files/${id}/${a.file}?v=${a.at}`]));
  return { ...p, status: p.screenplay ? shotStatus(p) : {}, timeline: tl, castImages, castSheet: cast ? `/api/projects/${id}/castsheet.svg?v=${p.assets.cast.at}` : null,
    final: p.assets.final ? { ...p.assets.final, url: `/files/${id}/${p.assets.final.file}?v=${p.assets.final.at}`, srtUrl: `/files/${id}/${p.assets.final.srt}`, thumbUrl: `/files/${id}/${p.assets.final.thumb}?v=${p.assets.final.at}` } : null };
}

/** Screenplay edits from the storyboard: keep the shape sane, never trust ids blindly. */
function cleanScreenplay(sp, old) {
  if (!sp || !Array.isArray(sp.scenes)) throw new Error('bad screenplay');
  const seen = new Set();
  for (const sc of sp.scenes) {
    if (!SAFE_ID.test(sc.id ?? '')) throw new Error(`bad scene id ${sc.id}`);
    sc.shots = (sc.shots ?? []).filter(Boolean);
    for (const sh of sc.shots) {
      if (!SAFE_ID.test(sh.id ?? '') || seen.has(sh.id)) throw new Error(`bad or duplicate shot id ${sh.id}`);
      seen.add(sh.id);
      sh.kind = ['title', 'end'].includes(sh.id) ? sh.id : 'shot';
      for (const k of ['narration', 'visual', 'action']) sh[k] = String(sh[k] ?? '');
      sh.cast = Array.isArray(sh.cast) ? sh.cast.map(String) : [];
      if (!CAMERAS.includes(sh.camera)) sh.camera = 'drift';
      if (!TRANSITIONS.includes(sh.transition)) sh.transition = 'cut';
      if (!SHOT_TYPES.includes(sh.shotType)) sh.shotType = 'medium';
      sh.seconds = Math.min(15, Math.max(1.5, Number(sh.seconds) || 4));
    }
  }
  sp.scenes = sp.scenes.filter(sc => sc.shots.length);
  return { ...old, ...sp };
}

function castSheet(id) {
  const p = loadProject(id);
  const svg = fs.readFileSync(fileOf(id, p.assets.cast.file), 'utf8');
  const syms = librarySymbols(svg);
  const names = Object.fromEntries((p.screenplay?.cast ?? []).map(c => [`cast-${c.id}`, c.name]));
  const pal = p.screenplay?.palette ?? {};
  const W = 280 * Math.max(1, syms.length);
  const body = syms.map((s, i) => `<use href="#${s.id}" x="${i * 280 + 20}" y="30" width="240" height="400"/><text x="${i * 280 + 140}" y="470" text-anchor="middle" font-family="Cairo, Segoe UI, Tahoma" font-weight="700" font-size="24" fill="${pal.ink ?? '#fff'}">${(names[s.id] ?? s.id).replace(/[<&]/g, '')}</text>`).join('');
  const sheet = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 500"><rect width="${W}" height="500" rx="18" fill="${pal.bg ?? '#111'}"/><rect y="430" width="${W}" height="70" fill="#000" opacity=".25"/>${body}</svg>`;
  return expandCast(sheet, svg);
}

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // after "api"
  const m = req.method;
  if (parts[0] === 'events') return subscribe(res);
  if (parts[0] === 'settings') {
    if (parts[1] === 'test' && m === 'POST') { try { return send(res, 200, await testEngine()); } catch (e) { return send(res, 200, { ok: false, error: e.message }); } }
    if (m === 'GET') return send(res, 200, publicSettings());
    if (m === 'POST') { saveSettings(await readBody(req)); return send(res, 200, publicSettings()); }
  }
  if (parts[0] === 'voices') return send(res, 200, await listVoices());
  if (parts[0] === 'image' && parts[1] === 'test' && m === 'POST') { try { return send(res, 200, await testImageEngine()); } catch (e) { return send(res, 200, { ok: false, error: e.message }); } }
  if (parts[0] === 'meta') return send(res, 200, { styles: STYLES, cameras: CAMERAS, transitions: TRANSITIONS, shotTypes: SHOT_TYPES, aspects: ASPECTS, steps: STEPS, film: FILM });
  if (parts[0] === 'jobs') {
    if (!parts[1]) return send(res, 200, listJobs());
    if (parts[2] === 'stop' && m === 'POST') return send(res, 200, { ok: stopJob(parts[1]) });
    const j = getJob(parts[1]);
    return j ? send(res, 200, j) : send(res, 404, { error: 'no job' });
  }
  if (parts[0] === 'projects') {
    if (!parts[1]) {
      if (m === 'GET') return send(res, 200, listProjects());
      if (m === 'POST') { const b = await readBody(req); if (!String(b.story ?? '').trim()) return send(res, 400, { error: t('writeStoryFirst') }); return send(res, 200, projectView(createProject(b).id)); }
    }
    const id = parts[1];
    if (!SAFE_ID.test(id) || !fs.existsSync(fileOf(id, 'project.json'))) return send(res, 404, { error: 'no project' });
    if (!parts[2]) {
      if (m === 'GET') return send(res, 200, projectView(id));
      if (m === 'PUT') {
        const b = await readBody(req), p = loadProject(id);
        if (typeof b.title === 'string') p.title = b.title.slice(0, 200);
        if (typeof b.story === 'string') p.story = b.story;
        if (b.options) p.options = { ...p.options, ...b.options };
        if (b.screenplay) { p.screenplay = cleanScreenplay(b.screenplay, p.screenplay); pruneAssets(p); }
        saveProject(p);
        return send(res, 200, projectView(id));
      }
      if (m === 'DELETE') { // never destroyed: moved to projects/_trash
        const trash = path.join(PROJECTS, '_trash'); fs.mkdirSync(trash, { recursive: true });
        fs.renameSync(path.join(PROJECTS, id), path.join(trash, `${id}-${Date.now()}`));
        return send(res, 200, { ok: true });
      }
    }
    if (parts[2] === 'run' && m === 'POST') {
      const b = await readBody(req);
      const steps = (Array.isArray(b.steps) ? b.steps : []).filter(s => STEPS.includes(s));
      if (!steps.length) return send(res, 400, { error: 'no steps' });
      const p = loadProject(id);
      const shots = Array.isArray(b.shots) ? b.shots.filter(s => SAFE_ID.test(s)) : undefined;
      const label = b.label || (steps.length > 2 ? t('makeFilm') : steps.join(' + '));
      return send(res, 200, enqueue({ project: id, steps, label: `${p.screenplay?.title ?? p.title} — ${label}`, opts: { shots, note: b.note ? String(b.note).slice(0, 1500) : undefined, force: !!b.force } }));
    }
    if (parts[2] === 'bundle' && parts[3]) {
      const p = loadProject(id), s = loadSettings();
      const tl = buildTimeline(p, Number(p.options.fps) || s.render.fps || 30);
      try { return send(res, 200, buildBundle(p, tl, parts[3])); } catch (e) { return send(res, 404, { error: e.message }); }
    }
    if (parts[2] === 'castsheet.svg') return send(res, 200, castSheet(id), 'image/svg+xml');
    if (parts[2] === 'reveal' && m === 'POST' && process.platform === 'win32') { spawn('explorer', [path.join(PROJECTS, id)], { detached: true }); return send(res, 200, { ok: true }); }
  }
  return send(res, 404, { error: 'unknown endpoint' });
}

const server = http.createServer(async (req, res) => {
  const host = req.headers.host ?? '';
  if (!new RegExp(`^(127\\.0\\.0\\.1|localhost):${PORT}$`).test(host)) return send(res, 403, { error: 'forbidden host' });
  const origin = req.headers.origin;
  if (origin && origin !== 'null' && !new RegExp(`^http://(127\\.0\\.0\\.1|localhost):${PORT}$`).test(origin)) return send(res, 403, { error: 'forbidden origin' });
  const url = new URL(req.url, `http://${host}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/files/')) {
      const [, , id, ...rest] = url.pathname.split('/').map(decodeURIComponent);
      if (!SAFE_ID.test(id ?? '') || rest.some(r => r === '..' || r.includes('\\'))) return send(res, 400, { error: 'bad path' });
      const file = path.join(PROJECTS, id, ...rest);
      if (!file.startsWith(path.join(PROJECTS, id) + path.sep)) return send(res, 400, { error: 'bad path' });
      return serveFile(req, res, file);
    }
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (rel.includes('..')) return send(res, 400, { error: 'bad path' });
    return serveFile(req, res, path.join(PUBLIC, rel));
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`🏮 Hakawati Studio: ${url}`);
  if (process.platform === 'win32' && !process.env.HAKAWATI_NO_OPEN) spawn('cmd', ['/c', 'start', '', url], { detached: true, windowsHide: true });
});
