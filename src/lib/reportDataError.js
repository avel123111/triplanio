// ONE reporter for every frontend data-layer failure (TRIP-219) — used by BOTH
// the React-Query cache seam (query-client.js) AND the direct-write seam
// (`writeRows` in trip-data.js).
//
// Why one shared function: a write can fail on TWO paths — inside a React-Query
// mutation (MutationCache.onError sees it) OR in an optimistic fire-and-forget
// insert that bypasses React-Query entirely (e.g. EventEditDialog's booking
// create). The cache seam only covers the first; routing both through the same
// reporter is what makes "a swallowed DB write can't hide" a property of the
// data layer, not of each call-site remembering to report.
//
// Dedup: the error is stamped `__seamHandled` (same contract invokeFn uses for
// edge/network errors) so an error reported here — then re-thrown into a
// surrounding QueryCache/MutationCache onError — is never reported a second time.
//
// Sentry is imported LAZILY so this module (and its importers, e.g. trip-data.js)
// stay loadable under `node --test`, where `import('./sentry')` simply rejects
// and is swallowed. `import.meta.env?.DEV` is optional-chained for the same
// reason — no `import.meta.env` object exists under node.
import { statusOf } from './loadStateClassify.js';

/**
 * @param {any} error   the thrown PostgREST/RPC error (or a synthetic write_rejected)
 * @param {string} source  'query' | 'mutation' | 'write'
 * @param {any} [key]    React-Query key — only its first (logical-name) segment is
 *                       tagged; later segments carry ids / share-tokens (PII).
 */
export function reportDataError(error, source, key) {
	if (!error || error.__seamHandled) return;
	// Stamp FIRST, so a re-throw into a React-Query cache onError isn't reported again.
	try { Object.defineProperty(error, '__seamHandled', { value: true }); } catch { /* frozen error */ }
	const name = Array.isArray(key) ? key[0] : key;
	import('./sentry').then(({ Sentry }) => {
		const status = statusOf(error);
		Sentry.captureException(error instanceof Error ? error : new Error(String(error?.message ?? error)), {
			tags: {
				surface: 'frontend', layer: 'data', source,
				...(status ? { status: String(status) } : {}),
				// PostgREST error code (e.g. 42501 = RLS reject) — lets an expected
				// authz denial be filtered from a genuine write bug in Sentry.
				...(error?.code ? { db_code: String(error.code) } : {}),
				...(name ? { query: String(name) } : {}),
			},
		});
	}).catch((e) => {
		// Monitoring must never break the app — but surface the failure in dev so a
		// blocked/misconfigured Sentry doesn't make data errors silently vanish.
		if (import.meta.env?.DEV) console.warn('[monitoring] data-error report failed', e);
	});
}
