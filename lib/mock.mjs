// The offline engine ("تجريبي بلا مفتاح"): a deterministic stand-in for the AI so the whole pipeline — voice,
// frame-exact render, montage, music — can be tried and tested with no key. It cuts the story into sentences
// and fills the screenplay's fields (bible looks, lens, light, motion) with plausible defaults. Its pictures are
// honest storyboard PLACEHOLDER cards, never drawings: a crude cartoon must never pass for a result.
import { STYLES, ASPECTS, CAMERAS } from './styles.mjs';
import { whisperLines, nameKey } from './whisper.mjs';

const LENS = { establishing: '24mm wide', wide: '24mm wide', medium: '35mm', close: '85mm portrait', 'extreme-close': '100mm macro', insert: '100mm macro', 'over-shoulder': '50mm', pov: '35mm' };
const PLACES = {
  hills: { look: 'rolling hills of dry golden grass and scattered olive trees under a wide sky, late afternoon golden hour, low warm sun from the left, long soft shadows, dust in the air', light: 'low warm golden sun from the left, long soft shadows' },
  valley: { look: 'a quiet valley with a shallow stream, smooth grey stones and dark cypress trees, dusk turning to night, cool blue twilight from the right, first stars, faint mist over the water', light: 'cool blue dusk light from the right, soft mist' },
};

const SENTENCE = /(?<=[.!?؟…])\s+|\n+/;
const TYPING = /يكتب…|ثلاث\S*\s+نقاط|typing…|three dots/i; // the chat "typing…" indicator, drawn by the player
const MAX_WHISPERS = 2; // per shot: a long exchange spreads over several shots

/**
 * The story as a sequence of narration sentences and whisper lines («Speaker: …», the beings' private language).
 * A story without whisper lines gives exactly the sentences it always gave.
 */
function storyItems(story) {
  const flat = story.replace(/\s+/g, ' '), items = [];
  const say = text => { for (const s of text.split(SENTENCE).map(x => x.trim()).filter(x => x.length > 2)) items.push({ text: s }); };
  let at = 0;
  for (const w of whisperLines(flat)) { say(flat.slice(at, w.index)); items.push({ whisper: w }); at = w.index + w.length; }
  say(flat.slice(at));
  return items;
}

export function mockScreenplay(p) {
  const o = p.options, st = STYLES[o.style] ?? STYLES.cinematic;
  const items = storyItems(p.story), sentences = items.filter(x => x.text).map(x => x.text);
  const want = Math.max(3, Math.min(14, Math.round((o.length - 6) / 5)));
  // every speaker is a being of the cast, in order of first appearance (its colour and glyphs follow from that order)
  const beings = [];
  for (const { whisper: w } of items) if (w && !beings.some(b => nameKey(b.name) === nameKey(w.name))) {
    const slug = w.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    beings.push({ id: slug && !['hero', 'friend'].includes(slug) ? slug : `being-${beings.length + 1}`, name: w.name, look: 'small translucent being made only of glowing light threads, faceless, soft halo, background visible through its body', personality: 'hidden', kind: 'being' });
  }
  // merge sentences into `want` narration chunks; whisper lines follow their chunk (at most MAX_WHISPERS a shot)
  const per = Math.max(1, Math.ceil(sentences.length / want)), chunks = [];
  let cur = null;
  for (const it of items) {
    if (it.text) {
      if (!cur || cur.whispers.length || cur.n === per) chunks.push(cur = { n: 0, text: [], whispers: [] });
      cur.n++; cur.text.push(it.text);
    } else {
      if (!cur || cur.whispers.length >= MAX_WHISPERS) chunks.push(cur = { n: per, text: [], whispers: [] });
      cur.whispers.push({ speaker: beings.find(b => nameKey(b.name) === nameKey(it.whisper.name)).id, text: it.whisper.text });
    }
  }
  const types = ['establishing', 'medium', 'close', 'wide', 'medium', 'insert'];
  const scenes = [];
  chunks.forEach((chunk, i) => {
    const text = chunk.text.join(' ');
    const si = Math.floor(i / 3), place = si % 2 ? 'valley' : 'hills';
    if (!scenes[si]) scenes[si] = { id: `s${si + 1}`, title: `${o.language === 'ar' ? 'المشهد' : 'Scene'} ${si + 1}`, location: place, shots: [] };
    const said = n => String(n).split(/\s+/).filter(Boolean).length;
    const words = said(text), shotType = types[i % types.length], both = i % 3 === 2;
    const whisperSec = chunk.whispers.reduce((a, w) => a + said(w.text) / 2.4 + 0.8, 0);
    scenes[si].shots.push({
      id: `s${si + 1}-${scenes[si].shots.length + 1}`, narration: text, whispers: chunk.whispers, overlay: TYPING.test(text) ? 'typing' : '',
      visual: `The hero walks along a path across the land toward the right third of the frame${both ? ', the friend trotting a step behind' : ''}.`, action: 'The hero walks; clouds drift; dust floats in the light.',
      cast: both ? ['hero', 'friend'] : ['hero'], shotType, lens: LENS[shotType], light: PLACES[place].light,
      motion: i % 4 === 1 ? 2 : 1, // ~25%: exercises the image-to-video path
      camera: CAMERAS[(i * 3 + 1) % CAMERAS.length], transition: i % 3 === 2 ? 'fade' : i % 5 === 4 ? 'wipe-left' : 'cut',
      seconds: Math.max(3, (words ? words / 2.2 + 1 : 0.6) + whisperSec),
    });
  });
  const untitled = !p.title || /^(Untitled story|قصة بلا عنوان)$/.test(p.title); // the project's placeholder, in either UI language
  return {
    title: untitled ? (o.language === 'ar' ? 'حكاية' : 'A Tale') : p.title, logline: sentences[0] ?? '', mood: 'warm', palette: st.palette, artStyle: st.brief,
    cast: [
      { id: 'hero', name: o.language === 'ar' ? 'البطل' : 'Hero', look: 'young man in his twenties, warm olive skin, oval face, short curly black hair, dark-brown eyes, saffron-yellow wool coat over a white linen shirt, brown boots, a long red scarf', personality: 'brave' },
      { id: 'friend', name: o.language === 'ar' ? 'الرفيق' : 'Friend', look: 'small red fox, russet fur with a cream chest, white-tipped bushy tail, bright amber eyes, one torn left ear, a blue thread tied around its neck', personality: 'curious' },
      ...beings.slice(0, 6),
    ],
    locations: Object.entries(PLACES).map(([id, l]) => ({ id, name: id, look: l.look })),
    scenes,
  };
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const FONT = `Cairo, 'Segoe UI', Tahoma, sans-serif`;
const LABEL_EN = 'PLACEHOLDER — no picture engine connected';
const LABEL_AR = 'صورة مؤقتة — لم يُوصل محرك الصور';

/** Greedy word wrap to `max` characters, at most `lines` lines (the last one ellipsed). */
function wrap(text, max, lines) {
  const all = String(text ?? '').replace(/\s+/g, ' ').trim();
  max = Math.min(max, Math.ceil(all.length / Math.ceil(all.length / max)) + 6); // balanced lines, no lone last word
  const out = [];
  let cur = '';
  for (const w of all.split(' ').filter(Boolean)) {
    if (cur && cur.length + 1 + w.length > max) { out.push(cur); cur = ''; }
    cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  if (out.length > lines) { out.length = lines; out[lines - 1] = `${out[lines - 1].replace(/[\s,.;:]+$/, '')}…`; }
  return out;
}

/** Character library: neutral grey silhouettes with the name, clearly labelled as placeholders. */
export function mockCast(sp) {
  const syms = sp.cast.map(c => `<symbol id="cast-${c.id}" viewBox="0 0 240 400">
  <ellipse cx="120" cy="394" rx="58" ry="6" fill="#000" opacity=".35"/>
  <g class="${c.id}-body"><path d="M60 398 C60 300 78 232 120 232 C162 232 180 300 180 398 Z" fill="#3a4152"/></g>
  <g class="${c.id}-head"><circle cx="120" cy="180" r="40" fill="#4a5266"/></g>
  <rect x="18" y="20" width="204" height="36" rx="7" fill="#151a26" stroke="#5b6479" stroke-dasharray="6 5"/>
  <text x="120" y="44" text-anchor="middle" font-family="${FONT}" font-size="17" font-weight="700" fill="#d7deea">${esc(String(c.name).slice(0, 20))}</text>
  <text x="120" y="80" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="700" letter-spacing="2" fill="#f2c46d">PLACEHOLDER</text>
  <text x="120" y="98" text-anchor="middle" direction="rtl" font-family="${FONT}" font-size="12" font-weight="700" fill="#f2c46d">صورة مؤقتة</text>
</symbol>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${240 * Math.max(1, sp.cast.length)} 400"><defs>${syms.join('\n')}</defs></svg>`;
}

/**
 * One shot as a storyboard placeholder card: shot id, size and camera, the shot's `visual` text, and a clear
 * "no picture engine" label. One slow shimmer of the dashed frame keeps the render checks honest (it moves, it is
 * not one flat colour, it has enough elements) without pretending to be art.
 */
export function mockShot({ options, shot, duration: D }) {
  const { w, h } = ASPECTS[options.aspect] ?? ASPECTS['16:9'];
  const u = Math.min(w, h) / 100; // 1% of the short side
  const mx = w * 0.12, my = h * 0.12; // the player's camera (up to 1.14× and 4% pan) crops ~10% of the edges
  const vertical = h > w;
  const lines = wrap(shot.visual || shot.action, vertical ? 26 : 50, 5);
  const fs = u * (vertical ? 3.4 : 3.6), lh = fs * 1.5, cy = h * (vertical ? 0.42 : 0.45);
  const y0 = cy - ((lines.length - 1) * lh) / 2;
  const head = [shot.id, shot.shotType, shot.camera].filter(Boolean).join(' · ').toUpperCase();
  const sub = [shot.lens, shot.light, shot.motion === 2 ? 'image-to-video' : ''].filter(Boolean).join(' · ');
  const dur = Math.max(1, Number(D) || 5).toFixed(2);
  const thirds = [w / 3, (2 * w) / 3].map(x => `<line x1="${x.toFixed(0)}" y1="${my.toFixed(0)}" x2="${x.toFixed(0)}" y2="${(h - my).toFixed(0)}"/>`)
    .concat([h / 3, (2 * h) / 3].map(y => `<line x1="${mx.toFixed(0)}" y1="${y.toFixed(0)}" x2="${(w - mx).toFixed(0)}" y2="${y.toFixed(0)}"/>`)).join('');
  const k = u * 4; // corner marks
  const corners = [[mx, my, 1, 1], [w - mx, my, -1, 1], [mx, h - my, 1, -1], [w - mx, h - my, -1, -1]]
    .map(([x, y, sx, sy]) => `<path d="M${(x + sx * k).toFixed(0)} ${y.toFixed(0)} H${x.toFixed(0)} V${(y + sy * k).toFixed(0)}"/>`).join('');
  // direction="ltr": an Arabic film's player is right-to-left, and the English text would inherit it
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" direction="ltr">
<defs><linearGradient id="ph-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0d1018"/><stop offset="1" stop-color="#151a26"/></linearGradient></defs>
<style>
.ph-frame{animation:ph-shimmer ${dur}s linear both}
@keyframes ph-shimmer{0%{stroke-dashoffset:0;stroke-opacity:.35}50%{stroke-opacity:.85}100%{stroke-dashoffset:-${(u * 40).toFixed(0)};stroke-opacity:.35}}
</style>
<rect x="-40" y="-40" width="${w + 80}" height="${h + 80}" fill="url(#ph-bg)"/>
<g stroke="#232a3a" stroke-width="${(u * 0.15).toFixed(2)}" fill="none">${thirds}</g>
<rect class="ph-frame" x="${mx.toFixed(0)}" y="${my.toFixed(0)}" width="${(w - 2 * mx).toFixed(0)}" height="${(h - 2 * my).toFixed(0)}" rx="${(u * 1.2).toFixed(0)}" fill="none" stroke="#7d879c" stroke-width="${(u * 0.3).toFixed(2)}" stroke-dasharray="${(u * 2.2).toFixed(0)} ${(u * 1.6).toFixed(0)}"/>
<g stroke="#9aa4b8" stroke-width="${(u * 0.45).toFixed(2)}" fill="none">${corners}</g>
<text x="${(mx + u * 3).toFixed(0)}" y="${(my + u * 6).toFixed(0)}" font-family="${FONT}" font-size="${(u * 3).toFixed(1)}" font-weight="800" letter-spacing="${(u * 0.2).toFixed(1)}" fill="#9aa4b8">${esc(head)}</text>
${sub ? `<text x="${(mx + u * 3).toFixed(0)}" y="${(my + u * 10).toFixed(0)}" font-family="${FONT}" font-size="${(u * 2.3).toFixed(1)}" fill="#6b7489">${esc(sub.length > (vertical ? 44 : 80) ? `${sub.slice(0, vertical ? 43 : 79)}…` : sub)}</text>` : ''}
<g font-family="${FONT}" font-size="${fs.toFixed(1)}" font-weight="600" fill="#c9d1e0" text-anchor="middle">${lines.map((l, i) => `<text x="${(w / 2).toFixed(0)}" y="${(y0 + i * lh).toFixed(0)}">${esc(l)}</text>`).join('')}</g>
<g font-family="${FONT}" font-weight="800" fill="#f2c46d" text-anchor="middle">
<text x="${(w / 2).toFixed(0)}" y="${(h * 0.71).toFixed(0)}" font-size="${(u * 2.6).toFixed(1)}" letter-spacing="${(u * 0.15).toFixed(1)}">${LABEL_EN}</text>
<text x="${(w / 2).toFixed(0)}" y="${(h * 0.71 + u * 4.6).toFixed(0)}" font-size="${(u * 2.9).toFixed(1)}" direction="rtl">${LABEL_AR}</text>
</g>
</svg>`;
}
