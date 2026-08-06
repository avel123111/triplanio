// addOfflineTripMember
// Adds a non-registered ("offline") participant to a trip — a name-only member
// with no email/login. Gated at the `editor` step (_shared/tripAccess.ts).
// Body: { tripId: string, name: string }
import { withHandler } from '../_shared/http.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { isCallerEditor } from '../_shared/tripAccess.ts';

Deno.serve(withHandler('addOfflineTripMember', async (req, corsHeaders) => {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { tripId, name } = await req.json().catch(() => ({}));
    if (!tripId || !name || !String(name).trim()) {
      return Response.json({ error: 'tripId and name are required' }, { status: 400, headers: corsHeaders });
    }
    if (!(await isCallerEditor(tripId, user.id))) {
      return Response.json({ error: 'Only trip admins can add members' }, { status: 403, headers: corsHeaders });
    }

    const { data: member, error } = await supabaseAdmin.from('trip_members').insert({
      trip_id: tripId,
      user_id: null,
      invite_email: null,
      user_full_name: String(name).trim(),
      role: 'viewer',
      status: 'offline',
      invited_by: user.id,
      created_by: user.id,
    }).select().single();
    if (error) throw error;

    return Response.json({ ok: true, member }, { headers: corsHeaders });
}));
