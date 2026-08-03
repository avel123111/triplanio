// Viral link marking (TRIP-329) — pure helpers. campaign.js owns the READING
// half of the same layer; this is the writing half.
//
// `npm test` runs these under plain `node --test`, so this module stays
// dependency-free (same rule as campaign.js / trip-cities.js).
//
// THE RULE: mark only a link that can bring a NEW person. Links back to our own
// users — reminders, password resets, confirmation mail — stay bare. Attribution
// is last-touch, so marking those would move a purchase made by someone we PAID
// Google Ads for onto "the reminder", and the acquisition channel would quietly
// turn into the last-click channel.
//
// The test is the KIND of link, not the individual recipient. An invite goes to
// someone who is not a participant yet, so the channel brings strangers and gets
// marked — knowing that a recipient who already has an account will have their
// last-touch mark moved onto the invite. That cost is accepted, not overlooked:
// `users.signup_utm_*` is written once at signup and is unaffected, so "which
// channel brought this REGISTRATION" stays exact; only "which channel brought
// this PURCHASE" needs `medium NOT LIKE 'viral%'` to read paid honestly. A
// reminder, by contrast, only ever reaches an existing participant — there is no
// stranger on the other end and therefore nothing to win.
//
// Every mark carries the `viral` prefix in utm_medium, which is what makes the
// two halves separable in one report: filter medium NOT LIKE 'viral%' for clean
// paid numbers, drop the filter for the full picture.
//
// Mirrored for Deno in supabase/functions/_shared/viralLink.ts — an edge
// function cannot import from src/. viralLink.test.js reads that file and fails
// when the two tables drift.

/**
 * Link kind → the fixed pair it always carries. The trip id is NOT here: it
 * rides utm_campaign, which is per-link.
 */
export const VIRAL_MARKS = {
  // Public read-only trip link, /public/trip/:id?t=…
  public_link: { utm_source: 'trip_share', utm_medium: 'viral' },
  // Invite link the member copies out of the dialog, /join/:token
  invite_link: { utm_source: 'trip_invite', utm_medium: 'viral' },
  // The links inside the invite EMAIL. Same source, own medium: an invite that
  // was mailed and one that was pasted into a chat are the same channel but not
  // the same delivery, and only the medium can tell them apart afterwards.
  invite_email: { utm_source: 'trip_invite', utm_medium: 'viral_email' },
  // QR on the social share card → the landing page.
  share_card: { utm_source: 'share_card', utm_medium: 'viral' },
};

/**
 * Append the campaign marks for a viral link.
 *
 * The trip id goes in utm_campaign for EVERY kind, so one field answers "which
 * trips bring people in". It is also the only one of the three that survives a
 * cookie refusal: `users` has signup_utm_source/_medium/_campaign columns and no
 * column for utm_content (campaign.js), so an id parked in utm_content would be
 * invisible for exactly the visitors PostHog never sees.
 *
 * Built by hand rather than through `new URL()`: URL throws on a malformed base,
 * and one caller (the invite email, whose base is the PUBLIC_APP_URL secret)
 * sits outside a try/catch. A missing mark is a reporting gap; a throw there is
 * a broken invite. Same reason unknown kinds and a missing trip id return the
 * url untouched instead of raising.
 *
 * @param {string} url        absolute url, may already carry a query
 * @param {keyof typeof VIRAL_MARKS} kind
 * @param {string} tripId
 * @param {string} [content]  optional utm_content (the card passes its format)
 * @returns {string}
 */
export function withViralMarks(url, kind, tripId, content) {
  const marks = VIRAL_MARKS[kind];
  if (!url || !marks || !tripId) return url;

  const params = new URLSearchParams({ ...marks, utm_campaign: `trip_${tripId}` });
  if (content) params.set('utm_content', content);

  return appendQuery(url, params.toString());
}

/**
 * Hang a ready-made query string off an address, whether or not it already has
 * one. Shared with `withVisitCampaign` (analytics.js), which puts the marks of
 * the CURRENT visit on an outgoing link rather than minting new ones — the two
 * halves differ in where the marks come from, not in how they are attached.
 *
 * @param {string} url
 * @param {string} query  already encoded, without the leading `?`
 * @returns {string}
 */
export function appendQuery(url, query) {
  if (!url || !query) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${query}`;
}
