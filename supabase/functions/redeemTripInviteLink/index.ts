/**
 * redeemTripInviteLink
 *
 * POST body: { token }
 *
 * Auth: any authenticated user. Validates the invite token (exists, not
 * revoked, not expired), then adds the caller to the trip as an ACTIVE member
 * with the role stored on the link. Mirrors the accept branch of the
 * `respond_trip_invite` RPC. Never downgrades an existing admin to viewer.
 *
 * Block list: if the user was removed from this trip by an admin
 * (trip_member_blocks), the link refuses them (code 'blocked') UNLESS there
 * is a pending invite waiting for them (an admin explicitly re-invited them,
 * which lifts the block). A successful join clears any stale block.
 *
 * Stays a standalone function (token flow, no trip-scope actor), but normalized
 * like the rest of the door: caller resolved via the shared `getRequestUser`
 * (a real Auth outage surfaces as 503 `AUTH_UNAVAILABLE`, never a null-swallowed
 * 401), errors emitted through the canon `jsonError` / `refusalResponse` seam.
 *
 * Returns: { ok: true, tripId, alreadyMember }
 *   error `code` on failure: not_found | revoked | expired | trip_missing | blocked
 */
import { jsonError, readJson, refusalResponse, withHandler } from '../_shared/http.ts';
import { getRequestUser, supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { emitTripReached2 } from '../_shared/analytics.ts';
import { emit } from '../_shared/emit.ts';
import { resolveRedeemRole } from './redeemRole.ts';

Deno.serve(withHandler('redeemTripInviteLink', async (req, corsHeaders) => {
    const user = await getRequestUser(req);
    if (!user) return jsonError(401, 'Unauthorized', 'UNAUTHENTICATED', corsHeaders);

    const body = await readJson(req);
    const token = String(body.token ?? '').trim();
    if (!token) return jsonError(400, 'token is required', 'INVALID_INPUT', corsHeaders);

    const { data: link } = await supabaseAdmin
      .from('trip_invite_links').select('*').eq('token', token).maybeSingle();

    if (!link) return jsonError(404, 'invalid', 'not_found', corsHeaders);
    // sentrySkip: an expired/revoked link is a NORMAL business outcome (users
    // click old links), not an error — the frontend shows a designed message.
    // `refusalResponse` sets `x-sentry-skip` so withHandler stays silent
    // (high-frequency, non-actionable noise).
    if (link.revoked_at) return refusalResponse({ status: 410, code: 'revoked', message: 'revoked', sentrySkip: true }, corsHeaders);
    if (new Date(link.expires_at).getTime() < Date.now()) {
      return refusalResponse({ status: 410, code: 'expired', message: 'expired', sentrySkip: true }, corsHeaders);
    }

    const { data: trip } = await supabaseAdmin
      .from('trips').select('id, created_by').eq('id', link.trip_id).maybeSingle();
    if (!trip) return jsonError(404, 'Trip not found', 'trip_missing', corsHeaders);

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
        return jsonError(403, 'blocked', 'blocked', corsHeaders);
      }
    }

    if (existing) {
      // Activate a pending/declined/offline row. The "a link never downgrades an
      // existing invite" rule lives in ./redeemRole.ts as a pure function, so a
      // test can pin it (TRIP-274 Ф1.4).
      const keepRole = resolveRedeemRole(existing.role, link.role);
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

    // North Star: did this join make the trip collaborative (owner + 1st member = 2)?
    await emitTripReached2(supabaseAdmin, trip.id, user.id);

    // TRIP-356: announce the join; n8n notifies the trip owner.
    if (trip.created_by && trip.created_by !== user.id) {
      emit('invite_accepted', { trip_id: trip.id, recipient_id: trip.created_by, actor_id: user.id });
    }

    return Response.json({ ok: true, tripId: trip.id, alreadyMember: false }, { headers: corsHeaders });
}));
