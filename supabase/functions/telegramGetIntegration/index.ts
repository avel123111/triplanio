/**
 * telegramGetIntegration
 *
 * POST body: { tripId }
 *
 * Returns { connected, integration } for the current user and the given trip.
 */

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { tripId } = await req.json();
    if (!tripId) return Response.json({ error: 'tripId is required' }, { status: 400, headers: corsHeaders });

    const { data: rows } = await supabaseAdmin
      .from('trip_telegram_integrations')
      .select('*')
      .eq('trip_id', tripId)
      .eq('user_id', user.id)
      .limit(1);

    const integration = rows?.[0] || null;
    const connected = !!(integration?.telegram_chat_id);

    return Response.json({ connected, integration }, { headers: corsHeaders });

  } catch (e) {
    console.error('telegramGetIntegration error:', e);
    return Response.json(
      { error: (e as Error).message },
      { status: 500, headers: corsHeaders },
    );
  }
});
