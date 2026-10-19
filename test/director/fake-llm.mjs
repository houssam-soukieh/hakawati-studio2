// A stand-in language model for tests (no real LLM host is reachable from CI). Speaks both wire formats the
// Studio uses — OpenAI POST /v1/chat/completions and Anthropic POST /v1/messages — streamed as SSE in small
// chunks, like a real gateway. It recognises who is asking from the prompts (director, script doctor, revision,
// picture-prompt writer), answers with canned but realistic JSON, and records every request.
//   const fake = await startFakeLLM();  fake.queue.push({ role: 'doctor', text: 'not json' });  … fake.requests
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const fixture = name => JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', `${name}.json`), 'utf8'));

export const PICTURE_PROMPT = '[[layla]] standing at the left third of the flat rooftop, lantern raised high in her right hand, face tilted up in wonder, [[fox]] sitting at her feet looking up, clay jars and a washing line on the right, medium shot, eye level, quiet awe';

/** Which call is this? Decided from the prompts, the way a human reading the logs would. */
export function roleOf(system, user) {
  if (/script doctor/i.test(system)) return 'doctor';
  if (user.includes("THE SCRIPT DOCTOR'S NOTES")) return 'revise';
  if (/SHOOTING SCRIPT/.test(system)) return 'director';
  if (/SDXL image model/.test(system)) return 'prompt';
  return 'other';
}

function defaultAnswer(role, n) {
  if (role === 'director') return `Here is the shooting script.\n\`\`\`json\n${JSON.stringify(fixture('draft'), null, 2)}\n\`\`\``; // chatter + fence, like real models
  if (role === 'doctor') return JSON.stringify(fixture(n === 1 ? 'doctor-1' : 'doctor-2'));
  if (role === 'revise') return JSON.stringify(fixture('revised'));
  if (role === 'prompt') return JSON.stringify({ prompt: PICTURE_PROMPT });
  return 'Ready ✓';
}

const chunks = (s, n = 48) => Array.from({ length: Math.ceil(s.length / n) }, (_, i) => s.slice(i * n, i * n + n));

function streamOpenAI(res, text) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
  const ev = o => res.write(`data: ${JSON.stringify(o)}\n\n`);
  ev({ id: 'chatcmpl-fake', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] });
  for (const c of chunks(text)) ev({ id: 'chatcmpl-fake', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: c } }] });
  ev({ id: 'chatcmpl-fake', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: Math.ceil(text.length / 4) } });
  res.end('data: [DONE]\n\n');
}

function streamAnthropic(res, text) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
  const ev = (type, o) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`);
  ev('message_start', { message: { id: 'msg_fake', type: 'message', role: 'assistant', content: [], usage: { input_tokens: 1000, output_tokens: 1 } } });
  ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
  ev('ping', {});
  for (const c of chunks(text)) ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: c } });
  ev('content_block_stop', { index: 0 });
  ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: Math.ceil(text.length / 4) } });
  ev('message_stop', {});
  res.end();
}

export async function startFakeLLM() {
  const requests = [], queue = [], counts = {}, served = {}; // served: canned (unscripted) answers per role
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', d => { raw += d; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw); } catch { /* recorded as is */ }
      const anthropic = req.url === '/v1/messages';
      if (req.method !== 'POST' || !(anthropic || req.url === '/v1/chat/completions')) { res.writeHead(404); return res.end('{"error":"not found"}'); }
      const system = anthropic ? String(body.system ?? '') : String(body.messages?.find(m => m.role === 'system')?.content ?? '');
      const user = String(body.messages?.filter(m => m.role === 'user').at(-1)?.content ?? '');
      const role = roleOf(system, user);
      counts[role] = (counts[role] ?? 0) + 1;
      requests.push({ path: req.url, role, n: counts[role], headers: { authorization: req.headers.authorization, 'x-api-key': req.headers['x-api-key'], 'anthropic-version': req.headers['anthropic-version'] }, body, system, user });
      const i = queue.findIndex(q => q.role === role);
      const scripted = i >= 0 ? queue.splice(i, 1)[0] : null;
      if (scripted?.status) { res.writeHead(scripted.status, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: scripted.text ?? 'scripted failure' } })); }
      const text = scripted ? (scripted.json ? JSON.stringify(scripted.json) : scripted.text) : defaultAnswer(role, (served[role] = (served[role] ?? 0) + 1));
      (anthropic ? streamAnthropic : streamOpenAI)(res, text);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    port, requests, queue,
    roles: () => requests.map(r => r.role),
    reset() { requests.length = 0; queue.length = 0; for (const o of [counts, served]) for (const k of Object.keys(o)) delete o[k]; },
    close: () => new Promise(r => server.close(r)),
  };
}

// `node test/director/fake-llm.mjs` → serve until stopped (point the Studio's Settings at it by hand).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const f = await startFakeLLM();
  console.log(`fake LLM on http://127.0.0.1:${f.port}  (openai base: /v1, anthropic base: /)`);
}
