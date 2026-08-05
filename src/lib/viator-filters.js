// Pure client-side filter contract for the Viator activity fork list: the base
// filters object + the spec that says where each knob reads from an activity.
// Kept free of React/supabase imports so it is unit-testable under `node --test`
// — the same split as stay22-normalize.js next door (which additionally maps the
// Stay22 response; Viator's mapping lives in the edge function, so there is
// nothing to normalize on this side).

// Relative import (not the `@/` alias) so `node --test` can load this file
// directly, the same reason the mapping helpers live outside stay22.js/viator.js.
import { BASE_FORK_FILTERS, applyForkFilters, byNumberAsc, byNumberDesc, numberOrNull } from './forkFilter.js';

// Every client knob of the activity list, in ONE object. This is both the initial
// state and the reset target (useForkList) — a filter that is not here is a filter
// "Reset" would forget, which is what TRIP-293 was.
export const BASE_ACTIVITY_FILTERS = { ...BASE_FORK_FILTERS, freeCancel: false };

// Where each knob reads from an activity. Text spans title + description (the
// short summary Viator returns); price is `fromPrice` (per-person "from" price in
// the trip currency). Sort: 'recommended' (Viator relevance, pool order — no
// comparator) / 'price' ↑ / 'reviews' ↓.
export const VIATOR_FILTER_SPEC = {
  text: (a) => `${a?.title || ''} ${a?.desc || ''}`,
  price: (a) => numberOrNull(a?.fromPrice),
  flags: { freeCancel: (a) => !!a?.freeCancellation },
  sorts: {
    price: byNumberAsc((a) => a?.fromPrice),
    reviews: byNumberDesc((a) => a?.reviewCount),
  },
};

export function applyActivityFilters(activities, filters) {
  return applyForkFilters(activities, filters, VIATOR_FILTER_SPEC);
}
