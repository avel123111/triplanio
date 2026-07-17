import { createClient, type User } from 'npm:@supabase/supabase-js@2';
import { HttpError } from './http.ts';

/**
 * Service-role client — bypasses RLS. Use only inside Edge Functions
 * for operations that require reading/writing across user boundaries
 * (e.g. checking trip membership, sending notifications, syncing expenses).
 *
 * Never expose the service role key to the frontend.
 */
export const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

/**
 * Resolve the caller's Supabase user AND distinguish WHY it failed — so a caller
 * that wants to treat "no session" as an expected outcome (and stay silent in
 * Sentry) does NOT also swallow a genuine Auth-service outage.
 *
 *   - no Authorization header            → { user: null, authFailed: false }  (unauthenticated)
 *   - invalid / expired token (4xx)      → { user: null, authFailed: false }  (unauthenticated)
 *   - Auth API 5xx / retryable failure   → { user: null, authFailed: true  }  (operational)
 *
 * A thrown network error propagates to the caller's top-level catch (a reported
 * 500) — the same "this is a real failure" signal as `authFailed: true`.
 */
export async function getRequestUserResult(
  req: Request,
): Promise<{ user: User | null; authFailed: boolean }> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return { user: null, authFailed: false };

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(
    authHeader.replace('Bearer ', ''),
  );
  if (user) return { user, authFailed: false };
  // An AuthApiError carries the upstream status: 4xx = the token is bad (expected,
  // unauthenticated); >= 500 = the Auth service itself is failing (operational).
  const status = (error as { status?: number } | null)?.status ?? 0;
  return { user: null, authFailed: status >= 500 };
}

/**
 * Extracts the caller's Supabase user from the request's Authorization header.
 * Returns null if the header is absent or the token is invalid/expired (an
 * EXPECTED, unauthenticated outcome the caller renders as a 401).
 *
 * A genuine Auth-service OUTAGE (5xx / retryable) is NOT collapsed into that
 * `null` — it throws `HttpError(503, …, 'AUTH_UNAVAILABLE')`, which the top-level
 * `withHandler` catch reports to Sentry (an operational incident) and returns as a
 * 503 the client treats as "temporary → retry", not "session dead → /login". This
 * is what lets `withHandler` safely stay silent on 401: a real outage never
 * presents AS a 401. Callers that must branch on the outage flag without throwing
 * can still use `getRequestUserResult` directly.
 *
 * Usage:
 *   const user = await getRequestUser(req);
 *   if (!user) return unauthorized();
 */
export async function getRequestUser(req: Request) {
  const { user, authFailed } = await getRequestUserResult(req);
  if (authFailed) throw new HttpError(503, 'Auth service unavailable', 'AUTH_UNAVAILABLE');
  return user; // user.id (uuid), user.email
}
