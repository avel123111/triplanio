// Unified ACCOUNT-level Pro status (TRIP-135).
//
// ONE source of truth for "is THIS user Pro" across the whole app: the cached
// `users` row (subscription_status / subscription_end_date), read instantly via
// isProActive(user) — the SAME value the Pro badge and every feature gate already
// use. The account plaque reads THIS, never a second verdict, so badge and plaque
// can no longer disagree (the bug: "Free" plaque next to a Pro badge).
//
// Layered design (clean separation, provider-agnostic verdict):
//   • Verdict  — isProActive(user). Instant, no network, always available. Mirrors
//                the server's single SQL source is_user_pro(). Provider-neutral:
//                it reads the normalized users cache, not Stripe.
//   • Details  — getUserPlan (price / period end / cancelled / type) for the plaque
//                body. A SEPARATE layer: if it fails, the verdict stays valid and
//                only the details degrade to a retry — a failure NEVER downgrades
//                the plaque to "Free".
//   • Freshness — getUserPlan runs reconcileEntitlement server-side (lazy
//                recompute-on-read, unchanged). If the authoritative post-reconcile
//                verdict disagrees with the cached row, resync the row
//                (checkUserAuth) so the instant verdict self-corrects app-wide.
//
// This lives in its own module (not subscription.js) on purpose: subscription.js
// must stay free of '@/'-aliased top-level imports so the pure isProActive formula
// remains importable under `node --test` (the drift-guard test). This hook is only
// imported by React screens.
//
// Shared react-query key ['my-pro-status'] — already invalidated by
// StripeReturnModals after checkout — so all consumers share ONE background
// revalidation instead of each firing getUserPlan.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { isProActive } from '@/lib/subscription';

export function useProStatus() {
  const { user, checkUserAuth } = useAuth();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ['my-pro-status'],
    enabled: !!user?.id,
    // Match the trip-badge cadence (['travel-stats'] uses 30s) so the account
    // plaque can't lag minutes behind the trip cards after a background sub change.
    staleTime: 30 * 1000,
    gcTime: 30 * 60 * 1000,
    // A transient getUserPlan failure must not be treated as "free" — retry a
    // couple of times; the verdict is read from the cache regardless.
    retry: 2,
    queryFn: async () => {
      const { supabase } = await import('@/api/supabaseClient');
      const { data, error } = await supabase.functions.invoke('getUserPlan');
      if (error) throw error;
      // Authoritative verdict AFTER the server reconcile. If it disagrees with the
      // cached row the client reads, refresh the row so isProActive(user) converges,
      // and nudge the trip-badge cache so the whole UI flips together (not piecemeal).
      const serverPro = data?.plan === 'pro';
      if (serverPro !== isProActive(user)) {
        try { await checkUserAuth(); } catch { /* non-fatal — next read reconciles */ }
        qc.invalidateQueries({ queryKey: ['travel-stats'] });
      }
      return data ?? null;
    },
  });

  return {
    // Instant verdict from the cached users row (same formula as is_user_pro).
    isPro: isProActive(user),
    // Billing details for the plaque body (null until loaded / on error).
    plan: q.data ?? null,
    detailsLoading: q.isLoading,
    detailsError: q.isError,
    refetchDetails: q.refetch,
  };
}
