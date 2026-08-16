// Browser transport for edge functions — same-origin `/api/*` instead of the
// Supabase SDK's `functions.invoke` (TRIP-432, Ф1 «FE↔backend транспортная развязка»).
//
// Why this exists: `functions.invoke` hard-codes the vendor URL
// (`<ref>.supabase.co/functions/v1/…`). Routing edge calls through our own
// same-origin `/api/<fn>` gives us the `triplanio.com/api` surface, WITHOUT the
// FE ever importing a vendor URL. The `/api/<fn>` → `<supabase>/functions/v1/<fn>`
// hop is a Vercel serverless function (`api/[...path].js`) — NOT a managed CDN
// rewrite, which silently drops the caller's `Authorization` on a cross-host
// proxy and breaks every authenticated call; the function forwards it.
//
// It faithfully mirrors what the SDK put on the wire — `apikey` + `Authorization`
// — so nothing downstream changes. `apikey` is the ANON key: public by design,
// already in the bundle, carries no identity; sending it from the browser is the
// same posture as the SDK today. `Authorization: Bearer <jwt>` is what actually
// identifies the user (falling back to the anon key when there is no session,
// exactly like supabase-js).
//
// It returns supabase-js's EXACT `{ data, error }` contract, so `invokeFn` and
// every one of the 86 call-sites stay byte-for-byte unchanged:
//   • 2xx           → { data: <parsed JSON body>, error: null }
//   • non-2xx       → { data: null, error: Error whose `.context` is the Response }
//   • network/relay → { data: null, error: <the thrown error>, no `.context` }
// `parseEdgeError` reads `error.context.json()` (a Response body is readable
// once) and call-sites read `error.context.status`, so `.context` MUST be the
// raw, unread Response — mirroring supabase-js's `FunctionsHttpError`.
//
// Pure factory (no module-level `supabase` import) so it unit-tests without the
// network — the same shape as `createAuthRetryFetch`. Inject `doFetch` (wrap it
// in `createAuthRetryFetch` at the call-site to keep the 401→refresh→replay
// recovery, TRIP-56), `getToken`, and `apiKey`.

// Vite inlines these at build; `?.` keeps the module loadable under `node --test`
// where `import.meta.env` is undefined.
const DEFAULT_API_BASE = import.meta.env?.VITE_API_BASE || '/api';
const DEFAULT_API_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || '';

/**
 * @param {object}   deps
 * @param {typeof fetch} deps.doFetch   underlying fetch (wrap with createAuthRetryFetch)
 * @param {() => Promise<string|null>} deps.getToken  resolves the current access token
 * @param {string}  [deps.apiKey]       Supabase anon key (public), sent as `apikey`
 * @param {string}  [deps.apiBase]      base path, default `/api`
 * @returns {(name: string, options?: { body?: any, method?: string, headers?: Record<string,string> }) => Promise<{ data: any, error: any }>}
 */
export function createEdgeTransport({ doFetch, getToken, apiKey = DEFAULT_API_KEY, apiBase = DEFAULT_API_BASE }) {
  return async function invoke(name, options = {}) {
    // No live session → an anonymous call (the SDK behaves the same). A failure
    // to read the session must not throw here; it just means no user token.
    let token = null;
    try { token = await getToken(); } catch { /* no session → anon */ }

    const headers = {
      'Content-Type': 'application/json',
      apikey: apiKey,
      // Mirror supabase-js: the user JWT when signed in, else the anon key.
      Authorization: `Bearer ${token || apiKey}`,
    };
    if (options.headers) Object.assign(headers, options.headers);

    let res;
    try {
      res = await doFetch(`${apiBase}/${name}`, {
        method: options.method || 'POST',
        headers,
        // Always a JSON body (even `{}`) so a function doing `await req.json()`
        // never chokes on an empty body — safer than the SDK's "no body".
        body: options.body === undefined ? '{}' : JSON.stringify(options.body),
      });
    } catch (err) {
      // Never reached the function — no `.context`, exactly like a relay failure.
      return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
    }

    if (!res.ok) {
      // Mirror FunctionsHttpError: leave the body UNREAD on `.context` so
      // parseEdgeError reads it once. Message matches supabase-js so the
      // `/non-2xx/i` filter in parseEdgeError still recognises it.
      const error = new Error('Edge Function returned a non-2xx status code');
      error.context = res;
      return { data: null, error };
    }

    // 2xx — body may be empty (204) or JSON.
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    return { data, error: null };
  };
}
