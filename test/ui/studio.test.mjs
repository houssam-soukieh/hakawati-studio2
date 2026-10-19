// End-to-end QA of the Studio UI: every flow, in English and Arabic, at desktop (1440×900) and phone (390×844)
// widths, failing on any console error. Uses the offline mock engine; one combination makes a real film.
//
//   PATH=<dir with an edge-tts shim>:$PATH HAKAWATI_CHROME=/path/to/chromium node --test test/ui/studio.test.mjs
//
// HAKAWATI_URL=http://127.0.0.1:4848 reuses a running Studio; otherwise one starts on HAKAWATI_TEST_PORT (4865).
// Screenshots land in test/ui/shots/ (git-ignored). The run creates projects through the UI and moves them to
// projects/_trash at the end; Settings it changes are put back.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, BASE, api, setLang, waitJobs, jobSeq, launch, closeBrowser, openPage, shot, noSideScroll, startServer, stopServer, sleep } from './helpers.mjs';

const COMBOS = [
  { lang: 'en', vp: 'desktop', style: 'shadow', aspect: '16:9', narration: 'en', film: true },
  { lang: 'en', vp: 'phone', style: 'paper', aspect: '9:16', narration: 'ar' },
  { lang: 'ar', vp: 'desktop', style: 'miniature', aspect: '1:1', narration: 'ar' },
  { lang: 'ar', vp: 'phone', style: 'storybook', aspect: '16:9', narration: 'fr', last: true },
].map(c => ({ ...c, tag: `${c.lang}-${c.vp}` }));

let saved = null; // settings to put back
const film = { id: null }; // the project that gets a real film (made once, watched by every combination)
const trashed = [];

before(async () => {
  await startServer();
  const s = await api('settings');
  const { hasKey, apiKey, ...engine } = s.engine; // an omitted key keeps the saved one
  saved = { ui: s.ui, image: s.image, engine, voice: s.voice, render: s.render, ...(s.video ? { video: s.video } : {}) };
  if (s.image.engine === 'comfyui') await api('settings', { image: { engine: 'none' } }); // the mock pipeline paints placeholders
  await launch();
});
after(async () => {
  await closeBrowser();
  if (saved) await api('settings', saved).catch(() => {});
  await stopServer();
});

/** No console errors since the last check. */
function clean(page) {
  const errs = page.errors.splice(0);
  assert.deepEqual(errs, [], `console errors:\n${errs.join('\n')}`);
}
async function noScroll(page, where) {
  const r = await noSideScroll(page);
  assert.ok(r.ok, `${where}: sideways overflow ${JSON.stringify(r)}`);
}
const pidOf = page => decodeURIComponent(page.url().match(/#\/p\/([^/]+)/)?.[1] ?? '');
const project = id => api(`projects/${encodeURIComponent(id)}`);
const shotsOf = p => p.screenplay.scenes.flatMap(sc => sc.shots);
const findShot = (p, id) => shotsOf(p).find(s => s.id === id);
async function saved_(page) { // the autosave chip settles on "saved"
  await page.waitForSelector('#saveState.ok:not([hidden])', { timeout: 10000 });
}
async function collapseDock(page) { if (!(await page.$('#dock.collapsed'))) await page.click('#dockToggle'); }
async function openNav(page, c) { if (c.vp === 'phone' && !(await page.$('body.nav-open'))) { await page.click('#navBtn'); await page.waitForSelector('#side', { state: 'visible' }); } }
async function inView(page, sel) {
  return page.$eval(sel, el => { const r = el.getBoundingClientRect(), m = document.getElementById('main').getBoundingClientRect(); return r.bottom > m.top && r.top < m.bottom && r.bottom > 0 && r.top < innerHeight; });
}
async function gotoTab(page, tab) {
  await page.click(`.step[data-tab="${tab}"]`);
  await page.waitForSelector(`.step.on[data-tab="${tab}"]`);
}

describe('shell states', () => {
  it('shows a loading state, then the home page; an empty project list explains itself', async () => {
    await setLang('en');
    const page = await openPage('desktop');
    await page.route('**/api/meta', async r => { await sleep(1200); await r.continue(); });
    await page.route('**/api/projects', r => (r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.continue()));
    await page.goto(`${BASE}/#/`);
    await page.waitForSelector('#view .loading');
    await page.waitForSelector('#heroNew');
    await page.waitForSelector('#projects .empty-side');
    await shot(page, 'en-desktop-00-empty');
    clean(page);
    await page.context().close();
  });
});

for (const c of COMBOS) {
  describe(`Studio — ${c.tag}`, () => {
    let page, id;
    before(async () => { await setLang(c.lang); page = await openPage(c.vp); });
    after(async () => { await page?.context().close(); });

    it('home: direction, layout and navigation', async () => {
      await page.goto(`${BASE}/#/`);
      await page.waitForSelector('#heroNew');
      assert.equal(await page.getAttribute('html', 'dir'), c.lang === 'ar' ? 'rtl' : 'ltr');
      assert.equal(await page.getAttribute('html', 'lang'), c.lang);
      if (c.vp === 'desktop') {
        const side = await page.$eval('#side', el => el.getBoundingClientRect().left);
        assert.ok(c.lang === 'ar' ? side > 700 : side < 10, 'the sidebar sits on the reading-start side');
      } else {
        assert.ok(!(await page.isVisible('#side')), 'the sidebar is a hidden drawer on phones');
        assert.ok(await page.isVisible('#navBtn'));
        await page.click('#navBtn');
        await page.waitForSelector('#side', { state: 'visible' });
        await sleep(300);
        assert.equal(await page.getAttribute('#navBtn', 'aria-expanded'), 'true');
        await shot(page, `${c.tag}-01-drawer`);
        await page.keyboard.press('Escape');
        await page.waitForSelector('#side', { state: 'hidden' });
        await page.click('#navBtn');
        await page.click('#scrim', { position: { x: c.lang === 'ar' ? 20 : 370, y: 400 } });
        await page.waitForSelector('#side', { state: 'hidden' });
      }
      await shot(page, `${c.tag}-01-home`);
      await noScroll(page, 'home');
      clean(page);
    });

    it('new story: sample, style, frame, language, length, toggles, notes', async () => {
      if (c.vp === 'phone') { await openNav(page, c); await page.click('#newBtn'); } else await page.click('#newBtn');
      await page.waitForSelector('#fStory');
      assert.ok(!(await page.$('body.nav-open')), 'the drawer closes after choosing');
      await page.click('#createGo'); // an empty story is refused with a hint, no project
      await page.waitForSelector('.toast');
      assert.equal(pidOf(page), '');
      await page.click('#fSample');
      assert.ok((await page.inputValue('#fStory')).length > 100);
      assert.notEqual(await page.textContent('#fCount'), '');
      if (c.tag === 'en-desktop') { // keyboard: Tab reaches a style card, it shows a focus ring, Space picks it
        await page.focus('#fSample');
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => [document.activeElement.className, getComputedStyle(document.activeElement).outlineStyle]);
        assert.match(focused[0], /style-card/); assert.equal(focused[1], 'solid');
        await page.keyboard.press(' ');
        assert.equal(await page.getAttribute('.style-card:focus', 'aria-pressed'), 'true');
      }
      await page.click(`.style-card[data-style="${c.style}"]`);
      assert.equal(await page.getAttribute(`.style-card[data-style="${c.style}"]`, 'aria-pressed'), 'true');
      await page.click(`#fAspect [data-v="${c.aspect}"]`);
      await page.click(`#fLang [data-v="${c.narration}"]`);
      assert.equal(await page.getAttribute(`#fLang [data-v="${c.narration}"]`, 'aria-pressed'), 'true');
      await page.waitForFunction(() => document.querySelectorAll('#fVoice option').length >= 1);
      await page.$eval('#fLen', el => { el.value = '30'; el.dispatchEvent(new Event('input', { bubbles: true })); });
      assert.equal(await page.textContent('#fLenV'), '30');
      await page.click('label.toggle:has(#fMusic)');
      assert.equal(await page.isChecked('#fMusic'), false);
      await page.selectOption('#fQuality', '720p');
      await page.click('details summary');
      await page.fill('#fAudience', c.lang === 'ar' ? 'أطفال' : 'children');
      await shot(page, `${c.tag}-02-new`, { full: true });
      await noScroll(page, 'new story');
      if (c.tag === 'en-desktop') { await page.focus('#fStory'); await page.keyboard.press('Control+Enter'); } else await page.click('#createGo');
      await page.waitForSelector('.shots .shot[data-shot]', { timeout: 30000 }); // the screenplay arrives, the storyboard opens by itself
      id = pidOf(page);
      assert.ok(id);
      if (c.film) film.id = id;
      const p = await project(id);
      assert.equal(p.options.style, c.style); assert.equal(p.options.aspect, c.aspect); assert.equal(p.options.language, c.narration);
      assert.equal(p.options.length, 30); assert.equal(p.options.music, false); assert.equal(p.options.captions, true); assert.ok(p.options.audience);
      clean(page);
    });

    it('storyboard: placeholders, edits autosave, selects, cast, add/duplicate/move/delete, scenes, timeline', async () => {
      // the script doctor's notes (sp.doctor) show as a disclosure; the mock director writes none, so add some
      await page.route(`**/api/projects/${id}`, async r => {
        if (r.request().method() !== 'GET') return r.continue();
        const res = await r.fetch(), json = await res.json();
        json.screenplay.doctor = [{ pass: 1, issues: 3, top: ['Scene 2 repeats scene 1', 'العنوان طويل'], verdict: 'Tighten the middle' }, { pass: 2, issues: 1, top: ['Ending lands'], verdict: 'Ready' }];
        // and what the critic and the motion step report per shot
        const [a, b] = json.screenplay.scenes.flatMap(sc => sc.shots).filter(x => x.kind === 'shot');
        Object.assign(json.status[a.id], { score: 8, critique: 'Strong light; the fox is too small', video: true, depth: true });
        Object.assign(json.status[b.id], { score: 5, critique: 'الوجه مشوّه' });
        await r.fulfill({ response: res, json });
      });
      await page.reload();
      await page.waitForSelector('.doctor summary');
      const [s1, s2] = await page.$$eval('.shots .shot[data-shot]', els => els.map(e => e.dataset.shot).filter(x => x !== 'title' && x !== 'end'));
      assert.equal((await page.textContent(`.shot[data-shot="${s1}"] .score`)).trim(), '★ 8/10');
      assert.match(await page.getAttribute(`.shot[data-shot="${s1}"] .score`, 'title'), /fox is too small/);
      assert.ok(await page.$(`.shot[data-shot="${s1}"] .score.ok`) && await page.$(`.shot[data-shot="${s2}"] .score.low`), 'scores below the threshold stand out');
      assert.match(await page.textContent(`.shot[data-shot="${s1}"] .st`), /🎬/);
      assert.match(await page.textContent(`.shot[data-shot="${s1}"] .st`), /◐/);
      assert.equal(await page.textContent(`.shot[data-shot="${s2}"] .critique-line span`), 'الوجه مشوّه');
      assert.match(await page.textContent('.doctor summary'), /4/);
      await page.click('.doctor summary');
      assert.equal(await page.$$eval('.doctor-body li', els => els.length), 3);
      assert.equal(await page.getAttribute('.doctor-body li >> nth=1', 'dir'), 'auto');
      await shot(page, `${c.tag}-03-doctor`);
      await page.click('.doctor summary');
      await page.unroute(`**/api/projects/${id}`);
      await page.waitForSelector('.banner #phSettings');
      const story = await page.$$eval('.shots .shot[data-shot]', els => els.map(e => e.dataset.shot).filter(s => s !== 'title' && s !== 'end'));
      assert.equal(await page.$$eval('.shots .shot .badges .ph-badge', els => els.length), story.length, 'every story frame is marked as a placeholder');
      await shot(page, `${c.tag}-03-board`);
      await noScroll(page, 'storyboard');
      // mixed direction: user text follows its own script, whatever the interface language
      assert.equal(await page.getAttribute('.phead h1', 'dir'), 'auto');
      const first = story[0], card = `.shot[data-shot="${first}"]`;
      assert.equal(await page.$eval(`${card} textarea[data-k=narration]`, el => getComputedStyle(el).direction), await page.$eval(`${card} textarea[data-k=narration]`, el => (/[\u0600-\u06FF]/.test(el.value) ? 'rtl' : 'ltr')));
      // narration → autosave
      const line = c.lang === 'ar' ? 'سطرٌ جديد للراوي.' : 'A new line for the narrator.';
      await page.fill(`${card} textarea[data-k=narration]`, line);
      await page.waitForSelector('#saveState.warn:not([hidden])');
      await saved_(page);
      assert.equal(findShot(await project(id), first).narration, line);
      // selects, including the new motion selector
      await page.selectOption(`${card} select[data-k=shotType]`, 'close');
      await page.selectOption(`${card} select[data-k=camera]`, 'pan-left');
      await page.selectOption(`${card} select[data-k=transition]`, 'fade');
      assert.ok(await page.isHidden(`${card} .motion-hint`));
      await page.selectOption(`${card} select[data-k=motion]`, '2');
      await page.waitForSelector(`${card} .motion-hint:not([hidden])`); // image-to-video is off in Settings
      await page.click(`${card} details summary`);
      await page.fill(`${card} input[data-k=lens]`, '35mm, shallow depth of field');
      await page.fill(`${card} input[data-k=light]`, 'warm rim light');
      assert.equal(await page.getAttribute(`${card} input[data-k=lens]`, 'dir'), 'ltr');
      await sleep(1100); await saved_(page);
      let sh = findShot(await project(id), first);
      assert.deepEqual([sh.shotType, sh.camera, sh.transition, sh.motion, sh.lens, sh.light], ['close', 'pan-left', 'fade', 2, '35mm, shallow depth of field', 'warm rim light']);
      await shot(page, `${c.tag}-03-card`);
      await page.click(`${card} .motion-hint`);
      await page.waitForSelector('#settings[open] #set-motion');
      await page.keyboard.press('Escape');
      await page.waitForSelector('#settings[open]', { state: 'detached' });
      await page.click(`${card} details summary`);
      // cast chips toggle
      const chip = `${card} [data-cast]`;
      if (await page.$(chip)) {
        const was = await page.getAttribute(chip, 'aria-pressed');
        await page.click(chip);
        assert.notEqual(await page.getAttribute(chip, 'aria-pressed'), was);
        await sleep(1100); await saved_(page);
        const castId = await page.getAttribute(chip, 'data-cast');
        assert.equal(findShot(await project(id), first).cast.includes(castId), was !== 'true');
      }
      const count = () => page.$$eval('.shots .shot[data-shot]', els => els.length);
      const ids = async () => page.$$eval('.scene:first-of-type .shot[data-shot]', els => els.map(e => e.dataset.shot));
      const n0 = await count(), initial = await ids();
      await page.click('.scene >> nth=0 >> [data-add-shot]');
      await page.waitForFunction(n => document.querySelectorAll('.shots .shot[data-shot]').length === n + 1, n0);
      await page.click(`${card} [data-act=dup]`);
      await page.waitForFunction(n => document.querySelectorAll('.shots .shot[data-shot]').length === n + 2, n0);
      const before = await ids();
      await page.click(`.shot[data-shot="${first}"] [data-act=down]`);
      await page.waitForFunction(([f, i]) => [...document.querySelectorAll('.scene:first-of-type .shot[data-shot]')].map(e => e.dataset.shot).indexOf(f) === i + 1, [first, before.indexOf(first)]);
      await saved_(page);
      const order = shotsOf(await project(id)).map(s => s.id);
      assert.equal(order.indexOf(first), before.indexOf(first) + 1, 'the move is saved');
      // delete: Escape keeps the shot, Enter confirms
      const victim = (await ids()).filter(x => !initial.includes(x))[0];
      await page.click(`.shot[data-shot="${victim}"] [data-act=del]`);
      await page.waitForSelector('#modal[open]');
      await shot(page, `${c.tag}-04-delete-confirm`);
      await page.keyboard.press('Escape');
      await page.waitForSelector('#modal[open]', { state: 'detached' });
      assert.equal(await count(), n0 + 2);
      await page.click(`.shot[data-shot="${victim}"] [data-act=del]`);
      await page.waitForSelector('#modal[open]');
      await page.keyboard.press('Enter');
      await page.waitForFunction(n => document.querySelectorAll('.shots .shot[data-shot]').length === n + 1, n0);
      // a new scene takes the end card with it
      const scenes = await page.$$eval('.scene', els => els.length);
      await page.click('#addScene');
      await page.waitForFunction(n => document.querySelectorAll('.scene').length === n + 1, scenes);
      assert.ok(await page.$('.scene:last-of-type .shot[data-shot="end"]'));
      await page.fill('.scene >> nth=0 >> [data-scene-title]', c.lang === 'ar' ? 'البداية' : 'Opening');
      await sleep(1100); await saved_(page);
      const p = await project(id);
      assert.equal(p.screenplay.scenes.length, scenes + 1);
      assert.equal(p.screenplay.scenes[0].title, c.lang === 'ar' ? 'البداية' : 'Opening');
      assert.equal(shotsOf(p).length, n0 + 2, 'added + duplicated − deleted + the new scene’s first shot');
      // timeline: a click scrolls to the card and focuses its frame
      await page.$eval('#tlWrap', el => el.scrollIntoView({ block: 'center' })); // well clear of the fixed dock
      await sleep(300);
      const target = story[story.length - 1];
      await page.click(`.timeline .blk[data-shot="${target}"]`);
      for (let i = 0; i < 30 && !(await inView(page, `.shot[data-shot="${target}"] .frame`)); i++) await sleep(100); // smooth scroll
      if (!(await inView(page, `.shot[data-shot="${target}"] .frame`))) {
        await shot(page, `${c.tag}-xx-timeline`);
        assert.fail(`the card is not scrolled into view: ${JSON.stringify(await page.evaluate(t => ({ top: document.getElementById('main').scrollTop, rect: document.querySelector(`.shot[data-shot="${t}"] .frame`).getBoundingClientRect().top, active: document.activeElement.className, blk: [...document.querySelectorAll('.timeline .blk')].map(b => b.dataset.shot + ':' + Math.round(b.getBoundingClientRect().width)) }), target))}`);
      }
      assert.equal(await page.evaluate(() => document.activeElement.closest('.shot')?.dataset.shot), target);
      clean(page);
    });

    it('jobs: paint what is missing, dock progress + log, redraw with a note', async () => {
      await page.evaluate(() => { document.getElementById('main').scrollTop = 0; });
      let seq = await jobSeq();
      await page.click('#artBtn');
      await page.waitForSelector('#dock.running', { timeout: 15000 }).catch(async e => { await shot(page, `${c.tag}-xx-no-job`); throw new Error(`${e.message}\n${page.errors.join('\n')}`); });
      assert.ok(await page.isVisible('#stopBtn'));
      assert.equal(await page.getAttribute('#dockToggle', 'aria-expanded'), 'true');
      await page.waitForFunction(() => document.getElementById('log').textContent.length > 10);
      await shot(page, `${c.tag}-05-dock`);
      await waitJobs(id, { after: seq });
      await page.waitForSelector('#dock.done');
      assert.ok(!(await page.isVisible('#stopBtn')));
      await collapseDock(page);
      assert.equal(await page.getAttribute('#dockToggle', 'aria-expanded'), 'false');
      await page.waitForFunction(() => [...document.querySelectorAll('.shots .shot .frame')].every(f => f.style.backgroundImage), null, { timeout: 15000 });
      // redraw one shot with a note: Enter submits, Shift+Enter keeps a newline
      const target = await page.$eval('.shots .shot [data-act=redraw]', b => b.closest('.shot').dataset.shot);
      const at = (await project(id)).assets.art[target]?.at;
      await page.click(`.shot[data-shot="${target}"] [data-act=redraw]`);
      await page.waitForSelector('#modal[open] #redrawNote');
      await page.type('#redrawNote', 'darker sky');
      await page.keyboard.press('Shift+Enter');
      await page.type('#redrawNote', 'slower fox');
      assert.match(await page.inputValue('#redrawNote'), /darker sky\nslower fox/);
      await shot(page, `${c.tag}-06-redraw`);
      seq = await jobSeq();
      await page.keyboard.press('Enter');
      await page.waitForSelector('#modal[open]', { state: 'detached' });
      const job = await waitJobs(id, { after: seq });
      assert.equal(job.status, 'done');
      const p = await project(id);
      assert.ok(p.assets.art[target].at > (at ?? 0), 'the shot was painted again');
      assert.ok(fs.readdirSync(path.join(ROOT, 'projects', id, 'art')).some(f => f.startsWith(`${target}.v`)), 'the previous picture is kept');
      await collapseDock(page);
      clean(page);
    });

    it('live preview: the animatic chains the player shot by shot with the voices', async () => {
      await page.evaluate(() => { document.getElementById('main').scrollTop = 0; });
      await page.click('#aniBtn');
      await page.waitForSelector('#modal[open] #mScreen .ov');
      assert.ok(await page.isVisible('#modal .screen-wrap .ph-badge'));
      await page.click('#mScreen .ov');
      const voice = page.waitForRequest(r => /\/audio\/[^/]+\.mp3/.test(r.url()), { timeout: 15000 });
      await page.waitForSelector('#mScreen iframe[src*="player.html"]');
      await voice;
      await page.waitForSelector('#mBar i.on, #mBar i.past');
      await sleep(1500);
      await shot(page, `${c.tag}-07-animatic`);
      await page.keyboard.press('Escape');
      await page.waitForSelector('#modal[open]', { state: 'detached' });
      await page.waitForFunction(() => !document.querySelector('iframe'), null, { timeout: 2000 }); // closing stops the animatic
      clean(page);
    });

    it('shot preview modal: keyboard Enter on a frame, placeholder badge, close', async () => {
      const first = await page.$eval('.shots .shot [data-act=redraw]', b => b.closest('.shot').dataset.shot);
      await page.focus(`.shot[data-shot="${first}"] .frame`);
      await page.keyboard.press('Enter');
      await page.waitForSelector('#modal[open] #mScreen iframe');
      assert.match(await page.textContent('#modalTitle'), new RegExp(first));
      assert.ok(await page.isVisible('#modal .ph-badge'));
      await sleep(800);
      await shot(page, `${c.tag}-08-shot-preview`);
      await page.click('#modal [data-v="__x"]');
      await page.waitForSelector('#modal[open]', { state: 'detached' });
      clean(page);
    });

    it('characters & look: palette, mood, title, cast edits', async () => {
      await gotoTab(page, 'cast');
      await page.waitForSelector('[data-sp=title]');
      await page.fill('input[data-pal=accent]', '#ff3366');
      await page.selectOption('select[data-sp=mood]', 'epic');
      const name = c.lang === 'ar' ? 'ليلى' : 'Laila';
      if (await page.$('[data-c="0"][data-ck=name]')) await page.fill('[data-c="0"][data-ck=name]', name);
      await sleep(1100); await saved_(page);
      const sp = (await project(id)).screenplay;
      assert.equal(sp.palette.accent, '#ff3366'); assert.equal(sp.mood, 'epic');
      if (sp.cast.length) {
        assert.equal(sp.cast[0].name, name);
        // a second edit after the autosave replaced the screenplay copy must still be saved
        await page.fill('[data-c="0"][data-ck=personality]', 'brave and kind');
        await page.waitForSelector('#saveState.warn:not([hidden])');
        await saved_(page);
        assert.equal((await project(id)).screenplay.cast[0].personality, 'brave and kind');
      }
      if (await page.$('.cast-sheet')) assert.ok(await page.isVisible('.badged .ph-badge'), 'the vector cast sheet is marked as a placeholder');
      await shot(page, `${c.tag}-09-cast`, { full: true });
      await noScroll(page, 'cast');
      if (await page.isEnabled('#castRedraw')) { const seq = await jobSeq(); await page.click('#castRedraw'); await waitJobs(id, { after: seq }); await collapseDock(page); }
      clean(page);
    });

    it('story tab: change the look and save', async () => {
      await gotoTab(page, 'story');
      await page.waitForSelector('#saveStory');
      const next = c.style === 'paper' ? 'neon' : 'paper';
      await page.click(`.style-card[data-style="${next}"]`);
      await page.click('#saveStory');
      await page.waitForSelector('.toast');
      assert.equal((await project(id)).options.style, next);
      await noScroll(page, 'story tab');
      clean(page);
    });

    it('settings: engine presets, test + vision, pictures (critic), motion, doctor passes; Enter saves, Escape closes', async () => {
      await page.click(c.vp === 'phone' ? '#topSettings' : '#engineChip');
      await page.waitForSelector('#settings[open] #sPreset');
      await shot(page, `${c.tag}-10-settings`);
      await page.selectOption('#sPreset', 'openai');
      assert.equal(await page.inputValue('#sProto'), 'openai');
      assert.equal(await page.inputValue('#sBase'), 'https://api.openai.com/v1');
      await page.selectOption('#sPreset', 'mock');
      assert.equal(await page.inputValue('#sProto'), 'mock');
      await page.click('#sTest');
      await page.waitForFunction(() => /✓ mock/.test(document.getElementById('sTestOut').textContent));
      assert.ok(await page.isHidden('#sVision'), 'no vision line when the engine does not report it');
      for (const vision of [true, false]) {
        await page.route('**/api/settings/test', r => r.fulfill({ json: { ok: true, model: 'vision-model', reply: 'ready', vision, models: [] } }));
        await page.click('#sTest');
        await page.waitForFunction(v => { const el = document.getElementById('sVision'); return !el.hidden && el.textContent.includes(v ? '✓' : '✗'); }, vision);
        await page.unroute('**/api/settings/test');
      }
      // pictures: ComfyUI first, the off option says placeholders only
      assert.equal(await page.getAttribute('#sPic button:first-child', 'data-v'), 'comfyui');
      await page.click('.set-nav [data-sec=pictures]');
      await page.click('#sPic [data-v=comfyui]');
      await page.waitForSelector('#sPicBox:not([hidden])');
      await page.fill('#iCand', '9'); // clamped to 4
      await page.click('label.toggle:has(#iCritic)');
      assert.ok(await page.isDisabled('#iMin'));
      await page.click('label.toggle:has(#iCritic)');
      assert.ok(await page.isEnabled('#iMin'));
      await page.fill('#iMin', '8'); await page.fill('#iRounds', '3'); await page.fill('#iUp', '4x-UltraSharp.pth');
      await page.click('#iTest'); // no ComfyUI here: a red ✗ line, never a console error
      await page.waitForFunction(() => /✗|✓/.test(document.getElementById('iTestOut').textContent), null, { timeout: 20000 });
      // what a real ComfyUI reports: suggestions, its samplers, the resolved checkpoint, IP-Adapter models missing
      await page.route('**/api/image/test', r => r.fulfill({ json: { ok: true, version: '0.3.60', gpu: 'RTX 3060 Ti', vram: 8, checkpoints: ['RealVisXL_V5.0_Lightning_fp16.safetensors', 'juggernautXL.safetensors'], checkpoint: 'RealVisXL_V5.0_Lightning_fp16.safetensors', upscalers: ['4x-UltraSharp.pth', 'RealESRGAN_x4plus.pth'], upscaler: '4x-UltraSharp.pth', ipadapter: false, ipadapterNodes: true, ipadapterMissing: ['ip-adapter-plus_sdxl_vit-h.safetensors'], samplers: ['euler', 'dpmpp_sde', 'uni_pc'], schedulers: ['karras', 'beta'] } }));
      await page.fill('#iCkpt', 'realvis');
      await page.click('#iTest');
      await page.waitForSelector('#iIpOut:not([hidden])');
      assert.equal(await page.inputValue('#iCkpt'), 'RealVisXL_V5.0_Lightning_fp16.safetensors');
      assert.equal(await page.$$eval('#iUps option', o => o.length), 2);
      assert.ok(await page.$('#iSampler option[value="uni_pc"], #iSampler option:text-is("uni_pc")'));
      assert.match(await page.textContent('#iIpOut'), /ip-adapter-plus_sdxl_vit-h/);
      assert.match(await page.textContent('#iTestOut'), /RTX 3060 Ti/);
      await page.unroute('**/api/image/test');
      await shot(page, `${c.tag}-11-settings-pictures`);
      await page.click('.set-nav [data-sec=motion]');
      await page.click('#vEngine [data-v=wan22]');
      await page.waitForSelector('#vBox:not([hidden])');
      await page.fill('#vSteps', '25'); await page.fill('#vSec', '4');
      await page.click('label.toggle:has(#vDepth)');
      await sleep(400);
      await shot(page, `${c.tag}-12-settings-motion`);
      await page.fill('#sDoc', '1');
      const req = page.waitForRequest(r => r.url().endsWith('/api/settings') && r.method() === 'POST');
      await page.focus('#sDoc');
      await page.keyboard.press('Enter');
      const body = (await req).postDataJSON();
      await page.waitForSelector('#settings[open]', { state: 'detached' });
      assert.deepEqual([body.image.engine, body.image.candidates, body.image.critic, body.image.minScore, body.image.maxRounds, body.image.upscaler], ['comfyui', 4, true, 8, 3, '4x-UltraSharp.pth']);
      assert.deepEqual([body.video.engine, body.video.steps, body.video.seconds, body.video.depth, body.video.unet, body.video.fps], ['wan22', 25, 4, false, 'wan2.2_ti2v_5B_fp16.safetensors', 24]);
      assert.equal(body.engine.doctorPasses, 1);
      assert.equal(body.image.checkpoint, 'RealVisXL_V5.0_Lightning_fp16.safetensors');
      // with a picture engine the banner goes away; with image-to-video on, so does the motion hint
      await gotoTab(page, 'board');
      assert.ok(!(await page.$('.banner')));
      if (body.video && (await api('settings')).video) assert.ok(!(await page.$('.motion-hint:not([hidden])')));
      // back to placeholders: the banner returns and its button opens Settings at Pictures
      await page.click(c.vp === 'phone' ? '#topSettings' : '#engineChip');
      await page.waitForSelector('#settings[open] #sPic');
      await page.click('#sPic [data-v=none]');
      await page.click('#vEngine [data-v=none]');
      await page.click('#sSave');
      await page.waitForSelector('#settings[open]', { state: 'detached' });
      await page.waitForSelector('.banner #phSettings');
      await page.click('#phSettings');
      await page.waitForSelector('#settings[open] #set-pictures');
      await sleep(300);
      const top = await page.$eval('#set-pictures', el => el.getBoundingClientRect().top - el.closest('.dlg-b').getBoundingClientRect().top);
      assert.ok(top >= 0 && top < 120, `Settings opens at the Pictures section (${top})`);
      await page.keyboard.press('Escape');
      await page.waitForSelector('#settings[open]', { state: 'detached' });
      if (saved.video) await api('settings', { video: saved.video });
      clean(page);
    });

    it('job dock: stop a running job', async () => {
      if (c.film) return; // this combination makes the film instead
      const seq = await jobSeq();
      await page.click('#makeFilm');
      await page.waitForSelector('#dock.running #stopBtn:not([hidden])', { timeout: 15000 });
      await sleep(1500);
      await page.click('#stopBtn');
      const job = await waitJobs(id, { after: seq, timeout: 60000 });
      assert.equal(job.status, 'stopped');
      await page.waitForSelector('#dock.done, #dock:not(.running)');
      await collapseDock(page);
      clean(page);
    });

    it('screening room: animatic before the film; the film plays and downloads', async () => {
      await gotoTab(page, 'room');
      if (!c.film) {
        assert.ok(await page.isDisabled('#roomMode [data-v=film]'), 'no film yet');
        assert.ok(await page.isVisible('#screen .ov'));
        assert.ok(await page.isVisible('.screen-wrap .ph-badge'));
        await shot(page, `${c.tag}-13-room-empty`);
      } else {
        const seq = await jobSeq();
        await page.click('#roomMake');
        await page.waitForSelector('#dock.running', { timeout: 15000 });
        const job = await waitJobs(id, { after: seq, timeout: 480000 });
        assert.equal(job.status, 'done', job.error);
        await collapseDock(page);
      }
      assert.ok(film.id, 'the film project exists');
      await page.goto(`${BASE}/#/p/${film.id}/room`);
      await page.waitForSelector('#screen video');
      assert.equal(await page.getAttribute('#roomMode [data-v=film]', 'aria-pressed'), 'true');
      const canH264 = await page.evaluate(() => document.createElement('video').canPlayType('video/mp4; codecs="avc1.640028"') !== '');
      if (canH264) {
        const t = await page.$eval('#screen video', async v => { v.muted = true; await v.play(); await new Promise(r => setTimeout(r, 1500)); return v.currentTime; });
        assert.ok(t > 0.5, 'the film plays');
      } else { // this Chromium has no H.264: the room says so instead of showing a dead player
        await page.waitForSelector('#screen .ov.msg .note');
        console.log(`# ${c.tag}: video playback not verifiable here (no H.264 in this Chromium); the fallback message is shown`);
      }
      await shot(page, `${c.tag}-14-room-film`, { full: true });
      await noScroll(page, 'room');
      for (const [sel, ext] of [['.downloads a:nth-child(1)', '.mp4'], ['.downloads a:nth-child(2)', '.srt'], ['.downloads a:nth-child(3)', '.jpg']]) {
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
        assert.ok(dl.suggestedFilename().endsWith(ext), dl.suggestedFilename());
        const file = await dl.path();
        assert.ok(fs.statSync(file).size > 0);
        if (ext === '.mp4') {
          const d = parseFloat(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).stdout.toString());
          assert.ok(d > 10, `the film lasts ${d} s`);
        }
      }
      // the animatic still plays from the room
      await page.click('#roomMode [data-v=ani]');
      await page.click('#screen .ov');
      await page.waitForSelector('#screen iframe');
      await page.click('#roomMode [data-v=film]');
      await page.waitForSelector('#screen video');
      clean(page);
    });

    it('language switch both ways', async () => {
      const other = c.lang === 'en' ? 'ar' : 'en';
      for (const lang of [other, c.lang]) {
        await openNav(page, c);
        await Promise.all([page.waitForEvent('load'), page.click('#langBtn')]);
        await page.waitForSelector('#view .phead, #view .hero');
        assert.equal(await page.getAttribute('html', 'dir'), lang === 'ar' ? 'rtl' : 'ltr');
        assert.equal((await api('settings')).ui.lang, lang);
        if (lang === other) await shot(page, `${c.tag}-15-switched-${other}`);
      }
      clean(page);
    });

    it('project trash', async () => {
      if (c.film) { // keep the film for the other combinations; trash a story saved with "Save only"
        await page.goto(`${BASE}/#/new`);
        await page.waitForSelector('#fStory');
        await page.fill('#fStory', 'A short story to throw away.');
        await page.click('#createOnly');
        await page.waitForSelector('#writeScript');
        id = pidOf(page);
      } else await page.goto(`${BASE}/#/p/${id}/story`);
      const del = async pid => {
        await page.goto(`${BASE}/#/p/${pid}/story`);
        await page.waitForSelector('#delProj');
        await page.click('#delProj');
        await page.waitForSelector('#modal[open]');
        assert.ok(await page.$('#modal bdi'), 'the title is isolated inside the sentence');
        await shot(page, `${c.tag}-16-trash`);
        await page.click('#modal .dlg-f .btn.danger');
        await page.waitForFunction(() => location.hash === '#/');
        assert.ok(!(await api('projects')).some(p => p.id === pid));
        assert.ok(!(await page.$(`#projects a[href="#/p/${pid}"]`)));
        trashed.push(pid);
      };
      await del(id);
      if (c.last && film.id) await del(film.id);
      clean(page);
    });
  });
}
