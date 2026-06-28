// checkSubscriptionStatus
// Returns whether the given trip should have Pro features unlocked.
// Pro is available if EITHER the trip is a one-time pro_trip OR the trip's
// OWNER has an active Pro subscription. Without a tripId, falls back to the
// caller's own subscription (used by the trip-creation paywall).
import { corsFor } from '../_shared/cors.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { captureEdgeError } from '../_shared/sentry.ts';
import { reconcileEntitlement, needsEntitlementReconcile } from '../_shared/reconcileEntitlement.ts';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

async function getUser(req: Request) {
  const a = req.headers.get('Authorization');
  if (!a) return null;
  const { data: { user } } = await admin.auth.getUser(a.replace('Bearer ', ''));
  return user ?? null;
}

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const user = await getUser(req);
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
      const { data: isProRpc } = await admin.rpc('is_user_pro', { p_uid: user.id });
      const isPro = isProRpc === true;
      return Response.json({ isPro, reason: isPro ? 'subscription' : null }, { headers: corsHeaders });
    }

    const { data: trip } = await admin
      .from('trips').select('created_by, is_pro_trip')
      .eq('id', tripId).single();
    if (!trip) return Response.json({ isPro: false, isOwner: false, reason: null }, { headers: corsHeaders });

    const isOwner = trip.created_by === user.id;

    if (trip.is_pro_trip) {
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
      const { data: ownerProRpc } = await admin.rpc('is_user_pro', { p_uid: trip.created_by });
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
