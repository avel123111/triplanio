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
 * Free users: max 1 ACTIVE owned trip — exactly the same rule as create_trip,
 * via the shared count_active_owned_trips() helper (migration 0045). Pro: unlimited.
 * New trip is owned by the caller (created_by = user.id).
 * All child records are re-created with new IDs and caller as created_by.
 */

import { corsFor } from '../_shared/cors.ts';
import { PRO_ONLY_ADDONS } from '../_shared/proAddons.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { isCallerParticipant } from '../_shared/tripAccess.ts';

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { tripId } = await req.json();
    if (!tripId) return Response.json({ error: 'tripId is required' }, { status: 400, headers: corsHeaders });

    // Verify caller has access to source trip
    const hasAccess = await isCallerParticipant(tripId, user.id);
    if (!hasAccess) return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });

    // --- Free-tier trip limit ---
    // Enforced server-side by the trips_enforce_limit BEFORE INSERT trigger
    // (migration 0058) — the SINGLE source for every creation path. The new-trip
    // insert below is the first write, so an over-limit free user is rejected
    // there (TRIP_LIMIT_REACHED) before any child rows are copied. We map that
    // error to a clean 403 at the insert site.

    // --- Load source trip ---
    const { data: sourceTrip } = await supabaseAdmin
      .from('trips')
      .select('*')
      .eq('id', tripId)
      .single();

    if (!sourceTrip) return Response.json({ error: 'Trip not found' }, { status: 404, headers: corsHeaders });

    // --- Sanitize details for the copy ---
    // The copy is never Pro (is_pro_trip: false), so it must not inherit
    // Pro-only addons. PRO_ONLY_ADDONS comes from the shared edge module
    // (_shared/proAddons.ts); free addons (hotels_selection) are preserved.
    const sourceDetails = (sourceTrip.details && typeof sourceTrip.details === 'object')
      ? sourceTrip.details as Record<string, unknown>
      : {};
    const sourceAddons = (sourceDetails.addons && typeof sourceDetails.addons === 'object')
      ? sourceDetails.addons as Record<string, unknown>
      : null;
    const copyDetails: Record<string, unknown> = { ...sourceDetails };
    if (sourceAddons) {
      const sanitizedAddons = { ...sourceAddons };
      for (const key of PRO_ONLY_ADDONS) delete sanitizedAddons[key];
      copyDetails.addons = sanitizedAddons;
    }

    // --- Create new trip ---
    const { data: newTrip, error: tripErr } = await supabaseAdmin
      .from('trips')
      .insert({
        title: `Copy of ${sourceTrip.title}`,
        description: sourceTrip.description,
        // The copy is born WITHOUT any documents (Pavel decision 2026-06-24):
        // the cover image is a Storage-backed document, so it is never copied.
        cover_image_url: null,
        // The gradient is a plain id (not a document) → inherit it so the copy
        // keeps the original's cover. Fall back to the built-in default when the
        // source had a photo-only cover (TRIP-107).
        cover_gradient: sourceTrip.cover_gradient || 'gradient_1',
        notes: sourceTrip.notes,
        details: copyDetails,
        is_pro_trip: false, // copy is not automatically pro
        created_by: user.id,
      })
      .select()
      .single();

    if (tripErr || !newTrip) {
      // The trips_enforce_limit trigger raises TRIP_LIMIT_REACHED (P0001) for an
      // over-limit free user — surface it as a clean 403, matching create_trip.
      if ((tripErr?.message ?? '').includes('TRIP_LIMIT_REACHED')) {
        return Response.json(
          { error: 'Trip limit reached. Upgrade to Pro to create more trips.' },
          { status: 403, headers: corsHeaders },
        );
      }
      throw tripErr ?? new Error('Failed to create trip');
    }

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
            start_date: cv.start_date,
            end_date: cv.end_date,
            kind: cv.kind,
            position: cv.position,
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
      const newHotels = hotels.map(({ id: _id, created_at: _ca, updated_at: _ua, documents: _docs, ...h }) => ({
        ...h,
        trip_id: newTripId,
        city_visit_id: h.city_visit_id ? (cityVisitIdMap[h.city_visit_id] ?? null) : null,
        documents: [], // copy is born without documents (Pavel 2026-06-24)
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
      const newActivities = activities.map(({ id: _id, created_at: _ca, updated_at: _ua, documents: _docs, ...a }) => ({
        ...a,
        trip_id: newTripId,
        city_visit_id: a.city_visit_id ? (cityVisitIdMap[a.city_visit_id] ?? null) : null,
        documents: [], // copy is born without documents (Pavel 2026-06-24)
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
      const newTransfers = transfers.map(({ id: _id, created_at: _ca, updated_at: _ua, documents: _docs, ...t }) => ({
        ...t,
        trip_id: newTripId,
        from_city_visit_id: t.from_city_visit_id ? (cityVisitIdMap[t.from_city_visit_id] ?? null) : null,
        to_city_visit_id: t.to_city_visit_id ? (cityVisitIdMap[t.to_city_visit_id] ?? null) : null,
        documents: [], // copy is born without documents (Pavel 2026-06-24)
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
      const newServices = services.map(({ id: _id, created_at: _ca, updated_at: _ua, ...s }) => {
        // Drop the `documents` key from details — copy is born without documents
        // (Pavel 2026-06-24). Rest of details (provider/booking data) is preserved.
        const { documents: _drop, ...details } = (s.details && typeof s.details === 'object') ? s.details : {};
        return {
          ...s,
          details,
          trip_id: newTripId,
          created_by: user.id,
        };
      });
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
