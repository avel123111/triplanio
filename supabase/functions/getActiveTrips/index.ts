// getActiveTrips
// Returns the count of the caller's active trips + whether they are Pro.
// Routes through the single-source active_owned_trips() helper (migration 0045)
// so the "active owned trip" rule lives in exactly ONE place and is shared with
// create_trip and copyTrip.
//
// NOTE: the real free-tier enforcement lives in the create_trip RPC. This endpoint
// only drives the upsell dialog, so on ANY error we fail OPEN (activeCount 0)
// rather than falsely blocking the user.
import { withHandler } from '../_shared/http.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

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

Deno.serve(withHandler('getActiveTrips', async (req, corsHeaders) => {
    const user = await getUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    // Pro verdict from the single SQL source (is_user_pro, migration 0055) instead
    // of an inline copy of the predicate. Fail-open: on RPC error isPro=false and
    // activeCount stays 0, so the upsell never falsely blocks (create_trip is the
    // real enforcement).
    const { data: isProRpc } = await admin.rpc('is_user_pro', { p_uid: user.id });
    const isPro = isProRpc === true;

    // Single source of truth (migration 0045): active = owned trip with no dated
    // visits yet OR max(city_visits.end_date) >= today.
    const { data: activeTrips, error } = await admin
      .rpc('active_owned_trips', { p_uid: user.id });

    if (error) {
      console.error('getActiveTrips active_owned_trips error:', error);
      // Fail open: create_trip is the real enforcement; never falsely block.
      return Response.json({ isPro, activeCount: 0, activeTrips: [] }, { headers: corsHeaders });
    }

    const list = activeTrips ?? [];
    return Response.json({
      isPro,
      activeCount: list.length,
      activeTrips: list.map((t: { id: string; title: string }) => ({ id: t.id, title: t.title })),
    }, { headers: corsHeaders });
}));
