import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Email/notification templates live in functions/_emailTemplate — single source
// of truth. Brand and signature also come from there (no duplication).

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { trip_id, email, role } = body;
    if (!trip_id || !email || !role) {
      return Response.json({ error: 'Missing trip_id, email or role' }, { status: 400 });
    }
    if (!['viewer', 'admin'].includes(role)) {
      return Response.json({ error: 'Invalid role' }, { status: 400 });
    }
    const normalizedEmail = String(email).trim().toLowerCase();

    // Load trip and verify caller is owner/admin
    const trip = await base44.asServiceRole.entities.Trip.get(trip_id);
    if (!trip) return Response.json({ error: 'Trip not found' }, { status: 404 });

    const isOwner = trip.created_by === user.email;
    let callerIsAdmin = isOwner;
    if (!isOwner) {
      const callerMember = await base44.asServiceRole.entities.TripMember.filter({
        trip_id, user_email: user.email, status: 'active',
      });
      callerIsAdmin = callerMember[0]?.role === 'admin' || callerMember[0]?.role === 'owner';
    }
    if (!callerIsAdmin) {
      return Response.json({ error: 'Only trip admins can invite members' }, { status: 403 });
    }

    if (normalizedEmail === user.email.toLowerCase()) {
      return Response.json({ error: 'You cannot invite yourself' }, { status: 400 });
    }

    // Check existing membership
    const existing = await base44.asServiceRole.entities.TripMember.filter({
      trip_id, user_email: normalizedEmail,
    });
    if (existing.length > 0) {
      return Response.json({ error: 'This user is already invited or a member', existing: existing[0] }, { status: 409 });
    }

    // Check if invited user exists already — to pick their language
    const existingUsers = await base44.asServiceRole.entities.User.filter({ email: normalizedEmail });
    const invitedUser = existingUsers[0] || null;
    const recipientLang = invitedUser?.language || 'en';

    // Create the member record (pending)
    const member = await base44.asServiceRole.entities.TripMember.create({
      trip_id,
      user_email: normalizedEmail,
      user_full_name: invitedUser?.full_name || '',
      role,
      status: 'pending',
      invited_by_email: user.email,
    });

    // Render localized notification text via shared template function (fallback).
    // Primary rendering happens on the client via i18n keys.
    let notifTitle = `You have been invited to trip "${trip.title}"`;
    let notifMessage = `${user.full_name || user.email} invites you.`;
    try {
      const notifRes = await base44.functions.invoke('_emailTemplate', {
        kind: 'invite_notification',
        lang: recipientLang,
        params: { title: trip.title, inviter: user.full_name || user.email, role },
      });
      if (notifRes.data?.title) notifTitle = notifRes.data.title;
      if (notifRes.data?.message) notifMessage = notifRes.data.message;
    } catch (e) {
      console.error('Notification template fetch failed (using fallback):', e?.message || e);
    }

    await base44.asServiceRole.entities.Notification.create({
      user_email: normalizedEmail,
      type: 'trip_invite',
      i18n_title_key: 'notif.tpl_invite_title',
      i18n_message_key: 'notif.tpl_invite_msg',
      i18n_params: {
        trip: trip.title,
        inviter: user.full_name || user.email,
        role_key: role === 'admin' ? 'notif.role_admin' : 'notif.role_viewer',
      },
      title: notifTitle,
      message: notifMessage,
      trip_id,
      trip_member_id: member.id,
      read: false,
    });

    // Send email (best-effort) — URL comes from PUBLIC_APP_URL secret (single source of truth).
    try {
      const publicAppUrl = (Deno.env.get('PUBLIC_APP_URL') || '').replace(/\/+$/, '');
      const appUrl = publicAppUrl || `${new URL(req.url).origin}`;

      const tplRes = await base44.functions.invoke('_emailTemplate', {
        kind: 'invite_email',
        lang: recipientLang,
        params: {
          title: trip.title,
          inviter: user.full_name || user.email,
          role,
          recipientEmail: normalizedEmail,
          appUrl,
        },
      });

      if (tplRes.data?.subject && tplRes.data?.body) {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: normalizedEmail,
          subject: tplRes.data.subject,
          body: tplRes.data.body,
          from_name: tplRes.data.brand,
        });
      } else {
        console.error('Email template returned no subject/body, skipping email send');
      }
    } catch (e) {
      console.error('SendEmail failed:', e?.message || e);
    }

    return Response.json({ ok: true, member });
  } catch (error) {
    console.error('inviteTripMember error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});