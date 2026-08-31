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

/** Does the set about to be written say exactly what is already stored? */
function sameCampaign(set, stored) {
  // Walked over MARKS, not CAMPAIGN_KEYS: the marks are what identifies a click,
  // and `camp_ts` is the answer being decided — comparing it would be circular.
  return MARKS.every(
    ({ param }) => (set[campKey(param)] || null) === (stored[campKey(param)] || null),
  );
}

/**
 * Decide what to do with the campaign mark this visit arrived with.
 *
 * Takes MARKS rather than a query string on purpose: by the time consent is
 * given the address may be long gone, and the marks can just as well have come
 * from the carrier that crossed an OAuth redirect or a confirmation email
 * (TRIP-335). The decision is the same whichever door they came through.
 *
 * `stored` is the WHOLE stored set, not just its timestamp: without the stored
 * marks this cannot tell a NEW click from the SAME click seen twice, and that
 * difference is the rule below.
 *
 * THE SAME CLICK IS ONE TOUCH, however often the page loads (TRIP-493).
 * `camp_ts` starts the 30-day last-touch window, so rewriting it on every load
 * of a marked address extends that window for as long as the address is around.
 * That was harmless while the only marked address was the landing page, and
 * stopped being harmless once the marks began riding the address INTO the app
 * (`/trips?utm_source=…`) — a screen that is reloaded all day. So an unchanged
 * mark writes nothing at all, and the window runs from the first sight of it.
 * Accepted consequence: clicking the SAME ad again inside the window does not
 * extend it — that campaign already owns the person for the rest of it, and
 * once it expires the mark is cleared, so the next click registers fresh. A
 * DIFFERENT mark still wins immediately, which is what last touch means.
 *
 * @param {Record<string, string>|null} marks  as read by `readMarks`
 * @param {Record<string, string>|null} stored the `camp_*` super-properties this
 *   browser already carries (including `camp_ts`), null when nothing is stored
 * @param {number} now                         Date.now()
 * @returns {{ set: Record<string, string> } | { clear: true } | null}
 */
export function resolveCampaign(marks, stored, now) {
  // A fresh click always wins (last-touch): without overwrite the first channel
  // owns the person forever and the second never gets its conversion.
  if (isCampaign(marks)) {
    const set = { camp_ts: new Date(now).toISOString() };
    for (const { param } of MARKS) {
      if (marks[param]) set[campKey(param)] = marks[param];
    }
    // Already stored, to the letter: this is the same click coming round again,
    // and the only thing a rewrite would change is the window's start date.
    if (stored?.camp_ts && sameCampaign(set, stored)) return null;
    return { set };
  }

  const ts = Date.parse(stored?.camp_ts || '');
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

/**
 * Which marks the signup being made carries, and whether the OAuth stash is spent.
 *
 * WHY THIS IS A PURE FUNCTION (TRIP-316/TRIP-335 follow-up). The marks have to
 * cross a document replacement, and until now the rule that decides which carrier
 * wins lived inside `attribution.js` — a module glued to `window`, so it could not
 * have a test. It broke exactly the way an untested money decision breaks: silently,
 * and only visible months later as a paid signup filed under "organic". Same move as
 * `isSafeInternalPath` / `authFlowCode` / `loadStateClassify`: the decision is a pure
 * function with a gate, the storage read stays a thin shell around it.
 *
 * TWO RULES, and the second is the one that bites:
 *   1. THE ADDRESS WINS. A mark in the URL beat the redirect on its own; the stash
 *      is the fallback for the border the address could not cross. The address also
 *      survives a browser that refuses storage (private mode, ITP) — which is the
 *      failure that lost a real paid signup.
 *   2. A RESOLVED SIGNUP SPENDS THE STASH, whichever carrier won. Leaving it would
 *      credit this click to whoever registers next in the same tab. Skipping this
 *      when the address wins is the regression that makes rule 1 look free.
 *
 * @param {Record<string, string>|null} visitMarks  marks on THIS document's address
 * @param {string|null} stashedRaw  raw JSON the OAuth stash holds, null when empty
 * @returns {{ marks: Record<string, string>|null, spendStash: boolean }}
 */
export function resolveSignupMarks(visitMarks, stashedRaw) {
  // A stash that exists is spent by this signup even when it lost — see rule 2.
  const spendStash = Boolean(stashedRaw);
  if (visitMarks) return { marks: visitMarks, spendStash };

  // The stash is JSON WE wrote, but it comes back out of storage a stranger can
  // reach, so a malformed payload is data, not a crash.
  let parsed = null;
  try { parsed = JSON.parse(stashedRaw || 'null'); } catch { /* junk in storage */ }
  return { marks: pickSignupMarks(parsed), spendStash };
}
