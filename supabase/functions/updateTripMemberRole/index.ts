/**
 * updateTripMemberRole
 *
 * POST body: { member_id, role: 'viewer'|'admin' }
 *
 * Auth: caller must be trip owner or active admin.
 * Owner role cannot be changed.
 */

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { isCallerAdmin } from '../_shared/tripAccess.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
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

    const callerIsAdmin = await isCallerAdmin(member.trip_id, user.email!);
    if (!callerIsAdmin) {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }

    await supabaseAdmin.from('trip_members').update({ role }).eq('id', member_id);

    return Response.json({ ok: true }, { headers: corsHeaders });

  } catch (error) {
    console.error('updateTripMemberRole error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500, headers: corsHeaders },
    );
  }
});
