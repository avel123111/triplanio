// checkSubscriptionStatus
// Returns whether the given trip should have Pro features unlocked.
// Pro is available if EITHER the trip is a one-time pro_trip OR the trip's
// OWNER has an active Pro subscription. Without a tripId, falls back to the
// caller's own subscription (used by the trip-creation paywall).
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

function isActivePro(row: { subscription_status?: string; subscription_end_date?: string } | null, now: Date) {
  return !!row
    && row.subscription_status === 'pro'
    && !!row.subscription_end_date
    && new Date(row.subscription_end_date) > now;
}

Deno.serve(async (req) => {
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
      const isPro = isActivePro(me, now);
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
      if (isActivePro(owner, now)) {
        return Response.json({ isPro: true, isOwner, reason: 'owner_subscription' }, { headers: corsHeaders });
      }
    }

    return Response.json({ isPro: false, isOwner }, { headers: corsHeaders });
  } catch (error) {
    console.error('checkSubscriptionStatus error:', error);
    return Response.json({ error: String(error?.message || error) }, { status: 500, headers: corsHeaders });
  }
});
