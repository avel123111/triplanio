// Vercel Serverless Function — same-origin API façade for edge functions
// (TRIP-432, Ф1 «FE↔backend транспортная развязка»).
//
// The browser calls `/<host>/api/<fn>` (see src/lib/edgeTransport.js); a
// vercel.json rewrite `/api/:path(.*)` → `/api/proxy?path=:path` sends it here,
// and this function forwards to `<supabase>/functions/v1/<fn>`. The explicit
// rewrite (the SAME mechanism as the working `/ingest` proxy) is used instead of
// a filesystem catch-all (`api/[...path].js`) because that catch-all did not
// match MULTI-SEGMENT subpaths (`/api/trip-chat/send` → 404) on this project,
// while a `:path(.*)` rewrite matches any depth.
//
// Why a function and NOT a managed CDN rewrite straight to Supabase: a managed
// rewrite to an external host does not carry the caller's `Authorization: Bearer
// <jwt>` — the token never reaches Supabase (getMe → UNAUTHORIZED_ASYMMETRIC_JWT).
// A function receives the request same-origin (nothing stripped) and re-sends
// the headers itself, so the user token survives. It does THREE things:
//   1. Per-env routing — upstream origin from `VITE_SUPABASE_URL` (the same env
//      the frontend build uses → same project as auth, no cross-env mismatch).
//   2. Real client-IP forwarding — drop client-supplied forwarding headers, set
//      one clean `x-forwarded-for` from Vercel's trusted IP (rate-limit safe).
//      Supabase's own gateway OVERWRITES `x-forwarded-for`/`x-real-ip` with the
//      IP of THIS proxy (a couple of Vercel egress IPs), so the DB-side per-IP
//      rate-limit (signupPrecheck / requestPasswordReset) would collapse every
//      user onto those few IPs. To carry the real client IP past that gateway we
//      also stamp a bespoke `x-triplanio-client-ip` header (which the gateway
//      leaves untouched), authenticated by a shared `x-triplanio-proxy-secret`
//      so a direct caller hitting Supabase cannot forge it (rateLimit.ts trusts
//      the client-ip header ONLY when the secret matches).
//   3. NO apikey injection — the browser sends the public anon key just as the
//      SDK did; both `apikey` and `Authorization` are forwarded untouched.
//
// Node runtime + `maxDuration` covers slow AI functions (parseBookingWithAi /
// planTripWithAi / callTriplanioAi via n8n→LLM). On Fluid Compute the time spent
// awaiting Supabase is I/O wait, not billed CPU.

export const config = { maxDuration: 60 };

// NOTE (TRIP-373): `sentry-trace` / `baggage` are deliberately NOT stripped — they
// carry the browser's trace context and must reach the edge for the browser
// transaction and the edge error to stitch into one trace. Do not add them here.
const STRIP_REQUEST = new Set([
  'host', 'connection', 'content-length', 'cookie',
  'x-forwarded-for', 'x-real-ip', 'x-forwarded-host', 'forwarded',
  // Never let a caller supply these — the proxy is their sole author below, so a
  // spoofed client-ip (or a guessed secret) from the browser is dropped first.
  'x-triplanio-client-ip', 'x-triplanio-proxy-secret',
]);
const STRIP_RESPONSE = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection']);

/** Shared secret proving a request carrying `x-triplanio-client-ip` came from
 * THIS proxy. Absent → we send no secret and rateLimit.ts keeps its XFF fallback
 * (safe staged rollout: set the env on Vercel + Supabase to activate). */
const PROXY_SHARED_SECRET = process.env.PROXY_SHARED_SECRET || '';

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

  // The `?path=<fn>` the vercel.json rewrite captured (`account/profile`,
  // `trip-chat/send`, `getMe` — any depth). Array form guards against a repeated
  // param; join preserves subpath slashes.
  const raw = req.query?.path;
  const tail = Array.isArray(raw) ? raw.join('/') : (raw || '');
  const upstream = `${origin.replace(/\/$/, '')}/functions/v1/${tail}`;

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (STRIP_REQUEST.has(k.toLowerCase())) continue;
    headers[k] = Array.isArray(v) ? v.join(',') : v;
  }
  const ip = clientIp(req);
  if (ip) {
    headers['x-forwarded-for'] = ip;
    headers['x-real-ip'] = ip;
    // Carry the real client IP past Supabase's gateway (which rewrites the two
    // headers above); only trusted when the shared secret rides along.
    if (PROXY_SHARED_SECRET) {
      headers['x-triplanio-client-ip'] = ip;
      headers['x-triplanio-proxy-secret'] = PROXY_SHARED_SECRET;
    }
  }

  // The transport only ever sends JSON, so re-serialising the parsed body is
  // faithful and avoids depending on raw-stream availability under Vercel.
  const method = req.method || 'POST';
  let body;
  if (method !== 'GET' && method !== 'HEAD' && req.body != null) {
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }

  let upstreamRes;
  try {
    upstreamRes = await fetch(upstream, { method, headers, body, redirect: 'manual' });
  } catch {
    res.status(502).json({ error: 'api_proxy_upstream', code: 'api_proxy_upstream' });
    return;
  }

  res.status(upstreamRes.status);
  upstreamRes.headers.forEach((val, key) => {
    if (!STRIP_RESPONSE.has(key.toLowerCase())) res.setHeader(key, val);
  });
  res.send(Buffer.from(await upstreamRes.arrayBuffer()));
}
