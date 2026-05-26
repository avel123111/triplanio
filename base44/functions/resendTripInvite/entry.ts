import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Templates live in functions/_emailTemplate (single source of truth).

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { member_id } = await req.json();
    if (!member_id) return Response.json({ error: 'Missing member_id' }, { status: 400 });

    const member = await base44.asServiceRole.entities.TripMember.get(member_id);
    if (!member) return Response.json({ error: 'Member not found' }, { status: 404 });

    if (member.status !== 'pending') {
      return Response.json({ error: 'Invitation is not pending' }, { status: 400 });
    }

    const trip = await base44.asServiceRole.entities.Trip.get(member.trip_id);
    if (!trip) return Response.json({ error: 'Trip not found' }, { status: 404 });

    // Verify caller is owner/admin
    const isOwner = trip.created_by === user.email;
    let callerIsAdmin = isOwner;
    if (!isOwner) {
      const callerMember = await base44.asServiceRole.entities.TripMember.filter({
        trip_id: member.trip_id, user_email: user.email, status: 'active',
      });
      callerIsAdmin = callerMember[0]?.role === 'admin' || callerMember[0]?.role === 'owner';
    }
    if (!callerIsAdmin) {
      return Response.json({ error: 'Only trip admins can resend invitations' }, { status: 403 });
    }

    // Pick recipient language from their User record (if exists)
    const existingUsers = await base44.asServiceRole.entities.User.filter({ email: member.user_email });
    const recipientLang = existingUsers[0]?.language || 'en';

    const publicAppUrl = (Deno.env.get('PUBLIC_APP_URL') || '').replace(/\/+$/, '');
    const appUrl = publicAppUrl || `${new URL(req.url).origin}`;

    const tplRes = await base44.functions.invoke('_emailTemplate', {
      kind: 'resend_email',
      lang: recipientLang,
      params: {
        title: trip.title,
        inviter: user.full_name || user.email,
        role: member.role,
        recipientEmail: member.user_email,
        appUrl,
      },
    });

    if (!tplRes.data?.subject || !tplRes.data?.body) {
      return Response.json({ error: 'Failed to render email template' }, { status: 500 });
    }

    await base44.asServiceRole.integrations.Core.SendEmail({
      to: member.user_email,
      subject: tplRes.data.subject,
      body: tplRes.data.body,
      from_name: tplRes.data.brand,
    });

    return Response.json({ ok: true });
  } catch (error) {
    console.error('resendTripInvite error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});