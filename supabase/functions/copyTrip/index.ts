/**
 * copyTrip
 *
 * POST body: { tripId }
 *
 * Duplicates a trip the caller has access to:
 *   - trip (title prefixed with "Copy of ")
 *   - city_visits
 *   - hotel_stays
 *   - activities
 *   - transfers
 *   - trip_services
 *
 * Free users: max 3 owned trips. Pro users: unlimited.
 * New trip is owned by the caller (created_by = user.id).
 * All child records are re-created with new IDs and caller as created_by.
 */

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { isCallerParticipant } from '../_shared/tripAccess.ts';

const FREE_TRIP_LIMIT = 3;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { tripId } = await req.json();
    if (!tripId) return Response.json({ error: 'tripId is required' }, { status: 400, headers: corsHeaders });

    // Verify caller has access to source trip
    const hasAccess = await isCallerParticipant(tripId, user.id);
    if (!hasAccess) return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });

    // --- Check subscription / trip limit for free users ---
    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('subscription_status, subscription_end_date')
      .eq('id', user.id)
      .maybeSingle();

    const now = new Date();
    const isPro =
      profile?.subscription_status === 'active' ||
      profile?.subscription_status === 'pro_trip' ||
      (profile?.subscription_status === 'cancelled' &&
        profile?.subscription_end_date &&
        new Date(profile.subscription_end_date) > now);

    if (!isPro) {
      const { count } = await supabaseAdmin
        .from('trips')
        .select('id', { count: 'exact', head: true })
        .eq('created_by', user.id);

      if ((count ?? 0) >= FREE_TRIP_LIMIT) {
        return Response.json(
          { error: 'Trip limit reached. Upgrade to Pro to create more trips.' },
          { status: 403, headers: corsHeaders },
        );
      }
    }

    // --- Load source trip ---
    const { data: sourceTrip } = await supabaseAdmin
      .from('trips')
      .select('*')
      .eq('id', tripId)
      .single();

    if (!sourceTrip) return Response.json({ error: 'Trip not found' }, { status: 404, headers: corsHeaders });

    // --- Create new trip ---
    const { data: newTrip, error: tripErr } = await supabaseAdmin
      .from('trips')
      .insert({
        title: `Copy of ${sourceTrip.title}`,
        description: sourceTrip.description,
        start_date: sourceTrip.start_date,
        end_date: sourceTrip.end_date,
        cover_image_url: sourceTrip.cover_image_url,
        notes: sourceTrip.notes,
        details: sourceTrip.details,
        is_pro_trip: false, // copy is not automatically pro
        created_by: user.id,
      })
      .select()
      .single();

    if (tripErr || !newTrip) throw tripErr ?? new Error('Failed to create trip');

    const newTripId = newTrip.id;

    // --- Load city_visits ---
    const { data: cityVisits } = await supabaseAdmin
      .from('city_visits')
      .select('*')
      .eq('trip_id', tripId);

    // Map old city_visit_id → new city_visit_id
    const cityVisitIdMap: Record<string, string> = {};

    if (cityVisits && cityVisits.length > 0) {
      for (const cv of cityVisits) {
        const { data: newCv } = await supabaseAdmin
          .from('city_visits')
          .insert({
            trip_id: newTripId,
            external_city_id: cv.external_city_id,
            city_name: cv.city_name,
            country: cv.country,
            country_code: cv.country_code,
            latitude: cv.latitude,
            longitude: cv.longitude,
            timezone: cv.timezone,
            start_datetime: cv.start_datetime,
            end_datetime: cv.end_datetime,
            kind: cv.kind,
            notes: cv.notes,
            details: cv.details,
            created_by: user.id,
          })
          .select('id')
          .single();

        if (newCv) cityVisitIdMap[cv.id] = newCv.id;
      }
    }

    // --- Copy hotel_stays ---
    const { data: hotels } = await supabaseAdmin
      .from('hotel_stays')
      .select('*')
      .eq('trip_id', tripId);

    if (hotels && hotels.length > 0) {
      const newHotels = hotels.map(({ id: _id, created_at: _ca, updated_at: _ua, ...h }) => ({
        ...h,
        trip_id: newTripId,
        city_visit_id: h.city_visit_id ? (cityVisitIdMap[h.city_visit_id] ?? null) : null,
        created_by: user.id,
      }));
      await supabaseAdmin.from('hotel_stays').insert(newHotels);
    }

    // --- Copy activities ---
    const { data: activities } = await supabaseAdmin
      .from('activities')
      .select('*')
      .eq('trip_id', tripId);

    if (activities && activities.length > 0) {
      const newActivities = activities.map(({ id: _id, created_at: _ca, updated_at: _ua, ...a }) => ({
        ...a,
        trip_id: newTripId,
        city_visit_id: a.city_visit_id ? (cityVisitIdMap[a.city_visit_id] ?? null) : null,
        created_by: user.id,
      }));
      await supabaseAdmin.from('activities').insert(newActivities);
    }

    // --- Copy transfers ---
    const { data: transfers } = await supabaseAdmin
      .from('transfers')
      .select('*')
      .eq('trip_id', tripId);

    if (transfers && transfers.length > 0) {
      const newTransfers = transfers.map(({ id: _id, created_at: _ca, updated_at: _ua, ...t }) => ({
        ...t,
        trip_id: newTripId,
        from_city_visit_id: t.from_city_visit_id ? (cityVisitIdMap[t.from_city_visit_id] ?? null) : null,
        to_city_visit_id: t.to_city_visit_id ? (cityVisitIdMap[t.to_city_visit_id] ?? null) : null,
        created_by: user.id,
      }));
      await supabaseAdmin.from('transfers').insert(newTransfers);
    }

    // --- Copy trip_services ---
    const { data: services } = await supabaseAdmin
      .from('trip_services')
      .select('*')
      .eq('trip_id', tripId);

    if (services && services.length > 0) {
      const newServices = services.map(({ id: _id, created_at: _ca, updated_at: _ua, ...s }) => ({
        ...s,
        trip_id: newTripId,
        created_by: user.id,
      }));
      await supabaseAdmin.from('trip_services').insert(newServices);
    }

    return Response.json({ ok: true, tripId: newTripId }, { headers: corsHeaders });

  } catch (e) {
    console.error('copyTrip error:', e);
    return Response.json(
      { error: (e as Error).message },
      { status: 500, headers: corsHeaders },
    );
  }
});
