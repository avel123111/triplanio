// Cross-cutting auth recovery for EVERY Supabase call (TRIP-56).
//
// Why this exists: an authorized request can fail with 401 not because rights
// were lost but because the access token went stale (e.g. a throttled background
// tab missed the auto-refresh). Previously only `getTripDetails` self-healed this
// (manual refresh+retry wrapped around one function); the same latent bug lived
// on every other authorized `functions.invoke` / REST / Storage call. Moving the
// recovery into the client's `fetch` fixes ALL of them at once, with no per-call
// wrappers — and lets `invokeGetTripDetails` collapse back to a plain invoke.
//
// Pure factory (no module-level supabase import) so it unit-tests without the
// network: inject a fake `realFetch` and a fake client.

// GoTrue's own endpoints (token refresh, sign-in, etc). We must NOT intercept a
// 401 from here — refreshing in response to a failed refresh is the refresh→401→
// refresh loop. Everything else (edge functions, PostgREST, Storage) is fair game.
const AUTH_PATH = '/auth/v1/';

/**
 * Wrap a `fetch` so a 401 from an authorized call triggers ONE session refresh
 * and ONE retry with the fresh token.
 *
 * @param {typeof fetch} realFetch - the underlying fetch (window.fetch).
 * @param {() => { auth: { refreshSession: () => Promise<{ data?: any, error?: any }> } }} getClient
 *        - lazy getter for the supabase client (avoids the create-time TDZ).
 * @returns {typeof fetch}
 */
export function createAuthRetryFetch(realFetch, getClient) {
  // Single-flight: N concurrent 401s share ONE refreshSession() call instead of
  // stampeding the auth endpoint (thundering herd). Reset once it settles.
  let refreshing = null;

  return async function authRetryFetch(input, init) {
    // supabase-js always calls fetch as (urlString, init); guard the object form too.
    const url = typeof input === 'string' ? input : input?.url || '';
    const res = await realFetch(input, init);

    // Only recover a 401 from a non-auth call. Anything else passes straight through.
    if (res.status !== 401 || url.includes(AUTH_PATH)) return res;

    if (!refreshing) {
      refreshing = Promise.resolve()
        .then(() => getClient().auth.refreshSession())
        .finally(() => { refreshing = null; });
    }

    let token;
    try {
      const { data, error } = await refreshing;
      if (error) return res; // refresh failed → bubble the original 401 (→ /login)
      token = data?.session?.access_token;
    } catch {
      return res;
    }
    if (!token) return res; // no live session → original 401 stands

    // Retry ONCE with the fresh token. The body in `init` is a string/blob for
    // every supabase-js call, so it's safe to replay. No second retry → no loop.
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return realFetch(input, { ...init, headers });
  };
}
