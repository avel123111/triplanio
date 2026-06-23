/**
 * removeTripMember
 *
 * POST body: { member_id }
 *
 * Auth: caller must be trip owner/admin — OR the member themselves (self-removal).
 * Owner role cannot be removed.
 */

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { isCallerAdmin } from '../_shared/tripAccess.ts';
import { disconnectTripTelegram } from '../_shared/telegramTeardown.ts';
import { renderMemberLeftNotification, renderMemberRemovedNotification } from '../_shared/emailTemplate.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
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
    const callerIsAdmin = isSelf ? false : await isCallerAdmin(member.trip_id, user.id);

    if (!callerIsAdmin && !isSelf) {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
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

    // M2/M3 — notify about the membership change. Inserted AFTER the member
    // delete and with trip_member_id=null on purpose: the cascade above (and the
    // line-46 cleanup) would otherwise wipe a member-keyed row. Best-effort.
    try {
      const { data: tripRow } = await supabaseAdmin
        .from('trips').select('title, created_by').eq('id', member.trip_id).single();
      const tripTitle = tripRow?.title ?? '';

      if (isSelf) {
        // M2 — member left voluntarily → tell the owner + admins (each in their language).
        const { data: leaverUser } = await supabaseAdmin
          .from('users').select('full_name').eq('id', member.user_id).limit(1);
        const leaverName = member.user_full_name || leaverUser?.[0]?.full_name || member.invite_email || '';

        // The trip owner lives in trips.created_by — there is NO 'owner' row in
        // trip_members — so the owner must be added explicitly, alongside any
        // active admin members.
        const { data: managers } = await supabaseAdmin
          .from('trip_members')
          .select('user_id')
          .eq('trip_id', member.trip_id)
          .eq('status', 'active')
          .in('role', ['owner', 'admin']);

        const recipientIds = [...new Set([
          tripRow?.created_by ?? null,
          ...(managers ?? []).map((m: { user_id: string | null }) => m.user_id),
        ].filter((id: string | null): id is string => !!id && id !== member.user_id))];

        if (recipientIds.length) {
          const { data: recipUsers } = await supabaseAdmin
            .from('users').select('id, language').in('id', recipientIds);
          const langById = new Map((recipUsers ?? []).map((u: { id: string; language: string | null }) => [u.id, u.language ?? 'en']));

          const rows = recipientIds.map((uid) => {
            const texts = renderMemberLeftNotification(langById.get(uid) ?? 'en', { name: leaverName, title: tripTitle });
            return {
              user_id: uid,
              type: 'trip_member_left',
              i18n_title_key: 'notif.tpl_member_left_title',
              i18n_message_key: 'notif.tpl_member_left_msg',
              i18n_params: { name: leaverName, trip: tripTitle },
              title: texts.title,
              message: texts.message,
              trip_id: member.trip_id,
              read: false,
              created_by: user.id,
            };
          });
          await supabaseAdmin.from('notifications').insert(rows);
        }
      } else if (member.user_id) {
        // M3 — an admin removed a registered member → tell that member.
        // trip_id=null: they can no longer open the trip, so no dead "open trip" link.
        const { data: removedUser } = await supabaseAdmin
          .from('users').select('language').eq('id', member.user_id).limit(1);
        const lang = removedUser?.[0]?.language ?? 'en';
        const texts = renderMemberRemovedNotification(lang, { title: tripTitle });
        await supabaseAdmin.from('notifications').insert({
          user_id: member.user_id,
          type: 'trip_member_removed',
          i18n_title_key: 'notif.tpl_member_removed_title',
          i18n_message_key: 'notif.tpl_member_removed_msg',
          i18n_params: { trip: tripTitle },
          title: texts.title,
          message: texts.message,
          trip_id: null,
          read: false,
          created_by: user.id,
        });
      }
    } catch (e) {
      console.error('removeTripMember: change notification failed', e);
    }

    return Response.json({ ok: true }, { headers: corsHeaders });

  } catch (error) {
    console.error('removeTripMember error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500, headers: corsHeaders },
    );
  }
});
