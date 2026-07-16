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
import { isCallerAdmin } from '../_shared/tripAccess.ts';
import { renderRoleChangedNotification } from '../_shared/emailTemplate.ts';

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

    const callerIsAdmin = await isCallerAdmin(member.trip_id, user.id);
    if (!callerIsAdmin) {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }

    const roleChanged = member.role !== role;
    await supabaseAdmin.from('trip_members').update({ role }).eq('id', member_id);

    // M4 — tell the affected member their role changed (in THEIR language).
    // Only on an actual change and only for registered members. Best-effort.
    if (roleChanged && member.user_id) {
      try {
        const [tripResult, memberUserResult] = await Promise.all([
          supabaseAdmin.from('trips').select('title').eq('id', member.trip_id).single(),
          supabaseAdmin.from('users').select('language').eq('id', member.user_id).limit(1),
        ]);
        const tripTitle = tripResult.data?.title ?? '';
        const lang = memberUserResult.data?.[0]?.language ?? 'en';
        const texts = renderRoleChangedNotification(lang, { role, title: tripTitle });
        await supabaseAdmin.from('notifications').insert({
          user_id: member.user_id,
          type: 'trip_role_changed',
          i18n_title_key: 'notif.tpl_role_changed_title',
          i18n_message_key: role === 'admin' ? 'notif.tpl_role_changed_admin_msg' : 'notif.tpl_role_changed_viewer_msg',
          i18n_params: { trip: tripTitle },
          title: texts.title,
          message: texts.message,
          trip_id: member.trip_id,
          read: false,
          created_by: user.id,
        });
      } catch (e) {
        console.error('updateTripMemberRole: role-change notification failed', e);
      }
    }

    return Response.json({ ok: true }, { headers: corsHeaders });

}));
