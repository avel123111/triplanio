/**
 * redeemTripInviteLink
 *
 * POST body: { token }
 *
 * Auth: any authenticated user. Validates the invite token (exists, not
 * revoked, not expired), then adds the caller to the trip as an ACTIVE member
 * with the role stored on the link. Mirrors respondTripInvite's activation
 * logic. Never downgrades an existing admin to viewer.
 *
 * Block list: if the user was removed from this trip by an admin
 * (trip_member_blocks), the link refuses them (reason 'blocked') UNLESS there
 * is a pending invite waiting for them (an admin explicitly re-invited them,
 * which lifts the block). A successful join clears any stale block.
 *
 * Returns: { ok: true, tripId, alreadyMember }
 *   reasons on failure: not_found | revoked | expired | trip_missing | blocked
 *
 * Self-contained (shared helpers inlined) so it deploys cleanly on its own.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

async function getRequestUser(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
  if (error || !user) return null;
  return user;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const token = String(body.token ?? '').trim();
    if (!token) return Response.json({ error: 'token is required' }, { status: 400, headers: corsHeaders });

    const { data: link } = await supabaseAdmin
      .from('trip_invite_links').select('*').eq('token', token).maybeSingle();

    if (!link) return Response.json({ error: 'invalid', reason: 'not_found' }, { status: 404, headers: corsHeaders });
    if (link.revoked_at) return Response.json({ error: 'revoked', reason: 'revoked' }, { status: 410, headers: corsHeaders });
    if (new Date(link.expires_at).getTime() < Date.now()) {
      return Response.json({ error: 'expired', reason: 'expired' }, { status: 410, headers: corsHeaders });
    }

    const { data: trip } = await supabaseAdmin
      .from('trips').select('id, title, created_by').eq('id', link.trip_id).maybeSingle();
    if (!trip) return Response.json({ error: 'Trip not found', reason: 'trip_missing' }, { status: 404, headers: corsHeaders });

    // Owner already has full access.
    if (trip.created_by === user.id) {
      return Response.json({ ok: true, tripId: trip.id, alreadyMember: true }, { headers: corsHeaders });
    }

    const { data: callerUsers } = await supabaseAdmin
      .from('users').select('full_name').eq('id', user.id).limit(1);
    const callerName = callerUsers?.[0]?.full_name || user.email!;

    // Find an existing membership row: first by user_id, then by pending email invite.
    const { data: byUser } = await supabaseAdmin
      .from('trip_members').select('*').eq('trip_id', trip.id).eq('user_id', user.id).limit(1);
    let existing = byUser?.[0] ?? null;
    if (!existing && user.email) {
      const { data: byEmail } = await supabaseAdmin
        .from('trip_members').select('*')
        .eq('trip_id', trip.id).eq('invite_email', user.email.toLowerCase()).limit(1);
      existing = byEmail?.[0] ?? null;
    }

    // Already an active member -> nothing to do.
    if (existing && existing.status === 'active') {
      return Response.json({ ok: true, tripId: trip.id, alreadyMember: true }, { headers: corsHeaders });
    }

    // Block list: a user removed by an admin cannot rejoin via the link, UNLESS
    // an admin re-invited them (a pending invite is waiting), which lifts the block.
    const hasPendingInvite = !!existing && existing.status === 'pending';
    if (!hasPendingInvite) {
      const { data: block } = await supabaseAdmin
        .from('trip_member_blocks')
        .select('user_id').eq('trip_id', trip.id).eq('user_id', user.id).maybeSingle();
      if (block) {
        return Response.json({ error: 'blocked', reason: 'blocked' }, { status: 403, headers: corsHeaders });
      }
    }

    if (existing) {
      // Activate a pending/declined/offline row. Keep an admin role if the
      // existing invite was already admin; otherwise take the link's role.
      const keepRole = existing.role === 'admin' ? 'admin' : link.role;
      await supabaseAdmin.from('trip_members').update({
        status: 'active',
        role: keepRole,
        accepted_at: new Date().toISOString(),
        user_full_name: callerName,
        user_id: user.id,
      }).eq('id', existing.id);
    } else {
      await supabaseAdmin.from('trip_members').insert({
        trip_id: trip.id,
        invite_email: user.email ?? null,
        user_id: user.id,
        user_full_name: callerName,
        role: link.role,
        status: 'active',
        accepted_at: new Date().toISOString(),
        invited_by: link.created_by,
        created_by: link.created_by,
      });
    }

    // Joined successfully -> drop any stale block for this user on this trip.
    await supabaseAdmin.from('trip_member_blocks')
      .delete().eq('trip_id', trip.id).eq('user_id', user.id);

    // Best-effort: notify the trip owner that someone joined.
    if (trip.created_by && trip.created_by !== user.id) {
      try {
        await supabaseAdmin.from('notifications').insert({
          user_id: trip.created_by,
          type: 'trip_member_joined',
          i18n_title_key: 'notif.tpl_joined_title',
          i18n_message_key: 'notif.tpl_joined_msg',
          i18n_params: { name: callerName, trip: trip.title },
          title: 'New member joined',
          message: `${callerName} joined \"${trip.title}\"`,
          trip_id: trip.id,
          read: false,
          created_by: user.id,
        });
      } catch (e) {
        console.error('join notification failed (non-fatal):', e);
      }
    }

    return Response.json({ ok: true, tripId: trip.id, alreadyMember: false }, { headers: corsHeaders });
  } catch (e) {
    console.error('redeemTripInviteLink error:', e);
    return Response.json({ error: (e as Error).message }, { status: 500, headers: corsHeaders });
  }
});
