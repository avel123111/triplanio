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
