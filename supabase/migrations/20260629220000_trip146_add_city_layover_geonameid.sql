-- TRIP-146 Phase 4 — add_city / add_layover_transfer carry geonameid + name_i18n.
-- These RPCs insert city_visits from a jsonb payload with an explicit column list,
-- so unknown keys are dropped. We add geonameid + name_i18n to the insert so the
-- editor (add_city) and layover waypoints (add_layover_transfer) get the v2
-- identity key + hot-path snapshot — otherwise their affiliate (resolved by
-- geonameid) would be empty. Bodies are byte-identical to the baseline except the
-- two added columns. CREATE OR REPLACE (signatures unchanged).

create or replace function public.add_city(p_trip uuid, p_city jsonb, p_index integer default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid   uuid := auth.uid();
  v_id    uuid;
  v_kind  text;
  v_pos   int;
  v_start date;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public._can_edit_trip(p_trip, v_uid) then raise exception 'forbidden'; end if;

  v_kind := coalesce(nullif(p_city->>'kind',''), 'transit');
  v_pos  := coalesce(p_index, (select coalesce(max(position), -1) + 1 from city_visits where trip_id = p_trip));

  update city_visits set position = position + 1 where trip_id = p_trip and position >= v_pos;

  v_start := coalesce(
    (select max(end_date) from city_visits where trip_id = p_trip),
    current_date);

  insert into city_visits (
    trip_id, created_by, external_city_id, geonameid, name_i18n,
    city_name, country, country_code,
    latitude, longitude, timezone, kind, start_date, end_date, position)
  values (
    p_trip, v_uid, nullif(p_city->>'external_city_id',''),
    nullif(p_city->>'geonameid','')::bigint, p_city->'name_i18n',
    p_city->>'city_name', p_city->>'country', p_city->>'country_code',
    nullif(p_city->>'latitude','')::numeric, nullif(p_city->>'longitude','')::numeric,
    nullif(p_city->>'timezone',''), v_kind,
    v_start, v_start + (case when v_kind = 'transit' then 2 else 0 end), v_pos)
  returning id into v_id;

  perform public.recompute_trip(p_trip, null);
  return v_id;
end;
$$;

create or replace function public.add_layover_transfer(p_trip uuid, p_from uuid, p_to uuid, p_waypoints jsonb, p_segments jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
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
      trip_id, created_by, external_city_id, geonameid, name_i18n,
      city_name, country, country_code,
      latitude, longitude, timezone, kind, start_date, end_date, position)
    values (
      p_trip, v_uid, nullif(v_wp->>'external_city_id',''),
      nullif(v_wp->>'geonameid','')::bigint, v_wp->'name_i18n',
      v_wp->>'city_name', v_wp->>'country', v_wp->>'country_code',
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
$$;
