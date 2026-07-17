/**
 * telegramGetMyIntegrations
 *
 * POST (no body). Auth: logged-in user (verify_jwt = true — default, NOT listed
 * in config.toml). Called from the account-level "Подключённые аккаунты" section.
 *
 * Returns every Telegram binding the caller initiated (user_id = caller) across
 * ALL trips, enriched with the trip title and the caller's role in that trip:
 *
 *   { integrations: [{ id, trip_id, trip_title, role,
 *                      telegram_chat_id, telegram_username,
 *                      telegram_first_name, is_active, linked_at }] }
 *
 * One row per binding (chat ↔ trip). The same trip can appear twice if the user
 * linked it from two personal chats. Unlinking a row reuses telegramDisconnect
 * ({ tripId, integrationId }).
 *
 * Grouping is by user_id = "who linked the chat" (linked_by). In the personal-
 * chat scope (the only scope today) that equals the chat owner — see
 * TG_MULTILINK_TZ_2026-05-31.md.
 */

import { withHandler } from '../_shared/http.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';

Deno.serve(withHandler('telegramGetMyIntegrations', async (req, corsHeaders) => {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    // 1. Bindings this user initiated.
    const { data: rows, error } = await supabaseAdmin
      .from('trip_telegram_integrations')
      .select('id, trip_id, telegram_chat_id, telegram_username, telegram_first_name, is_active, linked_at')
      .eq('user_id', user.id)
      .order('linked_at', { ascending: false });
    if (error) throw error;

    const list = rows ?? [];
    if (list.length === 0) return Response.json({ integrations: [] }, { headers: corsHeaders });

    const tripIds = [...new Set(list.map((r) => r.trip_id))];

    // 2. Trip titles + creator (to derive the owner role).
    const { data: trips } = await supabaseAdmin
      .from('trips')
      .select('id, title, created_by')
      .in('id', tripIds);
    const tripsById: Record<string, { id: string; title: string; created_by: string }> = {};
    for (const tr of trips ?? []) tripsById[tr.id] = tr;

    // 3. Caller's membership role for the trips they don't own.
    const { data: members } = await supabaseAdmin
      .from('trip_members')
      .select('trip_id, role')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .in('trip_id', tripIds);
    const roleByTrip: Record<string, string> = {};
    for (const m of members ?? []) roleByTrip[m.trip_id] = m.role;

    const integrations = list
      .filter((r) => tripsById[r.trip_id]) // drop orphans (trip deleted mid-flight)
      .map((r) => {
        const tr = tripsById[r.trip_id];
        return {
          id: r.id,
          trip_id: r.trip_id,
          trip_title: tr.title ?? '',
          role: tr.created_by === user.id ? 'owner' : (roleByTrip[r.trip_id] || 'viewer'),
          telegram_chat_id: r.telegram_chat_id,
          telegram_username: r.telegram_username,
          telegram_first_name: r.telegram_first_name,
          is_active: r.is_active,
          linked_at: r.linked_at,
        };
      });

    return Response.json({ integrations }, { headers: corsHeaders });

}));
