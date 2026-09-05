-- TRIP-516 — владелец трипа становится обычной строкой `trip_members`.
--
-- Проблема. Создатель трипа не имеет строки в `trip_members` — он существует
-- только как `trips.created_by`. Полного списка людей трипа в БД нет: правило
-- «владелец ∪ активные участники» собирается руками в каждом месте (фронт
-- `withOwnerRow`, edge `bookingAddedRecipientIds`, SQL `is_trip_participant`).
-- Ссылаться на владельца внешним ключом сегодня физически не на что.
--
-- Что делаем. `create_trip_with_route` и `copy_trip` пишут создателю обычную
-- строку (`user_id`=создатель, `role='owner'`, `status='active'`), плюс разовый
-- бэкфилл существующих трипов. После этого «участники трипа» = содержимое одной
-- таблицы.
--
-- Владение НЕ меняется: `trips.created_by` остаётся единственным источником
-- владения; лестница доступа (`is_trip_participant`/`_can_edit_trip`/`tripStep`)
-- и Pro-гейт (`is_trip_pro` = `is_pro_trip OR is_user_pro(created_by)`) строку
-- членства не читают — добавление строки на них не влияет. Владелец и членство —
-- разные оси.
--
-- CHECK `tm_snapshot_only_offline` (user_full_name задан ⇒ user_id null) требует,
-- чтобы у строки с user_id поле user_full_name было NULL — поэтому его не пишем.
-- Роль `owner` уже разрешена констрейнтом `trip_members_role_check`.
-- Партиальный uniq `trip_members_trip_user_uidx (trip_id,user_id) where user_id
-- is not null` делает бэкфилл идемпотентным и исключает дубли по построению.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. create_trip_with_route — тело verbatim из 20260812190317_trip406_route_p_actor,
--    добавлена ТОЛЬКО вставка строки владельца сразу после INSERT trips.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.create_trip_with_route(p_title text, p_start_date date, p_cities jsonb, p_actor uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_trip   uuid;
  v_city   jsonb;
  v_kind   text;
  v_nights int;
  v_i      int := 0;
begin
  if p_actor is null then raise exception 'not authenticated'; end if;

  insert into public.trips (title, description, created_by)
  values (p_title, '', p_actor)
  returning id into v_trip;

  -- TRIP-516: владелец — обычная строка членства. Новый трип, конфликт невозможен.
  insert into public.trip_members (trip_id, user_id, role, status, created_by, accepted_at)
  values (v_trip, p_actor, 'owner', 'active', p_actor, now());

  for v_city in select value from jsonb_array_elements(coalesce(p_cities, '[]'::jsonb)) as t(value)
  loop
    v_kind   := coalesce(nullif(v_city->>'kind',''), 'transit');
    v_nights := greatest(0, coalesce(nullif(v_city->>'nights','')::int, 0));
    insert into city_visits (
      trip_id, created_by, external_city_id, geonameid, name_i18n, city_name_en,
      country_code,
      latitude, longitude, timezone, kind, start_date, end_date, position)
    values (
      v_trip, p_actor, nullif(v_city->>'external_city_id',''),
      nullif(v_city->>'geonameid','')::bigint, v_city->'name_i18n', nullif(v_city->>'city_name_en',''),
      v_city->>'country_code',
      nullif(v_city->>'latitude','')::numeric, nullif(v_city->>'longitude','')::numeric,
      nullif(v_city->>'timezone',''), v_kind,
      case when v_kind in ('start','end') then null else current_date end,
      case when v_kind in ('start','end') then null else current_date + v_nights end,
      v_i);
    v_i := v_i + 1;
  end loop;

  perform public.recompute_trip(v_trip, p_start_date);
  return v_trip;
end;
$function$;

-- create-or-replace сохраняет гранты; re-affirm least-privilege (как в прошлых редакциях).
revoke execute on function public.create_trip_with_route(text, date, jsonb, uuid) from public, anon, authenticated;
grant  execute on function public.create_trip_with_route(text, date, jsonb, uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. copy_trip — тело verbatim из 20260820234500_trip_transfer_day_span,
--    добавлена ТОЛЬКО вставка строки владельца сразу после INSERT trips.
--    (Участники исходного трипа НЕ копируются — по-прежнему только владелец.)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.copy_trip(p_source uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_src     public.trips%rowtype;
  v_details jsonb;
  v_addons  jsonb;
  v_lang    text;
  v_prefix  text;
  v_title   text;
  v_new_id  uuid;
  v_cv_map  jsonb := '{}'::jsonb;
  r         record;
  v_new_cv  uuid;
begin
  if not public.can_create_trip(p_actor) then
    return jsonb_build_object('outcome', 'limit');
  end if;

  select * into v_src from public.trips where id = p_source;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  v_details := coalesce(v_src.details, '{}'::jsonb);
  v_addons  := v_details -> 'addons';
  if v_addons is not null and jsonb_typeof(v_addons) = 'object' then
    v_addons := coalesce(
      (select jsonb_object_agg(key, value)
         from jsonb_each(v_addons)
        where not public.is_pro_addon(key)),
      '{}'::jsonb
    );
    v_details := jsonb_set(v_details, '{addons}', v_addons);
  end if;

  select language into v_lang from public.users where id = p_actor;
  v_prefix := case v_lang
                when 'ru' then 'Копия: '
                when 'es' then 'Copia de '
                else 'Copy of '
              end;
  v_title := left(
    v_prefix || regexp_replace(v_src.title, '^(Copy of |Копия: |Copia de )+', ''),
    300
  );

  insert into public.trips
    (title, description, cover_image_url, notes, details, is_pro_trip, created_by)
  values
    (v_title, v_src.description, null,
     v_src.notes, v_details, false, p_actor)
  returning id into v_new_id;

  -- TRIP-516: владелец копии — обычная строка членства. Новый трип, конфликт невозможен.
  insert into public.trip_members (trip_id, user_id, role, status, created_by, accepted_at)
  values (v_new_id, p_actor, 'owner', 'active', p_actor, now());

  for r in select * from public.city_visits where trip_id = p_source loop
    insert into public.city_visits
      (trip_id, external_city_id, geonameid, name_i18n, city_name_en, country_code,
       latitude, longitude, timezone, start_date, end_date, kind, position, notes, details, created_by)
    values
      (v_new_id, r.external_city_id, r.geonameid, r.name_i18n, r.city_name_en, r.country_code,
       r.latitude, r.longitude, r.timezone, r.start_date, r.end_date, r.kind, r.position, r.notes, r.details, p_actor)
    returning id into v_new_cv;
    v_cv_map := v_cv_map || jsonb_build_object(r.id::text, v_new_cv::text);
  end loop;

  insert into public.hotel_stays
    (trip_id, city_visit_id, name, address, check_in_datetime, check_out_datetime,
     booking_reference, payment_status, price, currency, free_cancellation, free_cancellation_until,
     phone, email, booking_url, latitude, longitude, notes, details, documents, created_by)
  select
    v_new_id,
    case when h.city_visit_id is not null then (v_cv_map ->> h.city_visit_id::text)::uuid end,
    h.name, h.address, h.check_in_datetime, h.check_out_datetime,
    h.booking_reference, h.payment_status, h.price, h.currency, h.free_cancellation, h.free_cancellation_until,
    h.phone, h.email, h.booking_url, h.latitude, h.longitude, h.notes, h.details, '[]'::jsonb, p_actor
  from public.hotel_stays h
  where h.trip_id = p_source;

  insert into public.activities
    (trip_id, city_visit_id, title, start_datetime, end_datetime, location_address,
     location_latitude, location_longitude, price, currency, notes, details, documents, created_by)
  select
    v_new_id,
    case when a.city_visit_id is not null then (v_cv_map ->> a.city_visit_id::text)::uuid end,
    a.title, a.start_datetime, a.end_datetime, a.location_address,
    a.location_latitude, a.location_longitude, a.price, a.currency, a.notes, a.details, '[]'::jsonb, p_actor
  from public.activities a
  where a.trip_id = p_source;

  insert into public.transfers
    (trip_id, from_city_visit_id, to_city_visit_id, transport_type, start_datetime, end_datetime,
     carrier, booking_reference, booking_url, from_address, to_address, from_latitude, from_longitude,
     to_latitude, to_longitude, flight_number, day_span, price, currency, notes, details, documents, created_by)
  select
    v_new_id,
    case when t.from_city_visit_id is not null then (v_cv_map ->> t.from_city_visit_id::text)::uuid end,
    case when t.to_city_visit_id   is not null then (v_cv_map ->> t.to_city_visit_id::text)::uuid end,
    t.transport_type, t.start_datetime, t.end_datetime,
    t.carrier, t.booking_reference, t.booking_url, t.from_address, t.to_address, t.from_latitude, t.from_longitude,
    t.to_latitude, t.to_longitude, t.flight_number, t.day_span, t.price, t.currency, t.notes, t.details, '[]'::jsonb, p_actor
  from public.transfers t
  where t.trip_id = p_source;

  insert into public.trip_services
    (trip_id, kind, name, price, currency, pickup_datetime, dropoff_datetime, details, created_by)
  select
    v_new_id, s.kind, s.name, s.price, s.currency, s.pickup_datetime, s.dropoff_datetime,
    coalesce(s.details, '{}'::jsonb) - 'documents', p_actor
  from public.trip_services s
  where s.trip_id = p_source;

  return jsonb_build_object('outcome', 'ok', 'tripId', v_new_id);
end;
$$;

revoke execute on function public.copy_trip(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.copy_trip(uuid, uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. get_my_trip_cards — тело verbatim из 20260823185005_trip_cards_addons,
--    добавлено ТОЛЬКО исключение создателя из ветки участников `parts`.
--
--    Владелец приходит в `participants` из ветки `created_by` (is_owner=true).
--    Его собственная строка членства (TRIP-516) во второй ветке (`union all`,
--    is_owner=false) задвоила бы владельца в списке → `Trips.isShared` считал бы
--    одиночный трип совместным, аватар/бейдж дублировались. Исключаем строку,
--    чей user_id = создатель этого трипа. Это же чинит унаследованный случай
--    «случайная строка создателя» (напр. viewer до появления серверного гарда).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_my_trip_cards(p_actor uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := p_actor;
  v_cards jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  with my_trips as (
    select t.id, t.title, t.description, t.cover_image_url,
           t.created_by, t.is_pro_trip, t.created_at, t.details
    from public.trips t where t.created_by = v_uid
    union
    select t.id, t.title, t.description, t.cover_image_url,
           t.created_by, t.is_pro_trip, t.created_at, t.details
    from public.trips t
    join public.trip_members m on m.trip_id = t.id
    where m.user_id = v_uid and m.status = 'active'
  ),
  my_role as (
    select mt.id as trip_id,
      case when mt.created_by = v_uid then 'owner'
           else (select m.role from public.trip_members m
                 where m.trip_id = mt.id and m.user_id = v_uid and m.status = 'active' limit 1)
      end as role
    from my_trips mt
  ),
  owner_pro as (
    select o.created_by, public.is_user_pro(o.created_by) as pro
    from (select distinct created_by from my_trips) o
  ),
  all_visits as (
    select cv.id, cv.trip_id, cv.kind, cv.geonameid, cv.name_i18n, cv.city_name_en,
           cv.country_code, cv.start_date, cv.end_date
    from public.city_visits cv join my_trips mt on mt.id = cv.trip_id
  ),
  visits_agg as (
    select trip_id, jsonb_agg(jsonb_build_object(
      'kind', kind, 'geonameid', geonameid, 'name_i18n', name_i18n,
      'city_name_en', city_name_en, 'country_code', country_code,
      'start_date', start_date, 'end_date', end_date)
      order by start_date nulls last, id) as arr
    from all_visits group by trip_id
  ),
  parts as (
    select p.trip_id, jsonb_agg(jsonb_build_object(
      'user_id', p.user_id, 'name', p.name,
      'avatar_url', p.avatar_url, 'is_owner', p.is_owner, 'is_deleted', p.is_deleted)
      order by p.is_owner desc, p.name) as arr
    from (
      select mt.id as trip_id, u.id as user_id,
        case when u.deleted_at is not null then ''
             else coalesce(
               nullif(btrim(u.full_name), ''),
               nullif(upper(left(split_part(u.email, '@', 1), 1)) || substr(split_part(u.email, '@', 1), 2), ''),
               '') end as name,
        coalesce(u.avatar_url, '') as avatar_url, true as is_owner,
        (u.deleted_at is not null) as is_deleted
      from my_trips mt join public.users u on u.id = mt.created_by
      union all
      select m.trip_id, coalesce(u.id, m.user_id) as user_id,
        case when u.deleted_at is not null then ''
             else coalesce(
               nullif(btrim(coalesce(u.full_name, m.user_full_name)), ''),
               nullif(upper(left(split_part(coalesce(u.email, m.invite_email), '@', 1), 1)) || substr(split_part(coalesce(u.email, m.invite_email), '@', 1), 2), ''),
               '') end as name,
        coalesce(u.avatar_url, '') as avatar_url, false as is_owner,
        (u.deleted_at is not null) as is_deleted
      from public.trip_members m
      left join public.users u on u.id = m.user_id
      where m.trip_id in (select id from my_trips) and m.status = 'active'
        -- TRIP-516: строку создателя не пускаем — владелец уже в ветке created_by выше.
        and not exists (select 1 from public.trips t
                        where t.id = m.trip_id and t.created_by = m.user_id)
    ) p
    group by p.trip_id
  ),
  cards as (
    select jsonb_agg(jsonb_build_object(
      'id', mt.id, 'title', mt.title, 'description', mt.description,
      'cover_image_url', mt.cover_image_url,
      'created_by', mt.created_by,
      'is_pro', coalesce(mt.is_pro_trip or op.pro, false),
      'role', mr.role,
      'addons', coalesce(mt.details->'addons', '{}'::jsonb),
      'visits', coalesce(va.arr, '[]'::jsonb),
      'participants', coalesce(pa.arr, '[]'::jsonb))
      order by mt.created_at desc) as arr
    from my_trips mt
    join owner_pro op on op.created_by = mt.created_by
    join my_role mr on mr.trip_id = mt.id
    left join visits_agg va on va.trip_id = mt.id
    left join parts pa on pa.trip_id = mt.id
  )
  select coalesce((select arr from cards), '[]'::jsonb) into v_cards;
  return v_cards;
end $function$;

revoke execute on function public.get_my_trip_cards(uuid) from public, anon, authenticated;
grant  execute on function public.get_my_trip_cards(uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Бэкфилл существующих трипов. `do update` (а не `do nothing`) приводит к
--    канону унаследованные «случайные» строки создателя (напр. viewer): у трипа
--    ровно одна строка владельца с ролью owner/active. Идемпотентно: партиальный
--    uniq по (trip_id,user_id) не даёт дублей; повтор миграции — no-op по данным.
--    created_by у трипа может указывать на soft-deleted аккаунт — строка users
--    жива, FK валиден, строка владельца создаётся штатно.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.trip_members (trip_id, user_id, role, status, created_by, accepted_at)
select t.id, t.created_by, 'owner', 'active', t.created_by, now()
from public.trips t
where t.created_by is not null
on conflict (trip_id, user_id) where user_id is not null
  do update set role = 'owner', status = 'active';
