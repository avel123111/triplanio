import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { member_id, role } = await req.json();
    if (!member_id || !['viewer', 'admin'].includes(role)) {
      return Response.json({ error: 'Bad input' }, { status: 400 });
    }

    const member = await base44.asServiceRole.entities.TripMember.get(member_id);
    if (!member) return Response.json({ error: 'Not found' }, { status: 404 });
    if (member.role === 'owner') {
      return Response.json({ error: 'Cannot change owner role' }, { status: 400 });
    }

    const trip = await base44.asServiceRole.entities.Trip.get(member.trip_id);
    const isOwner = trip?.created_by === user.email;
    let callerIsAdmin = isOwner;
    if (!isOwner) {
      const callerMember = await base44.asServiceRole.entities.TripMember.filter({
        trip_id: member.trip_id, user_email: user.email, status: 'active',
      });
      callerIsAdmin = callerMember[0]?.role === 'admin';
    }
    if (!callerIsAdmin) return Response.json({ error: 'Forbidden' }, { status: 403 });

    await base44.asServiceRole.entities.TripMember.update(member_id, { role });
    return Response.json({ ok: true });
  } catch (error) {
    console.error('updateTripMemberRole error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});