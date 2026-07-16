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

import { jsonError, readJson, withHandler } from '../_shared/http.ts';
import { PRO_ONLY_ADDONS } from '../_shared/proAddons.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { isCallerParticipant } from '../_shared/tripAccess.ts';

Deno.serve(withHandler('copyTrip', async (req, corsHeaders) => {
    const user = await getRequestUser(req);
    if (!user) return jsonError(401, 'Unauthorized', 'UNAUTHORIZED', corsHeaders);

    // Client sends ONLY { tripId }. A broken/empty body → clean 400, not 500.
    const body = await readJson(req);
    const tripId = typeof body.tripId === 'string' ? body.tripId : '';
    if (!tripId) return jsonError(400, 'tripId is required', 'TRIP_ID_REQUIRED', corsHeaders);

    // Verify caller has access to source trip
    const hasAccess = await isCallerParticipant(tripId, user.id);
    if (!hasAccess) return jsonError(403, 'Forbidden', 'FORBIDDEN', corsHeaders);

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

    if (!sourceTrip) return jsonError(404, 'Trip not found', 'NOT_FOUND', corsHeaders);

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
        return jsonError(
          403,
          'Trip limit reached. Upgrade to Pro to create more trips.',
          'TRIP_LIMIT_REACHED',
          corsHeaders,
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
            geonameid: cv.geonameid,
            name_i18n: cv.name_i18n,
            city_name_en: cv.city_name_en,
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
      // Explicit column projection (TRIP-169): the copy is decoupled from the
      // physical schema — a new hotel_stays column is NOT silently duplicated
      // until it is added here on purpose. id/created_at/updated_at are DB-owned;
      // documents are dropped by decision; trip_id/city_visit_id/created_by are
      // re-pointed below.
      const newHotels = hotels.map((h) => ({
        trip_id: newTripId,
        city_visit_id: h.city_visit_id ? (cityVisitIdMap[h.city_visit_id] ?? null) : null,
        name: h.name,
        address: h.address,
        check_in_datetime: h.check_in_datetime,
        check_out_datetime: h.check_out_datetime,
        booking_reference: h.booking_reference,
        payment_status: h.payment_status,
        price: h.price,
        currency: h.currency,
        free_cancellation: h.free_cancellation,
        free_cancellation_until: h.free_cancellation_until,
        phone: h.phone,
        email: h.email,
        booking_url: h.booking_url,
        latitude: h.latitude,
        longitude: h.longitude,
        notes: h.notes,
        details: h.details,
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
      const newActivities = activities.map((a) => ({
        trip_id: newTripId,
        city_visit_id: a.city_visit_id ? (cityVisitIdMap[a.city_visit_id] ?? null) : null,
        title: a.title,
        start_datetime: a.start_datetime,
        end_datetime: a.end_datetime,
        location_address: a.location_address,
        location_latitude: a.location_latitude,
        location_longitude: a.location_longitude,
        price: a.price,
        currency: a.currency,
        notes: a.notes,
        details: a.details,
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
      const newTransfers = transfers.map((t) => ({
        trip_id: newTripId,
        from_city_visit_id: t.from_city_visit_id ? (cityVisitIdMap[t.from_city_visit_id] ?? null) : null,
        to_city_visit_id: t.to_city_visit_id ? (cityVisitIdMap[t.to_city_visit_id] ?? null) : null,
        transport_type: t.transport_type,
        start_datetime: t.start_datetime,
        end_datetime: t.end_datetime,
        carrier: t.carrier,
        booking_reference: t.booking_reference,
        booking_url: t.booking_url,
        from_address: t.from_address,
        to_address: t.to_address,
        from_latitude: t.from_latitude,
        from_longitude: t.from_longitude,
        to_latitude: t.to_latitude,
        to_longitude: t.to_longitude,
        flight_number: t.flight_number,
        day_change: t.day_change,
        price: t.price,
        currency: t.currency,
        notes: t.notes,
        details: t.details,
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
      const newServices = services.map((s) => {
        // Drop the `documents` key from details — copy is born without documents
        // (Pavel 2026-06-24). Rest of details (provider/booking data) is preserved.
        const { documents: _drop, ...details } = (s.details && typeof s.details === 'object') ? s.details : {};
        return {
          trip_id: newTripId,
          kind: s.kind,
          name: s.name,
          price: s.price,
          currency: s.currency,
          pickup_datetime: s.pickup_datetime,
          dropoff_datetime: s.dropoff_datetime,
          details,
          created_by: user.id,
        };
      });
      await supabaseAdmin.from('trip_services').insert(newServices);
    }

    return Response.json({ ok: true, tripId: newTripId }, { headers: corsHeaders });
}));
