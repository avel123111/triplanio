/**
 * resendTripInvite
 *
 * POST body: { member_id }
 *
 * Auth: caller must be trip owner or active admin.
 * Re-announces a still-pending invite; n8n re-sends the email.
 */

import { withHandler } from '../_shared/http.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { isCallerEditor } from '../_shared/tripAccess.ts';
import { emit } from '../_shared/emit.ts';

Deno.serve(withHandler('resendTripInvite', async (req, corsHeaders) => {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { member_id } = await req.json();
    if (!member_id) return Response.json({ error: 'Missing member_id' }, { status: 400, headers: corsHeaders });

    const { data: member } = await supabaseAdmin
      .from('trip_members')
      .select('*')
      .eq('id', member_id)
      .single();

    if (!member) return Response.json({ error: 'Member not found' }, { status: 404, headers: corsHeaders });
    if (member.status !== 'pending') {
      return Response.json({ error: 'Invitation is not pending' }, { status: 400, headers: corsHeaders });
    }

    const callerIsEditor = await isCallerEditor(member.trip_id, user.id);
    if (!callerIsEditor) {
      return Response.json({ error: 'Only trip admins can resend invitations' }, { status: 403, headers: corsHeaders });
    }

    // TRIP-356: announce the event; n8n resolves audience/text and delivers (invite email).
    emit('invite_resent', { trip_id: member.trip_id, actor_id: user.id, member_id: member.id });

    return Response.json({ ok: true }, { headers: corsHeaders });

}));
