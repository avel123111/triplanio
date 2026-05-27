/**
 * telegramSetActive
 *
 * POST body: { tripId, isActive: boolean }
 *
 * Toggles TripTelegramIntegration.is_active for the current user + trip.
 */

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { tripId, isActive } = await req.json();
    if (!tripId || typeof isActive !== 'boolean') {
      return Response.json({ error: 'tripId and isActive required' }, { status: 400, headers: corsHeaders });
    }

    const { data: rows } = await supabaseAdmin
      .from('trip_telegram_integrations')
      .select('id')
      .eq('trip_id', tripId)
      .eq('user_id', user.id)
      .limit(1);

    if (!rows || rows.length === 0) {
      return Response.json({ error: 'Not connected' }, { status: 404, headers: corsHeaders });
    }

    await supabaseAdmin
      .from('trip_telegram_integrations')
      .update({ is_active: isActive })
      .eq('id', rows[0].id);

    return Response.json({ ok: true }, { headers: corsHeaders });

  } catch (e) {
    console.error('telegramSetActive error:', e);
    return Response.json(
      { error: (e as Error).message },
      { status: 500, headers: corsHeaders },
    );
  }
});
