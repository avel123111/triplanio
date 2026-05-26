import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Scheduled every 15 minutes by the "Telegram Reminders" automation.
 *
 * Sends Telegram reminders for upcoming trip events:
 *   - 24h before hotel free-cancellation deadline
 *   - 24h before hotel check-in
 *   - 18h before hotel check-out
 *   - 4h  before transfer departure
 *   - 18h before car rental start
 *   - 18h before car rental end
 *   - 4h  before activity start
 *
 * Reminders are sent within a 15-minute window aligned with the scheduler
 * interval. If a reminder didn't fire on time (e.g. function downtime), we
 * do NOT send a late one — only events currently inside the window trigger.
 *
 * Deduplication via TelegramReminderLog by (user_id, event_kind, event_id).
 *
 * Admin-only: this is invoked by the platform scheduler. We still verify
 * the caller is admin to prevent abuse via direct HTTP invocation.
 */

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const HOUR = 60 * 60 * 1000;

// Reminder rules: lead time before event_time
const RULES = [
  { kind: 'hotel_cancel_deadline', leadH: 24 },
  { kind: 'hotel_checkin',        leadH: 24 },
  { kind: 'hotel_checkout',       leadH: 18 },
  { kind: 'transfer_start',       leadH: 4  },
  { kind: 'car_rental_start',     leadH: 18 },
  { kind: 'car_rental_end',       leadH: 18 },
  { kind: 'activity_start',       leadH: 4  },
];

const TELEGRAM_API = (token, method) => `https://api.telegram.org/bot${token}/${method}`;

// Strip Markdown that we don't want to render in Telegram plain-text messages.
function plain(s) {
  if (!s) return '';
  return String(s).replace(/[*_`~]/g, '');
}

function fmtLocal(iso, timezone) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: timezone || 'UTC',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(d);
  } catch {
    return iso;
  }
}

function transportLabel(type) {
  const map = {
    plane: '✈️ Перелёт',
    train: '🚆 Поезд',
    bus: '🚌 Автобус',
    car: '🚗 Машина',
    taxi: '🚕 Такси',
    ferry: '⛴️ Паром',
    walk: '🚶 Пешком',
    own_transport: '🚙 Свой транспорт',
    other: '🧭 Трансфер',
  };
  return map[type] || '🧭 Трансфер';
}

async function sendTelegramMessage(token, chatId, text) {
  const res = await fetch(TELEGRAM_API(token, 'sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('Telegram sendMessage failed', res.status, body);
    return false;
  }
  return true;
}

/**
 * Returns true if the reminder time (event_time - leadH) falls inside the
 * current 15-minute window [now, now + WINDOW_MS).
 */
function isInWindow(eventIso, leadH, now) {
  if (!eventIso) return false;
  const t = new Date(eventIso).getTime();
  if (Number.isNaN(t)) return false;
  const reminderAt = t - leadH * HOUR;
  return reminderAt >= now && reminderAt < now + WINDOW_MS;
}

/**
 * Convert a naive wall-clock datetime string (without TZ suffix, e.g.
 * "2026-06-08T10:00:00") into an absolute UTC ISO string, interpreting the
 * wall-clock value as being in the given IANA timezone.
 *
 * Returns null on failure or if timezone is missing.
 *
 * Used for car_rental events: they store `pickup_at_local` as naive
 * wall-clock in `pickup_timezone`, so we need to convert to UTC for the
 * scheduler window comparison.
 */
function naiveLocalToUtcIso(localStr, timezone) {
  if (!localStr || !timezone) return null;
  try {
    // Strip any TZ suffix and seconds — keep only "YYYY-MM-DDTHH:mm".
    const clean = String(localStr).replace(/(Z|[+-]\d{2}:?\d{2})$/, '').slice(0, 16);
    const match = clean.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!match) return null;
    const [, y, m, d, hh, mm] = match.map(Number);
    // Build a date assuming UTC, then figure out the offset of `timezone`
    // at that instant and shift accordingly. This is the standard trick to
    // turn a naive local datetime into a real UTC moment.
    const utcGuess = Date.UTC(y, m - 1, d, hh, mm);
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts = Object.fromEntries(
      dtf.formatToParts(new Date(utcGuess)).map(p => [p.type, p.value])
    );
    const asUtcOfTz = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second)
    );
    const offset = asUtcOfTz - utcGuess; // offset of TZ at that instant
    return new Date(utcGuess - offset).toISOString();
  } catch {
    return null;
  }
}

function buildMessage(kind, ctx) {
  const { trip, hotel, transfer, activity, service, cityName, tz } = ctx;
  const tripLine = `🧳 ${plain(trip?.title || '')}`;

  switch (kind) {
    case 'hotel_cancel_deadline':
      return [
        `⏰ Через 24 часа истекает бесплатная отмена отеля`,
        ``,
        tripLine,
        `🏨 ${plain(hotel.name)}${cityName ? ` — ${plain(cityName)}` : ''}`,
        `📅 Дедлайн: ${fmtLocal(hotel.free_cancellation_until, tz)}`,
      ].join('\n');

    case 'hotel_checkin':
      return [
        `🏨 Завтра заезд в отель (через 24 часа)`,
        ``,
        tripLine,
        `🏨 ${plain(hotel.name)}${cityName ? ` — ${plain(cityName)}` : ''}`,
        `📅 Заезд: ${fmtLocal(hotel.check_in_datetime, tz)}`,
        hotel.address ? `📍 ${plain(hotel.address)}` : '',
        hotel.booking_reference ? `🔖 Бронь: ${plain(hotel.booking_reference)}` : '',
      ].filter(Boolean).join('\n');

    case 'hotel_checkout':
      return [
        `🧳 Через 18 часов выезд из отеля`,
        ``,
        tripLine,
        `🏨 ${plain(hotel.name)}${cityName ? ` — ${plain(cityName)}` : ''}`,
        `📅 Выезд: ${fmtLocal(hotel.check_out_datetime, tz)}`,
      ].filter(Boolean).join('\n');

    case 'transfer_start': {
      const label = transportLabel(transfer.transport_type);
      return [
        `${label} через 4 часа`,
        ``,
        tripLine,
        `🛫 Отправление: ${fmtLocal(transfer.start_datetime, tz)}`,
        transfer.from_address ? `📍 Откуда: ${plain(transfer.from_address)}` : '',
        transfer.to_address ? `📍 Куда: ${plain(transfer.to_address)}` : '',
        transfer.carrier ? `🏷️ ${plain(transfer.carrier)}` : '',
        transfer.booking_reference ? `🔖 Бронь: ${plain(transfer.booking_reference)}` : '',
      ].filter(Boolean).join('\n');
    }

    case 'car_rental_start':
      return [
        `🚗 Через 18 часов — получение арендованного авто`,
        ``,
        tripLine,
        `🏷️ ${plain(service?.name || 'Аренда авто')}`,
      ].join('\n');

    case 'car_rental_end':
      return [
        `🚗 Через 18 часов — возврат арендованного авто`,
        ``,
        tripLine,
        `🏷️ ${plain(service?.name || 'Аренда авто')}`,
      ].join('\n');

    case 'activity_start':
      return [
        `🎟️ Через 4 часа — активность`,
        ``,
        tripLine,
        `📌 ${plain(activity.title)}${cityName ? ` — ${plain(cityName)}` : ''}`,
        `📅 Начало: ${fmtLocal(activity.start_datetime, tz)}`,
        activity.location_address ? `📍 ${plain(activity.location_address)}` : '',
      ].filter(Boolean).join('\n');

    default:
      return '';
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!TELEGRAM_BOT_TOKEN) {
      console.error('TELEGRAM_BOT_TOKEN is not set');
      return Response.json({ error: 'TELEGRAM_BOT_TOKEN missing' }, { status: 500 });
    }

    const svc = base44.asServiceRole;
    const now = Date.now();

    // 1. All active Telegram integrations with a linked chat.
    const integrations = await svc.entities.TripTelegramIntegration.filter({ is_active: true });
    const activeIntegrations = integrations.filter(i => i.telegram_chat_id);
    if (activeIntegrations.length === 0) {
      return Response.json({ ok: true, sent: 0, reason: 'no active integrations' });
    }

    // Group integrations by trip_id for efficient lookup.
    const integrationsByTrip = new Map();
    for (const i of activeIntegrations) {
      const arr = integrationsByTrip.get(i.trip_id) || [];
      arr.push(i);
      integrationsByTrip.set(i.trip_id, arr);
    }
    const tripIds = [...integrationsByTrip.keys()];

    let sent = 0;
    let skipped = 0;
    const errors = [];

    // Process each trip independently.
    for (const tripId of tripIds) {
      const tripIntegrations = integrationsByTrip.get(tripId);
      const trip = await svc.entities.Trip.get(tripId).catch(() => null);
      if (!trip) continue;

      // Trip-wide events
      const [hotels, transfers, activities, services, cityVisits] = await Promise.all([
        svc.entities.HotelStay.filter({ trip_id: tripId }),
        svc.entities.Transfer.filter({ trip_id: tripId }),
        svc.entities.Activity.filter({ trip_id: tripId }),
        svc.entities.TripService.filter({ trip_id: tripId, kind: 'car_rental' }),
        svc.entities.CityVisit.filter({ trip_id: tripId }),
      ]);

      const cityById = new Map(cityVisits.map(c => [c.id, c]));

      // Build a list of candidate events: { kind, event_id, event_time, ctx }
      const candidates = [];

      for (const h of hotels) {
        const city = cityById.get(h.city_visit_id);
        const tz = city?.timezone || 'UTC';
        const cityName = city?.city_name;

        if (h.free_cancellation && h.free_cancellation_until &&
            isInWindow(h.free_cancellation_until, 24, now)) {
          candidates.push({
            kind: 'hotel_cancel_deadline', event_id: h.id,
            ctx: { trip, hotel: h, cityName, tz },
          });
        }
        if (h.check_in_datetime && isInWindow(h.check_in_datetime, 24, now)) {
          candidates.push({
            kind: 'hotel_checkin', event_id: h.id,
            ctx: { trip, hotel: h, cityName, tz },
          });
        }
        if (h.check_out_datetime && isInWindow(h.check_out_datetime, 18, now)) {
          candidates.push({
            kind: 'hotel_checkout', event_id: h.id,
            ctx: { trip, hotel: h, cityName, tz },
          });
        }
      }

      for (const tr of transfers) {
        if (!tr.start_datetime || !isInWindow(tr.start_datetime, 4, now)) continue;
        // tz from origin city when available
        const fromCity = cityById.get(tr.from_city_visit_id);
        const tz = fromCity?.timezone || 'UTC';
        candidates.push({
          kind: 'transfer_start', event_id: tr.id,
          ctx: { trip, transfer: tr, tz },
        });
      }

      for (const a of activities) {
        if (!a.start_datetime || !isInWindow(a.start_datetime, 4, now)) continue;
        const city = cityById.get(a.city_visit_id);
        const tz = city?.timezone || 'UTC';
        const cityName = city?.city_name;
        candidates.push({
          kind: 'activity_start', event_id: a.id,
          ctx: { trip, activity: a, cityName, tz },
        });
      }

      for (const s of services) {
        const d = s.details || {};
        // car_rental stores naive wall-clock + per-side timezone (new model).
        // Legacy records without timezone are skipped — they won't get
        // reminders until edited & resaved. This matches the agreed plan:
        // "old records stay as-is, new ones use the new TZ-aware logic".
        const pickupLocal = d.pickup_at_local;
        const dropoffLocal = d.dropoff_at_local;
        const pickupTz = d.pickup_timezone;
        const dropoffTz = d.dropoff_timezone || d.pickup_timezone;

        const pickupUtc = naiveLocalToUtcIso(pickupLocal, pickupTz);
        const dropoffUtc = naiveLocalToUtcIso(dropoffLocal, dropoffTz);

        if (pickupUtc && isInWindow(pickupUtc, 18, now)) {
          candidates.push({
            kind: 'car_rental_start', event_id: s.id,
            ctx: { trip, service: s, tz: pickupTz },
          });
        }
        if (dropoffUtc && isInWindow(dropoffUtc, 18, now)) {
          candidates.push({
            kind: 'car_rental_end', event_id: s.id,
            ctx: { trip, service: s, tz: dropoffTz },
          });
        }
      }

      if (candidates.length === 0) continue;

      // For each candidate, fan out to all active Telegram users of this trip,
      // skipping those that already received the same reminder.
      for (const cand of candidates) {
        for (const integ of tripIntegrations) {
          // Dedup check
          const existingLog = await svc.entities.TelegramReminderLog.filter({
            user_id: integ.user_id,
            event_kind: cand.kind,
            event_id: cand.event_id,
          });
          if (existingLog.length > 0) {
            skipped++;
            continue;
          }

          const text = buildMessage(cand.kind, cand.ctx);
          if (!text) continue;

          const ok = await sendTelegramMessage(TELEGRAM_BOT_TOKEN, integ.telegram_chat_id, text);
          if (ok) {
            await svc.entities.TelegramReminderLog.create({
              trip_id: tripId,
              user_id: integ.user_id,
              event_kind: cand.kind,
              event_id: cand.event_id,
              sent_at: new Date().toISOString(),
            });
            sent++;
          } else {
            errors.push({ tripId, user_id: integ.user_id, kind: cand.kind, event_id: cand.event_id });
          }
        }
      }
    }

    return Response.json({ ok: true, sent, skipped, errors });
  } catch (error) {
    console.error('sendTripReminders error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});