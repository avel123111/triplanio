// The consent record itself (TRIP-311) — its shape and the rules that decide
// whether a stored answer still counts.
//
// Pure and dependency-free so `npm test` runs it under plain `node --test`
// (same rule as campaign.js). Everything that touches storage, PostHog or gtag
// lives in consent.js.

/** Bump to re-ask everyone: an answer to the old question is not an answer to a new one. */
export const CONSENT_VERSION = 1;

/** Answers older than this are re-asked rather than assumed to still hold. */
export const CONSENT_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Read a stored answer, or null when there is no usable one. Null is the single
 * signal callers act on, whatever the reason behind it: wipe the keys and ask
 * again. Treating a stale or half-written record as consent is the failure this
 * prevents.
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

  // The store is user-editable: a truthy string must not become consent.
  return {
    v: CONSENT_VERSION,
    ts: record.ts,
    analytics: record.analytics === true,
    marketing: record.marketing === true,
  };
}

/**
 * Both purposes move together: the banner asks about them in one sentence, and
 * recording a granular answer to a question we never asked is the same lie in
 * the other direction. TRIP-227 splits it.
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

/**
 * Whether a `storage`-event consent change in ANOTHER tab should make this tab
 * silence + wipe (TRIP-407, variant B). The trap this pins: under B the client
 * runs in every tab from load, so "is analytics live" (readiness) is true even in
 * a tab that never persisted anything — keying on it would clear/reload a
 * memory-only tab on a foreign refusal, throwing away captures it was entitled to.
 * So the decision keys on whether THIS tab was PERSISTING to the device, and fires
 * only when the new answer is not an analytics grant (a refusal, a withdrawal, or
 * an unusable/expired record — all of which parse to a non-`true` `analytics`).
 *
 * @param {boolean} persisting  does this tab write PostHog keys to the device
 * @param {ReturnType<typeof parseConsent>} record  the other tab's new answer
 * @returns {boolean}
 */
export function shouldSilenceOnConsentChange(persisting, record) {
  return persisting && record?.analytics !== true;
}

/**
 * Whether we may identify a person to analytics (TRIP-407 P1). `identify(uid)` is
 * a network event that CREATES a server-side person under that uid — a "person"
 * operation — so it requires the SAME consent that lets us persist to the device,
 * NOT merely a live (memory-only) client. So: a uid AND a persisting document.
 *
 * The trap: under variant B the client is "ready" from load, so a logged-in
 * visitor who REFUSED cookies (or has not answered) would otherwise be identified
 * anyway — a real person without consent. Anonymous capture rides `isReady()`;
 * identity waits for `isPersisting()`.
 *
 * @param {string|null|undefined} uid
 * @param {boolean} persisting  isPersisting() — this document writes to the device
 * @returns {boolean}
 */
export function mayIdentify(uid, persisting) {
  return !!uid && persisting === true;
}
