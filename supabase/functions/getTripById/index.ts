/**
 * getTripById
 *
 * POST body: { id: string }
 *
 * Server-to-server endpoint called from n8n / the Telegram bot. Runs with
 * verify_jwt=false, so it authenticates the caller itself: requires
 * `Authorization: Bearer <N8N_SECRET>` (see requireN8nSecret). Without this
 * gate any party that learns a trip UUID could read the entire trip
 * (members, share_token, …) — broken access control.
 *
 * Returns the trip itinerary payload for the given trip id. Budget data is NOT
 * included (finances are never exposed to the bot/n8n layer).
 */

import { withHandler } from '../_shared/http.ts';
import { requireN8nSecret } from '../_shared/n8nAuth.ts';
import { fetchTripPayload } from '../_shared/tripPayload.ts';

Deno.serve(withHandler('getTripById', async (req, corsHeaders) => {
  // Authenticate the server-to-server caller (n8n / Telegram bot).
  const denied = requireN8nSecret(req);
  if (denied) return denied;

  const { id } = await req.json();
  if (!id) {
    return Response.json({ error: 'id is required' }, { status: 400, headers: corsHeaders });
  }

  return await fetchTripPayload(id);
}));
