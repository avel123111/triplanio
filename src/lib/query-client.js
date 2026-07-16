import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { statusOf } from './loadStateClassify.js';

// Retry policy (TRIP-208 B2) ────────────────────────────────────────────────────
// The old `retry: 1` retried EVERYTHING once with no delay: it retried 4xx that
// can never succeed on repeat, and it re-fired all of a screen's queries in a
// synchronised burst (thundering herd) exactly when the origin was already
// struggling — turning a sub-second platform blip into a longer visible outage.
// New policy, defined ONCE for the whole app and leaning on the same normalized
// `statusOf` from the error contract (Ф1):
//   • 4xx except 429 → never retry. 401/403/404 don't heal by repeating; 401 is
//     already recovered separately in the fetch layer (createAuthRetryFetch).
//   • network / 5xx / 429 (and any error with no resolvable status) → up to 2
//     retries with exponential backoff + jitter, so N parallel queries on one
//     screen don't hammer the origin in lockstep.
export function retryQuery(failureCount, error) {
  const status = statusOf(error);
  if (status && status < 500 && status !== 429) return false; // permanent 4xx: pointless to retry
  return failureCount < 2;                                     // transient: at most 2 more attempts
}

// Exponential backoff capped at 15s, plus up to 250ms jitter to de-synchronise a
// screen's parallel retries (anti-thundering-herd). attempt is 0-based.
export function retryDelay(attempt) {
  return Math.min(1000 * 2 ** attempt, 15_000) + Math.random() * 250;
}

// Data-layer error seam (TRIP-219 F3) ────────────────────────────────────────────
// ONE place that reports every React-Query failure to Sentry, so a swallowed
// query/mutation error can't hide. This is the class of failure no edge/invoke
// seam sees: direct PostgREST / RPC errors (`.from()` / `.rpc()` that `throw`).
//
// Dedup with the invoke/edge seam: an error routed through `invokeFn` is stamped
// `__seamHandled` (edge already captured a server 4xx/5xx, or invokeFn captured a
// network / 200-error), so a queryFn re-throwing it is skipped here — never twice.
// Navigational `Failed to fetch` / `AbortError` are dropped by the SDK's
// `ignoreErrors`, so no extra filter is needed.
//
// Only the FIRST queryKey/mutationKey segment (the logical name) is tagged — later
// segments carry ids / share-tokens (PII), so they are deliberately not sent.
//
// Sentry is imported LAZILY (inside the handler) so this module stays importable
// under `node --test` (sentry.js reads `import.meta.env`) — same reason
// subscription.js lazy-imports invokeFn.
function reportDataError(error, source, key) {
	if (!error || error.__seamHandled) return;
	const name = Array.isArray(key) ? key[0] : key;
	import('./sentry').then(({ Sentry }) => {
		const status = statusOf(error);
		Sentry.captureException(error instanceof Error ? error : new Error(String(error?.message ?? error)), {
			tags: {
				surface: 'frontend', layer: 'data', source,
				...(status ? { status: String(status) } : {}),
				...(name ? { query: String(name) } : {}),
			},
		});
	}).catch(() => { /* monitoring must never break the app */ });
}

export const queryClientInstance = new QueryClient({
	queryCache: new QueryCache({
		onError: (error, query) => reportDataError(error, 'query', query?.queryKey),
	}),
	mutationCache: new MutationCache({
		onError: (error, _vars, _ctx, mutation) => reportDataError(error, 'mutation', mutation?.options?.mutationKey),
	}),
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: retryQuery,
			retryDelay,
			// Coalesce identical keys within a screen so a remount/return doesn't
			// re-hit the origin for data seconds old. Mutations invalidate explicitly
			// (invalidateQueries), which overrides staleTime — so post-mutation data
			// stays fresh regardless of this default.
			staleTime: 30_000,
		},
		mutations: {
			retry: false, // never auto-retry a write
		},
	},
});
