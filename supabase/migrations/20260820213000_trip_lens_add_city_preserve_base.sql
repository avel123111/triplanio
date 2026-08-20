-- Lens-edit bug: adding a START city shoved the whole trip forward by its span
-- (e.g. +42 days on a real dev trip). P0.
--
-- Root cause — input/output aliasing on the anchor column. The trip's base date
-- lives in ONE place: the `start` anchor's own `start_date` (_trip_anchor_date,
-- TRIP-209). `add_city` seeded EVERY new row's start_date with max(end_date) (the
-- trip's far END) as a throwaway placeholder, then called recompute_trip(p_trip,
-- **null**) — which RE-DERIVES the base AFTER the insert. For a `start` node the
-- placeholder IS the base: _trip_anchor_date reads the freshly-inserted start row's
-- start_date (= max(end_date)) and anchors the whole chain on the trip's end, so
-- every city jumps forward by the trip span.
--
-- This was the only route-RPC that recomputed with a null base (re-derive after
-- mutation). remove_city / reorder_cities already capture v_base :=
-- _trip_anchor_date(p_trip) BEFORE they mutate and pass it explicitly. The fix
-- brings add_city to that same shape, so the base is the PRE-insert anchor and the
-- new row's seed can no longer feed itself back as the base. Belt-and-suspenders:
-- the seed is anchored on v_base too, so the row is never placed at the far end and
-- even a stray recompute(null) can't be poisoned by it.
--
-- Behaviour-preserving for every non-start insert (v_base == what recompute(null)
-- would have derived); it only stops the start-insert from re-anchoring. Signature,
-- return type (jsonb chain, TRIP-435), role-gate (in the edge seam), search_path and
-- grants are unchanged. CREATE OR REPLACE keeps the existing grants (no return-type
-- change → no DROP needed).

create or replace function public.add_city(p_trip uuid, p_city jsonb, p_actor uuid, p_index integer default null::integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid   uuid := p_actor;
  v_kind  text;
  v_pos   int;
  v_base  date;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  -- Base = the pre-insert anchor. Captured BEFORE any mutation and passed to
  -- recompute explicitly, so inserting a `start` node cannot re-derive the base
  -- from its own placeholder seed.
  v_base := public._trip_anchor_date(p_trip);

  v_kind := coalesce(nullif(p_city->>'kind',''), 'transit');
  v_pos  := coalesce(p_index, (select coalesce(max(position), -1) + 1 from city_visits where trip_id = p_trip));

  update city_visits set position = position + 1 where trip_id = p_trip and position >= v_pos;

  -- Seed anchored on v_base (not max(end_date)): the row is never parked at the
  -- trip's far end. recompute_trip overwrites the dates from the chain anyway; the
  -- only load-bearing part of the seed is the transit span (end - start = 2 nights),
  -- preserved here.
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
    v_base, v_base + (case when v_kind = 'transit' then 2 else 0 end), v_pos);

  perform public.recompute_trip(p_trip, v_base);
  return public._trip_city_chain(p_trip);
end;
$function$;

revoke execute on function public.add_city(uuid, jsonb, uuid, integer) from public, anon, authenticated;
grant  execute on function public.add_city(uuid, jsonb, uuid, integer) to service_role;
