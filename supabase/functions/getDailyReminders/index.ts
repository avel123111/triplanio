/**
 * getDailyReminders
 *
 * POST endpoint called by n8n once per type per day. Returns every event
 * happening "tomorrow" (UTC date arithmetic — datetimes are stored as
 * naive wall-clock-as-UTC so a plain ::date comparison is correct) for the
 * requested category.
 *
 * Auth: Bearer N8N_SECRET (same secret as getPendingReminders).
 *
 * Body:
 *   { "type": "hotel_checkin"
 *           | "hotel_checkout"
 *           | "hotel_cancel"
 *           | "transfer"
 *           | "activity"
 *           | "car_pickup"
 *           | "car_dropoff" }
 *
 * Each `type` maps to a single STABLE SQL function created by the
 * `add_daily_reminder_functions` migration. Unlike getPendingReminders, this
 * endpoint does NOT write to telegram_reminder_logs — daily reminders are
 * fire-and-forget; n8n is responsible for any deduplication if it retries
 * inside the same day.
 */

import { corsFor } from '../_shared/cors.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';

const RPC_MAP: Record<string, string> = {
  hotel_checkin:  'get_trips_hotel_checkin_tomorrow',
  hotel_checkout: 'get_trips_hotel_checkout_tomorrow',
  hotel_cancel:   'get_trips_hotel_cancel_deadline_tomorrow',
  transfer:       'get_trips_transfer_tomorrow',
  activity:       'get_trips_activity_tomorrow',
  car_pickup:     'get_trips_car_pickup_tomorrow',
  car_dropoff:    'get_trips_car_dropoff_tomorrow',
};

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
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
  const type = typeof body.type === 'string' ? body.type : '';
  const rpcName = RPC_MAP[type];
  if (!rpcName) {
    return Response.json(
      { error: `Unknown type. Valid: ${Object.keys(RPC_MAP).join(', ')}` },
      { status: 400, headers: corsHeaders },
    );
  }

  const { data, error } = await supabaseAdmin.rpc(rpcName);
  if (error) {
    console.error(`${rpcName} error:`, error);
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }

  return Response.json({ type, reminders: data ?? [] }, { headers: corsHeaders });
});
