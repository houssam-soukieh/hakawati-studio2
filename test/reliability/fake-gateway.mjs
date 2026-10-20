// A fake text engine that misbehaves on demand, like a throttling reseller. Speaks both formats the Studio uses, streamed:
// Anthropic POST /v1/messages (CodeCraft) and OpenAI POST /v1/chat/completions (LM Studio). Modes:
//   'ok'        a normal streamed answer
//   'empty'     HTTP 200, a stream with message_start/message_stop and no text ("Empty answer from the engine")
//   'midstream' the answer starts (headers, message_start, a few words) and then the stream goes silent forever
//   'headers'   headers flushed, then nothing at all on the open connection
//   'nothing'   the request is read and never answered (no headers)
//   '429'       HTTP 429 (retryable)        '400'  HTTP 400 (not retryable)
// state.hook(call) → one of those (default 'ok'); call = { n, kind, text, images, model }. kind: 'critic' | 'probe' |
// 'prompt' (SDXL shot prompt) | 'text'. state.score(call) → the critic's scores for its candidates (default 8 each).
// state.blind = true → the vision check is answered "I cannot see pictures" (a text-only local model).
// It counts calls in flight (all, and those carrying pictures), measures every picture (JPEG/PNG header) and records
// whether a stalled connection was closed by the client.
//   import { startFakeGateway } from './fake-gateway.mjs' → { url, state, close() }
import http from 'node:http';

/** Width × height from a JPEG (SOF marker) or PNG (IHDR) header. */
export function imageSize(buf) {
  if (buf[0] === 0x89 && buf.toString('latin1', 12, 16) === 'IHDR') return { mime: 'image/png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  for (let o = 2; o + 9 < buf.length;) {
    if (buf[o] !== 0xff) { o++; continue; }
    const m = buf[o + 1], len = buf.readUInt16BE(o + 2);
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { mime: 'image/jpeg', h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
    o += 2 + len;
  }
  return null;
}

const FIX = 'a single figure alone in the frame, (correct light and time of day:1.3), the lens and framing the shot asks for, nothing duplicated, no text anywhere, clean background, cinematic film still, photorealistic, natural colours, sharp focus, soft shadows, calm mood, room for the camera move';

function answer(call, state) {
  if (call.kind === 'critic') {
    const n = call.labels.filter(l => /^CANDIDATE \d+$/.test(l)).length;
    const scores = state.score(call, n) ?? Array(n).fill(8);
    const best = scores.indexOf(Math.max(...scores)) + 1;
    return JSON.stringify({ candidates: scores.map((score, i) => ({ n: i + 1, score, problems: score < 7 ? ['wrong light'] : ['slight softness'] })), best, critique: `fake critique, best ${Math.max(...scores)}/10`, fixPrompt: FIX });
  }
  if (call.kind === 'probe') return state.blind ? 'I cannot see pictures, sorry.' : 'Red';
  if (call.kind === 'prompt') return JSON.stringify({ prompt: `${(call.text.match(/WHAT WE SEE: (.*)/)?.[1] ?? 'a quiet scene').slice(0, 200)}, medium shot, soft window light, calm mood, cinematic composition, natural colours` });
  return call.text.match(/Reply with exactly: (.*)/)?.[1] ?? 'All right, here is a complete answer from the fake gateway.';
}

export function startFakeGateway({ port = 0, delay = 0 } = {}) {
  const state = {
    hook: () => 'ok', score: () => null, delay, blind: false,
    calls: [], inFlight: 0, maxInFlight: 0, vision: 0, maxVision: 0, closedStalls: 0, openStalls: new Set(),
  };
  const server = http.createServer(async (req, res) => {
    const protocol = req.url === '/v1/messages' ? 'anthropic' : req.url === '/v1/chat/completions' ? 'openai' : null;
    if (req.method !== 'POST' || !protocol) { res.writeHead(404).end(); return; }
    let raw = '';
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    const user = body.messages?.find(m => m.role === 'user')?.content;
    const parts = typeof user === 'string' ? [{ type: 'text', text: user }] : user;
    const labels = [], images = [];
    for (const [i, p] of parts.entries()) {
      if (p.type === 'text') labels.push(p.text);
      else {
        const [, mime, data] = protocol === 'anthropic' ? [null, p.source.media_type, p.source.data] : String(p.image_url?.url).match(/^data:([^;]+);base64,(.*)$/) ?? [];
        const size = imageSize(Buffer.from(data ?? '', 'base64'));
        images.push({ ...size, declared: mime, label: parts[i - 1]?.type === 'text' ? parts[i - 1].text.slice(0, 40) : '' });
      }
    }
    const text = labels.join('\n'), system = String(protocol === 'anthropic' ? body.system ?? '' : body.messages?.find(m => m.role === 'system')?.content ?? '');
    const kind = /picture critic/.test(system) ? 'critic' : images.length ? 'probe' : /SDXL image model/.test(system) ? 'prompt' : 'text';
    const call = { n: state.calls.length + 1, protocol, kind, text, labels, images, model: body.model, auth: req.headers.authorization ?? '', at: Date.now() };
    state.calls.push(call);
    const seeing = images.length > 0;
    state.inFlight++; state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    if (seeing) { state.vision++; state.maxVision = Math.max(state.maxVision, state.vision); }
    let left = false;
    const leave = () => { if (left) return; left = true; state.inFlight--; if (seeing) state.vision--; };
    res.on('finish', leave); res.on('close', leave);
    const mode = state.hook(call);
    call.mode = mode;
    if (state.delay) await new Promise(r => setTimeout(r, state.delay));
    const sse = (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    const oai = data => res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
    const stall = () => { // keep the connection open and silent; note when the client gives up on it
      state.openStalls.add(res);
      res.on('close', () => { state.openStalls.delete(res); state.closedStalls++; });
    };
    if (mode === '400') { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'bad request' } })); return; }
    if (mode === '429') { res.writeHead(429, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'slow down' } })); return; }
    if (mode === 'nothing') { stall(); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.flushHeaders();
    if (mode === 'headers') { stall(); return; }
    if (protocol === 'openai') {
      const out = mode === 'empty' ? '' : answer(call, state);
      const chunks = out ? out.match(/[\s\S]{1,40}/g) : [];
      for (const d of mode === 'midstream' ? chunks.slice(0, 2) : chunks) oai({ choices: [{ index: 0, delta: { content: d } }] });
      if (mode === 'midstream') { stall(); return; }
      oai({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: Math.ceil(out.length / 4) } });
      oai('[DONE]');
      res.end();
      return;
    }
    sse('message_start', { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1 } } });
    if (mode === 'empty') { sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 0 } }); sse('message_stop', { type: 'message_stop' }); res.end(); return; }
    const out = answer(call, state);
    sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    const chunks = out.match(/[\s\S]{1,40}/g) ?? [''];
    if (mode === 'midstream') { for (const d of chunks.slice(0, 2)) sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: d } }); stall(); return; }
    for (const d of chunks) sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: d } });
    sse('content_block_stop', { type: 'content_block_stop', index: 0 });
    sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: Math.ceil(out.length / 4) } });
    sse('message_stop', { type: 'message_stop' });
    res.end();
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`, state,
    close: () => new Promise(r => { for (const s of state.openStalls) s.destroy(); server.closeAllConnections?.(); server.close(() => r()); }),
  })));
}
