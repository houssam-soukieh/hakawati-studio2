// SVG hygiene for model-written art: pull the SVG out of the answer, strip anything active or external,
// and inject the film's cast library so shots can <use href="#cast-…"> the same characters.

/** The SVG inside an answer (code fences, chatter and a cut-off tail are tolerated up to the last </svg>). */
export function extractSvg(text) {
  const a = text.indexOf('<svg');
  const b = text.lastIndexOf('</svg>');
  if (a < 0 || b < a) throw new Error('no complete <svg>…</svg> in the answer');
  return text.slice(a, b + 6);
}

/** Remove scripts, event handlers, foreignObject, external references. Returns {svg, removed[]} */
export function sanitize(svg) {
  const removed = [];
  const drop = (re, what) => { svg = svg.replace(re, () => { removed.push(what); return ''; }); };
  drop(/<script[\s\S]*?<\/script\s*>/gi, 'script');
  drop(/<script[^>]*\/>/gi, 'script');
  drop(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, 'foreignObject');
  drop(/<image\b[^>]*>(?:\s*<\/image>)?/gi, 'image');
  drop(/<iframe[\s\S]*?<\/iframe\s*>/gi, 'iframe');
  drop(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, 'event handler');
  drop(/@import[^;]+;/gi, '@import');
  svg = svg.replace(/\s(?:xlink:)?href\s*=\s*("|')\s*(?:https?:|javascript:|\/\/)[^"']*\1/gi, () => { removed.push('external link'); return ''; });
  svg = svg.replace(/url\(\s*['"]?\s*(?:https?:|\/\/)[^)]*\)/gi, () => { removed.push('external url()'); return 'none'; });
  return { svg, removed };
}

/** Make sure the root has xmlns + the canvas viewBox; drop fixed width/height (the player sizes it). */
export function normalizeRoot(svg, w, h) {
  return svg.replace(/<svg\b([^>]*)>/, (m, attrs) => {
    let a = attrs.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/g, '');
    if (!/xmlns\s*=/.test(a)) a = ` xmlns="http://www.w3.org/2000/svg"${a}`;
    if (!/xmlns:xlink/.test(a) && /xlink:href/.test(svg)) a += ' xmlns:xlink="http://www.w3.org/1999/xlink"';
    if (!/viewBox\s*=/.test(a)) a += ` viewBox="0 0 ${w} ${h}"`;
    if (!/preserveAspectRatio/.test(a)) a += ' preserveAspectRatio="xMidYMid slice"';
    return `<svg${a}>`;
  });
}

/**
 * Replace every <use href="#cast-…"> with a real copy of the character (a nested <svg> with the symbol's
 * viewBox). Animations inside <use> shadow trees are invisible to document.getAnimations(), so they could not
 * be paused and seeked frame by frame; real copies can. Library <style> and other <defs> are injected once.
 */
export function expandCast(svg, castSvg) {
  if (!castSvg) return svg;
  const symbols = new Map();
  for (const m of castSvg.matchAll(/<symbol\b([^>]*)>([\s\S]*?)<\/symbol>/gi)) {
    const id = m[1].match(/\bid\s*=\s*"([^"]+)"/)?.[1];
    if (id) symbols.set(id, { viewBox: m[1].match(/viewBox\s*=\s*"([^"]+)"/)?.[1] ?? '0 0 240 400', inner: m[2] });
  }
  const style = [...castSvg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
  const otherDefs = [...castSvg.matchAll(/<defs[^>]*>([\s\S]*?)<\/defs>/gi)].map(m => m[1].replace(/<symbol\b[\s\S]*?<\/symbol>/gi, '')).join('\n');
  const attr = (a, n) => a.match(new RegExp(`(?:^|\\s)${n}\\s*=\\s*("([^"]*)"|'([^']*)')`))?.slice(2).find(v => v !== undefined);
  let out = svg.replace(/<use\b([^>]*?)(?:\/>|>\s*<\/use>)/gi, (m, a) => {
    const ref = (attr(a, 'href') ?? attr(a, 'xlink:href') ?? '').replace(/^#/, '');
    const sym = symbols.get(ref);
    if (!sym) return m;
    const [, , vw, vh] = sym.viewBox.split(/[\s,]+/).map(Number);
    const x = attr(a, 'x') ?? 0, y = attr(a, 'y') ?? 0, w = attr(a, 'width') ?? vw, h = attr(a, 'height') ?? vh;
    const keep = ['transform', 'class', 'style', 'opacity', 'filter', 'clip-path', 'mask'].map(n => { const v = attr(a, n); return v !== undefined ? ` ${n}="${v.replace(/"/g, '&quot;')}"` : ''; }).join('');
    return `<g${keep} data-cast="${ref}"><svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${sym.viewBox}" preserveAspectRatio="xMidYMax meet" overflow="visible">${sym.inner}</svg></g>`;
  });
  if (style || otherDefs) out = out.replace(/<svg\b[^>]*>/, m => `${m}\n<defs>${style ? `<style>${style}</style>` : ''}${otherDefs}</defs>`);
  return out;
}

/** Symbol ids (and their viewBox) defined in the cast library. */
export function librarySymbols(castSvg) {
  return [...String(castSvg ?? '').matchAll(/<symbol\b[^>]*\bid\s*=\s*"([^"]+)"[^>]*>/gi)].map(m => {
    const vb = m[0].match(/viewBox\s*=\s*"([^"]+)"/i)?.[1] ?? '0 0 240 400';
    return { id: m[1], viewBox: vb };
  });
}

/** Static checks that need no browser. Returns a list of problems (empty = fine). */
export function lint(svg, { castSvg } = {}) {
  const issues = [];
  if (svg.length > 120_000) issues.push(`the SVG is ${Math.round(svg.length / 1024)} KB — keep it under 60 KB (simpler paths, reuse with <use>)`);
  const known = new Set(librarySymbols(castSvg).map(s => s.id));
  for (const m of svg.matchAll(/href\s*=\s*"#(cast-[\w-]+)"/g)) if (!known.has(m[1])) issues.push(`<use href="#${m[1]}"> refers to a character that is not in the cast library (available: ${[...known].join(', ') || 'none'})`);
  const defined = new Set([...svg.matchAll(/\bid\s*=\s*"([^"]+)"/g)].map(m => m[1]));
  for (const k of known) defined.add(k);
  const missing = new Set();
  for (const m of svg.matchAll(/(?:href\s*=\s*"#|url\(#)([\w.-]+)/g)) if (!defined.has(m[1])) missing.add(m[1]);
  if (missing.size) issues.push(`these ids are referenced but never defined: ${[...missing].slice(0, 12).join(', ')}`);
  if (!/@keyframes|<animate/i.test(svg)) issues.push('there is no animation at all — every shot needs story motion plus ambient motion');
  return issues;
}
