// Vercel Serverless Function — same-origin API façade for edge functions
// (Ф1 эпика «FE↔backend транспортная развязка»).
//
// The browser calls `/<host>/api/<fn>` (see src/lib/edgeTransport.js); this
// function forwards it to `<supabase>/functions/v1/<fn>`. Why a function and NOT
// a Vercel CDN Routing Rule / vercel.json rewrite: a managed rewrite to an
// EXTERNAL host does not carry the caller's `Authorization: Bearer <jwt>` — the
// browser token never reaches Supabase, so every authenticated edge call fails
// `UNAUTHORIZED_ASYMMETRIC_JWT` (Supabase then only sees the anon `apikey`).
// A function receives the browser request same-origin (nothing stripped) and
// re-sends the headers itself via `fetch`, so the user token survives. Vercel's
// own docs forward auth tokens through a function for exactly this reason.
//
// It does THREE things and nothing more:
//   1. Per-environment routing — upstream origin from `VITE_SUPABASE_URL`
//      (`triplanio.com/api` → prod project, `dev.triplanio.com/api` → dev).
//   2. Real client-IP forwarding — drop any client-supplied forwarding headers,
//      set one clean `x-forwarded-for` from Vercel's trusted IP, so Supabase's
//      IP rate-limit (`_shared/rateLimit.ts`) neither collapses nor is spoofable.
//   3. NO apikey injection — the browser sends the public anon key just as the
//      SDK did; both `apikey` and `Authorization` are forwarded untouched.
//
// Node runtime (NOT edge) on purpose: `maxDuration` covers slow AI functions
// (parseBookingWithAi / planTripWithAi / callTriplanioAi go through n8n→LLM).
// On Fluid Compute the time awaiting Supabase is I/O wait, not billed CPU.

export const config = { maxDuration: 60 };

// Headers we must not copy onward: host/content-length break the upstream
// request; cookie carries app state Supabase never needs; the forwarding
// headers are rebuilt from a trusted source below so a client can't forge them.
// NB: `authorization` and `apikey` are deliberately NOT here — they must pass.
const STRIP_REQUEST = new Set([
  'host', 'connection', 'content-length', 'cookie',
  'x-forwarded-for', 'x-real-ip', 'x-forwarded-host', 'forwarded',
]);
// fetch() already decompressed the body, so a stale content-encoding/length
// would corrupt it; Node recomputes length for the buffer we send.
const STRIP_RESPONSE = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection']);

/** Trusted client IP set by Vercel's proxy (not the client-supplied value). */
function clientIp(req) {
  const real = req.headers['x-real-ip'];
  if (real) return String(real).trim();
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return '';
}

export default async function handler(req, res) {
  const origin = process.env.VITE_SUPABASE_URL;
  if (!origin) {
    res.status(500).json({ error: 'api_proxy_misconfigured', code: 'api_proxy_misconfigured' });
    return;
  }

  // `/api/trip-route/city/add?x=1` → `trip-route/city/add?x=1` (subpaths kept).
  const tail = req.url.replace(/^\/api\//, '');
  const upstream = `${origin.replace(/\/$/, '')}/functions/v1/${tail}`;

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (STRIP_REQUEST.has(k.toLowerCase())) continue;
    headers[k] = Array.isArray(v) ? v.join(',') : v;
  }
  const ip = clientIp(req);
  if (ip) { headers['x-forwarded-for'] = ip; headers['x-real-ip'] = ip; }

  // The transport only ever sends JSON, so re-serialising the parsed body is
  // faithful and avoids depending on raw-stream availability under Vercel's
  // body parsing.
  const method = req.method || 'POST';
  let body;
  if (method !== 'GET' && method !== 'HEAD' && req.body != null) {
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }

  let upstreamRes;
  try {
    upstreamRes = await fetch(upstream, { method, headers, body, redirect: 'manual' });
  } catch {
    // Never reached Supabase — surface a canonical error so parseEdgeError and
    // Sentry treat it like any relay failure, not a mystery HTML 500.
    res.status(502).json({ error: 'api_proxy_upstream', code: 'api_proxy_upstream' });
    return;
  }

  res.status(upstreamRes.status);
  upstreamRes.headers.forEach((val, key) => {
    if (!STRIP_RESPONSE.has(key.toLowerCase())) res.setHeader(key, val);
  });
  res.send(Buffer.from(await upstreamRes.arrayBuffer()));
}
