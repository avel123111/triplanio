/**
 * resolveProfiles
 *
 * POST body: { tripId, userIds: string[] }
 *
 * Returns { id, full_name, avatar_url } for each user id — but only for ids
 * that are active participants of the trip (prevents leaking arbitrary profiles).
 *
 * Optimization vs base44: one WHERE id = ANY(...) query instead of N individual queries.
 *
 * Exception: the AI bot (users.email = info@triplanio.com) is always allowed
 * regardless of membership.
 */

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { isCallerParticipant } from '../_shared/tripAccess.ts';

const TRIPLANIO_BOT_EMAIL = 'info@triplanio.com';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
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

    // Load trip owner + all active members + the bot id in parallel
    const [tripResult, membersResult, botResult] = await Promise.all([
      supabaseAdmin.from('trips').select('created_by').eq('id', tripId).single(),
      supabaseAdmin.from('trip_members').select('user_id').eq('trip_id', tripId).eq('status', 'active'),
      supabaseAdmin.from('users').select('id').eq('email', TRIPLANIO_BOT_EMAIL).maybeSingle(),
    ]);

    if (!tripResult.data) {
      return Response.json({ error: 'Trip not found' }, { status: 404, headers: corsHeaders });
    }

    const allowed = new Set<string>();
    if (tripResult.data.created_by) allowed.add(tripResult.data.created_by);
    (membersResult.data ?? [])
      .filter((m: { user_id: string | null }) => m.user_id)
      .forEach((m: { user_id: string }) => allowed.add(m.user_id));
    if (botResult.data?.id) allowed.add(botResult.data.id);

    // Keep only ids that are participants (+ AI bot exception)
    const allowedIds = wanted.filter((id) => allowed.has(id));
    if (allowedIds.length === 0) {
      return Response.json({ profiles: [] }, { headers: corsHeaders });
    }

    // Single batch query — no N+1
    const { data: userRows } = await supabaseAdmin
      .from('users')
      .select('id, full_name, avatar_url, email')
      .in('id', allowedIds);

    const profiles = (userRows ?? []).map((u: { id: string; full_name: string | null; avatar_url: string | null; email: string | null }) => ({
      id: u.id,
      full_name: u.full_name || '',
      avatar_url: u.avatar_url || '',
      email: u.email || '',
    }));

    return Response.json({ profiles }, { headers: corsHeaders });

  } catch (error) {
    console.error('resolveProfiles error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500, headers: corsHeaders },
    );
  }
});
