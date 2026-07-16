/**
 * resendTripInvite
 *
 * POST body: { member_id }
 *
 * Auth: caller must be trip owner or active admin.
 * Resends the invite email to a still-pending member.
 */

import { withHandler } from '../_shared/http.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { isCallerAdmin } from '../_shared/tripAccess.ts';
import { renderInviteTemplate } from '../_shared/emailTemplate.ts';
import { sendEmail } from '../_shared/sendEmail.ts';

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

    const callerIsAdmin = await isCallerAdmin(member.trip_id, user.id);
    if (!callerIsAdmin) {
      return Response.json({ error: 'Only trip admins can resend invitations' }, { status: 403, headers: corsHeaders });
    }

    const { data: trip } = await supabaseAdmin
      .from('trips')
      .select('title')
      .eq('id', member.trip_id)
      .single();
    if (!trip) return Response.json({ error: 'Trip not found' }, { status: 404, headers: corsHeaders });

    // Fetch caller (inviter) display name + language.
    // The EMAIL language follows the INVITER's app language.
    const { data: callerUsers } = await supabaseAdmin
      .from('users')
      .select('full_name, language')
      .eq('id', user.id)
      .limit(1);
    const callerName = callerUsers?.[0]?.full_name || user.email!;
    const callerLang = callerUsers?.[0]?.language ?? 'en';

    const publicAppUrl = (Deno.env.get('PUBLIC_APP_URL') || '').replace(/\/+$/, '');
    const appUrl = publicAppUrl || new URL(req.url).origin;

    const tpl = renderInviteTemplate(callerLang, 'resend', {
      title: trip.title,
      inviter: callerName,
      role: member.role,
      appUrl,
    });

    await sendEmail({
      to: member.invite_email,
      subject: tpl.subject,
      from_name: tpl.brand,
      template: { id: tpl.templateId, variables: tpl.variables },
    });

    return Response.json({ ok: true }, { headers: corsHeaders });

}));
