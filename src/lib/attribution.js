// Ad-attribution mark carrier (TRIP-407 PR4) — the ONE owner of "which campaign
// marks does this signup carry", across the three borders those marks must cross.
//
// Split out of analytics.js so the mark STATE lives in one place. The dependency
// is one-way: analytics.js imports THIS (as it already imports campaign.js); this
// module never imports analytics.js. The campaign super-property write
// (`setCampaign`) is triggered on the analytics side — at identify and at boot —
// reading `getActiveMarks()` here, so this module never has to know PostHog
// exists. Keeping that arrow one-way is what stops the attribution↔analytics cycle.
//
// Browser-only (reads the entrySearch snapshot + sessionStorage); the node-safe,
// testable form of a mark is campaign.js (`pickSignupMarks` / the whitelist).
import { readMarks, resolveSignupMarks } from '@/lib/campaign';
import { entrySearch } from '@/lib/analyticsEnv';

// The campaign marks of THIS document, from the entry-URL snapshot. Null on any
// page not arrived on directly — every page after Google's OAuth screen or a
// confirmation link, which is why `recoveredMarks` exists.
const visitMarks = readMarks(entrySearch);
// The same marks, brought across a document replacement by the signup path.
//
// ONE CARRIER PER BORDER, both readers on it (TRIP-335). The marks have to cross
// three borders and no single carrier crosses all of them: in-memory dies with the
// document, so the OAuth redirect is crossed by the sessionStorage stash below and
// the confirmation email by Supabase auth metadata. Whichever carrier made it hands
// the marks here, and both readers (the campaign super-properties and the `users`
// columns) take them from one place instead of each growing a courier of its own.
let recoveredMarks = null;

// Survives the OAuth round trip, which the in-memory snapshot cannot: the provider
// replaces the whole document. Same category as `postLoginRedirect`, which already
// rides sessionStorage next to it.
const REDIRECT_KEY = 'tp-signup-attribution';

/**
 * The marks this browser currently holds for the campaign side: this document's
 * address, else whatever the signup path recovered across a border. The single
 * read `analytics.setCampaign()` consults.
 * @returns {Record<string, string> | null}
 */
export function getActiveMarks() {
  return visitMarks || recoveredMarks;
}

/**
 * Keep this visit's marks through an OAuth provider. Called on the button, not at
 * start-up: pressing "continue with Google" is the request that makes storing them
 * part of the service.
 *
 * The MARKS, not the columns projected out of them: this stash is the carrier for
 * that border, and both readers hang off it. Not getSignupMarks(): that one
 * consumes the stash, so a retry after a failed sign-in would eat its own marks.
 */
export function rememberAttributionForRedirect() {
  if (!visitMarks) return;
  try {
    sessionStorage.setItem(REDIRECT_KEY, JSON.stringify(visitMarks));
  } catch { /* private mode — attribution is lost, the signup still works */ }
}

/**
 * Drop the OAuth stash unused: the sign-in belonged to an existing account, so
 * there was no signup to attribute, and leaving the marks would credit them to
 * whoever registers next in this tab.
 */
export function forgetStashedAttribution() {
  try {
    sessionStorage.removeItem(REDIRECT_KEY);
  } catch { /* nothing stored, nothing to forget */ }
}

/**
 * The marks of the signup being made, or null: this document's address, else
 * whatever the OAuth stash carried across. Feeds the `users` columns, which are
 * written for EVERY visitor, refusers included — this is why "which campaign
 * brought this signup" has an answer that does not depend on consent.
 *
 * A THIN SHELL over `resolveSignupMarks` (campaign.js): the two rules — the
 * address wins, and a resolved signup spends the stash whichever carrier won —
 * are a pure function with a test, because they are worth ad spend and used to be
 * unobservable until a paid signup showed up months later filed under "organic".
 * All this reads is storage, and a browser refusing storage (private mode, ITP)
 * must NOT take the address carrier down with it — hence the two separate `try`s.
 *
 * @returns {Record<string, string> | null}  marks, keyed by query parameter
 */
export function getSignupMarks() {
  let stashedRaw = null;
  try { stashedRaw = sessionStorage.getItem(REDIRECT_KEY); } catch { /* storage refused */ }

  const { marks, spendStash } = resolveSignupMarks(visitMarks, stashedRaw);
  if (spendStash) forgetStashedAttribution();
  // Only the RECOVERED path has to hand them on: when the address carried the
  // marks, `getActiveMarks()` already reads them straight off `visitMarks`.
  if (marks && !visitMarks) rememberSignupMarks(marks);
  return marks;
}

/**
 * Hand the campaign side the marks that crossed a document replacement.
 *
 * Called by AuthContext at the ONE point a `users` row is born, with whatever the
 * signup path recovered — the OAuth stash, or the auth metadata that carried them
 * through a confirmation email to another device. Only there: those metadata live
 * on the auth user forever, and reading them on a later login would resurrect a
 * year-old click as a fresh one, exactly the lie last-touch attribution avoids.
 *
 * ONLY stores `recoveredMarks` — it does NOT call `setCampaign` (that would import
 * analytics.js, closing the cycle this split exists to break). The campaign write
 * is analytics.js's job: `identifyUser` runs `setCampaign()` right after AuthContext
 * calls this, reading the marks back through `getActiveMarks()`.
 *
 * @param {Record<string, string> | null} marks  keyed by query parameter
 */
export function rememberSignupMarks(marks) {
  if (!marks) return;
  recoveredMarks = marks;
}
