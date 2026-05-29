/**
 * getTripById
 *
 * POST body: { id: string }
 *
 * Server-to-server endpoint (no JWT required — called from n8n / Telegram bot).
 * Returns the full trip payload for the given trip id.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { id } = await req.json();
    if (!id) {
      return Response.json({ error: 'id is required' }, { status: 400, headers: corsHeaders });
    }

    return await fetchTripPayload(id);
  } catch (err) {
    console.error('getTripById error:', err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500, headers: corsHeaders },
    );
  }
});

async function fetchTripPayload(tripId: string) {
  const { data: trip, error: tripErr } = await supabaseAdmin
    .from('trips')
    .select('*')
    .eq('id', tripId)
    .single();

  if (tripErr || !trip) {
    return Response.json({ error: 'Trip not found' }, { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  const [
    { data: cityVisits },
    { data: hotels },
    { data: activities },
    { data: transfers },
    { data: services },
    { data: members },
    { data: budgetArr },
    { data: budgetCategories },
    { data: budgetExpenses },
  ] = await Promise.all([
    supabaseAdmin.from('city_visits').select('*').eq('trip_id', tripId),
    supabaseAdmin.from('hotel_stays').select('*').eq('trip_id', tripId),
    supabaseAdmin.from('activities').select('*').eq('trip_id', tripId),
    supabaseAdmin.from('transfers').select('*').eq('trip_id', tripId),
    supabaseAdmin.from('trip_services').select('*').eq('trip_id', tripId),
    supabaseAdmin.from('trip_members').select('*').eq('trip_id', tripId),
    supabaseAdmin.from('trip_budgets').select('*').eq('trip_id', tripId),
    supabaseAdmin.from('budget_categories').select('*').eq('trip_id', tripId).order('order_index'),
    supabaseAdmin.from('budget_expenses').select('*').eq('trip_id', tripId),
  ]);

  return Response.json({
    trip,
    cityVisits: cityVisits ?? [],
    hotels: hotels ?? [],
    activities: activities ?? [],
    transfers: transfers ?? [],
    services: services ?? [],
    members: members ?? [],
    budget: (budgetArr ?? [])[0] ?? null,
    budgetCategories: budgetCategories ?? [],
    budgetExpenses: budgetExpenses ?? [],
  }, { headers: { 'Access-Control-Allow-Origin': '*' } });
}
