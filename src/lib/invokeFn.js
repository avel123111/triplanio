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
// already reports EVERY function that returned a non-2xx (server side, with the
// real server stack). We therefore do NOT duplicate those. We capture what edge
// cannot see:
//   • a NETWORK / relay failure — the call never reached the function (no
//     `error.context` Response), e.g. offline / DNS / CORS / cold-start timeout;
//   • a 200-with-`{ error }` body — the function answered 200 with a domain error,
//     so `withHandler`'s `status >= 400` check never fired.
// A genuine navigation-abort ("Failed to fetch" / AbortError from the user
// leaving) is filtered by the SDK's `ignoreErrors`, so it never becomes noise.
//
// Net effect: every failure a user hits is in Sentry exactly once — from edge
// (server 4xx/5xx) or from here (network / 200-error / client) — never twice.

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

  // `error.context` present = the function RETURNED a non-2xx → the edge seam
  // already captured it; capturing here would duplicate. Absent = network/relay
  // failure or a 200-with-error the edge never saw → this is ours to report.
  const reportedByEdge = Boolean(error?.context);
  if (!reportedByEdge) {
    const toReport = error instanceof Error ? error : new Error(message || `${name} failed`);
    Sentry.captureException(toReport, {
      tags: { surface: 'frontend', fn: name, ...(code ? { code } : {}) },
    });
  }

  return { data, error, code, message };
}
