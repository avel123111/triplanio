/**
 * Shared full-trip payload builder.
 *
 * buildTripData(tripId) returns the trip plus every related collection
 * (cities, hotels, activities, transfers, services, members, budget +
 * categories + expenses) as a plain object, or null if the trip is missing.
 *
 * fetchTripPayload(tripId) wraps buildTripData in an HTTP Response and is used
 * by getTripById (single-trip contract — unchanged).
 *
 * getTripByTelegramChatId builds its own { trips: [...] } array response on top
 * of buildTripData (a chat may be linked to several trips).
 *
 * Runs with the service-role client (bypasses RLS), so callers MUST
 * authenticate the request (requireN8nSecret) before invoking this — it
 * performs NO access control of its own.
 */

import { supabaseAdmin } from './supabaseAdmin.ts';
import { corsHeaders } from './cors.ts';

export interface TripData {
  trip: Record<string, unknown>;
  cityVisits: unknown[];
  hotels: unknown[];
  activities: unknown[];
  transfers: unknown[];
  services: unknown[];
  members: unknown[];
  budget: unknown | null;
  budgetCategories: unknown[];
  budgetExpenses: unknown[];
}

/** Builds the full trip object for `tripId`, or null when the trip is missing. */
export async function buildTripData(tripId: string): Promise<TripData | null> {
  const { data: trip, error: tripErr } = await supabaseAdmin
    .from('trips')
    .select('*')
    .eq('id', tripId)
    .single();

  if (tripErr || !trip) return null;

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

  return {
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
  };
}

/** Single-trip HTTP wrapper used by getTripById (contract unchanged). */
export async function fetchTripPayload(tripId: string): Promise<Response> {
  const data = await buildTripData(tripId);
  if (!data) {
    return Response.json({ error: 'Trip not found' }, { status: 404, headers: corsHeaders });
  }
  return Response.json(data, { headers: corsHeaders });
}
