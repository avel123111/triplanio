/**
 * inviteTripMember
 *
 * POST body: { trip_id, email, role: 'viewer'|'admin' }
 *
 * Auth: caller must be authenticated and be the trip owner or an active admin.
 * Creates a pending TripMember, a Notification, and sends an invite email (best-effort).
 */

import { corsFor } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { isCallerAdmin } from '../_shared/tripAccess.ts';
import { renderInviteTemplate, renderInviteNotification } from '../_shared/emailTemplate.ts';
import { sendEmail } from '../_shared/sendEmail.ts';

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { trip_id, email, role } = await req.json();
    if (!trip_id || !email || !role) {
      return Response.json({ error: 'Missing trip_id, email or role' }, { status: 400, headers: corsHeaders });
    }
    if (!['viewer', 'admin'].includes(role)) {
      return Response.json({ error: 'Invalid role' }, { status: 400, headers: corsHeaders });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    if (normalizedEmail === user.email!.toLowerCase()) {
      return Response.json({ error: 'You cannot invite yourself' }, { status: 400, headers: corsHeaders });
    }

    // Verify caller is owner or admin
    const callerIsAdmin = await isCallerAdmin(trip_id, user.id);
    if (!callerIsAdmin) {
      return Response.json({ error: 'Only trip admins can invite members' }, { status: 403, headers: corsHeaders });
    }

    // Load trip (for title and created_by)
    const { data: trip } = await supabaseAdmin.from('trips').select('*').eq('id', trip_id).single();
    if (!trip) return Response.json({ error: 'Trip not found' }, { status: 404, headers: corsHeaders });

    // Check existing membership
    const { data: existing } = await supabaseAdmin
      .from('trip_members')
      .select('*')
      .eq('trip_id', trip_id)
      .eq('invite_email', normalizedEmail);

    // An existing row blocks a fresh invite — EXCEPT when it was declined.
    // A declined invite can be re-sent: we reuse the same row (reset to pending)
    // so the notification FK and history stay intact. Any other status
    // (pending / active / offline) still 409s.
    const existingRow = existing?.[0] ?? null;
    const reactivating = !!existingRow && existingRow.status === 'declined';
    if (existingRow && !reactivating) {
      return Response.json(
        { error: 'This user is already invited or a member', existing: existingRow },
        { status: 409, headers: corsHeaders },
      );
    }

    // Fetch invited user's profile (if registered) to get id, language, full_name
    const { data: invitedUsers } = await supabaseAdmin
      .from('users')
      .select('id, language, full_name, avatar_url')
      .eq('email', normalizedEmail)
      .limit(1);
    const invitedUser = invitedUsers?.[0] ?? null;
    const recipientLang = invitedUser?.language ?? 'en';

    // Fetch caller's profile: display name + language.
    // The EMAIL language follows the INVITER's app language (callerLang),
    // while the in-app notification stays in the recipient's language (recipientLang).
    const { data: callerUsers } = await supabaseAdmin
      .from('users')
      .select('full_name, language')
      .eq('id', user.id)
      .limit(1);
    const callerName = callerUsers?.[0]?.full_name || user.email!;
    const callerLang = callerUsers?.[0]?.language ?? 'en';

    // Create the TripMember record (pending) — or, when re-inviting a declined
    // member, reset the existing row back to pending with the new role.
    const memberFields = {
      trip_id,
      invite_email: normalizedEmail,
      user_id: invitedUser?.id ?? null,
      user_full_name: invitedUser?.full_name || '',
      role,
      status: 'pending',
      invited_by: user.id,
      created_by: user.id,
    };
    const { data: member, error: memberError } = reactivating
      ? await supabaseAdmin.from('trip_members')
          .update({ ...memberFields, accepted_at: null })
          .eq('id', existingRow.id).select().single()
      : await supabaseAdmin.from('trip_members')
          .insert(memberFields).select().single();

    if (memberError || !member) {
      throw new Error(memberError?.message || 'Failed to create member');
    }

    // Create in-app notification (i18n keys preferred; legacy fallback fields kept)
    const notifTexts = renderInviteNotification(recipientLang, {
      title: trip.title,
      inviter: callerName,
      role,
    });

    // Only registered users have a notifications inbox keyed by user_id.
    if (invitedUser?.id) {
      await supabaseAdmin.from('notifications').insert({
        user_id: invitedUser.id,
        type: 'trip_invite',
        i18n_title_key: 'notif.tpl_invite_title',
        i18n_message_key: 'notif.tpl_invite_msg',
        i18n_params: {
          trip: trip.title,
          inviter: callerName,
          role_key: role === 'admin' ? 'notif.role_admin' : 'notif.role_viewer',
        },
        title: notifTexts.title,
        message: notifTexts.message,
        trip_id,
        trip_member_id: member.id,
        read: false,
        created_by: user.id,
      });
    }

    // Send invite email via Resend template (best-effort — failure doesn't break the invite)
    try {
      const publicAppUrl = (Deno.env.get('PUBLIC_APP_URL') || '').replace(/\/+$/, '');
      const appUrl = publicAppUrl || new URL(req.url).origin;

      const tpl = renderInviteTemplate(callerLang, 'invite', {
        title: trip.title,
        inviter: callerName,
        role,
        appUrl,
      });

      await sendEmail({
        to: normalizedEmail,
        subject: tpl.subject,
        from_name: tpl.brand,
        template: { id: tpl.templateId, variables: tpl.variables },
      });
    } catch (e) {
      console.error('sendEmail failed (non-fatal):', e);
    }

    return Response.json({ ok: true, member }, { headers: corsHeaders });

  } catch (error) {
    console.error('inviteTripMember error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500, headers: corsHeaders },
    );
  }
});
