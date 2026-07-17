/**
 * telegramGetIntegration
 *
 * POST body: { tripId }
 *
 * Returns ALL Telegram bindings for the trip (multi-account):
 *   { integrations: [{ id, telegram_chat_id, telegram_username,
 *                      telegram_first_name, is_active, linked_at }] }
 *
 * Authorized by trip participation (any participant manages the trip's bindings).
 */

import { withHandler } from '../_shared/http.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { isCallerParticipant } from '../_shared/tripAccess.ts';

Deno.serve(withHandler('telegramGetIntegration', async (req, corsHeaders) => {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { tripId } = await req.json();
    if (!tripId) return Response.json({ error: 'tripId is required' }, { status: 400, headers: corsHeaders });

    if (!(await isCallerParticipant(tripId, user.id))) {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }

    const { data: rows } = await supabaseAdmin
      .from('trip_telegram_integrations')
      .select('id, telegram_chat_id, telegram_username, telegram_first_name, is_active, linked_at')
      .eq('trip_id', tripId)
      .order('linked_at', { ascending: false });

    return Response.json({ integrations: rows ?? [] }, { headers: corsHeaders });

}));
