/**
 * CORS headers with an origin allow-list (TRIP-67).
 *
 * CORS is a BROWSER mechanism. Server-to-server callers (Stripe webhook, n8n,
 * Telegram bot, cron reminders) send no `Origin` header and ignore the response
 * CORS headers entirely — so the allow-list below cannot affect them.
 *
 * `corsFor(req)` reflects the request `Origin` ONLY when it is in the allow-list
 * (our prod domains, this project's Vercel previews, and localhost dev):
 *   - allow-listed Origin  → `Access-Control-Allow-Origin: <that origin>`
 *   - foreign Origin       → no ACAO header → the foreign site's browser blocks it
 *   - no Origin (s2s)      → no ACAO header → request proceeds as before
 *
 * Not paired with `Access-Control-Allow-Credentials: true` (auth is a Bearer
 * header, not a cookie), so this is defense-in-depth against a leaked/stolen
 * token being replayed from an arbitrary origin in a browser — not a hard
 * gate against server-to-server abuse (which CORS never covers).
 */

// Exact-match origins we own.
const STATIC_ALLOWED = new Set<string>([
  'https://triplanio.com',
  'https://www.triplanio.com',
  'https://dev.triplanio.com',
  'http://localhost:5173',
  'http://localhost:3000',
]);

// Vercel preview deployments for THIS project. There are TWO URL shapes:
//   - raw deployment URL (project slug `triplanio`, what the dashboard opens):
//       https://triplanio-awdc1hnkn-avel123111-5277s-projects.vercel.app
//   - branch/PR alias (prefixed `triplanioapp-git-…`):
//       https://triplanioapp-git-dev-avel123111-5277s-projects.vercel.app
// The `app` segment is therefore OPTIONAL — matching only `triplanioapp-` (the
// original TRIP-67 regex) blocked every raw deployment preview.
const VERCEL_PREVIEW_RE =
  /^https:\/\/triplanio(?:app)?-[a-z0-9-]+-avel123111-5277s-projects\.vercel\.app$/;

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  if (STATIC_ALLOWED.has(origin)) return true;
  return VERCEL_PREVIEW_RE.test(origin);
}

const BASE_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  // Responses depend on the request Origin → must not be cached across origins.
  'Vary': 'Origin',
};

/**
 * Build CORS response headers for a request. Reflects an allow-listed `Origin`;
 * omits `Access-Control-Allow-Origin` otherwise (safe default for foreign and
 * server-to-server callers). Call with no argument for s2s-only helpers.
 */
export function corsFor(req?: Request): Record<string, string> {
  const origin = req?.headers.get('origin');
  if (isAllowedOrigin(origin)) {
    return { ...BASE_HEADERS, 'Access-Control-Allow-Origin': origin as string };
  }
  return { ...BASE_HEADERS };
}
