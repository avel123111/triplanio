/**
 * copyTrip
 *
 * POST body: { tripId }
 *
 * Duplicates a trip the caller has access to:
 *   - trip (title prefixed in the caller's language, see COPY_PREFIX)
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

/**
 * Title prefix for the copy, in the caller's language. The title is STORED data
 * resolved once (at copy time), not UI text, so it cannot go through the
 * frontend `t()` — same reason the DB notification triggers carry their own
 * per-language strings keyed off `users.language`.
 */
const COPY_PREFIX: Record<string, string> = {
  en: 'Copy of ',
  ru: 'Копия: ',
  es: 'Copia de ',
};

/**
 * Strip an already-present prefix, in ANY language, before adding the caller's.
 * Copying a copy must stay "Копия: Rome", not grow "Копия: Copy of Rome" on
 * every round. Built FROM COPY_PREFIX so adding a locale needs no second edit
 * (the values are plain words — no regex metacharacters to escape).
 */
const COPY_PREFIX_RE = new RegExp(`^(?:${Object.values(COPY_PREFIX).join('|')})+`);

/** trips_title_len CHECK (TRIP-169) — the prefix must not push the copy over it. */
const TITLE_MAX = 300;

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

    // --- Name the copy in the caller's language ---
    // The caller owns the copy, so their language is the right one. Falls back to
    // English when the profile has no language set (or an unknown one).
    const { data: caller } = await supabaseAdmin
      .from('users')
      .select('language')
      .eq('id', user.id)
      .single();
    const prefix = COPY_PREFIX[caller?.language ?? ''] ?? COPY_PREFIX.en;
    // Trim by CODE POINTS, not with `.slice()`: Postgres char_length() counts code
    // points while a JS string index is a UTF-16 unit, so slicing a title whose
    // 300th character is an emoji would cut a surrogate pair in half and hand
    // Postgres invalid UTF-8.
    const copyTitle = [...(prefix + String(sourceTrip.title).replace(COPY_PREFIX_RE, ''))]
      .slice(0, TITLE_MAX)
      .join('');

    // --- Create new trip ---
    const { data: newTrip, error: tripErr } = await supabaseAdmin
      .from('trips')
      .insert({
        title: copyTitle,
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

    /** Read the source rows of one child table, failing loudly. */
    const loadRows = async (table: string) => {
      const { data, error } = await supabaseAdmin.from(table).select('*').eq('trip_id', tripId);
      if (error) throw new Error(`copyTrip: reading ${table} failed: ${error.message}`);
      return data ?? [];
    };

    /** Insert the copied rows of one child table, failing loudly. No-op when empty. */
    const insertRows = async (table: string, rows: Record<string, unknown>[]) => {
      if (rows.length === 0) return;
      const { error } = await supabaseAdmin.from(table).insert(rows);
      if (error) throw new Error(`copyTrip: copying ${table} failed: ${error.message}`);
    };

    // From here the copy row exists but is still empty. Everything below runs
    // under a compensating delete: a partial copy handed back as `ok: true` is
    // worse than a clean failure — the user saw a success, navigated into it, and
    // silently lost bookings. Every child table is ON DELETE CASCADE on trips.id,
    // so dropping the trip takes whatever already landed with it. A bare DELETE
    // is enough here — the two things deleteTrip tears down first (Telegram
    // integrations, Storage documents) cannot exist yet on a seconds-old copy.
    try {
      // --- Load city_visits ---
      const cityVisits = await loadRows('city_visits');

      // Map old city_visit_id → new city_visit_id
      const cityVisitIdMap: Record<string, string> = {};

      for (const cv of cityVisits) {
        const { data: newCv, error: cvErr } = await supabaseAdmin
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

        // A missed visit is not cosmetic: every hotel / activity / transfer that
        // pointed at it would silently land with a null city_visit_id.
        if (cvErr || !newCv) throw new Error(`copyTrip: copying city_visits failed: ${cvErr?.message ?? 'no row returned'}`);
        cityVisitIdMap[cv.id] = newCv.id;
      }

      // --- Copy hotel_stays ---
      const hotels = await loadRows('hotel_stays');

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
      await insertRows('hotel_stays', newHotels);

      // --- Copy activities ---
      const activities = await loadRows('activities');

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
      await insertRows('activities', newActivities);

      // --- Copy transfers ---
      const transfers = await loadRows('transfers');

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
      await insertRows('transfers', newTransfers);

      // --- Copy trip_services ---
      const services = await loadRows('trip_services');

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
      await insertRows('trip_services', newServices);
    } catch (e) {
      // Rolling back can itself fail. Say so in the rethrown message rather than
      // dropping it: otherwise Sentry only ever sees the original error and the
      // orphaned half-copy sitting in the user's trip list is invisible.
      const { error: rollbackErr } = await supabaseAdmin.from('trips').delete().eq('id', newTripId);
      if (rollbackErr) {
        throw new Error(`${(e as Error).message}; rollback failed too, trip ${newTripId} is orphaned: ${rollbackErr.message}`);
      }
      throw e; // withHandler reports it to Sentry and answers 500
    }

    return Response.json({ ok: true, tripId: newTripId }, { headers: corsHeaders });
}));
