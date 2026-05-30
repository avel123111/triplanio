/**
 * Shared full-trip payload builder.
 *
 * Returns the trip plus every related collection (cities, hotels, activities,
 * transfers, services, members, budget + categories + expenses) for `tripId`.
 *
 * Used by the server-to-server endpoints getTripById and
 * getTripByTelegramChatId. Runs with the service-role client (bypasses RLS),
 * so callers MUST authenticate the request (requireN8nSecret) before invoking
 * this — it performs NO access control of its own.
 */

import { supabaseAdmin } from './supabaseAdmin.ts';
import { corsHeaders } from './cors.ts';

export async function fetchTripPayload(tripId: string): Promise<Response> {
  const { data: trip, error: tripErr } = await supabaseAdmin
    .from('trips')
    .select('*')
    .eq('id', tripId)
    .single();

  if (tripErr || !trip) {
    return Response.json({ error: 'Trip not found' }, { status: 404, headers: corsHeaders });
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
  }, { headers: corsHeaders });
}
