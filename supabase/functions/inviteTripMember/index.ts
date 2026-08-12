/**
 * inviteTripMember
 *
 * POST body: { trip_id, email, role: 'viewer'|'admin' }
 *
 * Auth: caller must be authenticated and be the trip owner or an active admin.
 * Creates a pending TripMember and announces `invite_created`; n8n delivers the
 * in-app notification + email.
 */

import { withHandler } from '../_shared/http.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { isCallerEditor } from '../_shared/tripAccess.ts';
import { emit } from '../_shared/emit.ts';

Deno.serve(withHandler('inviteTripMember', async (req, corsHeaders) => {
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
    const callerIsEditor = await isCallerEditor(trip_id, user.id);
    if (!callerIsEditor) {
      return Response.json({ error: 'Only trip admins can invite members' }, { status: 403, headers: corsHeaders });
    }

    // Load trip (for created_by — owner guard below)
    const { data: trip } = await supabaseAdmin.from('trips').select('created_by').eq('id', trip_id).single();
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

    // Fetch invited user's profile (if registered) to get id + full_name for the
    // member row (owner-guard needs id; user_full_name is persisted on the row).
    const { data: invitedUsers } = await supabaseAdmin
      .from('users')
      .select('id, full_name')
      .eq('email', normalizedEmail)
      .limit(1);
    const invitedUser = invitedUsers?.[0] ?? null;

    // The trip creator is the owner via trips.created_by and is NEVER a
    // trip_members row (create_trip writes none). The `existing`-row check above
    // therefore can't catch them, so guard explicitly: inviting the creator as a
    // viewer/admin would create a stray member row that demotes the owner to
    // that role inside the trip (TRIP-143).
    if (invitedUser?.id && invitedUser.id === trip.created_by) {
      return Response.json(
        { error: 'Cannot invite the trip owner', code: 'invite_owner' },
        { status: 400, headers: corsHeaders },
      );
    }

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

    // TRIP-356: announce the event; n8n resolves audience/text and delivers
    // (in-app notification + invite email).
    emit('invite_created', { trip_id, actor_id: user.id, member_id: member.id });

    return Response.json({ ok: true, member }, { headers: corsHeaders });

}));
