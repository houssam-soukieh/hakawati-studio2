// A fake text engine for testing the picture critic offline. Speaks both wire formats the Studio uses:
//   openai    POST /v1/chat/completions (or /chat/completions)   anthropic  POST /v1/messages
// streamed (SSE, the Studio always asks) or plain JSON (model name containing "nostream"). It really "looks" at the
// pictures: each image part must be base64 JPEG/PNG of at most 768 px, or the request fails with HTTP 400 like a real
// API; its mean colour is measured with ffmpeg and the critic's scores come from its brightness — so a test can prove
// which pictures arrived. Model names containing "blind" reject images (an engine without vision); "badjson" answers
// prose instead of JSON. GET /__log lists every request (images summarised).
//   node test/critic/fake-llm.mjs [port=4871]
import http from 'node:http';
import { spawnSync } from 'node:child_process';

const PORT = Number(process.argv[2] || process.env.FAKE_LLM_PORT || 4871);
const LOG = [];

function look(buf) { // → { w, h, rgb, luma } via ffmpeg (stdin → 1×1 average pixel)
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', '-i', 'pipe:0'], { input: buf });
  const [w, h] = String(probe.stdout).trim().split(',').map(Number);
  const px = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', 'pipe:0', '-vf', 'scale=1:1:flags=area,format=rgb24', '-f', 'rawvideo', 'pipe:1'], { input: buf, maxBuffer: 1 << 20 });
  const [r, g, b] = px.stdout;
  return { w, h, rgb: [r, g, b], luma: Math.round(0.299 * r + 0.587 * g + 0.114 * b) };
}

/** Normalise both formats to { system, parts: [{type:'text',text} | {type:'image', mime, buf, ...look}] }; throws on bad image parts. */
function parse(protocol, body) {
  const msgs = body.messages ?? [];
  const system = protocol === 'anthropic' ? body.system ?? '' : msgs.find(m => m.role === 'system')?.content ?? '';
  const content = msgs.find(m => m.role === 'user')?.content ?? '';
  const raw = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
  const parts = raw.map((p, i) => {
    if (p.type === 'text') return { type: 'text', text: p.text };
    let mime, data;
    if (protocol === 'anthropic') {
      if (p.type !== 'image' || p.source?.type !== 'base64') throw new Error(`content[${i}]: expected {type:"image", source:{type:"base64",…}}, got ${JSON.stringify(p).slice(0, 120)}`);
      ({ media_type: mime, data } = p.source);
    } else {
      if (p.type !== 'image_url') throw new Error(`content[${i}]: unknown part type ${p.type}`);
      const m = String(p.image_url?.url ?? '').match(/^data:(image\/[\w+.-]+);base64,([A-Za-z0-9+/=]+)$/);
      if (!m) throw new Error(`content[${i}]: image_url.url must be a base64 data: URL`);
      [, mime, data] = m;
    }
    const buf = Buffer.from(data, 'base64');
    const kind = buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : buf.subarray(1, 4).toString() === 'PNG' ? 'image/png' : null;
    if (!kind) throw new Error(`content[${i}]: the bytes are not a JPEG or PNG`);
    if (kind !== mime) throw new Error(`content[${i}]: declared ${mime} but the bytes are ${kind}`);
    const l = look(buf);
    if (!l.w || Math.max(l.w, l.h) > 768) throw new Error(`content[${i}]: ${l.w}×${l.h} — expected a picture shrunk to ≤768 px`);
    return { type: 'image', mime, bytes: buf.length, ...l };
  });
  return { system: typeof system === 'string' ? system : system.map(b => b.text).join('\n'), parts };
}

const colourName = ([r, g, b]) => (r > 150 && g < 90 && b < 90 ? 'Red' : g > 150 && r < 90 ? 'Green' : b > 150 && r < 90 ? 'Blue' : 'Grey');

function answer(model, { system, parts }) {
  const text = parts.filter(p => p.type === 'text').map(p => p.text).join('\n');
  const images = parts.filter(p => p.type === 'image');
  if (/badjson/.test(model)) return 'I think the second one looks nicer, honestly.';
  if (/picture critic/.test(system)) {
    // candidates = images right after a "CANDIDATE n" label; the brighter, the better (the fake ComfyUI paints corrected prompts bright)
    const cands = [];
    parts.forEach((p, i) => { if (p.type === 'image' && /^CANDIDATE \d+$/.test(parts[i - 1]?.text ?? '')) cands.push(p); });
    const scored = cands.map((c, k) => ({ n: k + 1, score: Math.max(1, Math.min(10, Math.round(c.luma / 20))), problems: c.luma < 140 ? ['too dark, murky', 'faces lost in shadow'] : ['slight softness'] }));
    const best = scored.reduce((a, b) => (b.score > a.score ? b : a), scored[0]);
    const prompt = text.match(/PROMPT THAT PAINTED THE CANDIDATES: (.*)/)?.[1] ?? '';
    const fixed = prompt.includes('bright clean daylight') ? prompt : `${prompt.replace(/,?\s*$/, '')}, (bright clean daylight:1.3), clear readable faces, natural hands, uncluttered composition`;
    return `Here is my review:\n\`\`\`json\n${JSON.stringify({ candidates: scored, best: best.n, critique: `Candidate ${best.n} is the clearest (luma ${cands[best.n - 1].luma}); ${best.problems.join(', ')}.`, fixPrompt: fixed })}\n\`\`\``;
  }
  if (images.length) return colourName(images[0].rgb);
  if (/You write prompts for an SDXL image model/.test(system)) {
    const see = text.match(/WHAT WE SEE: (.*)/)?.[1] ?? 'a quiet scene';
    return JSON.stringify({ prompt: `${see.slice(0, 220)}, cinematic film still, photorealistic, 35mm lens, shallow depth of field, volumetric light` });
  }
  const echo = text.match(/Reply with exactly: (.*)/);
  if (echo) return echo[1];
  return null;
}

function sse(res, events) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  for (const [name, ev] of events) res.write(`${name ? `event: ${name}\n` : ''}data: ${typeof ev === 'string' ? ev : JSON.stringify(ev)}\n\n`);
  res.end();
}

const chunks = s => s.match(/[\s\S]{1,17}/g) ?? [''];

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.method === 'GET' && url.pathname === '/__log') return send(200, LOG);
  if (req.method === 'GET' && /^(\/v1)?\/models$/.test(url.pathname)) return send(200, { data: [{ id: 'fake-vision' }, { id: 'fake-blind' }] });
  if (req.method !== 'POST') return send(404, { error: { message: 'not found' } });
  const protocol = url.pathname === '/v1/messages' ? 'anthropic' : /^(\/v1)?\/chat\/completions$/.test(url.pathname) ? 'openai' : null;
  if (!protocol) return send(404, { error: { message: `no route ${url.pathname}` } });
  if (!/^Bearer \S+/.test(req.headers.authorization ?? '') && !req.headers['x-api-key']) return send(401, { error: { message: 'no key' } });
  if (protocol === 'anthropic' && !req.headers['anthropic-version']) return send(400, { error: { message: 'anthropic-version header required' } });
  let body = '';
  for await (const c of req) body += c;
  body = JSON.parse(body);
  const row = { at: new Date().toISOString(), protocol, model: body.model, stream: !!body.stream, temperature: body.temperature };
  LOG.push(row);
  let msg;
  try {
    msg = parse(protocol, body);
    row.images = msg.parts.map((p, i) => (p.type === 'image' ? { label: msg.parts[i - 1]?.type === 'text' ? msg.parts[i - 1].text.slice(0, 60) : '', mime: p.mime, bytes: p.bytes, w: p.w, h: p.h, luma: p.luma } : null)).filter(Boolean);
    row.kind = /picture critic/.test(msg.system) ? 'critic' : row.images.length ? 'probe' : /SDXL/.test(msg.system) ? 'prompt' : 'text';
    if (row.images.length && /blind/.test(body.model)) throw new Error('this model does not accept image input');
  } catch (e) {
    row.error = e.message;
    return send(400, { error: { type: 'invalid_request_error', message: e.message } });
  }
  const text = answer(body.model, msg);
  if (text == null) { row.error = 'unsupported request'; return send(400, { error: { message: 'fake-llm: unsupported request' } }); }
  row.reply = text.slice(0, 300);
  const usage = { in: 50 + msg.parts.reduce((n, p) => n + (p.type === 'image' ? Math.round(p.w * p.h / 750) : Math.ceil(p.text.length / 4)), 0), out: Math.ceil(text.length / 4) };
  if (protocol === 'anthropic') {
    if (!body.stream || /nostream/.test(body.model)) return send(200, { type: 'message', role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: usage.in, output_tokens: usage.out } });
    return sse(res, [
      ['message_start', { type: 'message_start', message: { usage: { input_tokens: usage.in, output_tokens: 1 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ...chunks(text).map(d => ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: d } }]),
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: usage.out } }],
      ['message_stop', { type: 'message_stop' }],
    ]);
  }
  if (!body.stream || /nostream/.test(body.model)) return send(200, { choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: usage.in, completion_tokens: usage.out } });
  return sse(res, [
    ...chunks(text).map(d => [null, { choices: [{ index: 0, delta: { content: d } }] }]),
    [null, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: usage.in, completion_tokens: usage.out } }],
    [null, '[DONE]'],
  ]);
}).listen(PORT, '127.0.0.1', () => console.log(`fake-llm on http://127.0.0.1:${PORT}`));
