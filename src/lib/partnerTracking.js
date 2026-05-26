// Logs a partner-referral click into the PartnerClick entity.
// Fire-and-forget: failures must not block the user's navigation to the partner.
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useCallback } from 'react';

/**
 * Low-level logger. Use the `usePartnerLogger` hook in components instead.
 */
export function logPartnerClick({ partner, type, link, tripId, user }) {
  if (!partner || !type || !link) return;
  try {
    const payload = {
      partner,
      type,
      link,
      trip_id: tripId || '',
      user_id: user?.id || '',
      user_email: user?.email || '',
    };
    // Fire-and-forget — don't await, don't throw
    base44.entities.PartnerClick.create(payload).catch(() => { /* ignore */ });
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
    ({ partner, type, link }) =>
      logPartnerClick({ partner, type, link, tripId, user }),
    [user, tripId]
  );
}