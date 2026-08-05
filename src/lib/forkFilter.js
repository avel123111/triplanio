// Pure filter/sort engine shared by every "fork" search list (hotels, activities,
// and whatever comes next). React-free so it unit-tests under `node --test`.
//
// ONE contract, two halves:
//  · the FILTERS OBJECT — every user-tunable knob of a fork list lives in one flat
//    object, INCLUDING the text query and the sort key. "Reset" replaces that whole
//    object with the base (see useForkList), so a knob can never be forgotten by a
//    hand-written list of setters. That is exactly how TRIP-293 happened: the
//    activity list kept `query` in its own useState next to eight others, its reset
//    listed the other seven, and the no-match state's "Reset" button did nothing
//    whenever the text search was the reason nothing matched.
//  · the SPEC — the per-list adapter: where the searchable text lives, where the
//    price lives, which boolean flags exist and their comparators. Everything
//    list-specific sits HERE, so the engine itself never grows a per-list branch.
//
// A sort key with no comparator in `spec.sorts` (e.g. 'recommended') keeps the pool
// order — relevance ranking from the supplier is the default for both lists.

// Every fork list has at least these four. A list adds its own booleans on top
// (activities: freeCancel) — see BASE_ACTIVITY_FILTERS.
export const BASE_FORK_FILTERS = { text: '', min: '', max: '', sortBy: 'recommended' };

/**
 * Filter + sort a pooled result list. Returns a NEW array; the input is never
 * mutated and its order is preserved unless a comparator is picked.
 *
 * @param {Array}  items                the pool (may be null/undefined)
 * @param {object} filters              current filters object (missing keys fall back to the base)
 * @param {object} spec                 per-list adapter
 * @param {(item)=>string} spec.text    searchable text (name + address / title + desc)
 * @param {(item)=>number|null} spec.price  comparable price in the trip currency
 * @param {object} spec.flags           { filterKey: (item)=>boolean } — boolean filters
 * @param {object} spec.sorts           { sortKey: comparator } — omit a key to keep pool order
 */
export function applyForkFilters(items, filters = {}, spec = {}) {
  const f = { ...BASE_FORK_FILTERS, ...filters };
  const q = String(f.text || '').trim().toLowerCase();
  const lo = bound(f.min);
  const hi = bound(f.max);
  const priceActive = lo != null || hi != null;
  const { text: textOf, price: priceOf, sorts } = spec;
  const flags = Object.entries(spec.flags || {});

  // filter() already hands back a fresh array, so sorting it in place never
  // touches the caller's pool.
  const out = (items || []).filter((it) => {
    if (q && textOf && !String(textOf(it) || '').toLowerCase().includes(q)) return false;
    for (const [key, pred] of flags) if (f[key] && !pred(it)) return false;
    if (priceActive && priceOf) {
      const p = priceOf(it);
      if (p == null) return false; // no comparable price → hidden while filtering by price
      if (lo != null && p < lo) return false;
      if (hi != null && p > hi) return false;
    }
    return true;
  });

  const cmp = sorts?.[f.sortBy];
  return cmp ? out.sort(cmp) : out;
}

// An empty input field means "no bound", not 0.
function bound(v) {
  return v === '' || v == null ? null : Number(v);
}

// The `spec.price` contract: a comparable number, or null for "no price" (which
// hides the item while a bound is set). Suppliers may send anything.
export const numberOrNull = (v) => (typeof v === 'number' ? v : null);

// Shared comparators — "unknown last" in BOTH directions, so a missing price or
// score never jumps to the top of the list.
//
// Two deliberate details. The sentinels are infinities rather than 0/-1: every
// value we sort on today is non-negative, but a sentinel sitting inside the real
// value range would silently rank "unknown" above real data the first time a list
// sorts on something that can go negative. And the comparison is </> rather than
// a subtraction, which would yield NaN for two unknowns (Infinity - Infinity).
const cmpNum = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
export const byNumberAsc = (read) => (a, b) => cmpNum(read(a) ?? Infinity, read(b) ?? Infinity);
export const byNumberDesc = (read) => (a, b) => cmpNum(read(b) ?? -Infinity, read(a) ?? -Infinity);
