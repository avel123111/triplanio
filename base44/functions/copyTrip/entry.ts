import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Duplicates a trip the caller has access to (owner or any member).
 * Copies: trip, city visits, hotel stays, activities, transfers.
 * Does NOT copy: trip members.
 * The new trip is owned by the caller.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { trip_id } = await req.json();
    if (!trip_id) return Response.json({ error: 'Missing trip_id' }, { status: 400 });

    const sr = base44.asServiceRole;
    const original = await sr.entities.Trip.get(trip_id);
    if (!original) return Response.json({ error: 'Trip not found' }, { status: 404 });

    // Check subscription limits for Free users.
    // Active = trip has no visits, OR max visit end_datetime >= today UTC.
    const now = new Date();
    const hasProSubscription = user.subscription_status === 'pro' &&
      user.subscription_end_date &&
      new Date(user.subscription_end_date) > now;

    if (!hasProSubscription) {
      const allUserTrips = await sr.entities.Trip.filter({ created_by: user.email });
      const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      let activeCount = 0;
      for (const t of allUserTrips) {
        const visits = await sr.entities.CityVisit.filter({ trip_id: t.id });
        let maxEnd = null;
        for (const v of visits) {
          const e = v.end_datetime ? new Date(v.end_datetime).getTime() : null;
          if (e !== null && (maxEnd === null || e > maxEnd)) maxEnd = e;
        }
        const isActive = maxEnd === null || new Date(maxEnd) >= today;
        if (isActive) activeCount++;
      }

      if (activeCount >= 1) {
        return Response.json({
          error: 'Active trip limit reached. Upgrade to Pro to create more trips.',
          code: 'TRIP_LIMIT_REACHED'
        }, { status: 403 });
      }
    }

    // Authorisation: owner OR active member
    const isOwner = original.created_by === user.email;
    if (!isOwner) {
      const membership = await sr.entities.TripMember.filter({
        trip_id, user_email: user.email, status: 'active',
      });
      if (!membership[0]) {
        return Response.json({ error: 'No access to this trip' }, { status: 403 });
      }
    }

    // Create the new trip — as the calling user (so they become created_by).
    // We use the USER-scoped client so created_by is the current user.
    const baseTitle = (original.title || 'Trip').replace(/\s*\(copy\)\s*$/i, '');
    const newTrip = await base44.entities.Trip.create({
      title: `${baseTitle} (copy)`,
      description: original.description || '',
      start_date: original.start_date || null,
      end_date: original.end_date || null,
      cover_image_url: original.cover_image_url || null,
      notes: original.notes || '',
      details: original.details || {},
      is_pro_trip: false, // Copy never inherits Pro — must be purchased separately (TC-44)
    });

    // Load all related records
    const [visits, hotels, activities, transfers] = await Promise.all([
      sr.entities.CityVisit.filter({ trip_id }),
      sr.entities.HotelStay.filter({ trip_id }),
      sr.entities.Activity.filter({ trip_id }),
      sr.entities.Transfer.filter({ trip_id }),
    ]);

    // Recreate visits and build an old→new id map
    const visitIdMap = {};
    for (const v of visits) {
      const created = await base44.entities.CityVisit.create({
        trip_id: newTrip.id,
        external_city_id: v.external_city_id,
        city_name: v.city_name,
        country: v.country,
        country_code: v.country_code,
        latitude: v.latitude,
        longitude: v.longitude,
        timezone: v.timezone,
        start_datetime: v.start_datetime || null,
        end_datetime: v.end_datetime || null,
        kind: v.kind || 'transit',
        notes: v.notes || '',
        details: v.details || {},
      });
      visitIdMap[v.id] = created.id;
    }

    // Recreate hotels
    for (const h of hotels) {
      const newVisitId = visitIdMap[h.city_visit_id];
      if (!newVisitId) continue;
      await base44.entities.HotelStay.create({
        trip_id: newTrip.id,
        city_visit_id: newVisitId,
        name: h.name,
        address: h.address || '',
        check_in_datetime: h.check_in_datetime || null,
        check_out_datetime: h.check_out_datetime || null,
        booking_reference: h.booking_reference || '',
        payment_status: h.payment_status || null,
        price: h.price ?? null,
        currency: h.currency || null,
        free_cancellation: !!h.free_cancellation,
        free_cancellation_until: h.free_cancellation_until || null,
        phone: h.phone || '',
        email: h.email || '',
        booking_url: h.booking_url || '',
        booking_platform: h.booking_platform || null,
        voucher_file_url: h.voucher_file_url || '',
        voucher_file_name: h.voucher_file_name || '',
        notes: h.notes || '',
        details: h.details || {},
      });
    }

    // Recreate activities
    for (const a of activities) {
      const newVisitId = visitIdMap[a.city_visit_id];
      if (!newVisitId) continue;
      await base44.entities.Activity.create({
        trip_id: newTrip.id,
        city_visit_id: newVisitId,
        title: a.title,
        start_datetime: a.start_datetime || null,
        end_datetime: a.end_datetime || null,
        location_name: a.location_name || '',
        location_address: a.location_address || '',
        notes: a.notes || '',
        details: a.details || {},
      });
    }

    // Recreate transfers
    for (const t of transfers) {
      const newFrom = visitIdMap[t.from_city_visit_id];
      const newTo = visitIdMap[t.to_city_visit_id];
      if (!newFrom || !newTo) continue;
      await base44.entities.Transfer.create({
        trip_id: newTrip.id,
        from_city_visit_id: newFrom,
        to_city_visit_id: newTo,
        transport_type: t.transport_type || 'plane',
        start_datetime: t.start_datetime || null,
        end_datetime: t.end_datetime || null,
        carrier: t.carrier || '',
        booking_reference: t.booking_reference || '',
        booking_url: t.booking_url || '',
        booking_platform: t.booking_platform || null,
        from_address: t.from_address || '',
        to_address: t.to_address || '',
        price: t.price ?? null,
        currency: t.currency || null,
        voucher_file_url: t.voucher_file_url || '',
        voucher_file_name: t.voucher_file_name || '',
        notes: t.notes || '',
        details: t.details || {},
      });
    }

    return Response.json({ ok: true, trip: newTrip });
  } catch (error) {
    console.error('copyTrip error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});