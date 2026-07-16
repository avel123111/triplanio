/**
 * createTripInviteLink
 *
 * POST body: { trip_id, role: 'viewer'|'admin' }
 *
 * Auth: caller must be the trip owner or an active admin.
 * Mints (or reuses) a shareable invite link bound to the trip + role with a
 * 7-day expiry. The role is stored server-side with the token, never in the
 * URL, so it cannot be tampered with by the recipient.
 *
 * Returns: { token, role, expiresAt, reused }
 *
 * Self-contained (shared helpers inlined) so it deploys cleanly on its own.
 */
import { withHandler } from '../_shared/http.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

async function getRequestUser(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
  if (error || !user) return null;
  return user;
}

async function isCallerAdmin(tripId: string, userId: string): Promise<boolean> {
  const { data: trip, error: tripErr } = await supabaseAdmin.from('trips').select('created_by').eq('id', tripId).single();
  // Transient query failure must fail LOUD (→ 5xx via terminal catch), never read
  // as "not admin" (false 403). PGRST116 = genuine no-such-trip → false. TRIP-208.
  if (tripErr && (tripErr as { code?: string }).code !== 'PGRST116') throw tripErr;
  if (!trip) return false;
  if (trip.created_by === userId) return true;
  const { data: members, error: memErr } = await supabaseAdmin
    .from('trip_members').select('role')
    .eq('trip_id', tripId).eq('user_id', userId).eq('status', 'active').limit(1);
  if (memErr) throw memErr;
  const role = members?.[0]?.role;
  return role === 'admin' || role === 'owner';
}

const LINK_TTL_DAYS = 7;

Deno.serve(withHandler('createTripInviteLink', async (req, corsHeaders) => {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const tripId = (body.trip_id ?? body.tripId) as string | undefined;
    const role = body.role === 'admin' ? 'admin' : 'viewer';
    if (!tripId) return Response.json({ error: 'trip_id is required' }, { status: 400, headers: corsHeaders });

    if (!(await isCallerAdmin(tripId, user.id))) {
      return Response.json({ error: 'Only trip admins can create invite links' }, { status: 403, headers: corsHeaders });
    }

    // Reuse an existing live link for this (trip, role) so the URL stays stable.
    const nowIso = new Date().toISOString();
    const { data: existing } = await supabaseAdmin
      .from('trip_invite_links')
      .select('token, role, expires_at')
      .eq('trip_id', tripId).eq('role', role)
      .is('revoked_at', null).gt('expires_at', nowIso)
      .order('created_at', { ascending: false }).limit(1);

    if (existing && existing[0]) {
      return Response.json(
        { token: existing[0].token, role: existing[0].role, expiresAt: existing[0].expires_at, reused: true },
        { headers: corsHeaders },
      );
    }

    // Mint a fresh opaque token (24 random bytes -> 48 hex chars).
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    const expiresAt = new Date(Date.now() + LINK_TTL_DAYS * 86400000).toISOString();

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('trip_invite_links')
      .insert({ trip_id: tripId, token, role, created_by: user.id, expires_at: expiresAt })
      .select('token, role, expires_at').single();

    if (insErr || !inserted) throw new Error(insErr?.message || 'Failed to create invite link');

    return Response.json(
      { token: inserted.token, role: inserted.role, expiresAt: inserted.expires_at, reused: false },
      { headers: corsHeaders },
    );
}));
