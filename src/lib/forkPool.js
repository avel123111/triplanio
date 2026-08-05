// Pool assembly for the "fork" search lists. React-free so it unit-tests under
// `node --test`.
//
// Both fork panels load a city in pages (page 1 paints instantly, the tail bursts
// in the background) and merge those pages into ONE client pool that feeds the
// list, the filters and — for hotels — the map pins. That merge was written twice
// with the same intent and two different sets of guarantees: hotels deduped by
// `id` and capped the pool, activities deduped by `code` and had no cap at all.
// The cap is not decoration — without it a supplier that suddenly returns more
// pages grows the pool (and the DOM) unbounded. One implementation, with the
// dedup key and the cap as parameters, so a third list cannot inherit half of it.

/**
 * Merge already-fetched pages into one deduped, capped pool.
 *
 * Dedup keeps the FIRST occurrence of a key: earlier pages rank higher with both
 * suppliers, so the kept entry is the more relevant one. A page may be undefined
 * while it is still loading (progressive load) and is skipped.
 *
 * @param {Array<Array|undefined>} pages fetched pages, in rank order
 * @param {object} opts
 * @param {(item)=>any} opts.getKey      identity of an item (id / product code)
 * @param {number} [opts.cap]            hard ceiling on the pooled items
 * @returns {{ items: Array, truncated: boolean }} truncated = the cap dropped real items
 */
export function mergeById(pages, { getKey, cap = Infinity } = {}) {
  const seen = new Set();
  const items = [];
  let truncated = false;
  for (const page of pages || []) {
    if (!Array.isArray(page)) continue;
    for (const it of page) {
      if (it == null) continue;
      const raw = getKey(it);
      if (raw == null) continue;
      const key = String(raw); // suppliers send ids as number or string
      if (seen.has(key)) continue;
      seen.add(key);
      if (items.length >= cap) { truncated = true; continue; }
      items.push(it);
    }
  }
  return { items, truncated };
}
