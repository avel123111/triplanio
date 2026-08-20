-- Фаза 2 обложек трипа: физический выпил мёртвой колонки trips.cover_gradient.
--
-- Градиенты обложек убраны из UI в Фазе 1 (PR #916): фронт больше не читает/пишет
-- cover_gradient, дверь trip-settings сняла её из whitelist (SETTINGS_COL_FIELDS),
-- `src/lib/trip-gradients.js` удалён. Колонка осталась в схеме мёртвой. Здесь:
-- переопределяем 4 ЖИВЫЕ функции (каждая с ОДНИМ edge-вызывателем под service_role)
-- ДОСЛОВНО минус cover_gradient, снимаем колонку из edge telegramGetMyIntegrations
-- (отдельный TS-файл этого PR), затем дропаем колонку. Колоночный
-- GRANT UPDATE(cover_gradient) снимается САМ вместе с DROP COLUMN.
--
-- Порядок: сперва переопределить функции (перестают ссылаться на колонку), потом
-- DROP COLUMN — иначе copy_trip (v_src public.trips%rowtype) держал бы ссылку на
-- несуществующую колонку.
--
-- ddl-guard: allow-destructive — Фаза 2 TRIP covers, cover_gradient мёртв с PR #916 (фронт не читает/пишет, дверь trip-settings сняла из whitelist)

-- ── get_my_trip_cards (edge getTrips) — минус cover_gradient ───────────────────
-- Дословно TRIP-431 (без email), убран cover_gradient из union-select и карточного
-- json. Сигнатура (uuid → jsonb) не меняется; DROP+CREATE + те же least-privilege
-- гранты (revoke public/anon/authenticated, grant service_role).
drop function if exists public.get_my_trip_cards(uuid);

create function public.get_my_trip_cards(p_actor uuid)
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
           t.created_by, t.is_pro_trip, t.created_at
    from public.trips t where t.created_by = v_uid
    union
    select t.id, t.title, t.description, t.cover_image_url,
           t.created_by, t.is_pro_trip, t.created_at
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

-- ── get_user_travel_stats (edge getTravelStats) — минус cover_gradient ─────────
-- Дословно TRIP-403, убран cover_gradient из union-select и trips-мапы. Сигнатура
-- (uuid) не меняется → CREATE OR REPLACE сохраняет гранты (EXECUTE у public/anon/
-- authenticated уже снят в TRIP-402).
create or replace function public.get_user_travel_stats(p_actor uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := p_actor;
  v_points jsonb; v_trips jsonb; v_transfers jsonb; v_trip_visits jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  with my_trips as (
    select t.id, t.title, t.cover_image_url, t.created_by, t.is_pro_trip
    from public.trips t where t.created_by = v_uid
    union
    select t.id, t.title, t.cover_image_url, t.created_by, t.is_pro_trip
    from public.trips t
    join public.trip_members m on m.trip_id = t.id
    where m.user_id = v_uid and m.status = 'active'
  ),
  all_visits as (
    select cv.id, cv.trip_id, cv.kind, cv.geonameid, cv.name_i18n, cv.city_name_en,
           cv.country_code, cv.latitude, cv.longitude, cv.start_date, cv.end_date
    from public.city_visits cv join my_trips mt on mt.id = cv.trip_id
  ),
  trip_points as (
    select jsonb_agg(jsonb_build_object('id',id,'kind','trip','trip_id',trip_id,
      'geonameid',geonameid,'name_i18n',name_i18n,
      'city_name',coalesce(name_i18n->>'en', city_name_en),'country_code',country_code,
      'lat',latitude,'lng',longitude,
      'start_date',start_date,'end_date',end_date)) as arr
    from all_visits where kind='transit'
  ),
  custom_points as (
    select jsonb_agg(jsonb_build_object('id',ucv.id,'kind','custom','trip_id',null,
      'geonameid',ucv.geonameid,'name_i18n',ucv.name_i18n,
      'city_name',ucv.name_i18n->>'en','country_code',ucv.country_code,'lat',ucv.lat,'lng',ucv.lng,
      'start_date',ucv.start_date,'end_date',ucv.end_date)) as arr
    from public.user_custom_visits ucv where ucv.user_id = v_uid
  ),
  transfer_rows as (
    select jsonb_agg(jsonb_build_object(
      'transport_type', tr.transport_type,
      'start_date', coalesce((tr.start_datetime at time zone 'utc')::date, fv.end_date, tv.start_date)
    ) order by coalesce((tr.start_datetime at time zone 'utc')::date, fv.end_date, tv.start_date), tr.id) as arr
    from public.transfers tr
    left join all_visits fv on fv.id = tr.from_city_visit_id
    left join all_visits tv on tv.id = tr.to_city_visit_id
    where tr.trip_id in (select id from my_trips)
  ),
  trip_visits as (
    select jsonb_object_agg(trip_id::text, rows) as obj from (
      select trip_id, jsonb_agg(jsonb_build_object('kind',kind,
        'geonameid',geonameid,'name_i18n',name_i18n,
        'city_name',coalesce(name_i18n->>'en', city_name_en),
        'country_code',country_code,'start_date',start_date,'end_date',end_date)) as rows
      from all_visits group by trip_id
    ) g
  )
  select
    coalesce((select arr from trip_points),'[]'::jsonb) || coalesce((select arr from custom_points),'[]'::jsonb),
    coalesce((select jsonb_object_agg(mt.id::text, jsonb_build_object('title',mt.title,
      'cover_image_url',mt.cover_image_url))
      from my_trips mt),'{}'::jsonb),
    coalesce((select arr from transfer_rows),'[]'::jsonb),
    coalesce((select obj from trip_visits),'{}'::jsonb)
  into v_points, v_trips, v_transfers, v_trip_visits;
  return jsonb_build_object('points',v_points,'trips',v_trips,
    'transfers',v_transfers,'transfers_total',jsonb_array_length(v_transfers),
    'trip_visits',v_trip_visits);
end $function$;

-- ── update_trip_settings (edge trip-settings) — минус присваивание cover_gradient
-- Дословно TRIP-416, убрана строка `cover_gradient = case … end` из UPDATE (дверь
-- уже не шлёт этот ключ в p_fields). Тело/гейт/сигнатура не меняются.
create or replace function public.update_trip_settings(
  p_trip uuid,
  p_actor uuid,
  p_fields jsonb,
  p_details_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_details jsonb;
  v_prev    jsonb;
  v_addons  jsonb;
  k         text;
begin
  select details into v_details from public.trips where id = p_trip;
  if not found then
    return jsonb_build_object('outcome', 'ok');
  end if;
  v_details := coalesce(v_details, '{}'::jsonb);

  if p_details_patch ? 'main_currency' then
    v_details := jsonb_set(v_details, '{main_currency}', p_details_patch -> 'main_currency');
  end if;
  if p_details_patch ? 'display' then
    v_details := jsonb_set(
      v_details, '{display}',
      coalesce(v_details -> 'display', '{}'::jsonb) || (p_details_patch -> 'display')
    );
  end if;
  if p_details_patch ? 'addons' then
    v_prev   := coalesce(v_details -> 'addons', '{}'::jsonb);
    v_addons := p_details_patch -> 'addons';
    if not public.is_trip_pro(p_trip) then
      for k in select jsonb_object_keys(v_addons) loop
        if (v_addons -> k) = to_jsonb(true)
           and public.is_pro_addon(k)
           and coalesce(v_prev -> k, to_jsonb(false)) is distinct from to_jsonb(true) then
          return jsonb_build_object('outcome', 'pro_required');
        end if;
      end loop;
    end if;
    v_details := jsonb_set(v_details, '{addons}', v_prev || v_addons);
  end if;

  update public.trips set
    title           = case when p_fields ? 'title'           then p_fields ->> 'title'           else title end,
    description     = case when p_fields ? 'description'     then p_fields ->> 'description'     else description end,
    cover_image_url = case when p_fields ? 'cover_image_url' then p_fields ->> 'cover_image_url' else cover_image_url end,
    notes           = case when p_fields ? 'notes'           then p_fields ->> 'notes'           else notes end,
    details         = v_details
  where id = p_trip;

  return jsonb_build_object('outcome', 'ok');
end;
$$;

revoke execute on function public.update_trip_settings(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant  execute on function public.update_trip_settings(uuid, uuid, jsonb, jsonb) to service_role;

-- ── copy_trip (edge trip-share) — минус cover_gradient из INSERT ───────────────
-- Дословно TRIP-416, убран cover_gradient из списка колонок и значений INSERT
-- (копия рождается без обложки: cover_image_url=null, обложки нет → фоллбек-
-- картинка). Тело/гранты/сигнатура не меняются.
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
     to_latitude, to_longitude, flight_number, day_change, price, currency, notes, details, documents, created_by)
  select
    v_new_id,
    case when t.from_city_visit_id is not null then (v_cv_map ->> t.from_city_visit_id::text)::uuid end,
    case when t.to_city_visit_id   is not null then (v_cv_map ->> t.to_city_visit_id::text)::uuid end,
    t.transport_type, t.start_datetime, t.end_datetime,
    t.carrier, t.booking_reference, t.booking_url, t.from_address, t.to_address, t.from_latitude, t.from_longitude,
    t.to_latitude, t.to_longitude, t.flight_number, t.day_change, t.price, t.currency, t.notes, t.details, '[]'::jsonb, p_actor
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

-- ── DROP COLUMN (снимает и колоночный GRANT UPDATE) ───────────────────────────
alter table public.trips drop column cover_gradient;
