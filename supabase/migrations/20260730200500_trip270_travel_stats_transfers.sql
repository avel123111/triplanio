-- TRIP-270: ship the user's transfers as a compact row set so "My statistics" can
-- show flights and ground transfers, year-filtered like everything else on it.
--
-- WHY: the screen already has both tiles (Statistics.jsx `flights` / `ground`,
-- .sfig.c-flight / .c-transfer, stats.sb_flights / sb_ground in en+es+ru) — they
-- render "—" because the data never arrives. The RPC returned transfers as ONE
-- SCALAR (transfers_total), which carries neither the transport type nor a date,
-- so it can be split by neither. /stats year-filters everything it shows.
--
-- HOW: same shape the points already use — the RPC ships a compact set once and
-- the client aggregates (see the header of src/lib/travel-stats.js: "the RPC ships
-- the compact point set once, the year switch never hits the network"). Transfers
-- were the one metric on the screen outside that seam; this puts them back in it.
--
--   • Two fields only: transport_type + start_date. No id / trip_id / end_date —
--     the tiles don't need them, and they cost the most bytes (a uuid pair is ~3×
--     the payload of the whole row otherwise). Measured on the heaviest prod user
--     (31 trips / 87 transfers): 4.5 KB raw, 439 B gzipped — the payload is 57 KB
--     raw today, so this is noise on the wire.
--   • The field is named start_date ON PURPOSE: the existing pointYear() /
--     filterByYear() / availableYears() read exactly `start_date || end_date`, so
--     the year filter works over transfers with ZERO new client code.
--   • `at time zone 'utc'` — transfer datetimes are stored as NAIVE wall-clock in
--     UTC (src/lib/naive-time.js), so the UTC date part IS the date the user
--     typed. Reading it in the session timezone would shift late-evening
--     transfers into the next day (and, on 31 Dec, the next YEAR).
--   • transfers_total is NOT computed a second time — it is now
--     jsonb_array_length() of this very array. One scan instead of two, and the
--     home stat-bar's number can never disagree with the statistics screen's.
--     The JSON key is unchanged, so Trips.jsx is untouched.
--   • `order by start_datetime, id` keeps the payload byte-stable across refetches
--     so react-query's structural sharing doesn't hand the screen a new array (and
--     a re-render) for identical data. The id tie-break is load-bearing, not
--     belt-and-braces: same-instant transfers DO exist (prod has a trip with 4 on
--     one timestamp), and start_datetime alone leaves their order up to the plan.
--
-- Everything else is byte-for-byte the TRIP-215 body: the set-based membership
-- CTE, owner_pro, the other JSON keys, SECURITY DEFINER, and the pinned
-- `search_path = public, pg_temp` (TRIP-54 — CREATE OR REPLACE without the SET
-- clause would wipe the pin). CREATE OR REPLACE preserves grants (TRIP-49:
-- authenticated + service_role). Deploys via CI/CD (job migrate) on merge to dev.

create or replace function public.get_user_travel_stats()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_points jsonb; v_trips jsonb; v_transfers jsonb; v_trip_visits jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  with my_trips as (
    -- Exact semantics of is_trip_participant(t.id), unioned into two indexable arms.
    select t.id, t.title, t.cover_gradient, t.cover_image_url, t.created_by, t.is_pro_trip
    from public.trips t where t.created_by = v_uid
    union
    select t.id, t.title, t.cover_gradient, t.cover_image_url, t.created_by, t.is_pro_trip
    from public.trips t
    join public.trip_members m on m.trip_id = t.id
    where m.user_id = v_uid and m.status = 'active'
  ),
  owner_pro as (
    -- One is_user_pro call per unique owner (not per trip); formula stays in is_user_pro.
    select o.created_by, public.is_user_pro(o.created_by) as pro
    from (select distinct created_by from my_trips) o
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
    -- Minimal per-transfer row: what kind of move it was, and when. Layover legs
    -- are separate rows by construction (add_layover_transfer writes one row per
    -- segment), so a flight with one stop reads as two flights — the same unit the
    -- home stat-bar and the trip Overview already count.
    select jsonb_agg(jsonb_build_object(
      'transport_type', tr.transport_type,
      'start_date', (tr.start_datetime at time zone 'utc')::date
    ) order by tr.start_datetime, tr.id) as arr
    from public.transfers tr where tr.trip_id in (select id from my_trips)
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
      'cover_gradient',mt.cover_gradient,'cover_image_url',mt.cover_image_url,
      'is_pro',coalesce(mt.is_pro_trip or op.pro, false)))
      from my_trips mt join owner_pro op on op.created_by = mt.created_by),'{}'::jsonb),
    coalesce((select arr from transfer_rows),'[]'::jsonb),
    coalesce((select obj from trip_visits),'{}'::jsonb)
  into v_points, v_trips, v_transfers, v_trip_visits;
  return jsonb_build_object('points',v_points,'trips',v_trips,
    'transfers',v_transfers,'transfers_total',jsonb_array_length(v_transfers),
    'trip_visits',v_trip_visits);
end $function$;
