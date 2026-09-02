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
 * Whether we may identify a person to analytics (TRIP-502, revises TRIP-407 P1).
 * `identify(uid)` links the anonymous history to a pseudonymous account number
 * (uid — an opaque UUID, never name/email), which is now allowed WITHOUT cookie
 * consent on a legitimate-interest basis (product decision, Ilia 02.09.2026). So
 * the gate is readiness, not persistence: identify the moment the client is booted.
 *
 * Why this changed: TRIP-407 gated identify on `isPersisting()`, which meant a
 * logged-in visitor who ignored the banner (all of the ad traffic) was NEVER
 * identified — so their landing/CTA/signup stayed three anonymous strangers and
 * the acquisition funnel, retention and engagement all broke. In memory mode
 * identify still writes NOTHING to the device (only a server-side anon→uid link),
 * so the ePrivacy "zero bytes on device before consent" line is intact; only the
 * GDPR processing (the link) is what consent no longer gates.
 *
 * The `ready` guard remains meaningful: before boot there is no client to identify
 * onto, and after a withdrawal `isReady()` is false, so identify stops with capture.
 *
 * @param {string|null|undefined} uid
 * @param {boolean} ready  isReady() — the client has booted (memory OR localStorage)
 * @returns {boolean}
 */
export function mayIdentify(uid, ready) {
  return !!uid && ready === true;
}
