// Campaign attribution (TRIP-316) — pure helpers.
//
// `npm test` runs these under plain `node --test`, so this module stays
// dependency-free (same rule as trip-cities.js). Everything that touches
// PostHog (register / unregister / person properties) lives in analytics.js.
//
// Own `camp_*` names, never `utm_*`: PostHog already collects utm_* by itself
// on the hit that carries them, and a PERSISTED super-property with the same
// name would silently overwrite that on every later event — two systems must
// not fight over one name.

/** Ad/UTM query parameter → the super-property we persist for it. */
const CAMPAIGN_FIELDS = {
  utm_source: 'camp_source',
  utm_medium: 'camp_medium',
  utm_campaign: 'camp_campaign',
  utm_content: 'camp_content',
  gclid: 'camp_gclid',
};

/** Every key we own, including the timestamp that drives the 30-day window. */
export const CAMPAIGN_KEYS = [...Object.values(CAMPAIGN_FIELDS), 'camp_ts'];

/**
 * The same marks, as columns on `users` — one parameter short, since there is no
 * column for `utm_content`. This is the ONLY attribution that survives a refusal:
 * the mark above rides PostHog, which does not exist until someone consents,
 * while these are account data written once at signup (TRIP-311).
 */
const SIGNUP_COLUMNS = {
  utm_source: 'signup_utm_source',
  utm_medium: 'signup_utm_medium',
  utm_campaign: 'signup_utm_campaign',
  gclid: 'signup_gclid',
};

/**
 * The same four marks under PostHog's OWN first-touch names.
 *
 * PostHog fills `$initial_utm_*` itself — from the address of the first event a
 * person is ever seen on. That address is useless to us: between the page that
 * carried the mark and the moment a person exists (identify, at account
 * creation) sits either Google's OAuth screen or a confirmation email, so what
 * PostHog sees is always `/trips` with an empty query. Measured on prod: all 24
 * persons carry `$initial_current_url = /login | /settings | /trips` and
 * `$initial_utm_* = NULL`.
 *
 * So we hand it the value instead. These are PostHog's canonical property names
 * written through its own `set_once` — not a parallel scheme: the field is the
 * one a report already expects, it is simply filled from the snapshot that DID
 * see the arrival. Unlike `camp_*` this must NOT get our own names: a second
 * name for first touch is exactly what makes two dashboards disagree.
 */
const INITIAL_PERSON_PROPS = {
  signup_utm_source: '$initial_utm_source',
  signup_utm_medium: '$initial_utm_medium',
  signup_utm_campaign: '$initial_utm_campaign',
  signup_gclid: '$initial_gclid',
};

/** The same parameters under their own names, for passing a mark ON unchanged. */
const CAMPAIGN_PASSTHROUGH = Object.fromEntries(
  Object.keys(CAMPAIGN_FIELDS).map((param) => [param, param]),
);

// Last-touch window. Past it the mark is dropped — otherwise a single click
// keeps claiming conversions half a year later.
export const CAMPAIGN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Values come from a URL a stranger controls and land in dashboards — cap them.
const MAX_VALUE_LEN = 200;

/**
 * Decide what to do with the campaign mark for the current URL.
 * @param {string} search            location.search
 * @param {string|null} storedTs     `camp_ts` already persisted (ISO), if any
 * @param {number} now               Date.now()
 * @returns {{ set: Record<string, string> } | { clear: true } | null}
 */
export function resolveCampaign(search, storedTs, now) {
  const incoming = readCampaignParams(search);
  // A fresh click always wins (last-touch): without overwrite the first channel
  // owns the person forever and the second never gets its conversion.
  if (incoming) return { set: { ...incoming, camp_ts: new Date(now).toISOString() } };

  const ts = Date.parse(storedTs || '');
  if (Number.isFinite(ts) && now - ts > CAMPAIGN_TTL_MS) return { clear: true };
  return null;
}

/**
 * Extract the campaign keys carried by a query string.
 * @param {string} search  location.search
 * @returns {Record<string, string> | null}  null when the URL carries no campaign
 */
function readCampaignParams(search) {
  const out = readParams(search, CAMPAIGN_FIELDS);

  // Trigger on source / campaign / gclid. Requiring utm_campaign would drop
  // exactly the paid clicks we need: Google auto-tagging sends gclid alone.
  return (out?.camp_source || out?.camp_campaign || out?.camp_gclid) ? out : null;
}

/**
 * Pull one field map out of a query string, trimmed and capped. The single place
 * the cap is applied to URL input, so the two maps cannot drift apart on it.
 * @param {string} search
 * @param {Record<string, string>} fields  query parameter → output key
 * @returns {Record<string, string> | null}  null when none of them are present
 */
function readParams(search, fields) {
  // URLSearchParams never throws on a string, however mangled the query is.
  const params = new URLSearchParams(search);

  const out = {};
  for (const [param, key] of Object.entries(fields)) {
    const value = (params.get(param) || '').trim().slice(0, MAX_VALUE_LEN);
    if (value) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * The campaign parameters a query string carries, re-encoded as a query string
 * of their own — what a link leaving this visit needs in order to arrive marked.
 *
 * A whitelist, not a copy of the query: the address it is read from can itself
 * BE a credential (`/public/trip/:id?t=<share_token>`), and forwarding that onto
 * the landing page would hand the token to every later destination — the leak
 * TRIP-330 closes, re-opened from the other side.
 *
 * @param {string} search  location.search
 * @returns {string}  encoded query without the leading `?`, empty when unmarked
 */
export function campaignQuery(search) {
  const carried = readParams(search, CAMPAIGN_PASSTHROUGH);
  return carried ? new URLSearchParams(carried).toString() : '';
}

/**
 * Extract the signup-attribution columns carried by a query string. Unlike the
 * campaign mark this has no trigger rule — a lone `utm_medium` is still worth
 * recording on the account, because nothing else will ever carry it.
 * @param {string} search  location.search
 * @returns {Record<string, string> | null}  null when the URL carries no marks
 */
export function readSignupAttribution(search) {
  return readParams(search, SIGNUP_COLUMNS);
}

/**
 * Keep only the four attribution columns out of an arbitrary object, capped.
 *
 * The email path carries these through Supabase auth metadata, which the client
 * owns and can write anything into. That object is later spread into the INSERT
 * that creates the `users` row, so passing it through unfiltered would let a
 * caller set ANY column on their own profile. Whitelisting here is what makes
 * that spread safe — the value is untrusted input at a trust boundary.
 *
 * @param {unknown} value
 * @returns {Record<string, string> | null}
 */
export function pickSignupAttribution(value) {
  if (!value || typeof value !== 'object') return null;

  const out = {};
  for (const column of Object.values(SIGNUP_COLUMNS)) {
    const raw = value[column];
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim().slice(0, MAX_VALUE_LEN);
    if (trimmed) out[column] = trimmed;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Translate the signup-attribution columns into PostHog's first-touch person
 * properties. Same values, same moment, two stores — `users.signup_utm_*` for
 * everyone including cookie refusers, this for whoever PostHog can see.
 *
 * Values arrive already trimmed and capped, from the two readers above — this is
 * a rename, not a second door onto URL input.
 *
 * @param {Record<string, string> | null | undefined} marks  as written to `users`
 * @returns {Record<string, string> | null}  null when there is nothing to say
 */
export function toInitialPersonProps(marks) {
  if (!marks) return null;

  const out = {};
  for (const [column, property] of Object.entries(INITIAL_PERSON_PROPS)) {
    if (marks[column]) out[property] = marks[column];
  }
  return Object.keys(out).length ? out : null;
}
