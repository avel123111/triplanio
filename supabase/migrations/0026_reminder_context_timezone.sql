-- 0026_reminder_context_timezone.sql
--
-- Expose the event's IANA timezone to the TG Reminders n8n flow.
--
-- Background: trip datetimes are stored as "wall-clock-as-UTC" (the digits the
-- user typed, written with a trailing Z and NO offset math -- see src/lib/time.js).
-- 0020_reminder_tz_aware.sql already made the *trigger window* timezone-correct
-- via reminder_true_instant(ts, tz), reconstructing each event's real instant
-- from those wall-clock digits + the event city's timezone.
--
-- Gap fixed here: get_pending_reminders returned context = to_jsonb(entity),
-- which carries the wall-clock datetimes but NOT the timezone. The n8n AI agent
-- only saw `now` (a real UTC instant) and datetimes ending in "Z", so it read
-- every event as UTC and mis-computed "today / tomorrow / in N hours" by exactly
-- the event city's offset.
--
-- Fix: inject `event_timezone` (the same tz already feeding reminder_true_instant
-- per row) into the context jsonb, normalized to a non-empty value -- null / ''
-- collapse to 'UTC' (legacy + genuine-UTC behaviour). The agent's datetime
-- fields stay untouched: they remain the event's LOCAL wall-clock; event_timezone
-- tells the agent which zone that wall-clock belongs to.
--
-- reminder_true_instant is unchanged. The daily get_trips_*_tomorrow functions
-- (date-granularity) are intentionally left as-is.

create or replace function public.get_pending_reminders(window_minutes integer default 15)
returns table(type text, user_id text, user_locale text, trip_id uuid, chat_id text, context jsonb)
language sql stable as $function$
  with active_users as (
    select tti.user_id, tti.trip_id, tti.telegram_chat_id as chat_id,
           coalesce(u.language, 'en') as locale
    from trip_telegram_integrations tti
    join users u on u.id = tti.user_id
    where tti.is_active = true and tti.telegram_chat_id is not null
  ),
  hotel_checkin as (
    select 'hotel_checkin'::text as type, au.user_id, au.locale, au.trip_id, au.chat_id,
           to_jsonb(h) || jsonb_build_object('event_timezone', coalesce(nullif(cv.timezone, ''), 'UTC')) as context
    from hotel_stays h
    join active_users au on au.trip_id = h.trip_id
    left join city_visits cv on cv.id = h.city_visit_id
    where public.reminder_true_instant(h.check_in_datetime, cv.timezone)
          between now() + interval '24 hours' and now() + interval '24 hours' + (window_minutes || ' minutes')::interval
      and not exists (select 1 from telegram_reminder_logs l where l.user_id = au.user_id and l.event_kind = 'hotel_checkin' and l.event_id = h.id)
  ),
  hotel_checkout as (
    select 'hotel_checkout'::text, au.user_id, au.locale, au.trip_id, au.chat_id,
           to_jsonb(h) || jsonb_build_object('event_timezone', coalesce(nullif(cv.timezone, ''), 'UTC'))
    from hotel_stays h
    join active_users au on au.trip_id = h.trip_id
    left join city_visits cv on cv.id = h.city_visit_id
    where public.reminder_true_instant(h.check_out_datetime, cv.timezone)
          between now() + interval '18 hours' and now() + interval '18 hours' + (window_minutes || ' minutes')::interval
      and not exists (select 1 from telegram_reminder_logs l where l.user_id = au.user_id and l.event_kind = 'hotel_checkout' and l.event_id = h.id)
  ),
  hotel_cancel as (
    select 'hotel_cancel_deadline'::text, au.user_id, au.locale, au.trip_id, au.chat_id,
           to_jsonb(h) || jsonb_build_object('event_timezone', coalesce(nullif(cv.timezone, ''), 'UTC'))
    from hotel_stays h
    join active_users au on au.trip_id = h.trip_id
    left join city_visits cv on cv.id = h.city_visit_id
    where h.free_cancellation = true
      and public.reminder_true_instant(h.free_cancellation_until, cv.timezone)
          between now() + interval '24 hours' and now() + interval '24 hours' + (window_minutes || ' minutes')::interval
      and not exists (select 1 from telegram_reminder_logs l where l.user_id = au.user_id and l.event_kind = 'hotel_cancel_deadline' and l.event_id = h.id)
  ),
  transfer_start as (
    select 'transfer_start'::text, au.user_id, au.locale, au.trip_id, au.chat_id,
           to_jsonb(t) || jsonb_build_object('event_timezone', coalesce(nullif(fcv.timezone, ''), 'UTC'))
    from transfers t
    join active_users au on au.trip_id = t.trip_id
    left join city_visits fcv on fcv.id = t.from_city_visit_id
    where public.reminder_true_instant(t.start_datetime, fcv.timezone)
          between now() + interval '4 hours' and now() + interval '4 hours' + (window_minutes || ' minutes')::interval
      and not exists (select 1 from telegram_reminder_logs l where l.user_id = au.user_id and l.event_kind = 'transfer_start' and l.event_id = t.id)
  ),
  activity_start as (
    select 'activity_start'::text, au.user_id, au.locale, au.trip_id, au.chat_id,
           to_jsonb(a) || jsonb_build_object('event_timezone', coalesce(nullif(cv.timezone, ''), 'UTC'))
    from activities a
    join active_users au on au.trip_id = a.trip_id
    left join city_visits cv on cv.id = a.city_visit_id
    where public.reminder_true_instant(a.start_datetime, cv.timezone)
          between now() + interval '4 hours' and now() + interval '4 hours' + (window_minutes || ' minutes')::interval
      and not exists (select 1 from telegram_reminder_logs l where l.user_id = au.user_id and l.event_kind = 'activity_start' and l.event_id = a.id)
  ),
  car_pickup as (
    select 'car_rental_pickup'::text, au.user_id, au.locale, au.trip_id, au.chat_id,
           to_jsonb(s) || jsonb_build_object('event_timezone', coalesce(nullif(s.details->>'pickup_timezone', ''), 'UTC'))
    from trip_services s
    join active_users au on au.trip_id = s.trip_id
    where s.kind = 'car_rental'
      and public.reminder_true_instant(s.pickup_datetime, s.details->>'pickup_timezone')
          between now() + interval '18 hours' and now() + interval '18 hours' + (window_minutes || ' minutes')::interval
      and not exists (select 1 from telegram_reminder_logs l where l.user_id = au.user_id and l.event_kind = 'car_rental_pickup' and l.event_id = s.id)
  ),
  car_dropoff as (
    select 'car_rental_dropoff'::text, au.user_id, au.locale, au.trip_id, au.chat_id,
           to_jsonb(s) || jsonb_build_object('event_timezone', coalesce(nullif(coalesce(s.details->>'dropoff_timezone', s.details->>'pickup_timezone'), ''), 'UTC'))
    from trip_services s
    join active_users au on au.trip_id = s.trip_id
    where s.kind = 'car_rental'
      and public.reminder_true_instant(s.dropoff_datetime, coalesce(s.details->>'dropoff_timezone', s.details->>'pickup_timezone'))
          between now() + interval '18 hours' and now() + interval '18 hours' + (window_minutes || ' minutes')::interval
      and not exists (select 1 from telegram_reminder_logs l where l.user_id = au.user_id and l.event_kind = 'car_rental_dropoff' and l.event_id = s.id)
  ),
  all_reminders as (
    select * from hotel_checkin
    union all select * from hotel_checkout
    union all select * from hotel_cancel
    union all select * from transfer_start
    union all select * from activity_start
    union all select * from car_pickup
    union all select * from car_dropoff
  )
  select type, user_id::text, locale as user_locale, trip_id, chat_id, context from all_reminders;
$function$;
