/**
 * resolveProfiles
 *
 * POST body: { tripId, userIds: string[] }
 *
 * Returns { id, full_name, avatar_url } for each user id — but only for ids
 * inside the trip's profile scope (prevents leaking arbitrary profiles). That
 * scope is shared with getTripDetails via tripProfileScope, so the two can't
 * drift apart again (TRIP-334).
 *
 * Optimization: one WHERE id = ANY(...) query instead of N individual queries.
 *
 * Exception: the AI bot (users.email = info@triplanio.com) is always allowed
 * regardless of membership.
 */

import { withHandler } from '../_shared/http.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { isCallerParticipant } from '../_shared/tripAccess.ts';
import { fetchProfiles, tripProfileScope } from '../_shared/profiles.ts';

const TRIPLANIO_BOT_EMAIL = 'info@triplanio.com';

Deno.serve(withHandler('resolveProfiles', async (req, corsHeaders) => {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { tripId, userIds } = await req.json().catch(() => ({}));
    if (!tripId || !Array.isArray(userIds)) {
      return Response.json({ error: 'Missing tripId or userIds[]' }, { status: 400, headers: corsHeaders });
    }

    // Dedupe — drop empty entries
    const wanted = Array.from(new Set(
      userIds
        .filter(Boolean)
        .map((id: string) => String(id).trim()),
    ));
    if (wanted.length === 0) return Response.json({ profiles: [] }, { headers: corsHeaders });

    // Caller must be a participant
    const callerOk = await isCallerParticipant(tripId, user.id);
    if (!callerOk) {
      return Response.json({ error: 'Forbidden: not a trip participant' }, { status: 403, headers: corsHeaders });
    }

    // Load trip owner + every member row + the bot id in parallel
    const [tripResult, membersResult, botResult] = await Promise.all([
      supabaseAdmin.from('trips').select('created_by').eq('id', tripId).single(),
      supabaseAdmin.from('trip_members').select('user_id').eq('trip_id', tripId),
      supabaseAdmin.from('users').select('id').eq('email', TRIPLANIO_BOT_EMAIL).maybeSingle(),
    ]);

    if (!tripResult.data) {
      return Response.json({ error: 'Trip not found' }, { status: 404, headers: corsHeaders });
    }

    // Keep only ids inside the trip's scope (+ AI bot exception)
    const allowed = new Set(tripProfileScope(
      membersResult.data,
      tripResult.data.created_by,
      [botResult.data?.id],
    ));
    const profiles = await fetchProfiles(supabaseAdmin, wanted.filter((id) => allowed.has(id)));

    return Response.json({ profiles }, { headers: corsHeaders });

}));
