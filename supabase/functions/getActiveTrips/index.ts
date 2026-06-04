// getActiveTrips
// Returns the count of the caller's active trips + whether they are Pro.
// Active = trip has no dated visits yet, OR latest visit end_datetime >= today (UTC).
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const user = await getUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const now = new Date();
    const { data: me } = await admin
      .from('users').select('subscription_status, subscription_end_date')
      .eq('id', user.id).single();
    const isPro = !!me
      && me.subscription_status === 'pro'
      && !!me.subscription_end_date
      && new Date(me.subscription_end_date) > now;

    const { data: trips } = await admin
      .from('trips').select('id, title').eq('created_by', user.id);

    if (!trips || trips.length === 0) {
      return Response.json({ isPro, activeCount: 0, activeTrips: [] }, { headers: corsHeaders });
    }

    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const tripIds = trips.map((t) => t.id);

    const { data: visits } = await admin
      .from('city_visits').select('trip_id, end_date').in('trip_id', tripIds);

    const maxEndByTrip = new Map<string, number>();
    for (const v of visits ?? []) {
      if (!v.end_date) continue;
      const e = new Date(v.end_date).getTime();
      if (Number.isNaN(e)) continue;
      const cur = maxEndByTrip.get(v.trip_id);
      if (cur === undefined || e > cur) maxEndByTrip.set(v.trip_id, e);
    }

    const activeTrips = trips.filter((t) => {
      const maxEnd = maxEndByTrip.get(t.id);
      return maxEnd === undefined || maxEnd >= today;
    });

    return Response.json({
      isPro,
      activeCount: activeTrips.length,
      activeTrips: activeTrips.map((t) => ({ id: t.id, title: t.title })),
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('getActiveTrips error:', error);
    return Response.json({ error: String(error?.message || error) }, { status: 500, headers: corsHeaders });
  }
});
