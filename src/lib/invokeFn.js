// The single browser entry point for calling a Supabase edge function (TRIP-219).
//
// A drop-in for `supabase.functions.invoke(name, options)` — it returns the same
// `{ data, error }` — but it ALSO:
//   • parses the canonical `{ error, code }` body ONCE (via parseEdgeError) and
//     returns `{ code, message }`, so call-sites stop each re-reading
//     `error.context` (a Response body can only be read once);
//   • reports the failure to Sentry so no handled edge error is silently
//     swallowed into a toast.
//
// Capture policy — the layered model (TRIP-219): the edge `withHandler` seam
// reports every non-2xx it PRODUCES (server side, with the real server stack).
// We do NOT duplicate those. We capture what the edge could not:
//   • a NETWORK / relay failure — the call never reached the function (no
//     `error.context` Response), e.g. offline / DNS / CORS / cold-start timeout;
//   • a 200-with-`{ error }` body — the function answered 200 with a domain error,
//     so `withHandler`'s `status >= 400` check never fired;
//   • a PLATFORM-level non-2xx — the runtime (not our code) returned the error:
//     boot crash, CPU/wall timeout, OOM, gateway 546/504. There IS an
//     `error.context`, but the body is not our `{ error, code }` contract, so
//     `withHandler` never ran and nobody captured it. We detect this by the
//     ABSENCE of a canonical message/code and tag it `edge_uncaptured`.
// A genuine navigation-abort ("Failed to fetch" / AbortError from the user
// leaving) is filtered by the SDK's `ignoreErrors`, so it never becomes noise.
//
// Net effect: every failure a user hits is in Sentry exactly once — from edge
// (server 4xx/5xx it produced) or from here (network / 200-error / platform floor
// / client) — never twice.

import { supabase } from '@/api/supabaseClient';
import { parseEdgeError } from '@/lib/edgeError';
import { Sentry } from '@/lib/sentry';

/**
 * @param {string} name  edge function slug
 * @param {import('@supabase/supabase-js').FunctionInvokeOptions} [options]
 * @returns {Promise<{ data: any, error: any, code: string|null, message: string|null }>}
 */
export async function invokeFn(name, options = {}) {
  const { data, error } = await supabase.functions.invoke(name, options);

  const failed = Boolean(error) || Boolean(data && data.error);
  if (!failed) return { data, error: null, code: null, message: null };

  const { code, message } = await parseEdgeError(error, data);

  // Mark the error so the global React-Query onError seam (query-client) does not
  // capture it a SECOND time when a queryFn re-throws it: the invoke/edge seam
  // already owns this error's reporting (edge captured a server 4xx/5xx, or below
  // we capture a network/200-error). Non-enumerable → never leaks into logs/JSON.
  if (error && typeof error === 'object') {
    try { Object.defineProperty(error, '__seamHandled', { value: true }); } catch { /* frozen error */ }
  }

  // Decide who reports. We defer to the edge ONLY when we have EVIDENCE the edge
  // saw this error: a non-2xx (`error.context`) whose body is our canonical
  // `{ error, code }` contract (so `withHandler` produced it and captured it, or
  // deliberately skipped it via x-sentry-skip). We report ourselves when:
  //   • no `error.context` — a network/relay failure or a 200-with-error the edge
  //     never saw (its `status >= 400` check never fired);
  //   • `error.context` present but the body is NOT our contract (no message/code)
  //     — a PLATFORM-level non-2xx (cold-start timeout, boot crash, OOM, gateway
  //     546/504). `withHandler` never ran, so NOBODY captured it. Tag it
  //     `edge_uncaptured` so this floor is visible, not silently trusted away.
  const bodyIsOurs = Boolean(message || code);
  const reportedByEdge = Boolean(error?.context) && bodyIsOurs;
  if (!reportedByEdge) {
    const toReport = error instanceof Error ? error : new Error(message || `${name} failed`);
    Sentry.captureException(toReport, {
      tags: {
        surface: 'frontend', fn: name,
        ...(code ? { code } : {}),
        ...(error?.context && !bodyIsOurs ? { edge_uncaptured: 'true' } : {}),
      },
    });
  }

  return { data, error, code, message };
}
