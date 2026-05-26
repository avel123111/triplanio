import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const I18N = {
  en: {
    joined_title: (name) => `${name} joined the trip`,
    joined_msg: (title) => `Accepted invitation to "${title}".`,
  },
  ru: {
    joined_title: (name) => `${name} присоединился к путешествию`,
    joined_msg: (title) => `Принял приглашение в «${title}».`,
  },
  es: {
    joined_title: (name) => `${name} se unió al viaje`,
    joined_msg: (title) => `Aceptó la invitación a «${title}».`,
  },
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { member_id, action } = await req.json();
    if (!member_id || !['accept', 'decline'].includes(action)) {
      return Response.json({ error: 'Missing member_id or invalid action' }, { status: 400 });
    }

    const member = await base44.asServiceRole.entities.TripMember.get(member_id);
    if (!member) return Response.json({ error: 'Invite not found' }, { status: 404 });
    if (member.user_email.toLowerCase() !== user.email.toLowerCase()) {
      return Response.json({ error: 'This invite is not yours' }, { status: 403 });
    }
    if (member.status !== 'pending') {
      return Response.json({ error: 'Invite already responded to' }, { status: 409 });
    }

    if (action === 'decline') {
      await base44.asServiceRole.entities.TripMember.update(member_id, { status: 'declined' });
    } else {
      await base44.asServiceRole.entities.TripMember.update(member_id, {
        status: 'active',
        accepted_at: new Date().toISOString(),
        user_full_name: user.full_name || '',
      });

      // Notify the inviter — in THEIR language (not the accepter's)
      const trip = await base44.asServiceRole.entities.Trip.get(member.trip_id);
      if (member.invited_by_email && trip) {
        const inviterUsers = await base44.asServiceRole.entities.User.filter({ email: member.invited_by_email });
        const inviterLang = (inviterUsers[0]?.language && I18N[inviterUsers[0].language])
          ? inviterUsers[0].language
          : 'en';
        const L = I18N[inviterLang];
        await base44.asServiceRole.entities.Notification.create({
          user_email: member.invited_by_email,
          type: 'trip_member_joined',
          i18n_title_key: 'notif.tpl_joined_title',
          i18n_message_key: 'notif.tpl_joined_msg',
          i18n_params: {
            name: user.full_name || user.email,
            trip: trip.title,
          },
          // Legacy fallback
          title: L.joined_title(user.full_name || user.email),
          message: L.joined_msg(trip.title),
          trip_id: member.trip_id,
          read: false,
        });
      }
    }

    // Mark the original invite notification as read
    const notifs = await base44.asServiceRole.entities.Notification.filter({
      user_email: user.email, trip_member_id: member_id,
    });
    for (const n of notifs) {
      await base44.asServiceRole.entities.Notification.update(n.id, { read: true });
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error('respondTripInvite error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});