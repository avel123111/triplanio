-- TRIP-435 — route-RPC возвращают пересчитанную цепочку city_visits (один round-trip).
--
-- Корень: пять route-RPC (add_city/remove_city/reorder_cities/set_city_nights/
-- set_trip_start_date) гоняли recompute_trip и возвращали void/uuid, поэтому клиент
-- был ВЫНУЖДЕН делать второй запрос (полный рефетч трипа), чтобы узнать
-- пересчитанные даты и реальный id. Теперь каждая функция после recompute_trip
-- возвращает АВТОРИТЕТНУЮ цепочку `city_visits` (jsonb-массив в порядке position) —
-- клиент реконсилит её из ответа в shell-кэш одним запросом (эпик TRIP-374/TRIP-378:
-- «реконсиляция из строки, что вернула запись», не рефетчем).
--
-- Изменение возвращаемого типа void/uuid → jsonb требует DROP+CREATE (Postgres не
-- меняет return type через CREATE OR REPLACE). Сигнатуры аргументов, тела, роль-
-- гейт (в шве), integrity-scope и гранты — БЕЗ изменений: правится только «хвост»
-- (после recompute_trip функция возвращает цепочку) и тип. Зависимости: пять
-- функций зовутся ТОЛЬКО из edge `trip-route/*` через `mutate.ts` (шов уже
-- прокидывает `data` RPC наружу без изменений — правки mutate.ts не нужно).
--
-- Форма цепочки объявлена ОДИН раз — `_trip_city_chain(p_trip)`; каждая route-RPC
-- заканчивается им, чтобы не расходились пять копий SELECT.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0) _trip_city_chain — единственный источник формы «цепочка city_visits трипа».
--    to_jsonb(cv) = те же сырые колонки, что отдаёт read-дверь getTripDetails
--    (`select *`), в порядке position. Read-обогащение (cities/iata_city_code)
--    здесь НЕ повторяем — это забота read-двери; клиент мержит цепочку поверх
--    уже обогащённых строк кэша по id (слои записи/чтения не смешиваются).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public._trip_city_chain(p_trip uuid)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(to_jsonb(cv) order by cv.position), '[]'::jsonb)
  from city_visits cv
  where cv.trip_id = p_trip;
$function$;

revoke execute on function public._trip_city_chain(uuid) from public, anon, authenticated;
grant  execute on function public._trip_city_chain(uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) add_city — возвращает цепочку (с реальным id новой строки). Мёртвая теперь
--    переменная v_id + `returning id into v_id` убраны (id больше не отдаём отдельно).
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.add_city(uuid, jsonb, uuid, integer);

create function public.add_city(p_trip uuid, p_city jsonb, p_actor uuid, p_index integer default null::integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid   uuid := p_actor;
  v_kind  text;
  v_pos   int;
  v_start date;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  v_kind := coalesce(nullif(p_city->>'kind',''), 'transit');
  v_pos  := coalesce(p_index, (select coalesce(max(position), -1) + 1 from city_visits where trip_id = p_trip));

  update city_visits set position = position + 1 where trip_id = p_trip and position >= v_pos;

  v_start := coalesce(
    (select max(end_date) from city_visits where trip_id = p_trip),
    current_date);

  insert into city_visits (
    trip_id, created_by, external_city_id, geonameid, name_i18n, city_name_en,
    country_code,
    latitude, longitude, timezone, kind, start_date, end_date, position)
  values (
    p_trip, v_uid, nullif(p_city->>'external_city_id',''),
    nullif(p_city->>'geonameid','')::bigint, p_city->'name_i18n', nullif(p_city->>'city_name_en',''),
    p_city->>'country_code',
    nullif(p_city->>'latitude','')::numeric, nullif(p_city->>'longitude','')::numeric,
    nullif(p_city->>'timezone',''), v_kind,
    v_start, v_start + (case when v_kind = 'transit' then 2 else 0 end), v_pos);

  perform public.recompute_trip(p_trip, null);
  return public._trip_city_chain(p_trip);
end;
$function$;

revoke execute on function public.add_city(uuid, jsonb, uuid, integer) from public, anon, authenticated;
grant  execute on function public.add_city(uuid, jsonb, uuid, integer) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) remove_city — тело без изменений; возвращает цепочку после каскада+recompute.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.remove_city(uuid, uuid, uuid);

create function public.remove_city(p_city uuid, p_trip uuid, p_actor uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_base date;
begin
  perform 1 from city_visits where id = p_city and trip_id = p_trip;
  if not found then raise exception 'city not found in trip'; end if;

  v_base := public._trip_anchor_date(p_trip);

  delete from hotel_stays where trip_id = p_trip and city_visit_id = p_city;
  delete from activities  where trip_id = p_trip and city_visit_id = p_city;
  delete from transfers   where trip_id = p_trip and (from_city_visit_id = p_city or to_city_visit_id = p_city);
  delete from city_visits where id = p_city and trip_id = p_trip;

  perform public.recompute_trip(p_trip, v_base);
  return public._trip_city_chain(p_trip);
end;
$function$;

revoke execute on function public.remove_city(uuid, uuid, uuid) from public, anon, authenticated;
grant  execute on function public.remove_city(uuid, uuid, uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) reorder_cities — тело без изменений; возвращает цепочку.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.reorder_cities(uuid, uuid[], uuid);

create function public.reorder_cities(p_trip uuid, p_order uuid[], p_actor uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_base date;
begin
  v_base := public._trip_anchor_date(p_trip);

  update city_visits cv
    set position = x.ord - 1, updated_at = now()
  from (select id, ord from unnest(p_order) with ordinality as t(id, ord)) x
  where cv.id = x.id and cv.trip_id = p_trip;

  perform public.recompute_trip(p_trip, v_base);
  return public._trip_city_chain(p_trip);
end;
$function$;

revoke execute on function public.reorder_cities(uuid, uuid[], uuid) from public, anon, authenticated;
grant  execute on function public.reorder_cities(uuid, uuid[], uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) set_city_nights — тело без изменений; возвращает цепочку.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.set_city_nights(uuid, integer, uuid, uuid);

create function public.set_city_nights(p_city uuid, p_nights integer, p_trip uuid, p_actor uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_kind  text;
  v_start date;
  v_n     int;
begin
  select kind, start_date into v_kind, v_start from city_visits where id = p_city and trip_id = p_trip;
  if not found then raise exception 'city not found in trip'; end if;
  if v_kind in ('start','end') then raise exception 'nights not applicable to anchor city'; end if;

  v_n := greatest(0, least(60, coalesce(p_nights, 0)));
  update city_visits
    set kind     = case when v_n = 0 then 'waypoint' else 'transit' end,
        end_date = coalesce(v_start, current_date) + v_n,
        updated_at = now()
  where id = p_city and trip_id = p_trip;

  perform public.recompute_trip(p_trip, null);
  return public._trip_city_chain(p_trip);
end;
$function$;

revoke execute on function public.set_city_nights(uuid, integer, uuid, uuid) from public, anon, authenticated;
grant  execute on function public.set_city_nights(uuid, integer, uuid, uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) set_trip_start_date — тело без изменений; возвращает цепочку.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.set_trip_start_date(uuid, date, uuid);

create function public.set_trip_start_date(p_trip uuid, p_date date, p_actor uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  perform public.recompute_trip(p_trip, p_date);
  return public._trip_city_chain(p_trip);
end;
$function$;

revoke execute on function public.set_trip_start_date(uuid, date, uuid) from public, anon, authenticated;
grant  execute on function public.set_trip_start_date(uuid, date, uuid) to service_role;
