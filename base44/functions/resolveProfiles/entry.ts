// Server-side resolver for member profiles.
//
// Returns { full_name, avatar_url } for a list of emails — but ONLY if the
// caller AND each requested email are participants of the same trip.
// This prevents leaking arbitrary User records across the app.
//
// Authorization rules:
//   - caller must be the trip owner (Trip.created_by) OR an active TripMember
//     (any role) of that trip.
//   - for each requested email, we include it in the response only if it is
//     also the trip owner OR an active TripMember of the same trip.
//     Non-participants are silently skipped (more resilient to races, e.g.
//     a member who just left).

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { tripId, emails } = body || {};
    if (!tripId || !Array.isArray(emails)) {
      return Response.json({ error: 'Missing tripId or emails[]' }, { status: 400 });
    }

    // Normalize & dedupe (drop falsy / offline placeholders).
    const wanted = Array.from(new Set(
      emails
        .filter(Boolean)
        .map((e) => String(e).trim().toLowerCase())
        .filter((e) => e && !e.startsWith('offline:'))
    ));
    if (wanted.length === 0) return Response.json({ profiles: [] });

    // Load trip + members in one batch.
    const [trip, allMembers] = await Promise.all([
      base44.asServiceRole.entities.Trip.get(tripId),
      base44.asServiceRole.entities.TripMember.filter({ trip_id: tripId }),
    ]);
    if (!trip) return Response.json({ error: 'Trip not found' }, { status: 404 });

    const ownerEmail = (trip.created_by || '').toLowerCase();
    const activeMemberEmails = new Set(
      allMembers
        .filter((m) => m.status === 'active' && m.user_email)
        .map((m) => String(m.user_email).toLowerCase())
    );
    // Owner is implicitly an active participant even without a TripMember row.
    if (ownerEmail) activeMemberEmails.add(ownerEmail);

    // Caller authorization: must be a participant.
    const callerEmail = String(user.email || '').toLowerCase();
    if (!activeMemberEmails.has(callerEmail)) {
      return Response.json({ error: 'Forbidden: not a trip participant' }, { status: 403 });
    }

    // Keep only requested emails that are also participants.
    // Exception: the Triplanio AI bot (info@triplanio.com) is a synthetic
    // shared user whose avatar we want to surface anywhere it speaks, even
    // though it is not a TripMember of any trip.
    const TRIPLANIO_BOT_EMAIL = 'info@triplanio.com';
    const allowedEmails = wanted.filter(
      (e) => activeMemberEmails.has(e) || e === TRIPLANIO_BOT_EMAIL
    );
    if (allowedEmails.length === 0) return Response.json({ profiles: [] });

    // Fetch User records (service role bypasses RLS).
    const userRecords = await Promise.all(
      allowedEmails.map(async (email) => {
        try {
          const list = await base44.asServiceRole.entities.User.filter({ email });
          return Array.isArray(list) ? list[0] : null;
        } catch {
          return null;
        }
      })
    );

    const profiles = allowedEmails.map((email, idx) => {
      const u = userRecords[idx];
      return {
        email,
        full_name: u?.full_name || '',
        avatar_url: u?.avatar_url || '',
      };
    });

    return Response.json({ profiles });
  } catch (error) {
    console.error('resolveProfiles error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});