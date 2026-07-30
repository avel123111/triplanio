// The consent record itself (TRIP-311) — its shape and the rules that decide
// whether a stored answer still counts.
//
// Pure and dependency-free so `npm test` runs it under plain `node --test`
// (same rule as campaign.js). Everything that touches storage, PostHog or gtag
// lives in consent.js.

/**
 * Bump to re-ask everyone. Needed whenever the banner starts asking about a
 * purpose it did not ask about before: an answer given to the old question is
 * not an answer to the new one (TRIP-227 adds the granular layer).
 */
export const CONSENT_VERSION = 1;

/** Answers older than this are re-asked rather than assumed to still hold. */
export const CONSENT_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Read a stored answer, or null when there isn't a usable one.
 *
 * Null is the ONE signal the app acts on: it means "we have no answer", and the
 * caller responds identically to every reason behind it — wipe PostHog's keys
 * and ask again. Silently treating a stale or half-written record as consent is
 * the failure this function exists to prevent.
 *
 * @param {string|null} raw  the localStorage value
 * @param {number} now       Date.now()
 * @returns {{v:number, ts:string, analytics:boolean, marketing:boolean}|null}
 */
export function parseConsent(raw, now) {
  if (!raw) return null;

  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!record || record.v !== CONSENT_VERSION) return null;

  const ts = Date.parse(record.ts || '');
  if (!Number.isFinite(ts) || now - ts > CONSENT_MAX_AGE_MS) return null;

  // Re-read as booleans: the record comes back from a store the user can edit,
  // so a truthy string must not become consent.
  return {
    v: CONSENT_VERSION,
    ts: record.ts,
    analytics: record.analytics === true,
    marketing: record.marketing === true,
  };
}

/**
 * Build the record for the answer just given. Both purposes move together
 * because the banner asks about them in one sentence — recording a granular
 * answer to a question we never asked would be the same lie in the other
 * direction. The split arrives with the "Customise" layer in TRIP-227.
 * @param {boolean} accepted
 * @param {number} now  Date.now()
 */
export function buildConsent(accepted, now) {
  return {
    v: CONSENT_VERSION,
    ts: new Date(now).toISOString(),
    analytics: accepted,
    marketing: accepted,
  };
}
