import { QueryClient } from '@tanstack/react-query';
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

export const queryClientInstance = new QueryClient({
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
