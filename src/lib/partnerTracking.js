// Logs a partner-referral click into the PartnerClick entity.
// Fire-and-forget: failures must not block the user's navigation to the partner.
import { supabase } from '@/api/supabaseClient';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/AuthContext';
import { useCallback } from 'react';

/**
 * Low-level logger. Use the `usePartnerLogger` hook in components instead.
 */
export function logPartnerClick({ partner, type, link, provider, campaign, fallback, tripId, user }) {
  if (!partner || !type || !link) return;
  try {
    const payload = {
      partner,
      type,
      link,
      // Affiliate network the click is monetized through (travelpayouts, stay22).
      // Non-affiliate direct links pass nothing → stored as NULL.
      provider: provider || null,
      // Click surface / campaign (fork_modal_button | fork_api_search) and whether
      // the URL was a generic/homepage fallback rather than a deep-link (TRIP-244).
      campaign: campaign || null,
      fallback: typeof fallback === 'boolean' ? fallback : null,
      trip_id: tripId || null,
      user_id: user?.id || '',
    };
    // Fire-and-forget - don't await, don't throw
    supabase.from('partner_clicks').insert(payload).then(() => {}, () => { /* ignore */ });
    // Same click as a product-analytics event (no PII — partner/type/campaign only).
    track('service_opened', { trip_id: tripId || undefined, service: type, partner, campaign: campaign || undefined });
  } catch {
    /* ignore */
  }
}

/**
 * Hook that returns a memoized logger bound to the current user (and optional tripId).
 * Usage:
 *   const logClick = usePartnerLogger(tripId);
 *   logClick({ partner: 'airalo', type: 'esim', link: url });
 */
export function usePartnerLogger(tripId) {
  const { user } = useAuth();
  return useCallback(
    ({ partner, type, link, provider, campaign, fallback }) =>
      logPartnerClick({ partner, type, link, provider, campaign, fallback, tripId, user }),
    [user, tripId]
  );
}