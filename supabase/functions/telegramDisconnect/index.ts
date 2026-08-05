/**
 * telegramDisconnect
 *
 * POST body: { tripId, integrationId }
 *
 * Removes ONE Telegram binding of the trip (multi-account).
 *
 * Auth = `editor` OR own row — the same two axes as removeTripMember, and for
 * the same reason (TRIP-274):
 *   • ADDING a channel to a trip is trip config, so telegramStartLink and
 *     telegramSetActive are `editor` only. On participation a viewer could
 *     mute or unbind the bot for the whole trip.
 *   • UNLINKING a binding one created oneself (`user_id` = caller) is the "own
 *     row" axis, not a step on the ladder. That path is reachable from the
 *     account screen ("Подключённые аккаунты"), which lists exactly the
 *     caller's own bindings across all trips — a flat `editor` gate would leave
 *     a viewer, or anyone demoted to viewer, staring at their own Telegram
 *     account with a button that 403s.
 * An editor may unlink ANY binding of their trip; everyone else, only their own.
 */

import { withHandler } from '../_shared/http.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { isCallerEditor } from '../_shared/tripAccess.ts';
import { disconnectTripTelegram } from '../_shared/telegramTeardown.ts';

Deno.serve(withHandler('telegramDisconnect', async (req, corsHeaders) => {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { tripId, integrationId } = await req.json().catch(() => ({}));
    if (!tripId || !integrationId) {
      return Response.json({ error: 'tripId and integrationId required' }, { status: 400, headers: corsHeaders });
    }

    // Scope the row by trip_id too, so a foreign integrationId can't be probed.
    const { data: integration, error: readErr } = await supabaseAdmin
      .from('trip_telegram_integrations')
      .select('user_id')
      .eq('id', integrationId)
      .eq('trip_id', tripId)
      .maybeSingle();
    // A read failure must fail LOUD (→ 5xx via the terminal catch), never read as
    // "not yours" (a false 403) — same contract as _shared/tripAccess.ts (TRIP-208).
    if (readErr) throw readErr;
    if (!integration) return Response.json({ error: 'Not found' }, { status: 404, headers: corsHeaders });

    const isSelf = integration.user_id === user.id;
    if (!isSelf && !(await isCallerEditor(tripId, user.id))) {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }

    // Delete via the single source of truth (_shared/telegramTeardown) so the
    // user-facing path and the Pro-rollback path never drift. Scoped by integrationId.
    const removed = await disconnectTripTelegram(supabaseAdmin, { tripId, integrationId });

    return Response.json({ ok: true, removed }, { headers: corsHeaders });

}));
