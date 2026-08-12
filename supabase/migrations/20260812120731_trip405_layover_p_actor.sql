-- TRIP-405: add_layover_transfer переходит на явный p_actor — домен броней эпика
-- «единая дверь в данные» (TRIP-374, блок 3).
--
-- ЗАЧЕМ. Единственный вызыватель RPC (EventEditDialog при создании переезда с
-- пересадками) уходит на edge trip-booking (действие transfer-layover, op:'rpc')
-- в ЭТОМ ЖЕ PR. Под service_role `auth.uid()` внутри функции возвращает NULL,
-- поэтому актор обязан приезжать ДАННЫМИ — параметром p_actor, который шов
-- подставляет ТОЛЬКО из проверенного JWT (клиент актора не называет).
--
-- ★ АТОМАРНО С REVOKE (handoff §0, идиома TRIP-49). Раз прямой клиентский вызов
-- уходит здесь же, окна «оба пути живы» нет → нет IDOR: клиент не сможет позвать
-- RPC с чужим p_actor (EXECUTE снят), edge подставляет p_actor из JWT. Смена
-- сигнатуры (5 арг → 6 арг) — это НОВАЯ функция для Postgres, поэтому DROP старой
-- + CREATE новой (а не CREATE OR REPLACE, тот завёл бы вторую перегрузку, и
-- argless-путь-по-старой-сигнатуре остался бы жив). Новая функция получает PUBLIC
-- EXECUTE по умолчанию → REVOKE FROM public,anon,authenticated + GRANT service_role.
--
-- ★★ p_actor БЕЗ default НАМЕРЕННО: `default null` + сохранённый 5-арг путь = IDOR.
-- Только явный обязательный p_actor + снятый EXECUTE закрывают это по построению.
--
-- Тело — байт-в-байт TRIP-223 (waypoint-цепочка + сегменты + recompute_trip,
-- SECURITY DEFINER, пин search_path=public,pg_temp по TRIP-54), единственная
-- правка: источник актора auth.uid() → p_actor. created_by вставляемых строк
-- (city_visits waypoint + transfers) = v_uid = p_actor. Деплой через CI/CD (migrate).

drop function if exists public.add_layover_transfer(uuid, uuid, uuid, jsonb, jsonb);

create function public.add_layover_transfer(p_trip uuid, p_from uuid, p_to uuid, p_waypoints jsonb, p_segments jsonb, p_actor uuid)
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
  if not public._can_edit_trip(p_trip, v_uid) then raise exception 'forbidden'; end if;

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

-- Least-privilege EXECUTE: снять PUBLIC-грант новой функции (иначе anon/authenticated
-- держат EXECUTE через PUBLIC — грабля TRIP-49), оставить только service_role (edge).
revoke execute on function public.add_layover_transfer(uuid, uuid, uuid, jsonb, jsonb, uuid) from public, anon, authenticated;
grant  execute on function public.add_layover_transfer(uuid, uuid, uuid, jsonb, jsonb, uuid) to service_role;
