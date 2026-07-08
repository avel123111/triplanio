// checkSubscriptionStatus
// Returns whether the given trip should have Pro features unlocked.
// Pro is available if EITHER the trip is a one-time pro_trip OR the trip's
// OWNER has an active Pro subscription. Without a tripId, falls back to the
// caller's own subscription (used by the trip-creation paywall).
import { corsFor } from '../_shared/cors.ts';
import { supabaseAdmin as admin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { captureEdgeError } from '../_shared/sentry.ts';
import { reconcileEntitlement, needsEntitlementReconcile, reconcileTripEntitlement } from '../_shared/reconcileEntitlement.ts';
import { isNotFound } from '../_shared/classifyDbError.ts';

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { tripId } = await req.json().catch(() => ({}));
    // No trip context → check caller's own subscription.
    if (!tripId) {
      const { data: me } = await admin
        .from('users').select('subscription_status, subscription_end_date')
        .eq('id', user.id).single();
      // recompute-on-read (Ф3): self-heal a wrong cache, throttled (stuck-PRO /
      // stuck-FREE). Предикат — единый (O1).
      if (await needsEntitlementReconcile(admin, user.id, me?.subscription_status, me?.subscription_end_date))
        await reconcileEntitlement(admin, user.id);
      // Verdict from the single SQL source (is_user_pro, migration 0055) — reads the
      // post-reconcile state, so no manual re-select needed.
      const { data: isProRpc, error: isProErr } = await admin.rpc('is_user_pro', { p_uid: user.id });
      // A failed verdict must NOT silently downgrade a paying user to Free.
      // Fail LOUD → 5xx; the client keeps its cached Pro and retries. TRIP-208.
      if (isProErr) throw isProErr;
      const isPro = isProRpc === true;
      return Response.json({ isPro, reason: isPro ? 'subscription' : null }, { headers: corsHeaders });
    }

    const { data: trip, error: tripErr } = await admin
      .from('trips').select('created_by, is_pro_trip')
      .eq('id', tripId).single();
    // Transient read failure must not read as "no pro_trip" (false Free). Genuine
    // missing/unusable trip id (not_found) → non-pro; any other error → 5xx "retry".
    // TRIP-208 (taxonomy: _shared/classifyDbError.ts).
    if (tripErr && !isNotFound(tripErr)) throw tripErr;
    if (!trip) return Response.json({ isPro: false, isOwner: false, reason: null }, { headers: corsHeaders });

    const isOwner = trip.created_by === user.id;

    // recompute-on-read для разовой Trip Pro (симметрия подписочному пути ниже):
    // потерянный refund/dispute-вебхук оставил бы is_pro_trip=true навсегда. Сверяем
    // покупку со Stripe (throttled per-trip) ПЕРЕД тем как поверить флагу. Если
    // сверка сходила в Stripe и сняла Pro — перечитываем флаг и идём в owner-путь.
    let tripIsPro = trip.is_pro_trip === true;
    if (tripIsPro && await reconcileTripEntitlement(admin, tripId)) {
      const { data: fresh } = await admin.from('trips').select('is_pro_trip').eq('id', tripId).single();
      tripIsPro = fresh?.is_pro_trip === true;
    }
    if (tripIsPro) {
      return Response.json({ isPro: true, isOwner, reason: 'trip' }, { headers: corsHeaders });
    }

    if (trip.created_by) {
      const { data: owner } = await admin
        .from('users').select('subscription_status, subscription_end_date')
        .eq('id', trip.created_by).single();
      // recompute-on-read (Ф3): self-heal the owner's cache, throttled (stuck-PRO /
      // stuck-FREE) — so an invited participant opening the trip also heals the
      // owner. Предикат — единый (O1).
      if (await needsEntitlementReconcile(admin, trip.created_by, owner?.subscription_status, owner?.subscription_end_date))
        await reconcileEntitlement(admin, trip.created_by);
      // Verdict from the single SQL source (is_user_pro, migration 0055) — reads the
      // owner's post-reconcile state, so no manual re-select needed.
      const { data: ownerProRpc, error: ownerProErr } = await admin.rpc('is_user_pro', { p_uid: trip.created_by });
      if (ownerProErr) throw ownerProErr;
      if (ownerProRpc === true) {
        return Response.json({ isPro: true, isOwner, reason: 'owner_subscription' }, { headers: corsHeaders });
      }
    }

    return Response.json({ isPro: false, isOwner }, { headers: corsHeaders });
  } catch (error) {
    await captureEdgeError(error, 'checkSubscriptionStatus');
    console.error('checkSubscriptionStatus error:', error);
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: corsHeaders });
  }
});
