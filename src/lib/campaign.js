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
  // URLSearchParams never throws on a string, however mangled the query is.
  const params = new URLSearchParams(search);

  const out = {};
  for (const [param, key] of Object.entries(CAMPAIGN_FIELDS)) {
    const value = (params.get(param) || '').trim().slice(0, MAX_VALUE_LEN);
    if (value) out[key] = value;
  }

  // Trigger on source / campaign / gclid. Requiring utm_campaign would drop
  // exactly the paid clicks we need: Google auto-tagging sends gclid alone.
  return (out.camp_source || out.camp_campaign || out.camp_gclid) ? out : null;
}
