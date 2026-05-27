/**
 * resendTripInvite
 *
 * POST body: { member_id }
 *
 * Auth: caller must be trip owner or active admin.
 * Resends the invite email to a still-pending member.
 */

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { isCallerAdmin } from '../_shared/tripAccess.ts';
import { renderResendEmail } from '../_shared/emailTemplate.ts';
import { sendEmail } from '../_shared/sendEmail.ts';

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

    if (!member) return Response.json({ error: 'Member not found' }, { status: 404, headers: corsHeaders });
    if (member.status !== 'pending') {
      return Response.json({ error: 'Invitation is not pending' }, { status: 400, headers: corsHeaders });
    }

    const callerIsAdmin = await isCallerAdmin(member.trip_id, user.email!);
    if (!callerIsAdmin) {
      return Response.json({ error: 'Only trip admins can resend invitations' }, { status: 403, headers: corsHeaders });
    }

    const { data: trip } = await supabaseAdmin
      .from('trips')
      .select('title')
      .eq('id', member.trip_id)
      .single();
    if (!trip) return Response.json({ error: 'Trip not found' }, { status: 404, headers: corsHeaders });

    // Fetch recipient language
    const { data: recipientUsers } = await supabaseAdmin
      .from('users')
      .select('language')
      .eq('email', member.user_email)
      .limit(1);
    const recipientLang = recipientUsers?.[0]?.language ?? 'en';

    // Fetch caller display name
    const { data: callerUsers } = await supabaseAdmin
      .from('users')
      .select('full_name')
      .eq('email', user.email!)
      .limit(1);
    const callerName = callerUsers?.[0]?.full_name || user.email!;

    const publicAppUrl = (Deno.env.get('PUBLIC_APP_URL') || '').replace(/\/+$/, '');
    const appUrl = publicAppUrl || new URL(req.url).origin;

    const emailData = renderResendEmail(recipientLang, {
      title: trip.title,
      inviter: callerName,
      role: member.role,
      recipientEmail: member.user_email,
      appUrl,
    });

    await sendEmail({
      to: member.user_email,
      subject: emailData.subject,
      body: emailData.body,
      from_name: emailData.brand,
    });

    return Response.json({ ok: true }, { headers: corsHeaders });

  } catch (error) {
    console.error('resendTripInvite error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500, headers: corsHeaders },
    );
  }
});
