-- 0029_add_layover_transfer.sql
-- TRIP-126 / Ф2 fix: atomic server-side creation of a layover (multi-leg) transfer.
--
-- WHY: the legacy client `saveLayoverChain` inserted the waypoint city_visits with a
-- PROVISIONAL position (0), then inserted the transfer rows, then renumbered positions
-- last. Once the Ф2 recompute-on-transfer trigger (0028) exists, the transfer insert
-- fires recompute_trip while the waypoint still sits at position 0 → it is laid as the
-- FIRST city and gets the earliest date; the subsequent start_date-based renumber then
-- locks that wrong order in. Result: the layover city jumps before its `from` city and
-- its date shifts by a day.
--
-- FIX: do the whole chain in ONE function, with positions made correct BEFORE any
-- transfer is written, so every trigger-fired recompute (and the final one) lays dates
-- by the right order. Reuses the same position-shift logic as add_city (0027).
--
-- Node chain built: from -> wp1 -> … -> wp(N-1) -> to  (N segments, N-1 waypoints).
-- p_waypoints: ordered jsonb array of layover city payloads (forced kind='waypoint'):
--   { city_name, country?, country_code?, latitude?, longitude?, timezone?, external_city_id? }
-- p_segments: ordered jsonb array of N transfer legs:
--   { transport_type, day_change, start_datetime, end_datetime, carrier?, flight_number?,
--     from_address?, to_address?, booking_reference?, booking_url?, booking_platform?,
--     price?, currency?, documents?(jsonb array), notes? }

create or replace function public.add_layover_transfer(
  p_trip      uuid,
  p_from      uuid,
  p_to        uuid,
  p_waypoints jsonb,
  p_segments  jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_from_pos int;
  v_wp       jsonb;
  v_wp_id    uuid;
  v_ids      uuid[];   -- node chain: from, waypoints…, to
  v_seg      jsonb;
  v_i        int := 0;
  v_idx      int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public._can_edit_trip(p_trip, v_uid) then raise exception 'forbidden'; end if;

  select position into v_from_pos from city_visits where id = p_from and trip_id = p_trip;
  if v_from_pos is null then raise exception 'from city not found in trip'; end if;

  v_ids := array[p_from];

  -- 1. Insert each waypoint right AFTER `from` (in order), shifting later positions.
  --    Positions are FINAL here — before any transfer write — so the recompute trigger
  --    (and the final recompute) lay dates by the correct chain order. Provisional
  --    dates are irrelevant (recompute_trip relays them).
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

  -- 2. One transfer per segment between adjacent chain nodes. Positions are already
  --    correct, so each trigger-fired recompute is right and idempotent.
  v_i := 0;
  for v_seg in select value from jsonb_array_elements(coalesce(p_segments, '[]'::jsonb)) as t(value)
  loop
    v_i := v_i + 1;
    insert into transfers (
      trip_id, created_by, from_city_visit_id, to_city_visit_id,
      transport_type, day_change, start_datetime, end_datetime,
      carrier, flight_number, from_address, to_address,
      booking_reference, booking_url, booking_platform,
      price, currency, documents, voucher_file_url, voucher_file_name, notes, details)
    values (
      p_trip, v_uid, v_ids[v_i], v_ids[v_i + 1],
      v_seg->>'transport_type', coalesce((v_seg->>'day_change')::boolean, false),
      nullif(v_seg->>'start_datetime','')::timestamptz, nullif(v_seg->>'end_datetime','')::timestamptz,
      nullif(v_seg->>'carrier',''), nullif(v_seg->>'flight_number',''),
      nullif(v_seg->>'from_address',''), nullif(v_seg->>'to_address',''),
      nullif(v_seg->>'booking_reference',''), nullif(v_seg->>'booking_url',''),
      nullif(v_seg->>'booking_platform',''),
      nullif(v_seg->>'price','')::numeric, coalesce(nullif(v_seg->>'currency',''), 'EUR'),
      coalesce(v_seg->'documents', '[]'::jsonb), '', '',
      nullif(v_seg->>'notes',''), '{}'::jsonb);
  end loop;

  -- 3. Final authoritative relay (positions correct → dates correct).
  perform public.recompute_trip(p_trip, null);
end;
$$;

revoke execute on function public.add_layover_transfer(uuid, uuid, uuid, jsonb, jsonb) from public, anon;
grant  execute on function public.add_layover_transfer(uuid, uuid, uuid, jsonb, jsonb) to authenticated;
