/**
 * telegramDisconnect
 *
 * POST body: { tripId, integrationId }
 *
 * Removes ONE Telegram binding of the trip (multi-account).
 * Authorized by trip participation.
 */

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { isCallerParticipant } from '../_shared/tripAccess.ts';
import { disconnectTripTelegram } from '../_shared/telegramTeardown.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { tripId, integrationId } = await req.json().catch(() => ({}));
    if (!tripId || !integrationId) {
      return Response.json({ error: 'tripId and integrationId required' }, { status: 400, headers: corsHeaders });
    }

    if (!(await isCallerParticipant(tripId, user.id))) {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }

    // Delete via the single source of truth (_shared/telegramTeardown) so the
    // user-facing path and the Pro-rollback path never drift. Scoped by integrationId.
    const removed = await disconnectTripTelegram(supabaseAdmin, { tripId, integrationId });

    return Response.json({ ok: true, removed }, { headers: corsHeaders });

  } catch (e) {
    console.error('telegramDisconnect error:', e);
    return Response.json({ error: (e as Error).message }, { status: 500, headers: corsHeaders });
  }
});
