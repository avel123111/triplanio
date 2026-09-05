// Ad-attribution mark carrier (TRIP-407 PR4) — the ONE owner of "which campaign
// marks does this signup carry", across the two borders those marks must cross.
//
// Split out of analytics.js so the mark STATE lives in one place. The dependency
// is one-way: analytics.js imports THIS (as it already imports campaign.js); this
// module never imports analytics.js. The campaign super-property write
// (`setCampaign`) is triggered on the analytics side — at identify and on every
// consent application — reading `getActiveMarks()` here, so this module never
// has to know PostHog exists. Keeping that arrow one-way is what stops the
// attribution↔analytics cycle.
//
// Browser-only (reads the entrySearch snapshot); the node-safe, testable form of
// a mark is campaign.js (`pickSignupMarks` / the whitelist).
import { readMarks } from '@/lib/campaign';
import { entrySearch } from '@/lib/analyticsEnv';

// The campaign marks of THIS document, from the entry-URL snapshot.
//
// ONE CARRIER PER BORDER, both readers on it (TRIP-335, TRIP-502). The marks have
// to cross two borders: the OAuth round trip (the provider replaces the whole
// document) is crossed by the ADDRESS — every door out of a visit is built with
// `withVisitCampaign`, so the `redirectTo` handed to Supabase and the hard
// navigation after One Tap both land on `/trips?utm_…`, and this snapshot reads
// them straight back; the confirmation email (opened on another device) is
// crossed by Supabase auth metadata, handed here through `rememberSignupMarks`.
// There used to be a sessionStorage stash for the OAuth border as well: a second
// carrier for a border the address already crosses, and the one a browser is
// free to refuse (private mode, ITP) — it is gone, the address is the carrier.
const visitMarks = readMarks(entrySearch);
// The same marks, brought across the email border by the signup path.
let recoveredMarks = null;

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
 * The marks of the signup being made, or null: this document's address. Feeds the
 * `users` columns, which are written for EVERY visitor, refusers included — this
 * is why "which campaign brought this signup" has an answer that does not depend
 * on consent. Read at the birth of a `users` row (AuthContext) and put on the
 * email signup as `signup_attribution` (Login.jsx).
 *
 * @returns {Record<string, string> | null}  marks, keyed by query parameter
 */
export function getSignupMarks() {
  return visitMarks;
}

/**
 * Hand the campaign side the marks that crossed a document replacement.
 *
 * Called by AuthContext at the ONE point a `users` row is born, with whatever the
 * signup path recovered — the auth metadata that carried them through a
 * confirmation email to another device. Only there: those metadata live on the
 * auth user forever, and reading them on a later login would resurrect a
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
