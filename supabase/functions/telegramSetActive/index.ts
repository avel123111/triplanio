/**
 * telegramSetActive
 *
 * POST body: { tripId, integrationId, isActive: boolean }
 *
 * Toggles is_active on ONE binding of the trip (multi-account).
 * Authorized by trip participation.
 */

import { withHandler } from '../_shared/http.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { isCallerParticipant } from '../_shared/tripAccess.ts';

Deno.serve(withHandler('telegramSetActive', async (req, corsHeaders) => {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { tripId, integrationId, isActive } = await req.json();
    if (!tripId || !integrationId || typeof isActive !== 'boolean') {
      return Response.json({ error: 'tripId, integrationId and isActive required' }, { status: 400, headers: corsHeaders });
    }

    if (!(await isCallerParticipant(tripId, user.id))) {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }

    // Update only when the binding belongs to this trip (guards cross-trip ids).
    const { data: updated, error } = await supabaseAdmin
      .from('trip_telegram_integrations')
      .update({ is_active: isActive })
      .eq('id', integrationId)
      .eq('trip_id', tripId)
      .select('id');
    if (error) throw error;
    if (!updated || updated.length === 0) {
      return Response.json({ error: 'Not found' }, { status: 404, headers: corsHeaders });
    }

    return Response.json({ ok: true }, { headers: corsHeaders });

}));
