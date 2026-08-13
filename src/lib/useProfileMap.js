// Indexes a Profile[] (the wire shape from supabase/functions/_shared/profiles.ts)
// by id, so resolveAuthor can look a profile up by user_id. Profiles arrive with
// the trip content bundle (getTripDetails, TRIP-230) — this is just the
// array→map step, done once in TripView and handed to every people-showing lens.
//
// The "deleted account" label is deliberately NOT applied here. That single rule
// lives in resolveAuthor (the one identity door): a soft-deleted account carries
// is_deleted:true on its profile, and resolveAuthor turns it into the localized
// label. Applying it in two places is what this file used to do, and it drifted.

import { useMemo } from 'react';

/**
 * @param {object[]} profiles - list of profiles ({ id, full_name, … })
 */
export function useProfileMap(profiles) {
  return useMemo(() => {
    const out = {};
    for (const p of profiles || []) if (p?.id) out[p.id] = p;
    return out;
  }, [profiles]);
}
