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
 * A single Telegram chat can be linked to SEVERAL trips (one row per
 * (trip_id, user_id) in trip_telegram_integrations; telegram_chat_id is NOT
 * unique). Therefore this endpoint returns an ARRAY:
 *
 *   { trips: [ { is_active, linked_at, trip, cityVisits, hotels, transfers,
 *                activities, services, members, budget, budgetCategories,
 *                budgetExpenses }, ... ] }
 *
 * Trips are ordered active-first, then by linked_at desc. When the chat has no
 * linked trips the response is { trips: [] } with HTTP 200 (not an error) so
 * the caller can cleanly tell the user the chat is not connected yet.
 *
 * NOTE: the previous implementation used .maybeSingle(), which threw
 * PGRST116 ("multiple rows returned") as soon as a chat had 2+ linked trips,
 * and ignored is_active entirely. This version fixes both.
 */

import { corsHeaders } from '../_shared/cors.ts';
import { requireN8nSecret } from '../_shared/n8nAuth.ts';
import { buildTripData } from '../_shared/tripPayload.ts';
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

    // All integrations bound to this chat (a chat may have several trips).
    const { data: integrations, error: intErr } = await supabaseAdmin
      .from('trip_telegram_integrations')
      .select('trip_id, is_active, linked_at')
      .eq('telegram_chat_id', String(telegram_chat_id))
      .order('is_active', { ascending: false })
      .order('linked_at', { ascending: false });

    if (intErr) {
      console.error('Integration lookup error:', intErr);
      return Response.json({ error: 'Integration lookup failed' }, { status: 500, headers: corsHeaders });
    }

    if (!integrations || integrations.length === 0) {
      // Not an error: chat is simply not linked to any trip yet.
      return Response.json({ trips: [] }, { headers: corsHeaders });
    }

    // De-duplicate trip_ids (same trip could be linked by several users).
    const seen = new Set<string>();
    const uniqueIntegrations = integrations.filter((i) => {
      if (!i.trip_id || seen.has(i.trip_id)) return false;
      seen.add(i.trip_id);
      return true;
    });

    // Build the full payload for each linked trip.
    const trips = (
      await Promise.all(
        uniqueIntegrations.map(async (i) => {
          const data = await buildTripData(i.trip_id);
          if (!data) return null; // trip deleted but integration row left behind
          return { is_active: i.is_active ?? false, linked_at: i.linked_at, ...data };
        }),
      )
    ).filter((t) => t !== null);

    return Response.json({ trips }, { headers: corsHeaders });
  } catch (err) {
    console.error('getTripByTelegramChatId error:', err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500, headers: corsHeaders },
    );
  }
});
