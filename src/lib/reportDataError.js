// ONE reporter for every CLIENT-side failure that would otherwise be swallowed
// into a toast (TRIP-219 → TRIP-284). Originally the data-layer seam; now the
// single door for every client blind spot — the `surface` tag says which domain
// failed:
//
//   'data'      React-Query cache seam (query-client.js) + direct write seam
//               (`writeRows` in trip-data.js) — a swallowed DB write.
//   'auth'      supabase.auth.* real failures (5xx / auth unreachable), NOT the
//               expected 4xx (wrong password, weak password, rate-limit).
//   'storage'   direct Storage byte doors (upload / move / remove).
//   'realtime'  a channel that errored / timed out (chat rows subscription).
//
// Why one shared function: a write can fail on TWO paths — inside a React-Query
// mutation (MutationCache.onError sees it) OR in an optimistic fire-and-forget
// insert that bypasses React-Query entirely (e.g. EventEditDialog's booking
// create). The cache seam only covers the first; routing every domain through the
// same reporter is what makes "a swallowed failure can't hide" a property of the
// client, not of each call-site remembering to report.
//
// `surface` is ONE dimension: the failing domain. There is no second `surface`
// and no `layer` — "this is the browser" is implied by the fact that it went
// through THIS reporter (edge failures go through `captureEdgeError` with their
// own tags), so no constant `frontend` tag is emitted (TRIP-284).
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
 * Build the Sentry tag bag for a client failure. Pure (no Sentry, no import.meta)
 * so it is unit-testable under `node --test` — it is the reporter's only piece of
 * real logic. `surface` is the failing domain; `source`/`key` are optional
 * refinements the data seam carries.
 *
 * @param {any} error
 * @param {{ surface: string, source?: string, key?: any }} opts
 */
export function buildTags(error, { surface, source, key } = {}) {
	const status = statusOf(error);
	const name = Array.isArray(key) ? key[0] : key;
	return {
		surface,
		...(source ? { source } : {}),
		...(status ? { status: String(status) } : {}),
		// PostgREST error code (e.g. 42501 = RLS reject) — lets an expected
		// authz denial be filtered from a genuine write bug in Sentry.
		...(error?.code ? { db_code: String(error.code) } : {}),
		...(name ? { query: String(name) } : {}),
	};
}

/**
 * Report a swallowed client failure to Sentry, once.
 *
 * @param {any} error   the thrown/returned error
 * @param {{ surface: string, source?: string, key?: any }} opts
 *   surface  failing domain: 'data' | 'auth' | 'storage' | 'realtime'
 *   source   'query' | 'mutation' | 'write' | … — optional refinement
 *   key      React-Query key — only its first (logical-name) segment is tagged;
 *            later segments carry ids / share-tokens (PII).
 */
export function report(error, opts) {
	if (!error || error.__seamHandled) return;
	// Stamp FIRST, so a re-throw into a React-Query cache onError isn't reported again.
	try { Object.defineProperty(error, '__seamHandled', { value: true }); } catch { /* frozen error */ }
	import('./sentry').then(({ Sentry }) => {
		Sentry.captureException(
			error instanceof Error ? error : new Error(String(error?.message ?? error)),
			{ tags: buildTags(error, opts) },
		);
	}).catch((e) => {
		// Monitoring must never break the app — but surface the failure in dev so a
		// blocked/misconfigured Sentry doesn't make client errors silently vanish.
		if (import.meta.env?.DEV) console.warn('[monitoring] client-error report failed', e);
	});
}

/**
 * Backward-compatible data-layer entry — the two existing call-sites
 * (query-client.js, trip-data.js) keep their `(error, source, key)` signature.
 * @param {any} error
 * @param {string} source  'query' | 'mutation' | 'write'
 * @param {any} [key]
 */
export function reportDataError(error, source, key) {
	report(error, { surface: 'data', source, key });
}

/**
 * Auth-domain entry — reports ONLY real failures. A `supabase.auth.*` call that
 * fails with a 4xx (wrong password, weak password, unconfirmed email, rate-limit,
 * 401/422) is an EXPECTED outcome of the flow, not a bug, and must not burn the
 * shared Sentry quota (TRIP-284). Everything else — a 5xx, or a failure with no
 * numeric status at all (GoTrue unreachable / network) — is a real incident and
 * is reported with `surface:'auth'`.
 *
 * @param {any} error   the GoTrue error (returned `{ error }` or a thrown one)
 * @param {string} [source]  which auth call ('signin' | 'signup' | 'oauth' | …)
 */
export function reportAuthError(error, source) {
	if (!error) return;
	const status = statusOf(error);
	if (typeof status === 'number' && status >= 400 && status < 500) return; // expected 4xx — i18n-ignore (гард 2d читает `>= 400 … < 500` как JSX-текст, это не строка UI)
	report(error, { surface: 'auth', source });
}
