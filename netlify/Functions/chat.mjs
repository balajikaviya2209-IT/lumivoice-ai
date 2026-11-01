/* Lumi AI chat relay as a Netlify Function (replaces server.js).
   Receives POST /api/chat { system?, messages:[{role,content}] } and returns { text }.
   Your API key lives only in Netlify's environment variables. Zero dependencies. */
import { createHash, timingSafeEqual } from 'node:crypto';

const env = k => process.env[k] || '';
const MODEL = env('ANTHROPIC_MODEL') || 'claude-sonnet-5-5';
const API_URL = env('ANTHROPIC_API_URL') || 'https://api.anthropic.com/v1/messages';
const MAX_TOKENS = +env('MAX_TOKENS') || 700;
const RATE = +env('RATE_LIMIT_PER_MIN') || 20;
const DAILY = +env('DAILY_LIMIT') || 500;

function json(status, obj, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra }
  });
}

/* --- abuse limits ---
   Kept in memory, so they are per running copy of the function and reset when it goes idle.
   They slow down abuse but are not exact. APP_PASSCODE and your Anthropic spend limit are the real protection. */
const hits = new Map();
let day = new Date().toISOString().slice(0, 10), dayCount = 0;
function limited(ip) {
  const now = Date.now();
  for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  const h = hits.get(ip);
  if (!h) { hits.set(ip, { n: 1, reset: now + 60000 }); return false; }
  return ++h.n > RATE;
}
function overDaily() {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== day) { day = d; dayCount = 0; }
  return ++dayCount > DAILY;
}
function passOk(req) {
  const pass = env('APP_PASSCODE');
  if (!pass) return true;
  const a = createHash('sha256').update(String(req.headers.get('x-lumi-passcode') || '')).digest();
  const b = createHash('sha256').update(pass).digest();
  return timingSafeEqual(a, b);
}

function validate(b) {
  if (!b || typeof b !== 'object') return null;
  const system = typeof b.system === 'string' ? b.system.slice(0, 4000) : '';
  if (!Array.isArray(b.messages) || b.messages.length < 1 || b.messages.length > 40) return null;
  let total = 0; const messages = [];
  for (const m of b.messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') return null;
    if (m.content.length > 30000) return null;
    total += m.content.length; messages.push({ role: m.role, content: m.content });
  }
  if (total > 120000) return null;
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== 'user') return null;
  return { system, messages };
}

export default async (req, context) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' }, { Allow: 'POST' });
  if (!passOk(req)) return json(401, { error: 'unauthorized' });
  const ip = (context && context.ip) || String(req.headers.get('x-nf-client-connection-ip') || 'unknown');
  if (limited(ip)) return json(429, { error: 'rate_limited' });
  if (overDaily()) return json(429, { error: 'daily_limit' });
  const key = env('ANTHROPIC_API_KEY');
  if (!key) return json(503, { error: 'server_not_configured' });

  let body = null;
  try {
    const raw = await req.text();
    if (raw.length <= 300000) body = validate(JSON.parse(raw));
  } catch (e) { body = null; }
  if (!body) return json(400, { error: 'bad_request' });

  // Netlify limits how long a function may run, so give up a little before that.
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(API_URL, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, ...(body.system ? { system: body.system } : {}), messages: body.messages })
    });
    if (!r.ok) {
      console.error('upstream status', r.status);                       // never log message content
      return json(r.status === 429 ? 429 : 502, { error: r.status === 429 ? 'rate_limited' : 'upstream_error' });
    }
    const data = await r.json();
    const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    return json(200, { text });
  } catch (e) {
    console.error('upstream failure', e && e.name);
    return json(502, { error: 'upstream_error' });
  } finally { clearTimeout(timer); }
};

export const config = { path: '/api/chat' };
