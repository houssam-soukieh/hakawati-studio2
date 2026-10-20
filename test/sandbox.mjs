// Imported FIRST by the test runners (before any lib module reads its paths): settings and projects go to a temp
// folder, so a test can never change — or, if it is interrupted, lose — the owner's .studio/settings.json (engine,
// key, ComfyUI) or touch his projects. Child processes (node make.mjs …) inherit the same folders.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.HAKAWATI_STUDIO_DIR) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hakawati-test-'));
  process.env.HAKAWATI_STUDIO_DIR = path.join(dir, 'studio');
  process.env.HAKAWATI_PROJECTS_DIR = path.join(dir, 'projects');
}
fs.mkdirSync(process.env.HAKAWATI_STUDIO_DIR, { recursive: true });
fs.mkdirSync(process.env.HAKAWATI_PROJECTS_DIR ?? path.join(path.dirname(process.env.HAKAWATI_STUDIO_DIR), 'projects'), { recursive: true });
