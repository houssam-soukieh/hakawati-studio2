// The offline engine ("تجريبي بلا مفتاح"): a deterministic stand-in for the AI so the whole pipeline — voice,
// frame-exact render, montage, music — can be tried and tested with no key. It cuts the story into sentences
// and draws procedural parallax landscapes with walking characters from the same cast library mechanism.
import { STYLES, ASPECTS, CAMERAS } from './styles.mjs';

const rng = seed => { let s = [...String(seed)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); };

export function mockScreenplay(p) {
  const o = p.options, st = STYLES[o.style] ?? STYLES.cinematic;
  const sentences = p.story.replace(/\s+/g, ' ').split(/(?<=[.!?؟…])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 2);
  const want = Math.max(3, Math.min(14, Math.round((o.length - 6) / 5)));
  // merge sentences into `want` narration chunks
  const chunks = [];
  const per = Math.max(1, Math.ceil(sentences.length / want));
  for (let i = 0; i < sentences.length; i += per) chunks.push(sentences.slice(i, i + per).join(' '));
  const types = ['establishing', 'wide', 'medium', 'close', 'wide', 'medium'];
  const scenes = [];
  chunks.forEach((text, i) => {
    const si = Math.floor(i / 3);
    if (!scenes[si]) scenes[si] = { id: `s${si + 1}`, title: `${o.language === 'ar' ? 'المشهد' : 'Scene'} ${si + 1}`, location: si % 2 ? 'valley' : 'hills', shots: [] };
    const words = text.split(/\s+/).length;
    scenes[si].shots.push({
      id: `s${si + 1}-${scenes[si].shots.length + 1}`, narration: text,
      visual: 'Rolling hills under a gradient sky; the hero walks across the land.', action: 'The hero walks; clouds drift; particles float.',
      cast: i % 3 === 2 ? ['hero', 'friend'] : ['hero'], shotType: types[i % types.length],
      camera: CAMERAS[(i * 3 + 1) % CAMERAS.length], transition: i % 3 === 2 ? 'fade' : i % 5 === 4 ? 'wipe-left' : 'cut',
      seconds: Math.max(3, words / 2.2 + 1),
    });
  });
  return {
    title: p.title || (o.language === 'ar' ? 'حكاية' : 'A Tale'), logline: sentences[0] ?? '', mood: 'warm', palette: st.palette, artStyle: st.brief,
    cast: [{ id: 'hero', name: o.language === 'ar' ? 'البطل' : 'Hero', look: 'round head, accent coat', personality: 'brave' },
      { id: 'friend', name: o.language === 'ar' ? 'الرفيق' : 'Friend', look: 'small, accent2 scarf', personality: 'curious' }],
    locations: [{ id: 'hills', name: 'hills', look: '' }, { id: 'valley', name: 'valley', look: '' }],
    scenes,
  };
}

function person(id, coat, skin, scale, extra = '') {
  return `<symbol id="cast-${id}" viewBox="0 0 240 400">
  <ellipse cx="120" cy="394" rx="${50 * scale}" ry="7" fill="#000" opacity=".25"/>
  <g class="${id}-body">
    <rect x="${120 - 12 * scale}" y="${400 - 110 * scale}" width="${10 * scale}" height="${108 * scale}" rx="${5 * scale}" fill="#2b2b3a"/>
    <rect x="${120 + 2 * scale}" y="${400 - 110 * scale}" width="${10 * scale}" height="${108 * scale}" rx="${5 * scale}" fill="#2b2b3a"/>
    <path d="M${120 - 42 * scale} ${400 - 100 * scale} Q120 ${400 - 260 * scale} ${120 + 42 * scale} ${400 - 100 * scale} Z" fill="${coat}"/>
    <g class="${id}-armR"><rect x="${120 + 26 * scale}" y="${400 - 205 * scale}" width="${12 * scale}" height="${80 * scale}" rx="${6 * scale}" fill="${coat}" opacity=".9"/></g>
    ${extra}
  </g>
  <g class="${id}-head">
    <circle cx="120" cy="${400 - 250 * scale}" r="${38 * scale}" fill="${skin}"/>
    <path d="M${120 - 38 * scale} ${400 - 258 * scale} Q120 ${400 - 310 * scale} ${120 + 38 * scale} ${400 - 258 * scale} Z" fill="#2b2b3a"/>
    <g class="${id}-eyes"><circle cx="${120 + 10 * scale}" cy="${400 - 250 * scale}" r="${4.5 * scale}" fill="#1a1a24"/><circle cx="${120 + 28 * scale}" cy="${400 - 250 * scale}" r="${4.5 * scale}" fill="#1a1a24"/></g>
  </g>
</symbol>`;
}

export function mockCast(sp) {
  const p = sp.palette;
  const cast = sp.cast.map((c, i) => person(c.id, i ? p.accent2 : p.accent, '#E8B894', i ? 0.72 : 1,
    i ? `<path d="M${120 - 30} ${400 - 175} h60 v14 h-60z" fill="${p.sky2}"/>` : ''));
  const style = sp.cast.map((c, i) => `
.${c.id}-eyes{animation:${c.id}-blink ${3.6 + i * 0.9}s infinite;transform-box:fill-box;transform-origin:center}
@keyframes ${c.id}-blink{0%,94%,100%{transform:scaleY(1)}96%{transform:scaleY(.1)}}
.${c.id}-body{animation:${c.id}-breathe ${2.8 + i * 0.5}s ease-in-out infinite;transform-box:fill-box;transform-origin:bottom}
@keyframes ${c.id}-breathe{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.015)}}
.${c.id}-armR{animation:${c.id}-sway ${2.2 + i * 0.4}s ease-in-out infinite;transform-box:fill-box;transform-origin:top}
@keyframes ${c.id}-sway{0%,100%{transform:rotate(-6deg)}50%{transform:rotate(8deg)}}`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${240 * sp.cast.length} 400"><style>${style}</style><defs>${cast.join('\n')}</defs></svg>`;
}

export function mockShot({ sp, options, shot, duration: D }) {
  const { w, h } = ASPECTS[options.aspect] ?? ASPECTS['16:9'];
  const r = rng(shot.id), p = sp.palette;
  const night = r() < 0.35;
  const ground = h * 0.8;
  const hills = (y, amp, n, seed) => {
    const rr = rng(seed); let d = `M-80 ${h + 40} L-80 ${y}`;
    for (let i = 0; i <= n; i++) { const x = -80 + (i * (w + 160)) / n; d += ` Q${x - (w + 160) / n / 2} ${y - amp * (0.4 + rr())} ${x} ${y - amp * rr() * 0.3}`; }
    return `${d} L${w + 80} ${h + 40} Z`;
  };
  const size = { establishing: 0.26, wide: 0.32, medium: 0.55, close: 1.15, 'extreme-close': 1.6, insert: 0.9, 'over-shoulder': 0.7, pov: 0.4 }[shot.shotType] ?? 0.4;
  const ch = h * size, cw = ch * 0.6;
  const chars = shot.cast.map((id, i) => {
    const x0 = w * (0.18 + i * 0.22) - cw / 2, travel = size < 0.6 ? w * 0.18 : w * 0.04;
    const baseY = size > 1 ? h * 0.15 + ch * 0.75 : ground + 6;
    return `<g style="animation:walk${i} ${D}s linear both"><g class="bob${size < 0.6 ? '' : 'Slow'}"><use href="#cast-${id}" x="${x0.toFixed(0)}" y="${(baseY - ch).toFixed(0)}" width="${cw.toFixed(0)}" height="${ch.toFixed(0)}"/></g></g>
<style>@keyframes walk${i}{from{transform:translateX(0)}to{transform:translateX(${travel.toFixed(0)}px)}}</style>`;
  }).join('\n');
  const stars = night ? Array.from({ length: 40 }, () => `<circle cx="${(r() * w).toFixed(0)}" cy="${(r() * h * 0.5).toFixed(0)}" r="${(0.8 + r() * 1.8).toFixed(1)}" fill="#fff" style="animation:tw ${(1.5 + r() * 3).toFixed(1)}s ${(r() * -3).toFixed(1)}s ease-in-out infinite"/>`).join('') : '';
  const motes = Array.from({ length: 18 }, () => `<circle cx="${(r() * w).toFixed(0)}" cy="${(h * 0.3 + r() * h * 0.6).toFixed(0)}" r="${(1 + r() * 2.5).toFixed(1)}" fill="${p.accent}" opacity=".6" style="animation:rise ${(5 + r() * 6).toFixed(1)}s ${(r() * -8).toFixed(1)}s linear infinite"/>`).join('');
  const clouds = Array.from({ length: 4 }, (_, i) => `<g opacity="${night ? 0.25 : 0.7}" style="animation:drift ${(30 + r() * 30).toFixed(0)}s ${(-r() * 30).toFixed(0)}s linear infinite"><ellipse cx="${(r() * w).toFixed(0)}" cy="${(h * (0.12 + i * 0.07)).toFixed(0)}" rx="${(80 + r() * 90).toFixed(0)}" ry="${(16 + r() * 12).toFixed(0)}" fill="#fff"/></g>`).join('');
  const sunX = w * (0.25 + r() * 0.5), sunY = h * (0.22 + r() * 0.12);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${night ? p.bg : p.sky1}"/><stop offset="1" stop-color="${night ? p.sky1 : p.sky2}"/></linearGradient>
<radialGradient id="vig" cx=".5" cy=".5" r=".75"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>
<filter id="glow" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="18"/></filter>
</defs>
<style>
@keyframes tw{0%,100%{opacity:.2}50%{opacity:1}}
@keyframes rise{from{transform:translateY(0)}to{transform:translateY(-${(h * 0.5).toFixed(0)}px)}}
@keyframes drift{from{transform:translateX(-${w}px)}to{transform:translateX(${w}px)}}
@keyframes far{from{transform:translateX(0)}to{transform:translateX(-24px)}}
@keyframes mid{from{transform:translateX(0)}to{transform:translateX(-60px)}}
@keyframes near{from{transform:translateX(0)}to{transform:translateX(-140px)}}
@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
@keyframes sway{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}
.bob{animation:bob .48s ease-in-out infinite}
.bobSlow{animation:bob 2.6s ease-in-out infinite}
.sun{animation:pulse 5s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
.grass{animation:sway 3s ease-in-out infinite;transform-box:fill-box;transform-origin:bottom}
</style>
<rect x="-40" y="-40" width="${w + 80}" height="${h + 80}" fill="url(#sky)"/>
${stars}
<g class="sun"><circle cx="${sunX.toFixed(0)}" cy="${sunY.toFixed(0)}" r="${(h * 0.1).toFixed(0)}" fill="${night ? '#F6F1D5' : p.accent}" filter="url(#glow)" opacity=".8"/><circle cx="${sunX.toFixed(0)}" cy="${sunY.toFixed(0)}" r="${(h * 0.065).toFixed(0)}" fill="${night ? '#FFFDF0' : p.accent}"/></g>
${clouds}
<g style="animation:far ${D}s linear both"><path d="${hills(h * 0.58, h * 0.22, 5, shot.id + 'a')}" fill="${p.sky1}" opacity=".55"/></g>
<g style="animation:mid ${D}s linear both"><path d="${hills(h * 0.7, h * 0.16, 4, shot.id + 'b')}" fill="${p.accent2}" opacity=".85"/></g>
<rect x="-40" y="${ground.toFixed(0)}" width="${w + 80}" height="${(h - ground + 40).toFixed(0)}" fill="${p.shadow}"/>
${chars}
${motes}
<g style="animation:near ${D}s linear both">${Array.from({ length: 14 }, (_, i) => `<path class="grass" style="animation-delay:-${(r() * 3).toFixed(1)}s" d="M${(i * (w + 200) / 14 - 40).toFixed(0)} ${h + 10} q${(10 + r() * 20).toFixed(0)} -${(h * 0.12 + r() * h * 0.1).toFixed(0)} ${(30 + r() * 20).toFixed(0)} -${(h * 0.16).toFixed(0)} q-6 ${(h * 0.1).toFixed(0)} 12 ${(h * 0.16).toFixed(0)}z" fill="${p.shadow}"/>`).join('')}</g>
<rect x="-40" y="-40" width="${w + 80}" height="${h + 80}" fill="url(#vig)"/>
</svg>`;
}
