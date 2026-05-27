/**
 * respondTripInvite
 *
 * POST body: { member_id, action: 'accept'|'decline' }
 *
 * Auth: caller must own the invite (member.user_email === caller).
 * On accept: activates member, notifies inviter in THEIR language.
 * On decline: sets status to 'declined'.
 * In both cases: marks the invite notification as read.
 */

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { renderJoinedNotification } from '../_shared/emailTemplate.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
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

    if (member.user_email?.toLowerCase() !== user.email!.toLowerCase()) {
      return Response.json({ error: 'This invite is not yours' }, { status: 403, headers: corsHeaders });
    }
    if (member.status !== 'pending') {
      return Response.json({ error: 'Invite already responded to' }, { status: 409, headers: corsHeaders });
    }

    if (action === 'decline') {
      await supabaseAdmin
        .from('trip_members')
        .update({ status: 'declined' })
        .eq('id', member_id);
    } else {
      // Fetch caller's display name
      const { data: callerUsers } = await supabaseAdmin
        .from('users')
        .select('full_name')
        .eq('email', user.email!)
        .limit(1);
      const callerName = callerUsers?.[0]?.full_name || user.email!;

      await supabaseAdmin
        .from('trip_members')
        .update({
          status: 'active',
          accepted_at: new Date().toISOString(),
          user_full_name: callerName,
        })
        .eq('id', member_id);

      // Notify the inviter in THEIR language (not the accepter's)
      if (member.invited_by_email) {
        const [tripResult, inviterResult] = await Promise.all([
          supabaseAdmin.from('trips').select('title').eq('id', member.trip_id).single(),
          supabaseAdmin.from('users').select('language').eq('email', member.invited_by_email).limit(1),
        ]);

        const trip = tripResult.data;
        const inviterLang = inviterResult.data?.[0]?.language ?? 'en';

        if (trip) {
          const notifTexts = renderJoinedNotification(inviterLang, {
            name: callerName,
            title: trip.title,
          });

          await supabaseAdmin.from('notifications').insert({
            user_email: member.invited_by_email,
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
            created_by: user.email!,
          });
        }
      }
    }

    // Mark the original invite notification as read
    await supabaseAdmin
      .from('notifications')
      .update({ read: true })
      .eq('user_email', user.email!)
      .eq('trip_member_id', member_id);

    return Response.json({ ok: true }, { headers: corsHeaders });

  } catch (error) {
    console.error('respondTripInvite error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500, headers: corsHeaders },
    );
  }
});
