// Campaign attribution (TRIP-316) — pure helpers.
//
// `npm test` runs these under plain `node --test`, so this module stays
// dependency-free (same rule as trip-cities.js). Everything that touches
// PostHog (register / unregister / person properties) lives in analytics.js.
//
// ONE VOCABULARY. Every mark this app understands is a row in `MARKS` below,
// and the four dictionaries that used to be written out by hand — the PostHog
// super-properties, the `users` columns, PostHog's own first-touch names, and
// the pass-through used when a link carries the marks onward — are derived from
// it. That is the difference between "google is handled here, utm over there"
// and one rule applied five times: adding a network (fbclid, msclkid, ttclid) is
// a row, not four edits in four files that drift apart the day one is forgotten.
//
// The currency between all of them is MARKS: an object keyed by the QUERY
// PARAMETER name (`{ utm_source: 'x', gclid: 'y' }`). Readers produce it,
// projections consume it, and nothing else passes a half-translated shape
// around.

/**
 * Every mark, once.
 * - `param`  — what the URL calls it. Also the key of the MARKS currency.
 * - `column` — the `users` column that survives a cookie refusal, or null when
 *   there is none. `utm_content` deliberately has no column: it says WHICH
 *   creative, which is an ad-reporting detail, not account data.
 *
 * Own `camp_*` names for the super-properties, never `utm_*`: PostHog already
 * collects `utm_*` by itself on the hit that carries them, and a PERSISTED
 * super-property with the same name would silently overwrite that on every
 * later event — two systems must not fight over one name.
 */
const MARKS = [
  { param: 'utm_source', column: 'signup_utm_source' },
  { param: 'utm_medium', column: 'signup_utm_medium' },
  { param: 'utm_campaign', column: 'signup_utm_campaign' },
  { param: 'utm_content', column: null },
  { param: 'gclid', column: 'signup_gclid' },
];

/** Query parameter → the persisted super-property. `utm_` is dropped, nothing else. */
function campKey(param) {
  return `camp_${param.replace(/^utm_/, '')}`;
}

/**
 * Query parameter → PostHog's OWN first-touch property.
 *
 * PostHog fills `$initial_utm_*` itself — from the address of the first event a
 * person is ever seen on. That address is useless to us: between the page that
 * carried the mark and the moment a person exists (identify, at account
 * creation) sits either Google's OAuth screen or a confirmation email, so what
 * PostHog sees is `/trips` with an empty query — and it writes an explicit null
 * (TRIP-335). We hand it the value instead, under its own canonical names.
 * Unlike `camp_*` these must NOT get names of ours: a second name for first
 * touch is exactly what makes two dashboards disagree.
 */
function initialKey(param) {
  return `$initial_${param}`;
}

/** Every super-property we own, including the timestamp driving the 30-day window. */
export const CAMPAIGN_KEYS = [...MARKS.map((m) => campKey(m.param)), 'camp_ts'];

/**
 * Every spelling a stored payload may use for a mark → the parameter it means:
 * the parameter itself, and the `users` column an older client wrote there.
 *
 * Null-prototype on purpose — this is looked up with keys from an object a
 * stranger controls, and on a plain object `toString` or `constructor` would
 * come back truthy and pose as a match.
 */
const PARAM_BY_KEY = Object.create(null);
for (const { param, column } of MARKS) {
  PARAM_BY_KEY[param] = param;
  if (column) PARAM_BY_KEY[column] = param;
}

// A campaign needs one of these to exist at all. Requiring `utm_campaign` would
// drop exactly the paid clicks we need: Google auto-tagging sends `gclid` alone.
const CAMPAIGN_TRIGGERS = ['utm_source', 'utm_campaign', 'gclid'];

// Last-touch window. Past it the mark is dropped — otherwise a single click
// keeps claiming conversions half a year later.
export const CAMPAIGN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Values come from a URL a stranger controls and land in dashboards — cap them.
const MAX_VALUE_LEN = 200;

/** Trim, cap, and drop what is empty. The ONE place URL input is sanitised. */
function clean(value) {
  return typeof value === 'string' ? value.trim().slice(0, MAX_VALUE_LEN) : '';
}

/** @param {Record<string, string>|null|undefined} marks @returns {boolean} */
function isCampaign(marks) {
  return !!marks && CAMPAIGN_TRIGGERS.some((param) => marks[param]);
}

/**
 * The marks a query string carries, keyed by parameter name.
 *
 * No trigger rule here — that belongs to whoever asks "is this a campaign?".
 * A lone `utm_medium` is still worth recording on the account, because nothing
 * else will ever carry it.
 *
 * @param {string} search  location.search
 * @returns {Record<string, string> | null}  null when the URL carries no marks
 */
export function readMarks(search) {
  // URLSearchParams never throws on a string, however mangled the query is.
  const params = new URLSearchParams(search);

  const out = {};
  for (const { param } of MARKS) {
    const value = clean(params.get(param));
    if (value) out[param] = value;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Marks → the `users` columns. This is the ONLY attribution that survives a
 * refusal: the super-properties ride PostHog, which does not exist until someone
 * consents, while these are account data written once at signup (TRIP-311).
 * @param {Record<string, string> | null | undefined} marks
 * @returns {Record<string, string> | null}
 */
export function marksToColumns(marks) {
  if (!marks) return null;

  const out = {};
  for (const { param, column } of MARKS) {
    if (column && marks[param]) out[column] = marks[param];
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Marks → PostHog's first-touch person properties, via the `users` row.
 *
 * Fed the profile, so the source is the COLUMN rather than the moment of
 * signup — which is what makes it survive a confirmation link opened on another
 * device, consent given after the account exists, or a reload in between.
 *
 * @param {Record<string, string> | null | undefined} row  the `users` row, or
 *   the signup columns alone
 * @returns {Record<string, string> | null}
 */
export function toInitialPersonProps(row) {
  if (!row) return null;

  const out = {};
  for (const { param, column } of MARKS) {
    if (column && row[column]) out[initialKey(param)] = row[column];
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Decide what to do with the campaign mark this visit arrived with.
 *
 * Takes MARKS rather than a query string on purpose: by the time consent is
 * given the address may be long gone, and the marks can just as well have come
 * from the carrier that crossed an OAuth redirect or a confirmation email
 * (TRIP-335). The decision is the same whichever door they came through.
 *
 * @param {Record<string, string>|null} marks  as read by `readMarks`
 * @param {string|null} storedTs               `camp_ts` already persisted (ISO)
 * @param {number} now                         Date.now()
 * @returns {{ set: Record<string, string> } | { clear: true } | null}
 */
export function resolveCampaign(marks, storedTs, now) {
  // A fresh click always wins (last-touch): without overwrite the first channel
  // owns the person forever and the second never gets its conversion.
  if (isCampaign(marks)) {
    const set = { camp_ts: new Date(now).toISOString() };
    for (const { param } of MARKS) {
      if (marks[param]) set[campKey(param)] = marks[param];
    }
    return { set };
  }

  const ts = Date.parse(storedTs || '');
  if (Number.isFinite(ts) && now - ts > CAMPAIGN_TTL_MS) return { clear: true };
  return null;
}

/**
 * The marks a query string carries, re-encoded as a query string of their own —
 * what a link leaving this visit needs in order to arrive marked.
 *
 * A whitelist, not a copy of the query: the address it is read from can itself
 * BE a credential (`/public/trip/:id?t=<share_token>`), and forwarding that onto
 * the landing page would hand the token to every later destination — the leak
 * TRIP-330 closes, re-opened from the other side. Deriving it from `MARKS` is
 * what keeps that whitelist from drifting out of step with the readers.
 *
 * @param {string} search  location.search
 * @returns {string}  encoded query without the leading `?`, empty when unmarked
 */
export function campaignQuery(search) {
  const marks = readMarks(search);
  return marks ? new URLSearchParams(marks).toString() : '';
}

/**
 * Keep only the marks out of an arbitrary object, capped.
 *
 * The email path carries them through Supabase auth metadata, which the client
 * owns and can write anything into. That object is later spread into the INSERT
 * that creates the `users` row, so passing it through unfiltered would let a
 * caller set ANY column on their own profile. Whitelisting here is what makes
 * that spread safe — the value is untrusted input at a trust boundary.
 *
 * Accepts BOTH spellings: the parameter names this module now carries, and the
 * column names an older client wrote. A confirmation email sent before this
 * shipped is still sitting in someone's inbox, and it must not lose its channel
 * when the link is finally clicked.
 *
 * @param {unknown} value
 * @returns {Record<string, string> | null}  marks, keyed by parameter name
 */
export function pickSignupMarks(value) {
  if (!value || typeof value !== 'object') return null;

  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    const param = PARAM_BY_KEY[key];
    if (!param) continue;
    const cleaned = clean(raw);
    if (cleaned) out[param] = cleaned;
  }
  return Object.keys(out).length ? out : null;
}
