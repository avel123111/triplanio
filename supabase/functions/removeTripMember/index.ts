/**
 * removeTripMember
 *
 * POST body: { member_id }
 *
 * Auth: caller must be trip owner/admin — OR the member themselves (self-removal).
 * Owner role cannot be removed.
 */

import { withHandler } from '../_shared/http.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { isCallerEditor } from '../_shared/tripAccess.ts';
import { disconnectTripTelegram } from '../_shared/telegramTeardown.ts';
import { purgePrivateDocsForMember } from '../_shared/personalDocsTeardown.ts';
import { emit } from '../_shared/emit.ts';

Deno.serve(withHandler('removeTripMember', async (req, corsHeaders) => {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { member_id } = await req.json();
    if (!member_id) return Response.json({ error: 'Missing member_id' }, { status: 400, headers: corsHeaders });

    const { data: member } = await supabaseAdmin
      .from('trip_members')
      .select('*')
      .eq('id', member_id)
      .single();

    if (!member) return Response.json({ error: 'Not found' }, { status: 404, headers: corsHeaders });
    if (member.role === 'owner') {
      return Response.json({ error: 'Cannot remove owner' }, { status: 400, headers: corsHeaders });
    }

    const isSelf = member.user_id === user.id;
    const callerIsEditor = isSelf ? false : await isCallerEditor(member.trip_id, user.id);

    if (!callerIsEditor && !isSelf) {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }

    // Purge the leaving/removed member's PRIVATE documents (rows + Storage files)
    // for this trip — they lose access and can no longer delete their own private
    // docs, and surviving members must not keep reading them via raw REST. Routed
    // through the single _shared/personalDocsTeardown source so self-leave (M2)
    // and admin-remove (M3) never drift. Shared docs stay (trip content).
    // Best-effort: a Storage hiccup must never block the leave (it's swallowed and
    // logged inside the helper). Offline members have user_id null → no-op.
    if (member.user_id) {
      try {
        await purgePrivateDocsForMember(supabaseAdmin, {
          tripId: member.trip_id,
          userId: member.user_id,
        });
      } catch (e) {
        console.error('removeTripMember: personal docs purge failed', e);
      }
    }

    // Notifications reference trip_members via trip_member_id. The prod FK is
    // ON DELETE NO ACTION (dev is CASCADE — schema drift), so a member that has
    // an invite notification can't be deleted until that notification is gone.
    // Clear referencing notifications first so the delete succeeds on BOTH envs.
    await supabaseAdmin.from('notifications').delete().eq('trip_member_id', member_id);

    // CRITICAL: capture the delete error. Previously this was fire-and-forget,
    // so a blocked delete (un-cleared FK reference) returned ok:true while the
    // row survived — "removeTripMember returns true but the member isn't removed".
    const { error: delErr } = await supabaseAdmin.from('trip_members').delete().eq('id', member_id);
    if (delErr) {
      console.error('removeTripMember delete failed:', delErr);
      return Response.json({ error: delErr.message }, { status: 500, headers: corsHeaders });
    }

    // Revoke this member's Telegram bindings for the trip — bot/reminder access
    // is tied to trip membership. Routed through the single teardown source
    // (_shared/telegramTeardown) so user-facing disconnect, Pro-rollback and
    // member-leave never drift; scoped by userId so other members keep theirs.
    // (Offline members have user_id null → skip.)
    if (member.user_id) {
      await disconnectTripTelegram(supabaseAdmin, {
        tripId: member.trip_id,
        userId: member.user_id,
      });
    }

    // TRIP-356: announce the membership change; n8n resolves the audience
    // (M2: owner + admins on self-leave; M3: the removed member) and delivers.
    if (isSelf) {
      emit('member_left', { trip_id: member.trip_id, actor_id: member.user_id });
    } else if (member.user_id) {
      emit('member_removed', { trip_id: member.trip_id, recipient_id: member.user_id, actor_id: user.id });
    }

    return Response.json({ ok: true }, { headers: corsHeaders });

}));
