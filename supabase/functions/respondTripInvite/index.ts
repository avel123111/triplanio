/**
 * respondTripInvite
 *
 * POST body: { member_id, action: 'accept'|'decline' }
 *
 * Auth: caller must own the invite (member.user_id === caller, or member.invite_email === caller email).
 * On accept: activates member, notifies inviter in THEIR language.
 * On decline: sets status to 'declined'.
 * In both cases: marks the invite notification as read.
 */

import { withHandler } from '../_shared/http.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { renderJoinedNotification, renderDeclinedNotification } from '../_shared/emailTemplate.ts';
import { emitTripReached2 } from '../_shared/analytics.ts';

Deno.serve(withHandler('respondTripInvite', async (req, corsHeaders) => {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { member_id, action } = await req.json();
    if (!member_id || !['accept', 'decline'].includes(action)) {
      return Response.json({ error: 'Missing member_id or invalid action' }, { status: 400, headers: corsHeaders });
    }

    const { data: member } = await supabaseAdmin
      .from('trip_members')
      .select('*')
      .eq('id', member_id)
      .single();

    if (!member) return Response.json({ error: 'Invite not found' }, { status: 404, headers: corsHeaders });

    const ownsInvite = (member.user_id && member.user_id === user.id)
      || member.invite_email?.toLowerCase() === user.email!.toLowerCase();
    if (!ownsInvite) {
      return Response.json({ error: 'This invite is not yours' }, { status: 403, headers: corsHeaders });
    }
    if (member.status !== 'pending') {
      return Response.json({ error: 'Invite already responded to' }, { status: 409, headers: corsHeaders });
    }

    // The trip creator is the owner via trips.created_by and must never become a
    // trip_members row. If the creator somehow holds a pending invite to their
    // own trip, accepting it would demote them to viewer/admin inside the trip —
    // so drop the stray invite instead of activating it (TRIP-143).
    const { data: ownTrip } = await supabaseAdmin
      .from('trips').select('created_by').eq('id', member.trip_id).single();
    if (ownTrip?.created_by === user.id) {
      await supabaseAdmin.from('trip_members').delete().eq('id', member_id);
      await supabaseAdmin.from('notifications')
        .update({ read: true })
        .eq('user_id', user.id)
        .eq('trip_member_id', member_id);
      return Response.json({ ok: true, alreadyOwner: true }, { headers: corsHeaders });
    }

    if (action === 'decline') {
      await supabaseAdmin
        .from('trip_members')
        .update({ status: 'declined' })
        .eq('id', member_id);

      // M1 — notify the inviter that the invite was declined (in THEIR language).
      // Best-effort: a failure here must not fail the decline itself.
      if (member.invited_by) {
        try {
          const { data: callerUsers } = await supabaseAdmin
            .from('users').select('full_name').eq('id', user.id).limit(1);
          const callerName = callerUsers?.[0]?.full_name || member.user_full_name || user.email!;

          const [tripResult, inviterResult] = await Promise.all([
            supabaseAdmin.from('trips').select('title').eq('id', member.trip_id).single(),
            supabaseAdmin.from('users').select('language').eq('id', member.invited_by).limit(1),
          ]);
          const trip = tripResult.data;
          const inviterLang = inviterResult.data?.[0]?.language ?? 'en';

          if (trip) {
            const notifTexts = renderDeclinedNotification(inviterLang, {
              name: callerName,
              title: trip.title,
            });
            await supabaseAdmin.from('notifications').insert({
              user_id: member.invited_by,
              type: 'trip_invite_declined',
              i18n_title_key: 'notif.tpl_invite_declined_title',
              i18n_message_key: 'notif.tpl_invite_declined_msg',
              i18n_params: { name: callerName, trip: trip.title },
              title: notifTexts.title,
              message: notifTexts.message,
              trip_id: member.trip_id,
              read: false,
              created_by: user.id,
            });
          }
        } catch (e) {
          console.error('respondTripInvite: decline notification failed', e);
        }
      }
    } else {
      // Fetch caller's display name
      const { data: callerUsers } = await supabaseAdmin
        .from('users')
        .select('full_name')
        .eq('id', user.id)
        .limit(1);
      const callerName = callerUsers?.[0]?.full_name || user.email!;

      await supabaseAdmin
        .from('trip_members')
        .update({
          status: 'active',
          accepted_at: new Date().toISOString(),
          user_full_name: callerName,
          user_id: user.id,
        })
        .eq('id', member_id);

      // North Star: did this accept make the trip collaborative (owner + 1st member = 2)?
      await emitTripReached2(supabaseAdmin, member.trip_id, user.id);

      // Notify the inviter in THEIR language (not the accepter's)
      if (member.invited_by) {
        const [tripResult, inviterResult] = await Promise.all([
          supabaseAdmin.from('trips').select('title').eq('id', member.trip_id).single(),
          supabaseAdmin.from('users').select('language').eq('id', member.invited_by).limit(1),
        ]);

        const trip = tripResult.data;
        const inviterLang = inviterResult.data?.[0]?.language ?? 'en';

        if (trip) {
          const notifTexts = renderJoinedNotification(inviterLang, {
            name: callerName,
            title: trip.title,
          });

          await supabaseAdmin.from('notifications').insert({
            user_id: member.invited_by,
            type: 'trip_member_joined',
            i18n_title_key: 'notif.tpl_joined_title',
            i18n_message_key: 'notif.tpl_joined_msg',
            i18n_params: {
              name: callerName,
              trip: trip.title,
            },
            title: notifTexts.title,
            message: notifTexts.message,
            trip_id: member.trip_id,
            read: false,
            created_by: user.id,
          });
        }
      }
    }

    // Mark the original invite notification as read
    await supabaseAdmin
      .from('notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('trip_member_id', member_id);

    return Response.json({ ok: true }, { headers: corsHeaders });

}));
