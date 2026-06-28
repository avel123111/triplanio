// checkSubscriptionStatus
// Returns whether the given trip should have Pro features unlocked.
// Pro is available if EITHER the trip is a one-time pro_trip OR the trip's
// OWNER has an active Pro subscription. Without a tripId, falls back to the
// caller's own subscription (used by the trip-creation paywall).
import { corsFor } from '../_shared/cors.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { captureEdgeError } from '../_shared/sentry.ts';
import { reconcileEntitlement } from '../_shared/reconcileEntitlement.ts';
import { getProviderCustomerId } from '../_shared/payments/customer.ts';

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
    const now = new Date();

    // No trip context → check caller's own subscription.
    if (!tripId) {
      const { data: me } = await admin
        .from('users').select('subscription_status, subscription_end_date')
        .eq('id', user.id).single();
      // recompute-on-read (Ф3): self-heal a wrong cache, throttled. Stuck-PRO (pro
      // but end stale) OR stuck-FREE (free but has a provider_customer = lost activation).
      const meEndPast = !me?.subscription_end_date || new Date(me.subscription_end_date) <= now;
      const meNeeds = (me?.subscription_status === 'pro' && meEndPast)
        || (me?.subscription_status !== 'pro' && (await getProviderCustomerId(admin, user.id)) !== null);
      if (meNeeds) await reconcileEntitlement(admin, user.id);
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
      // recompute-on-read (Ф3): self-heal the owner's cache, throttled. Same two
      // perekos as the no-trip branch / getUserPlan:
      //  • stuck-PRO  — 'pro' but end date stale/missing (lost renewal)
      //  • stuck-FREE — not 'pro' but has a provider_customer (lost activation),
      //    so an invited participant opening the trip also heals the owner.
      const ownerEndPast = !owner?.subscription_end_date || new Date(owner.subscription_end_date) <= now;
      const ownerNeeds = (owner?.subscription_status === 'pro' && ownerEndPast)
        || (owner?.subscription_status !== 'pro' && (await getProviderCustomerId(admin, trip.created_by)) !== null);
      if (ownerNeeds) await reconcileEntitlement(admin, trip.created_by);
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
