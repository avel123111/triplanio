// Stay22 accommodations data layer for the hotel "fork" side-panel.
//
// Fetches live bookable stays for a city via the `stay22Accommodations` edge
// function (which holds the X-API-KEY secret server-side). Nothing is persisted:
// the panel fetches on open and React Query caches the result client-side.
//
// Pure mapping/param helpers live in ./stay22-normalize.js so they can be
// unit-tested without React/supabase.

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { normalizeStay22, buildStay22Params, STAY22_KEY } from '@/lib/stay22-normalize';

export { normalizeStay22, buildStay22Params, STAY22_KEY };

/**
 * React Query hook for the hotel fork panel.
 * @param {object} args
 * @param {object} args.visit    city-visit node (needs latitude/longitude, start_date, end_date)
 * @param {string} args.currency trip currency (EUR/USD)
 * @param {string} args.lang     user locale (en/es/ru)
 * @param {number} args.page     1-based page
 * @param {boolean} args.enabled fetch only while the panel is open
 */
export function useStay22Accommodations({ visit, currency, lang, page = 1, filters, enabled = true }) {
  const params = buildStay22Params({ visit, currency, lang, page, filters });
  return useQuery({
    queryKey: STAY22_KEY(visit, currency, lang, page, filters),
    enabled: !!enabled && !!params,
    placeholderData: keepPreviousData, // keep the previous page visible while the next loads
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('stay22Accommodations', { body: params });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return normalizeStay22(data);
    },
  });
}
