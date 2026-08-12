-- TRIP-406: домен маршрута (`trip-route`) + создание трипа (`trip`) — пятый домен
-- эпика «единая дверь в данные» (TRIP-374, блок 3), после броней (TRIP-405).
--
-- ЗАЧЕМ. `city_visits` — двух-дверный ресурс: 5 live-edit RPC (кластер 1) + прямой
-- клиентский insert при создании (кластер 2). Оба писателя уходят ЗА ШОВ в ЭТОМ
-- ЖЕ PR (edge trip-route/trip, op:'rpc'). Под service_role `auth.uid()` внутри
-- функции = NULL, поэтому актор приезжает ДАННЫМИ — параметром p_actor, который
-- шов подставляет ТОЛЬКО из проверенного JWT (клиент актора не называет).
--
-- ★ НОРМА ЭПИКА: write-RPC НЕ самоавторизуется (Вариант B устава). Авторизация
-- editor — ЕДИНСТВЕННО в шве (`requires:['editor']`=`isCallerEditor`). Внутренний
-- `_can_edit_trip(...)`/`auth.uid()`-гейт СНЯТ из 5 route-RPC И из
-- `add_layover_transfer` (405-исключение чистим здесь же, чтобы не осталось
-- единственным). Остаётся: p_actor→created_by (у тех, кто вставляет строки) +
-- integrity-scope `trip_id` (строка принадлежит трипу — целостность, НЕ право).
-- `_can_edit_trip` как ФУНКЦИЯ жива (гейтит прямой Storage), список ролей не тронут
-- → LIVE-2e (checkEditorRoles) продолжает якорить EDITOR_ROLES↔_can_edit_trip.
--
-- ★★ IDOR закрыт единым scope=`trip_id`: `remove_city`/`set_city_nights` получают
-- p_trip в сигнатуру и резолвят строку `where id=<город> AND trip_id=p_trip` →
-- RAISE на 0-match (честный NOT_FOUND через шов, не тихий no-op). «Мой трип +
-- чужой город» отбрасывается по построению (осознанно 403→404: editor-гейт теперь
-- на p_trip в шве). p_actor у remove/reorder/nights/start-date не пишется в строку
-- (у их записи нет автора), но принят ради единообразия инъекции шва (buildPlan
-- всегда добавляет p_actor к аргументам op:'rpc').
--
-- ★★★ АТОМАРНО С REVOKE (handoff §0, идиома TRIP-49). Прямые клиентские вызовы
-- уходят в этом же PR → окна «оба пути живы» нет. Смена сигнатуры = НОВАЯ функция
-- для Postgres ⇒ DROP старой + CREATE новой (не CREATE OR REPLACE — тот завёл бы
-- вторую перегрузку, и argless-путь-по-старой-сигнатуре остался бы жив). Новая
-- функция получает PUBLIC EXECUTE по умолчанию → REVOKE FROM public,anon,
-- authenticated + GRANT service_role. p_actor БЕЗ default (default null + старый
-- путь = IDOR). `add_layover_transfer` сигнатуру НЕ меняет (уже p_actor, TRIP-405)
-- → CREATE OR REPLACE (правка только тела: снятие `_can_edit_trip`); гранты уже
-- service_role-only, не трогаем.
--
-- Тела в остальном байт-в-байт живой схеме (сверено live dev 2026-08-12), движок
-- дат/anchor (`recompute_trip`/`_trip_anchor_date`) не тронут. search_path пин
-- public,pg_temp (TRIP-54). Деплой через CI/CD (job migrate).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) add_city — добавить город. v_uid := p_actor (created_by вставки), гейт снят.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.add_city(uuid, jsonb, integer);

create function public.add_city(p_trip uuid, p_city jsonb, p_actor uuid, p_index integer default null::integer)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid   uuid := p_actor;
  v_id    uuid;
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
    v_start, v_start + (case when v_kind = 'transit' then 2 else 0 end), v_pos)
  returning id into v_id;

  perform public.recompute_trip(p_trip, null);
  return v_id;
end;
$function$;

revoke execute on function public.add_city(uuid, jsonb, uuid, integer) from public, anon, authenticated;
grant  execute on function public.add_city(uuid, jsonb, uuid, integer) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) remove_city — p_trip в сигнатуру, integrity-scope + RAISE на 0-match, гейт снят.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.remove_city(uuid);

create function public.remove_city(p_city uuid, p_trip uuid, p_actor uuid)
 returns void
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
end;
$function$;

revoke execute on function public.remove_city(uuid, uuid, uuid) from public, anon, authenticated;
grant  execute on function public.remove_city(uuid, uuid, uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) reorder_cities — гейт снят (UPDATE уже скоупит trip_id=p_trip).
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.reorder_cities(uuid, uuid[]);

create function public.reorder_cities(p_trip uuid, p_order uuid[], p_actor uuid)
 returns void
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
end;
$function$;

revoke execute on function public.reorder_cities(uuid, uuid[], uuid) from public, anon, authenticated;
grant  execute on function public.reorder_cities(uuid, uuid[], uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) set_city_nights — p_trip в сигнатуру, integrity-scope + RAISE на 0-match.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.set_city_nights(uuid, integer);

create function public.set_city_nights(p_city uuid, p_nights integer, p_trip uuid, p_actor uuid)
 returns void
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
end;
$function$;

revoke execute on function public.set_city_nights(uuid, integer, uuid, uuid) from public, anon, authenticated;
grant  execute on function public.set_city_nights(uuid, integer, uuid, uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) set_trip_start_date — гейт снят (recompute уже скоуплен p_trip).
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.set_trip_start_date(uuid, date);

create function public.set_trip_start_date(p_trip uuid, p_date date, p_actor uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  perform public.recompute_trip(p_trip, p_date);
end;
$function$;

revoke execute on function public.set_trip_start_date(uuid, date, uuid) from public, anon, authenticated;
grant  execute on function public.set_trip_start_date(uuid, date, uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) add_layover_transfer — снять `_can_edit_trip` (405-исключение), сигнатура та же.
--    CREATE OR REPLACE: правка ТОЛЬКО тела, гранты уже service_role-only.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.add_layover_transfer(p_trip uuid, p_from uuid, p_to uuid, p_waypoints jsonb, p_segments jsonb, p_actor uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid      uuid := p_actor;
  v_from_pos int;
  v_wp       jsonb;
  v_wp_id    uuid;
  v_ids      uuid[];
  v_seg      jsonb;
  v_i        int := 0;
  v_idx      int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select position into v_from_pos from city_visits where id = p_from and trip_id = p_trip;
  if v_from_pos is null then raise exception 'from city not found in trip'; end if;

  v_ids := array[p_from];

  for v_wp in select value from jsonb_array_elements(coalesce(p_waypoints, '[]'::jsonb)) as t(value)
  loop
    v_i  := v_i + 1;
    v_idx := v_from_pos + v_i;
    update city_visits set position = position + 1, updated_at = now()
      where trip_id = p_trip and position >= v_idx;
    insert into city_visits (
      trip_id, created_by, external_city_id, geonameid, name_i18n, city_name_en,
      country_code,
      latitude, longitude, timezone, kind, start_date, end_date, position)
    values (
      p_trip, v_uid, nullif(v_wp->>'external_city_id',''),
      nullif(v_wp->>'geonameid','')::bigint, v_wp->'name_i18n', nullif(v_wp->>'city_name_en',''),
      v_wp->>'country_code',
      nullif(v_wp->>'latitude','')::numeric, nullif(v_wp->>'longitude','')::numeric,
      nullif(v_wp->>'timezone',''), 'waypoint',
      current_date, current_date, v_idx)
    returning id into v_wp_id;
    v_ids := v_ids || v_wp_id;
  end loop;

  v_ids := v_ids || p_to;

  v_i := 0;
  for v_seg in select value from jsonb_array_elements(coalesce(p_segments, '[]'::jsonb)) as t(value)
  loop
    v_i := v_i + 1;
    insert into transfers (
      trip_id, created_by, from_city_visit_id, to_city_visit_id,
      transport_type, day_change, start_datetime, end_datetime,
      carrier, flight_number, from_address, to_address,
      from_latitude, from_longitude, to_latitude, to_longitude,
      booking_reference, booking_url,
      price, currency, documents, notes, details)
    values (
      p_trip, v_uid, v_ids[v_i], v_ids[v_i + 1],
      v_seg->>'transport_type', coalesce((v_seg->>'day_change')::boolean, false),
      nullif(v_seg->>'start_datetime','')::timestamptz, nullif(v_seg->>'end_datetime','')::timestamptz,
      nullif(v_seg->>'carrier',''), nullif(v_seg->>'flight_number',''),
      nullif(v_seg->>'from_address',''), nullif(v_seg->>'to_address',''),
      nullif(v_seg->>'from_latitude','')::double precision, nullif(v_seg->>'from_longitude','')::double precision,
      nullif(v_seg->>'to_latitude','')::double precision, nullif(v_seg->>'to_longitude','')::double precision,
      nullif(v_seg->>'booking_reference',''), nullif(v_seg->>'booking_url',''),
      nullif(v_seg->>'price','')::numeric, coalesce(nullif(v_seg->>'currency',''), 'EUR'),
      coalesce(v_seg->'documents', '[]'::jsonb),
      nullif(v_seg->>'notes',''), '{}'::jsonb);
  end loop;

  perform public.recompute_trip(p_trip, null);
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) create_trip_with_route — АТОМАРНОЕ создание: trips + bulk city_visits +
--    recompute. Схлопывает create_trip(RPC) + прямой client-insert в одну
--    транзакцию. Даты кладёт СЕРВЕР (тот же движок, что live-edit): города
--    засеваются провизорным span (transit: current_date .. +nights; anchor: null,
--    как add_city), затем ОДИН recompute_trip(trip, p_start_date) перекладывает
--    всю цепочку — паритет с прежним клиентским addDays структурный. Лимит держит
--    триггер enforce_trip_limit (backstop) на INSERT trips (NEW.created_by=p_actor).
--    service_role-only (внутренняя, IF3): REVOKE PUBLIC + GRANT service_role.
-- ─────────────────────────────────────────────────────────────────────────────
create function public.create_trip_with_route(p_title text, p_start_date date, p_cities jsonb, p_actor uuid)
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

revoke execute on function public.create_trip_with_route(text, date, jsonb, uuid) from public, anon, authenticated;
grant  execute on function public.create_trip_with_route(text, date, jsonb, uuid) to service_role;
