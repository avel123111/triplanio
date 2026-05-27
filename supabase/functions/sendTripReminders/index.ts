/**
 * sendTripReminders
 *
 * POST — no body required.
 *
 * Admin-only (ADMIN_EMAILS env var). Called by scheduler every 15 minutes.
 *
 * For each active telegram integration, checks upcoming events in a 15-minute window
 * and sends reminders via Telegram if not already sent (deduplicated via telegram_reminder_logs).
 *
 * Reminder triggers:
 *   - hotel_checkin:    hotel check-in in 24h
 *   - hotel_checkout:   hotel check-out in 2h
 *   - transfer_depart:  transfer start in 2h
 *   - activity_start:   activity start in 2h
 *   - car_rental_start: car rental start in 2h
 *   - car_rental_end:   car rental end in 2h
 *   - city_arrival:     city visit start in 1h
 */

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';

const TELEGRAM_API = 'https://api.telegram.org/bot';

// Returns true if eventTime is within [now, now + windowMs]
function isUpcoming(eventTimeStr: string | null, windowMs: number): boolean {
  if (!eventTimeStr) return false;
  const now = Date.now();
  const eventMs = new Date(eventTimeStr).getTime();
  return eventMs >= now && eventMs <= now + windowMs;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function sendTelegramMessage(botToken: string, chatId: string, text: string) {
  await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    }),
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
      hour: '2-digit', minute: '2-digit',
      hour12: false,
    });
  } catch {
    return dt;
  }
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

    // Load all active integrations
    const { data: integrations } = await supabaseAdmin
      .from('trip_telegram_integrations')
      .select('id, trip_id, user_id, telegram_chat_id, telegram_first_name')
      .eq('is_active', true)
      .not('telegram_chat_id', 'is', null);

    if (!integrations || integrations.length === 0) {
      return Response.json({ ok: true, sent: 0 }, { headers: corsHeaders });
    }

    let totalSent = 0;

    for (const integration of integrations) {
      const { trip_id: tripId, user_id: userId, telegram_chat_id: chatId } = integration;

      // Load trip data
      const [
        { data: hotels },
        { data: transfers },
        { data: activities },
        { data: services },
        { data: cityVisits },
      ] = await Promise.all([
        supabaseAdmin.from('hotel_stays').select('id, name, check_in_datetime, check_out_datetime').eq('trip_id', tripId),
        supabaseAdmin.from('transfers').select('id, transport_type, carrier, start_datetime, from_address, to_address').eq('trip_id', tripId),
        supabaseAdmin.from('activities').select('id, title, start_datetime, location_name').eq('trip_id', tripId),
        supabaseAdmin.from('trip_services').select('id, name, kind, details').eq('trip_id', tripId),
        supabaseAdmin.from('city_visits').select('id, city_name, country, start_datetime').eq('trip_id', tripId),
      ]);

      // --- Hotel check-in (24h window) ---
      for (const hotel of hotels ?? []) {
        if (!isUpcoming(hotel.check_in_datetime, DAY)) continue;
        const already = await hasBeenSent(tripId, userId, 'hotel_checkin', hotel.id);
        if (already) continue;
        const msg = `🏨 <b>Hotel Check-in Tomorrow</b>\n${hotel.name}\nCheck-in: ${formatDateTime(hotel.check_in_datetime)}`;
        await sendTelegramMessage(botToken, chatId, msg);
        await logSent(tripId, userId, 'hotel_checkin', hotel.id);
        totalSent++;
      }

      // --- Hotel check-out (2h window) ---
      for (const hotel of hotels ?? []) {
        if (!isUpcoming(hotel.check_out_datetime, 2 * HOUR)) continue;
        const already = await hasBeenSent(tripId, userId, 'hotel_checkout', hotel.id);
        if (already) continue;
        const msg = `🏨 <b>Hotel Check-out in 2 hours</b>\n${hotel.name}\nCheck-out: ${formatDateTime(hotel.check_out_datetime)}`;
        await sendTelegramMessage(botToken, chatId, msg);
        await logSent(tripId, userId, 'hotel_checkout', hotel.id);
        totalSent++;
      }

      // --- Transfers (2h window) ---
      for (const transfer of transfers ?? []) {
        if (!isUpcoming(transfer.start_datetime, 2 * HOUR)) continue;
        const already = await hasBeenSent(tripId, userId, 'transfer_depart', transfer.id);
        if (already) continue;
        const type = transfer.transport_type || 'Transfer';
        const carrier = transfer.carrier ? ` · ${transfer.carrier}` : '';
        const route = [transfer.from_address, transfer.to_address].filter(Boolean).join(' → ');
        const msg = `✈️ <b>${type}${carrier} in 2 hours</b>\n${route ? route + '\n' : ''}Departure: ${formatDateTime(transfer.start_datetime)}`;
        await sendTelegramMessage(botToken, chatId, msg);
        await logSent(tripId, userId, 'transfer_depart', transfer.id);
        totalSent++;
      }

      // --- Activities (2h window) ---
      for (const activity of activities ?? []) {
        if (!isUpcoming(activity.start_datetime, 2 * HOUR)) continue;
        const already = await hasBeenSent(tripId, userId, 'activity_start', activity.id);
        if (already) continue;
        const loc = activity.location_name ? `\n📍 ${activity.location_name}` : '';
        const msg = `🎭 <b>${activity.title} in 2 hours</b>${loc}\nStarts: ${formatDateTime(activity.start_datetime)}`;
        await sendTelegramMessage(botToken, chatId, msg);
        await logSent(tripId, userId, 'activity_start', activity.id);
        totalSent++;
      }

      // --- Car rental start/end (2h window) ---
      for (const service of services ?? []) {
        if (service.kind !== 'car_rental') continue;
        const startDt = service.details?.start_datetime ?? service.details?.pickup_datetime;
        const endDt = service.details?.end_datetime ?? service.details?.dropoff_datetime;

        if (startDt && isUpcoming(startDt, 2 * HOUR)) {
          const already = await hasBeenSent(tripId, userId, 'car_rental_start', service.id);
          if (!already) {
            const msg = `🚗 <b>Car Rental Pickup in 2 hours</b>\n${service.name}\nPickup: ${formatDateTime(startDt)}`;
            await sendTelegramMessage(botToken, chatId, msg);
            await logSent(tripId, userId, 'car_rental_start', service.id);
            totalSent++;
          }
        }

        if (endDt && isUpcoming(endDt, 2 * HOUR)) {
          const already = await hasBeenSent(tripId, userId, 'car_rental_end', service.id);
          if (!already) {
            const msg = `🚗 <b>Car Rental Drop-off in 2 hours</b>\n${service.name}\nDrop-off: ${formatDateTime(endDt)}`;
            await sendTelegramMessage(botToken, chatId, msg);
            await logSent(tripId, userId, 'car_rental_end', service.id);
            totalSent++;
          }
        }
      }

      // --- City arrivals (1h window) ---
      for (const cv of cityVisits ?? []) {
        if (!isUpcoming(cv.start_datetime, HOUR)) continue;
        const already = await hasBeenSent(tripId, userId, 'city_arrival', cv.id);
        if (already) continue;
        const msg = `🗺️ <b>Arriving in ${cv.city_name} in 1 hour</b>\n${cv.country || ''}`;
        await sendTelegramMessage(botToken, chatId, msg);
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
