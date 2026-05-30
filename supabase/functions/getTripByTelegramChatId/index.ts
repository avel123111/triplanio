/**
 * getTripByTelegramChatId
 *
 * POST body: { telegram_chat_id: string | number }
 *
 * Server-to-server endpoint called from n8n / the Telegram bot. Runs with
 * verify_jwt=false, so it authenticates the caller itself: requires
 * `Authorization: Bearer <N8N_SECRET>` (see requireN8nSecret). Without this
 * gate any party could resolve a chat id to a trip and read the entire trip
 * (members, budget, expenses, share_token) — broken access control.
 *
 * Looks up the trip via trip_telegram_integrations.telegram_chat_id,
 * then returns the full trip payload.
 */

import { corsHeaders } from '../_shared/cors.ts';
import { requireN8nSecret } from '../_shared/n8nAuth.ts';
import { fetchTripPayload } from '../_shared/tripPayload.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Authenticate the server-to-server caller (n8n / Telegram bot).
  const denied = requireN8nSecret(req);
  if (denied) return denied;

  try {
    const { telegram_chat_id } = await req.json();
    if (!telegram_chat_id) {
      return Response.json({ error: 'telegram_chat_id is required' }, { status: 400, headers: corsHeaders });
    }

    // Look up the integration
    const { data: integration, error: intErr } = await supabaseAdmin
      .from('trip_telegram_integrations')
      .select('trip_id')
      .eq('telegram_chat_id', String(telegram_chat_id))
      .maybeSingle();

    if (intErr) {
      console.error('Integration lookup error:', intErr);
      return Response.json({ error: 'Integration lookup failed' }, { status: 500, headers: corsHeaders });
    }
    if (!integration?.trip_id) {
      return Response.json({ error: 'No trip found for this Telegram chat' }, { status: 404, headers: corsHeaders });
    }

    return await fetchTripPayload(integration.trip_id);
  } catch (err) {
    console.error('getTripByTelegramChatId error:', err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500, headers: corsHeaders },
    );
  }
});
