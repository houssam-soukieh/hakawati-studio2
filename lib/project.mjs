// A project = one story → one film. projects/<id>/project.json holds the story, options, the screenplay
// (the editable montage) and a ledger of generated assets keyed by content hashes, so "make the film"
// only redoes what changed: edit one line of narration and only that shot's voice, art and clip are redone.
import fs from 'node:fs';
import path from 'node:path';
import { PROJECTS, SAFE_ID, readJSON, writeJSON, slug } from './util.mjs';
import { t } from './i18n.mjs';

export const DEFAULT_OPTIONS = {
  language: 'ar', style: 'photoreal', aspect: '16:9', length: 60, voice: '', captions: true, music: true,
  consistentCast: true, quality: '', fps: 0, audience: '', notes: '',
};

export const dirOf = id => {
  if (!SAFE_ID.test(id)) throw new Error('bad project id');
  return path.join(PROJECTS, id);
};
export const fileOf = (id, ...p) => path.join(dirOf(id), ...p);

export function listProjects() {
  if (!fs.existsSync(PROJECTS)) return [];
  return fs.readdirSync(PROJECTS)
    .filter(d => SAFE_ID.test(d) && fs.existsSync(path.join(PROJECTS, d, 'project.json')))
    .map(d => {
      const p = readJSON(path.join(PROJECTS, d, 'project.json'), {});
      const shots = allShots(p);
      return { id: d, title: p.screenplay?.title || p.title, updatedAt: p.updatedAt, style: p.options?.style, aspect: p.options?.aspect,
        shots: shots.length, final: p.assets?.final?.file ? `/files/${d}/${p.assets.final.file}` : null, thumb: p.assets?.final?.thumb ? `/files/${d}/${p.assets.final.thumb}` : null };
    })
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function createProject({ title, story, options }) {
  const base = `${new Date().toISOString().slice(0, 10)}-${slug(title || story?.slice(0, 30))}`;
  let id = base, n = 2;
  while (fs.existsSync(path.join(PROJECTS, id))) id = `${base}-${n++}`;
  const p = {
    id, title: title || t('untitled'), story: String(story ?? ''), options: { ...DEFAULT_OPTIONS, ...options },
    screenplay: null, assets: { voice: {}, whispers: {}, art: {}, clips: {}, cast: null, castImages: {}, final: null },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  saveProject(p);
  return p;
}

export function loadProject(id) {
  const p = readJSON(fileOf(id, 'project.json'));
  if (!p) throw new Error(`no project ${id}`);
  p.options = { ...DEFAULT_OPTIONS, ...p.options };
  p.assets = { voice: {}, whispers: {}, art: {}, clips: {}, cast: null, castImages: {}, final: null, ...p.assets };
  return p;
}

export function saveProject(p) {
  p.updatedAt = new Date().toISOString();
  writeJSON(fileOf(p.id, 'project.json'), p);
  return p;
}

/** Shots in film order, each with its scene. */
export function allShots(p) {
  const out = [];
  for (const sc of p?.screenplay?.scenes ?? []) for (const sh of sc.shots ?? []) out.push({ ...sh, sceneId: sc.id, sceneTitle: sc.title, location: sh.location ?? sc.location });
  return out;
}

export function findShot(p, shotId) {
  for (const sc of p.screenplay?.scenes ?? []) for (const sh of sc.shots ?? []) if (sh.id === shotId) return { scene: sc, shot: sh };
  return null;
}

/** Remove ledger entries for shots that no longer exist (after the user deleted shots in the editor). */
export function pruneAssets(p) {
  const ids = new Set(allShots(p).map(s => s.id));
  for (const k of ['voice', 'whispers', 'art', 'clips', 'motion']) for (const id of Object.keys(p.assets[k] ?? {})) if (!ids.has(id)) delete p.assets[k][id];
}
