/**
 * sendTripReminders
 *
 * POST — no body required.
 * Admin-only (ADMIN_EMAILS). Called by scheduler every 15 minutes.
 * Sends Telegram reminders for upcoming trip events.
 */

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';

const TELEGRAM_API = 'https://api.telegram.org/bot';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function isUpcoming(eventTimeStr: string | null, windowMs: number): boolean {
  if (!eventTimeStr) return false;
  const now = Date.now();
  const eventMs = new Date(eventTimeStr).getTime();
  return eventMs >= now && eventMs <= now + windowMs;
}

async function sendTelegramMessage(botToken: string, chatId: string, text: string) {
  await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
}

async function hasBeenSent(tripId: string, userId: string, eventKind: string, eventId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('telegram_reminder_logs')
    .select('id')
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .eq('event_kind', eventKind)
    .eq('event_id', eventId)
    .maybeSingle();
  return !!data;
}

async function logSent(tripId: string, userId: string, eventKind: string, eventId: string) {
  await supabaseAdmin.from('telegram_reminder_logs').insert({
    trip_id: tripId,
    user_id: userId,
    event_kind: eventKind,
    event_id: eventId,
    sent_at: new Date().toISOString(),
  });
}

function formatDateTime(dt: string | null): string {
  if (!dt) return 'unknown time';
  try {
    return new Date(dt).toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  } catch { return dt; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const adminEmails = (Deno.env.get('ADMIN_EMAILS') || '')
      .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (!adminEmails.includes((user.email || '').toLowerCase())) {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }

    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!botToken) return Response.json({ error: 'TELEGRAM_BOT_TOKEN missing' }, { status: 500, headers: corsHeaders });

    const { data: integrations } = await supabaseAdmin
      .from('trip_telegram_integrations')
      .select('id, trip_id, user_id, telegram_chat_id')
      .eq('is_active', true)
      .not('telegram_chat_id', 'is', null);

    if (!integrations || integrations.length === 0) {
      return Response.json({ ok: true, sent: 0 }, { headers: corsHeaders });
    }

    let totalSent = 0;

    for (const integration of integrations) {
      const { trip_id: tripId, user_id: userId, telegram_chat_id: chatId } = integration;

      const [hotels, transfers, activities, services, cityVisits] = await Promise.all([
        supabaseAdmin.from('hotel_stays').select('id, name, check_in_datetime, check_out_datetime').eq('trip_id', tripId).then((r) => r.data ?? []),
        supabaseAdmin.from('transfers').select('id, transport_type, carrier, start_datetime, from_address, to_address').eq('trip_id', tripId).then((r) => r.data ?? []),
        supabaseAdmin.from('activities').select('id, title, start_datetime, location_name').eq('trip_id', tripId).then((r) => r.data ?? []),
        supabaseAdmin.from('trip_services').select('id, name, kind, details').eq('trip_id', tripId).then((r) => r.data ?? []),
        supabaseAdmin.from('city_visits').select('id, city_name, country, start_date').eq('trip_id', tripId).then((r) => r.data ?? []),
      ]);

      // Hotel check-in (24h)
      for (const h of hotels) {
        if (!isUpcoming(h.check_in_datetime, DAY)) continue;
        if (await hasBeenSent(tripId, userId, 'hotel_checkin', h.id)) continue;
        await sendTelegramMessage(botToken, chatId, `🏨 <b>Hotel Check-in Tomorrow</b>\n${h.name}\nCheck-in: ${formatDateTime(h.check_in_datetime)}`);
        await logSent(tripId, userId, 'hotel_checkin', h.id);
        totalSent++;
      }

      // Hotel check-out (2h)
      for (const h of hotels) {
        if (!isUpcoming(h.check_out_datetime, 2 * HOUR)) continue;
        if (await hasBeenSent(tripId, userId, 'hotel_checkout', h.id)) continue;
        await sendTelegramMessage(botToken, chatId, `🏨 <b>Hotel Check-out in 2 hours</b>\n${h.name}\nCheck-out: ${formatDateTime(h.check_out_datetime)}`);
        await logSent(tripId, userId, 'hotel_checkout', h.id);
        totalSent++;
      }

      // Transfers (2h)
      for (const t of transfers) {
        if (!isUpcoming(t.start_datetime, 2 * HOUR)) continue;
        if (await hasBeenSent(tripId, userId, 'transfer_depart', t.id)) continue;
        const type = t.transport_type || 'Transfer';
        const carrier = t.carrier ? ` · ${t.carrier}` : '';
        const route = [t.from_address, t.to_address].filter(Boolean).join(' → ');
        await sendTelegramMessage(botToken, chatId, `✈️ <b>${type}${carrier} in 2 hours</b>\n${route ? route + '\n' : ''}Departure: ${formatDateTime(t.start_datetime)}`);
        await logSent(tripId, userId, 'transfer_depart', t.id);
        totalSent++;
      }

      // Activities (2h)
      for (const a of activities) {
        if (!isUpcoming(a.start_datetime, 2 * HOUR)) continue;
        if (await hasBeenSent(tripId, userId, 'activity_start', a.id)) continue;
        const loc = a.location_name ? `\n📍 ${a.location_name}` : '';
        await sendTelegramMessage(botToken, chatId, `🎭 <b>${a.title} in 2 hours</b>${loc}\nStarts: ${formatDateTime(a.start_datetime)}`);
        await logSent(tripId, userId, 'activity_start', a.id);
        totalSent++;
      }

      // Car rentals (2h)
      for (const s of services) {
        if (s.kind !== 'car_rental') continue;
        const startDt = s.details?.start_datetime ?? s.details?.pickup_datetime;
        const endDt = s.details?.end_datetime ?? s.details?.dropoff_datetime;
        if (startDt && isUpcoming(startDt, 2 * HOUR)) {
          if (!(await hasBeenSent(tripId, userId, 'car_rental_start', s.id))) {
            await sendTelegramMessage(botToken, chatId, `🚗 <b>Car Rental Pickup in 2 hours</b>\n${s.name}\nPickup: ${formatDateTime(startDt)}`);
            await logSent(tripId, userId, 'car_rental_start', s.id);
            totalSent++;
          }
        }
        if (endDt && isUpcoming(endDt, 2 * HOUR)) {
          if (!(await hasBeenSent(tripId, userId, 'car_rental_end', s.id))) {
            await sendTelegramMessage(botToken, chatId, `🚗 <b>Car Rental Drop-off in 2 hours</b>\n${s.name}\nDrop-off: ${formatDateTime(endDt)}`);
            await logSent(tripId, userId, 'car_rental_end', s.id);
            totalSent++;
          }
        }
      }

      // City arrivals (1h)
      // DEBT (date-only city dates): start_date has no time, so isUpcoming(..., HOUR)
      // is degenerate (fires only in the hour before UTC midnight). City-arrival
      // reminder policy is a separate decision (drop vs day-of) — see TRIP_SANDBOX doc.
      for (const cv of cityVisits) {
        if (!isUpcoming(cv.start_date, HOUR)) continue;
        if (await hasBeenSent(tripId, userId, 'city_arrival', cv.id)) continue;
        await sendTelegramMessage(botToken, chatId, `🗺️ <b>Arriving in ${cv.city_name} in 1 hour</b>\n${cv.country || ''}`);
        await logSent(tripId, userId, 'city_arrival', cv.id);
        totalSent++;
      }
    }

    return Response.json({ ok: true, sent: totalSent }, { headers: corsHeaders });

  } catch (e) {
    console.error('sendTripReminders error:', e);
    return Response.json(
      { error: (e as Error).message },
      { status: 500, headers: corsHeaders },
    );
  }
});
