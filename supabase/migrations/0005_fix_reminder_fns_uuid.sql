-- After the email->user_id migration, trip_telegram_integrations.user_id became
-- uuid. The reminder SQL functions still joined `users u ON u.id::text = tti.user_id`
-- (text = uuid → "operator does not exist: text = uuid") and returned user_id as
-- uuid while declaring `user_id text`. Fix: join uuid=uuid, cast user_id to text
-- only at the output (n8n contract keeps user_id as a string).

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
    from hotel_stays h join active_users au on au.trip_id = h.trip_id
    where h.check_in_datetime between now() + interval '24 hours' and now() + interval '24 hours' + (window_minutes || ' minutes')::interval
      and not exists (select 1 from telegram_reminder_logs l where l.user_id = au.user_id and l.event_kind = 'hotel_checkin' and l.event_id = h.id)
  ),
  hotel_checkout as (
    select 'hotel_checkout'::text, au.user_id, au.locale, au.trip_id, au.chat_id, to_jsonb(h)
    from hotel_stays h join active_users au on au.trip_id = h.trip_id
    where h.check_out_datetime between now() + interval '18 hours' and now() + interval '18 hours' + (window_minutes || ' minutes')::interval
      and not exists (select 1 from telegram_reminder_logs l where l.user_id = au.user_id and l.event_kind = 'hotel_checkout' and l.event_id = h.id)
  ),
  hotel_cancel as (
    select 'hotel_cancel_deadline'::text, au.user_id, au.locale, au.trip_id, au.chat_id, to_jsonb(h)
    from hotel_stays h join active_users au on au.trip_id = h.trip_id
    where h.free_cancellation = true
      and h.free_cancellation_until between now() + interval '24 hours' and now() + interval '24 hours' + (window_minutes || ' minutes')::interval
      and not exists (select 1 from telegram_reminder_logs l where l.user_id = au.user_id and l.event_kind = 'hotel_cancel_deadline' and l.event_id = h.id)
  ),
  transfer_start as (
    select 'transfer_start'::text, au.user_id, au.locale, au.trip_id, au.chat_id, to_jsonb(t)
    from transfers t join active_users au on au.trip_id = t.trip_id
    where t.start_datetime between now() + interval '4 hours' and now() + interval '4 hours' + (window_minutes || ' minutes')::interval
      and not exists (select 1 from telegram_reminder_logs l where l.user_id = au.user_id and l.event_kind = 'transfer_start' and l.event_id = t.id)
  ),
  activity_start as (
    select 'activity_start'::text, au.user_id, au.locale, au.trip_id, au.chat_id, to_jsonb(a)
    from activities a join active_users au on au.trip_id = a.trip_id
    where a.start_datetime between now() + interval '4 hours' and now() + interval '4 hours' + (window_minutes || ' minutes')::interval
      and not exists (select 1 from telegram_reminder_logs l where l.user_id = au.user_id and l.event_kind = 'activity_start' and l.event_id = a.id)
  ),
  car_pickup as (
    select 'car_rental_pickup'::text, au.user_id, au.locale, au.trip_id, au.chat_id, to_jsonb(s)
    from trip_services s join active_users au on au.trip_id = s.trip_id
    where s.kind = 'car_rental'
      and s.pickup_datetime between now() + interval '18 hours' and now() + interval '18 hours' + (window_minutes || ' minutes')::interval
      and not exists (select 1 from telegram_reminder_logs l where l.user_id = au.user_id and l.event_kind = 'car_rental_pickup' and l.event_id = s.id)
  ),
  car_dropoff as (
    select 'car_rental_dropoff'::text, au.user_id, au.locale, au.trip_id, au.chat_id, to_jsonb(s)
    from trip_services s join active_users au on au.trip_id = s.trip_id
    where s.kind = 'car_rental'
      and s.dropoff_datetime between now() + interval '18 hours' and now() + interval '18 hours' + (window_minutes || ' minutes')::interval
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

create or replace function public.get_trips_hotel_checkin_tomorrow()
returns table(trip_id uuid, user_id text, chat_id text, user_locale text, event_id uuid, context jsonb)
language sql stable as $function$
  select au.trip_id, au.user_id::text, au.chat_id, au.locale, h.id, to_jsonb(h)
  from hotel_stays h
  join (select tti.user_id, tti.trip_id, tti.telegram_chat_id as chat_id, coalesce(u.language,'en') as locale
        from trip_telegram_integrations tti join users u on u.id = tti.user_id
        where tti.is_active = true and tti.telegram_chat_id is not null) au on au.trip_id = h.trip_id
  where h.check_in_datetime::date = current_date + 1;
$function$;

create or replace function public.get_trips_hotel_checkout_tomorrow()
returns table(trip_id uuid, user_id text, chat_id text, user_locale text, event_id uuid, context jsonb)
language sql stable as $function$
  select au.trip_id, au.user_id::text, au.chat_id, au.locale, h.id, to_jsonb(h)
  from hotel_stays h
  join (select tti.user_id, tti.trip_id, tti.telegram_chat_id as chat_id, coalesce(u.language,'en') as locale
        from trip_telegram_integrations tti join users u on u.id = tti.user_id
        where tti.is_active = true and tti.telegram_chat_id is not null) au on au.trip_id = h.trip_id
  where h.check_out_datetime::date = current_date + 1;
$function$;

create or replace function public.get_trips_hotel_cancel_deadline_tomorrow()
returns table(trip_id uuid, user_id text, chat_id text, user_locale text, event_id uuid, context jsonb)
language sql stable as $function$
  select au.trip_id, au.user_id::text, au.chat_id, au.locale, h.id, to_jsonb(h)
  from hotel_stays h
  join (select tti.user_id, tti.trip_id, tti.telegram_chat_id as chat_id, coalesce(u.language,'en') as locale
        from trip_telegram_integrations tti join users u on u.id = tti.user_id
        where tti.is_active = true and tti.telegram_chat_id is not null) au on au.trip_id = h.trip_id
  where h.free_cancellation = true and h.free_cancellation_until::date = current_date + 1;
$function$;

create or replace function public.get_trips_transfer_tomorrow()
returns table(trip_id uuid, user_id text, chat_id text, user_locale text, event_id uuid, context jsonb)
language sql stable as $function$
  select au.trip_id, au.user_id::text, au.chat_id, au.locale, t.id, to_jsonb(t)
  from transfers t
  join (select tti.user_id, tti.trip_id, tti.telegram_chat_id as chat_id, coalesce(u.language,'en') as locale
        from trip_telegram_integrations tti join users u on u.id = tti.user_id
        where tti.is_active = true and tti.telegram_chat_id is not null) au on au.trip_id = t.trip_id
  where t.start_datetime::date = current_date + 1;
$function$;

create or replace function public.get_trips_activity_tomorrow()
returns table(trip_id uuid, user_id text, chat_id text, user_locale text, event_id uuid, context jsonb)
language sql stable as $function$
  select au.trip_id, au.user_id::text, au.chat_id, au.locale, a.id, to_jsonb(a)
  from activities a
  join (select tti.user_id, tti.trip_id, tti.telegram_chat_id as chat_id, coalesce(u.language,'en') as locale
        from trip_telegram_integrations tti join users u on u.id = tti.user_id
        where tti.is_active = true and tti.telegram_chat_id is not null) au on au.trip_id = a.trip_id
  where a.start_datetime::date = current_date + 1;
$function$;

create or replace function public.get_trips_car_pickup_tomorrow()
returns table(trip_id uuid, user_id text, chat_id text, user_locale text, event_id uuid, context jsonb)
language sql stable as $function$
  select au.trip_id, au.user_id::text, au.chat_id, au.locale, s.id, to_jsonb(s)
  from trip_services s
  join (select tti.user_id, tti.trip_id, tti.telegram_chat_id as chat_id, coalesce(u.language,'en') as locale
        from trip_telegram_integrations tti join users u on u.id = tti.user_id
        where tti.is_active = true and tti.telegram_chat_id is not null) au on au.trip_id = s.trip_id
  where s.kind = 'car_rental'
    and coalesce(s.pickup_datetime, (s.details->>'pickup_at_local')::timestamptz)::date = current_date + 1;
$function$;

create or replace function public.get_trips_car_dropoff_tomorrow()
returns table(trip_id uuid, user_id text, chat_id text, user_locale text, event_id uuid, context jsonb)
language sql stable as $function$
  select au.trip_id, au.user_id::text, au.chat_id, au.locale, s.id, to_jsonb(s)
  from trip_services s
  join (select tti.user_id, tti.trip_id, tti.telegram_chat_id as chat_id, coalesce(u.language,'en') as locale
        from trip_telegram_integrations tti join users u on u.id = tti.user_id
        where tti.is_active = true and tti.telegram_chat_id is not null) au on au.trip_id = s.trip_id
  where s.kind = 'car_rental'
    and coalesce(s.dropoff_datetime, (s.details->>'dropoff_at_local')::timestamptz)::date = current_date + 1;
$function$;
