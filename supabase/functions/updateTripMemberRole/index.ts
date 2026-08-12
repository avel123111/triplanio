/**
 * updateTripMemberRole
 *
 * POST body: { member_id, role: 'viewer'|'admin' }
 *
 * Auth: caller must be trip owner or active admin.
 * Owner role cannot be changed.
 */

import { withHandler } from '../_shared/http.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { isCallerEditor } from '../_shared/tripAccess.ts';
import { emit } from '../_shared/emit.ts';

Deno.serve(withHandler('updateTripMemberRole', async (req, corsHeaders) => {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { member_id, role } = await req.json();
    if (!member_id || !['viewer', 'admin'].includes(role)) {
      return Response.json({ error: 'Bad input' }, { status: 400, headers: corsHeaders });
    }

    const { data: member } = await supabaseAdmin
      .from('trip_members')
      .select('*')
      .eq('id', member_id)
      .single();

    if (!member) return Response.json({ error: 'Not found' }, { status: 404, headers: corsHeaders });
    if (member.role === 'owner') {
      return Response.json({ error: 'Cannot change owner role' }, { status: 400, headers: corsHeaders });
    }

    const callerIsEditor = await isCallerEditor(member.trip_id, user.id);
    if (!callerIsEditor) {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }

    const roleChanged = member.role !== role;
    await supabaseAdmin.from('trip_members').update({ role }).eq('id', member_id);

    // M4 — TRIP-356: announce the role change; n8n tells the affected member.
    // Only on an actual change and only for registered members.
    if (roleChanged && member.user_id) {
      emit('role_changed', {
        trip_id: member.trip_id,
        recipient_id: member.user_id,
        actor_id: user.id,
        member_id: member.id,
      });
    }

    return Response.json({ ok: true }, { headers: corsHeaders });

}));
