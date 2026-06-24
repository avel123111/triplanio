-- TRIP-15: выпил legacy voucher_file_url / voucher_file_name.
--
-- Колонки voucher_file_* на hotel_stays и transfers — мёртвый дубль documents[]
-- (непустых строк 0 на prod и dev, фронт их больше не пишет). Удаляем атомарно
-- вместе с переопределением add_layover_transfer, который был единственным
-- кодом БД, всё ещё вставлявшим в эти колонки ('', '') — иначе после дропа
-- создание овернайт-трансфера с пересадками падало бы в рантайме.
--
-- Порядок внутри одной транзакции: сперва create or replace RPC (без voucher),
-- затем drop column. Деплой ВРУЧНУЮ на оба проекта (prod tizscxrpuopobgcxbekf +
-- dev nydhzevdizkfaxdlikgc). Оригинал RPC: 0029, последний редеф: 0047.

-- 1. add_layover_transfer без voucher_file_url / voucher_file_name.
--    Сигнатура и тело 1:1 c 0047, удалены только две колонки и их значения
--    ('', '') из INSERT в transfers.
create or replace function public.add_layover_transfer(
  p_trip uuid, p_from uuid, p_to uuid, p_waypoints jsonb, p_segments jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid      uuid := auth.uid();
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
      trip_id, created_by, external_city_id, city_name, country, country_code,
      latitude, longitude, timezone, kind, start_date, end_date, position)
    values (
      p_trip, v_uid, nullif(v_wp->>'external_city_id',''), v_wp->>'city_name',
      v_wp->>'country', v_wp->>'country_code',
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
      booking_reference, booking_url, booking_platform,
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
      nullif(v_seg->>'booking_platform',''),
      nullif(v_seg->>'price','')::numeric, coalesce(nullif(v_seg->>'currency',''), 'EUR'),
      coalesce(v_seg->'documents', '[]'::jsonb),
      nullif(v_seg->>'notes',''), '{}'::jsonb);
  end loop;

  perform public.recompute_trip(p_trip, null);
end;
$function$;

-- 2. Дроп самих колонок.
alter table public.hotel_stays
  drop column if exists voucher_file_url,
  drop column if exists voucher_file_name;

alter table public.transfers
  drop column if exists voucher_file_url,
  drop column if exists voucher_file_name;
