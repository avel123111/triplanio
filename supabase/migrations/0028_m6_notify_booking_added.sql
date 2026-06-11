-- 0027_m6_notify_booking_added
--
-- M6: in-app notification when a booking is added to a SHARED trip.
-- Recipients = active trip members other than the author. Solo trips produce
-- no recipients, so trip creation / AI planning / clone don't spam.
--
-- Implementation: statement-level AFTER INSERT triggers with a transition table,
-- so a bulk insert (AI parse, multi-row) collapses into ONE notification per
-- recipient (count in i18n_params). SECURITY DEFINER to insert notifications for
-- other users (bypasses RLS); the whole body is wrapped in EXCEPTION so a
-- notification failure can never roll back the booking insert.
--
-- Covers hotel_stays, transfers, trip_services (the "booking" tables).
-- Activities are itinerary items, intentionally excluded.

-- 1) Type allow-list: add 'trip_booking_added'.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array[
    'trip_invite'::text,
    'trip_update'::text,
    'trip_member_joined'::text,
    'system'::text,
    'pro_activated'::text,
    'trip_invite_declined'::text,
    'trip_member_left'::text,
    'trip_member_removed'::text,
    'trip_role_changed'::text,
    'trip_booking_added'::text
  ]));

-- 2) Trigger function. `kind` is passed as a trigger argument (hotel/transfer/service).
create or replace function public.notify_booking_added()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text := tg_argv[0];
  agg record;
  rec record;
  actor_name text;
  trip_title text;
begin
  for agg in
    select trip_id, count(*)::int as n, (array_agg(created_by))[1] as actor_id
    from newrows
    group by trip_id
  loop
    select coalesce(u.full_name, '') into actor_name from users u where u.id = agg.actor_id;
    select title into trip_title from trips where id = agg.trip_id;

    -- Recipients = active members + the trip owner (trips.created_by — there is
    -- NO 'owner' row in trip_members), minus the actor.
    for rec in
      select x.uid as user_id, coalesce(u.language, 'en') as lang
      from (
        select tm.user_id as uid
        from trip_members tm
        where tm.trip_id = agg.trip_id and tm.status = 'active' and tm.user_id is not null
        union
        select t.created_by as uid
        from trips t
        where t.id = agg.trip_id
      ) x
      join users u on u.id = x.uid
      where x.uid <> agg.actor_id
    loop
      insert into notifications
        (user_id, type, i18n_title_key, i18n_message_key, i18n_params, title, message, trip_id, read, created_by)
      values (
        rec.user_id,
        'trip_booking_added',
        'notif.tpl_booking_added_title',
        case when agg.n > 1 then 'notif.tpl_booking_added_batch_msg' else 'notif.tpl_booking_added_msg' end,
        jsonb_build_object('name', actor_name, 'count', agg.n, 'kind', v_kind, 'trip', trip_title),
        case rec.lang
          when 'ru' then actor_name || ' добавил бронь'
          when 'es' then actor_name || ' añadió una reserva'
          else actor_name || ' added a booking'
        end,
        case when agg.n > 1 then
          case rec.lang
            when 'ru' then agg.n || ' брони в «' || trip_title || '»'
            when 'es' then agg.n || ' reservas en «' || trip_title || '»'
            else agg.n || ' bookings in "' || trip_title || '"'
          end
        else
          case rec.lang
            when 'ru' then (case v_kind when 'hotel' then 'Отель' when 'transfer' then 'Переезд' when 'service' then 'Услуга' else 'Бронь' end) || ' в «' || trip_title || '»'
            when 'es' then (case v_kind when 'hotel' then 'Hotel' when 'transfer' then 'Transporte' when 'service' then 'Servicio' else 'Reserva' end) || ' en «' || trip_title || '»'
            else (case v_kind when 'hotel' then 'Hotel' when 'transfer' then 'Transfer' when 'service' then 'Service' else 'Booking' end) || ' in "' || trip_title || '"'
          end
        end,
        agg.trip_id, false, agg.actor_id
      );
    end loop;
  end loop;
  return null;
exception when others then
  raise warning 'notify_booking_added failed: %', sqlerrm;
  return null;
end $$;

-- 3) Statement-level triggers on the booking tables.
drop trigger if exists trg_notify_booking_added on public.hotel_stays;
create trigger trg_notify_booking_added
  after insert on public.hotel_stays
  referencing new table as newrows
  for each statement execute function public.notify_booking_added('hotel');

drop trigger if exists trg_notify_booking_added on public.transfers;
create trigger trg_notify_booking_added
  after insert on public.transfers
  referencing new table as newrows
  for each statement execute function public.notify_booking_added('transfer');

drop trigger if exists trg_notify_booking_added on public.trip_services;
create trigger trg_notify_booking_added
  after insert on public.trip_services
  referencing new table as newrows
  for each statement execute function public.notify_booking_added('service');
