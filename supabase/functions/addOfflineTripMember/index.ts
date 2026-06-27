// addOfflineTripMember
// Adds a non-registered ("offline") participant to a trip — a name-only member
// with no email/login. Caller must be the trip owner or an active admin/owner.
// Body: { tripId: string, name: string }
import { corsFor } from '../_shared/cors.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

async function getUser(req: Request) {
  const a = req.headers.get('Authorization');
  if (!a) return null;
  const { data: { user } } = await admin.auth.getUser(a.replace('Bearer ', ''));
  return user ?? null;
}

async function isAdmin(tripId: string, userId: string) {
  const { data: trip } = await admin.from('trips').select('created_by').eq('id', tripId).single();
  if (!trip) return false;
  if (trip.created_by === userId) return true;
  const { data: members } = await admin
    .from('trip_members').select('role')
    .eq('trip_id', tripId).eq('user_id', userId).eq('status', 'active').limit(1);
  const role = members?.[0]?.role;
  return role === 'admin' || role === 'owner';
}

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const user = await getUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { tripId, name } = await req.json().catch(() => ({}));
    if (!tripId || !name || !String(name).trim()) {
      return Response.json({ error: 'tripId and name are required' }, { status: 400, headers: corsHeaders });
    }
    if (!(await isAdmin(tripId, user.id))) {
      return Response.json({ error: 'Only trip admins can add members' }, { status: 403, headers: corsHeaders });
    }

    const { data: member, error } = await admin.from('trip_members').insert({
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
  } catch (error) {
    console.error('addOfflineTripMember error:', error);
    return Response.json({ error: String((error as Error)?.message || error) }, { status: 500, headers: corsHeaders });
  }
});
