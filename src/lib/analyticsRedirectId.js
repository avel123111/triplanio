// Carrier for the anonymous PostHog `distinct_id` across an OAuth redirect or a
// hard navigation (TRIP-502). Same border, same shape as the campaign-mark stash
// (TRIP-493): before consent the id lives only in `persistence:'memory'`, so it
// dies with the document the moment a provider redirect / One Tap hard-nav starts
// a new one — and the funnel's top (`landing_viewed`/`cta_clicked` on the old id)
// stops being the same person as `user_signed_up` on the new one. `sessionStorage`
// survives that same-tab navigation, so we ferry the id across it and re-seed the
// fresh client with it (`bootstrap.distinctID`).
//
// Pure over an INJECTED storage so the round-trip is a unit test, not a browser
// check — the same reason TRIP-493 put its signup-mark decision on a pure function
// (`resolveSignupMarks`) instead of leaving it inside a window-bound module. This
// file never touches the PostHog SDK: `get_distinct_id()` / init stay behind the
// one door in `destinations/posthog.js` (guard 2j). It only moves a string.
//
// NOT a fix for every case: `sessionStorage` is per-tab, so a confirmation link
// opened in a NEW tab (email signup) or on another device does not see the stash —
// there the DB (`users.signup_utm_*`) stays the source of truth, as it is anyway.

/** One key, its own namespace — not shared with the mark stash (`tp-signup-attribution`). */
export const REDIRECT_ID_KEY = 'tp-analytics-did';

/**
 * Stash the current anonymous id before a redirect. No-op on a missing id or a
 * storage that throws (private mode / ITP): the id is simply lost and the funnel
 * falls back to the DB for that visit, exactly the TRIP-493 failure mode.
 *
 * @param {Pick<Storage,'setItem'>|null|undefined} storage  a sessionStorage-like object
 * @param {string|null|undefined} id  posthog.get_distinct_id()
 */
export function stashRedirectId(storage, id) {
  if (!storage || !id) return;
  try {
    storage.setItem(REDIRECT_ID_KEY, id);
  } catch {
    /* private mode — the id is lost, the funnel falls back to the DB */
  }
}

/**
 * Read AND clear the stashed id (one-shot). Clearing on read is load-bearing: a
 * stale id left behind would bootstrap a later, unrelated boot onto the wrong
 * person — the identity twin of TRIP-493's "the signup must spend the stash".
 *
 * @param {Pick<Storage,'getItem'|'removeItem'>|null|undefined} storage
 * @returns {string|null}
 */
export function takeRedirectId(storage) {
  if (!storage) return null;
  try {
    const id = storage.getItem(REDIRECT_ID_KEY);
    storage.removeItem(REDIRECT_ID_KEY);
    return id || null;
  } catch {
    return null;
  }
}
