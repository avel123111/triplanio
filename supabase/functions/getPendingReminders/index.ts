/**
 * getPendingReminders
 *
 * POST endpoint called by n8n on a schedule (default every 15 minutes).
 *
 * Auth: Bearer token from the N8N_SECRET Edge Function secret.
 *
 * Body (optional):
 *   { "window_minutes": 15 }   // defaults to 15
 *
 * Behavior:
 *   1. Calls the `get_pending_reminders(window_minutes)` SQL function which
 *      returns every reminder that falls inside its [lead_time, lead_time +
 *      window_minutes] bracket AND has not yet been logged for the user.
 *   2. Inserts a claim row in telegram_reminder_logs for each reminder up-front
 *      so retries inside the same window won't double-send, and reads back each
 *      row's id. Only freshly-claimed reminders are emitted (a row already
 *      claimed this window is dropped, never re-sent).
 *   3. Returns { reminders: [...] } to n8n, each carrying its log_id. n8n sends
 *      the Telegram messages and stamps delivered_at back against log_id, so a
 *      silent non-delivery stays visible (delivered_at is null) instead of the
 *      claim row meaning "delivered" forever.
 */

import { withHandler } from '../_shared/http.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';

interface ReminderRow {
  type: string;
  user_id: string;
  user_locale: string;
  trip_id: string;
  chat_id: string;
  // event_timezone: IANA zone of the event location (e.g. "Europe/Madrid"),
  // injected by get_pending_reminders. The other datetime fields in context are
  // wall-clock-as-UTC (local time of the event), so n8n needs this to reason
  // about how soon the event is. Normalized to 'UTC' when unknown.
  context: { id: string; event_timezone: string } & Record<string, unknown>;
}

Deno.serve(withHandler('getPendingReminders', async (req, corsHeaders) => {
  if (req.method !== 'POST') {
    // JSON `{ error }` (not plain text) keeps the frontend parseEdgeError contract
    // uniform and lets withHandler's body-enrichment read it.
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
  }

  const expected = Deno.env.get('N8N_SECRET');
  if (!expected) {
    console.error('N8N_SECRET is not set');
    return Response.json({ error: 'Server misconfigured' }, { status: 500, headers: corsHeaders });
  }

  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || token !== expected) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const windowMinutes: number = typeof body.window_minutes === 'number' ? body.window_minutes : 15;

  const { data: reminders, error } = await supabaseAdmin
    .rpc('get_pending_reminders', { window_minutes: windowMinutes });

  if (error) {
    console.error('get_pending_reminders error:', error);
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }

  const rows: ReminderRow[] = reminders || [];
  if (rows.length === 0) {
    return Response.json({ reminders: [] }, { headers: corsHeaders });
  }

  // Lock the reminders in immediately so a retry inside the same window
  // doesn't hand n8n the same rows twice. ignoreDuplicates relies on the
  // idx_reminder_logs_dedup UNIQUE index on (user_id, event_kind, event_id);
  // without it a single conflicting row would abort the whole batch.
  const logs = rows.map((r) => ({
    trip_id: r.trip_id,
    user_id: r.user_id,
    event_kind: r.type,
    event_id: r.context.id,
    sent_at: new Date().toISOString(),
  }));

  // Read back the claim rows' ids. With ignoreDuplicates a reminder already
  // claimed in this window is NOT returned here — we drop it below so it can't
  // be sent twice. Each returned id is the telegram_reminder_logs PK that n8n
  // echoes back to stamp delivered_at against the exact row (works even with
  // several reminders for the same event — each is its own row/id).
  const { data: claimed, error: logError } = await supabaseAdmin
    .from('telegram_reminder_logs')
    .upsert(logs, { onConflict: 'user_id,event_kind,event_id', ignoreDuplicates: true })
    .select('id, user_id, event_kind, event_id');

  if (logError) {
    // Fail closed: without a confirmed claim we might double-send next tick.
    // These reminders stay unclaimed and are retried on the following tick.
    console.error('reminder_logs claim error:', logError.message);
    return Response.json({ error: logError.message }, { status: 500, headers: corsHeaders });
  }

  // Attach each claim row's id (log_id) to its reminder and emit only the
  // freshly-claimed ones. A reminder whose row was a pre-existing duplicate has
  // no id here and is dropped — the RPC already excludes logged reminders, so
  // this only fires on a rare concurrent-tick race, and dropping it is correct
  // (it was already handed off once).
  const idByKey = new Map(
    (claimed ?? []).map((c) => [`${c.user_id}|${c.event_kind}|${c.event_id}`, c.id]),
  );
  const emit = rows.flatMap((r) => {
    const logId = idByKey.get(`${r.user_id}|${r.type}|${r.context.id}`);
    return logId ? [{ ...r, log_id: logId }] : [];
  });

  return Response.json({ reminders: emit }, { headers: corsHeaders });
}));
