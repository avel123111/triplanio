/**
 * removeTripMember
 *
 * POST body: { member_id }
 *
 * Auth: caller must be trip owner/admin — OR the member themselves (self-removal).
 * Owner role cannot be removed.
 */

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { isCallerAdmin } from '../_shared/tripAccess.ts';

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

    if (!member) return Response.json({ error: 'Not found' }, { status: 404, headers: corsHeaders });
    if (member.role === 'owner') {
      return Response.json({ error: 'Cannot remove owner' }, { status: 400, headers: corsHeaders });
    }

    const isSelf = member.user_id === user.id;
    const callerIsAdmin = isSelf ? false : await isCallerAdmin(member.trip_id, user.id);

    if (!callerIsAdmin && !isSelf) {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }

    await supabaseAdmin.from('trip_members').delete().eq('id', member_id);

    return Response.json({ ok: true }, { headers: corsHeaders });

  } catch (error) {
    console.error('removeTripMember error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500, headers: corsHeaders },
    );
  }
});
