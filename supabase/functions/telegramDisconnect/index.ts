// telegramDisconnect
// Removes the caller's TripTelegramIntegration row(s) for the given trip.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const user = await getUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { tripId } = await req.json().catch(() => ({}));
    if (!tripId) return Response.json({ error: 'tripId is required' }, { status: 400, headers: corsHeaders });

    const { data: removed, error } = await admin
      .from('trip_telegram_integrations')
      .delete()
      .eq('trip_id', tripId)
      .eq('user_email', user.email)
      .select('id');
    if (error) throw error;

    return Response.json({ ok: true, removed: (removed ?? []).length }, { headers: corsHeaders });
  } catch (error) {
    console.error('telegramDisconnect error:', error);
    return Response.json({ error: String(error?.message || error) }, { status: 500, headers: corsHeaders });
  }
});
