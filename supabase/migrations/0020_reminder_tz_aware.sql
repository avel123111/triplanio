-- 0020_reminder_tz_aware.sql
--
-- Timezone-correct pending reminders.
--
-- Trip datetimes are stored as "wall-clock-as-UTC": the digits the user typed
-- are written with a trailing Z and NO offset math (see src/lib/time.js). The
-- real timezone of an event lives separately on city_visits.timezone (hotels,
-- activities, transfers) or in trip_services.details (car rental).
--
-- get_pending_reminders compared those stored values directly against now(),
-- which is a true UTC instant -> reminders fired late/early by exactly the
-- event city's UTC offset (e.g. a Madrid 21:00 event's 24h reminder fired at
-- 23:00 local instead of 21:00).
--
-- Fix: reconstruct each event's REAL instant from its wall-clock digits + the
-- event city's IANA timezone before the now()+lead window comparison. When the
-- timezone is unknown (null / '' / 'UTC') the stored value is used unchanged --
-- legacy behaviour, and also correct for genuine UTC cities.
--
-- Scope: ONLY get_pending_reminders (the minute-window collector). The daily
-- get_trips_*_tomorrow functions (date-granularity) are intentionally left as-is.

create or replace function public.reminder_true_instant(ts timestamptz, tz text)
returns timestamptz
language sql
stable
as $$
  select case
    when ts is null then null
    when tz is null or tz = '' or tz = 'UTC' then ts
    else (ts at time zone 'UTC') at time zone tz
  end;
$$;

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
    select 'hotel_checkin'::text as type, au.user_id, au.locale, au.trip_id, au.chat_id, to_jsonb(h) as context
    from hotel_stays h
    join active_users au on au.trip_id = h.trip_id
    left join city_visits cv on cv.id = h.city_visit_id
    where public.reminder_true_instant(h.check_in_datetime, cv.timezone)
          between now() + interval '24 hours' and now() + interval '24 hours' + (window_minutes || ' minutes')::interval
      and not exists (select 1 from telegram_reminder_logs l where l.user_id = au.user_id and l.event_kind = 'hotel_checkin' and l.event_id = h.id)
  ),
  hotel_checkout as (
    select 'hotel_checkout'::text, au.user_id, au.locale, au.trip_id, au.chat_id, to_jsonb(h)
    from hotel_stays h
    join active_users au on au.trip_id = h.trip_id
    left join city_visits cv on cv.id = h.city_visit_id
    where public.reminder_true_instant(h.check_out_datetime, cv.timezone)
          between now() + interval '18 hours' and now() + interval '18 hours' + (window_minutes || ' minutes')::interval
      and not exists (select 1 from telegram_reminder_logs l where l.user_id = au.user_id and l.event_kind = 'hotel_checkout' and l.event_id = h.id)
  ),
  hotel_cancel as (
    select 'hotel_cancel_deadline'::text, au.user_id, au.locale, au.trip_id, au.chat_id, to_jsonb(h)
    from hotel_stays h
    join active_users au on au.trip_id = h.trip_id
    left join city_visits cv on cv.id = h.city_visit_id
    where h.free_cancellation = true
      and public.reminder_true_instant(h.free_cancellation_until, cv.timezone)
          between now() + interval '24 hours' and now() + interval '24 hours' + (window_minutes || ' minutes')::interval
      and not exists (select 1 from telegram_reminder_logs l where l.user_id = au.user_id and l.event_kind = 'hotel_cancel_deadline' and l.event_id = h.id)
  ),
  transfer_start as (
    select 'transfer_start'::text, au.user_id, au.locale, au.trip_id, au.chat_id, to_jsonb(t)
    from transfers t
    join active_users au on au.trip_id = t.trip_id
    left join city_visits fcv on fcv.id = t.from_city_visit_id
    where public.reminder_true_instant(t.start_datetime, fcv.timezone)
          between now() + interval '4 hours' and now() + interval '4 hours' + (window_minutes || ' minutes')::interval
      and not exists (select 1 from telegram_reminder_logs l where l.user_id = au.user_id and l.event_kind = 'transfer_start' and l.event_id = t.id)
  ),
  activity_start as (
    select 'activity_start'::text, au.user_id, au.locale, au.trip_id, au.chat_id, to_jsonb(a)
    from activities a
    join active_users au on au.trip_id = a.trip_id
    left join city_visits cv on cv.id = a.city_visit_id
    where public.reminder_true_instant(a.start_datetime, cv.timezone)
          between now() + interval '4 hours' and now() + interval '4 hours' + (window_minutes || ' minutes')::interval
      and not exists (select 1 from telegram_reminder_logs l where l.user_id = au.user_id and l.event_kind = 'activity_start' and l.event_id = a.id)
  ),
  car_pickup as (
    select 'car_rental_pickup'::text, au.user_id, au.locale, au.trip_id, au.chat_id, to_jsonb(s)
    from trip_services s
    join active_users au on au.trip_id = s.trip_id
    where s.kind = 'car_rental'
      and public.reminder_true_instant(s.pickup_datetime, s.details->>'pickup_timezone')
          between now() + interval '18 hours' and now() + interval '18 hours' + (window_minutes || ' minutes')::interval
      and not exists (select 1 from telegram_reminder_logs l where l.user_id = au.user_id and l.event_kind = 'car_rental_pickup' and l.event_id = s.id)
  ),
  car_dropoff as (
    select 'car_rental_dropoff'::text, au.user_id, au.locale, au.trip_id, au.chat_id, to_jsonb(s)
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
