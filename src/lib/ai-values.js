/**
 * The trust boundary for AI-parsed booking fields.
 *
 * A model asked for a field it cannot find does not stay silent - it answers in
 * prose: "N/A", "Not provided", "нет данных". Whatever we blacklist, the next
 * run picks a synonym that is not on the list, so enumerating placeholder
 * strings cannot work: both the n8n prompt and the old `v === 'N/A'` guard were
 * that kind of list, and both were observed failing on the same booking.
 *
 * So the question here is not "which strings are junk" but "is this a value of
 * the kind this field holds":
 *
 *   - TYPED fields (phone, e-mail, link, amount, currency, datetime) have a
 *     checkable shape. A phone with no digit, an address with no `@`, a link
 *     with no scheme is not a bad value - it is not a value at all, and it is
 *     dropped. That test is closed: it needs no knowledge of the phrase.
 *   - FREE-TEXT fields (name, carrier, addresses, booking reference) have no
 *     shape - "N/A" is a syntactically valid hotel name - so they pass through.
 *     Dropping one would also hide it: the field would sit empty with no hint
 *     that the model claimed anything, whereas passing it through lands it
 *     tinted in the review step under the standard validation (see
 *     memory/triplanio-validation-unification.md). Keeping prose out of those
 *     is the n8n prompt's contract, not this gate's.
 */

/** Shape tests, by kind. Each answers only "could this be one of these?". */
const AI_SHAPES = {
  // Any digit. Deliberately loose - formats vary by country, and rejecting a
  // real number is worse than letting an odd one through to be edited.
  phone: (v) => /\d/.test(v),
  email: (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
  // Absolute http(s) only. `normalizeExternalUrl` is NOT a test - it prepends
  // "https://" to anything, so it would happily turn "Not provided" into a link.
  url: (v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  },
  // Kept as text (the form holds strings and the engine validates downstream);
  // this only asks whether it is a number at all.
  amount: (v) => Number.isFinite(Number(v.replace(',', '.'))),
  currency: (v) => /^[A-Za-z]{3}$/.test(v),
  // `datetime-local` cannot hold an invalid value - anything that is not
  // YYYY-MM-DDTHH:mm silently blanks the input instead of showing the junk.
  datetime: (v) => /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(v),
};

/** Which form fields are typed, and as what. Anything absent is free text. */
const AI_FIELD_SHAPE = {
  phone: 'phone',
  email: 'email',
  booking_url: 'url',
  price: 'amount',
  currency: 'currency',
  free_cancellation_until_local: 'datetime',
};

/**
 * The parsed value for a form field, or null when the model gave us nothing
 * usable. Keyed by the FORM field name, so one lookup serves every merge path
 * (hotel, single-leg transfer, layover segments).
 *
 * @param {string} key - form field name
 * @param {unknown} v - raw value from the parser
 * @returns {string|null} trimmed value, or null
 */
export function aiField(key, v) {
  if (v == null) return null;
  const s = typeof v === 'string' ? v.trim() : String(v);
  if (s === '') return null;
  const shape = AI_SHAPES[AI_FIELD_SHAPE[key]];
  return shape && !shape(s) ? null : s;
}
