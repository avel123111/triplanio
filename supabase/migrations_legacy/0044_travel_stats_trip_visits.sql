-- Travel-stats RPC v2: fold the home screen's per-trip visit rows into the same
-- payload, and bind the "my trips" set to is_trip_participant so it can never
-- drift from what trips_select RLS actually shows the user.
--
-- WHY (performance): the home screen used to issue a SECOND round-trip
-- (`select * from city_visits where trip_id in (...)`) purely to drive the trip
-- CARDS (date range, "past/active" partition, city scope). That re-scanned
-- city_visits a second time (this RPC already reads it for `points`) and shipped
-- every column of every visit. We now return `trip_visits` — a compact per-trip
-- map of just the columns the cards need — from a SINGLE city_visits read, so the
-- front end can drop the separate query entirely.
--
-- WHY (correctness): "my trips" now = is_trip_participant(t.id), the EXACT
-- predicate behind the trips_select RLS policy (owner OR trip_members.status =
-- 'active'). Previously this RPC inlined `status = 'active'`; that happened to
-- match today, but inlining let the two definitions drift apart. Referencing the
-- shared function guarantees the stats set == the visible-trips set forever.
--
-- Payload shape (additions marked +):
--   { points: [ … ],                      -- transit + custom (unchanged)
--     trips:  { <id>: { title, cover_gradient, cover_image_url } },
--     transfers_total: int,
--   +  trip_visits: { <trip_id>: [ { kind, city_name, country_code,
--   +                                start_date, end_date } ] } }
--
-- Deploy MANUALLY to prod (tizscxrpuopobgcxbekf) + dev (nydhzevdizkfaxdlikgc).
-- Normal authenticated RPC — verify_jwt stays TRUE (NOT a canon-10 webhook fn).
-- Front end is backward-compatible: it falls back to the old query when an
-- older RPC build returns no `trip_visits`, so deploy order does not matter.

create or replace function public.get_user_travel_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_points jsonb;
  v_trips jsonb;
  v_transfers int;
  v_trip_visits jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  with my_trips as (
    select t.id, t.title, t.cover_gradient, t.cover_image_url
    from public.trips t
    where public.is_trip_participant(t.id)   -- owner OR active member (== trips_select RLS)
  ),
  -- Read each visited trip's city_visits ONCE; derive both the transit-only
  -- `points` and the all-kinds `trip_visits` from this single set.
  all_visits as (
    select cv.id, cv.trip_id, cv.kind, cv.city_name, cv.country_code,
           cv.latitude, cv.longitude, cv.start_date, cv.end_date
    from public.city_visits cv
    join my_trips mt on mt.id = cv.trip_id
  ),
  trip_points as (
    select jsonb_agg(jsonb_build_object(
             'id', id, 'kind', 'trip', 'trip_id', trip_id,
             'city_name', city_name, 'country_code', country_code,
             'lat', latitude, 'lng', longitude,
             'start_date', start_date, 'end_date', end_date
           )) as arr
    from all_visits
    where kind = 'transit'
  ),
  custom_points as (
    select jsonb_agg(jsonb_build_object(
             'id', ucv.id, 'kind', 'custom', 'trip_id', null,
             'city_name', ucv.city_name, 'country_code', ucv.country_code,
             'lat', ucv.lat, 'lng', ucv.lng,
             'start_date', ucv.start_date, 'end_date', ucv.end_date
           )) as arr
    from public.user_custom_visits ucv
    where ucv.user_id = v_uid
  ),
  trip_visits as (
    select jsonb_object_agg(trip_id::text, rows) as obj
    from (
      select trip_id, jsonb_agg(jsonb_build_object(
               'kind', kind, 'city_name', city_name, 'country_code', country_code,
               'start_date', start_date, 'end_date', end_date
             )) as rows
      from all_visits
      group by trip_id
    ) g
  )
  select
    coalesce((select arr from trip_points), '[]'::jsonb)
      || coalesce((select arr from custom_points), '[]'::jsonb),
    coalesce((select jsonb_object_agg(mt.id::text, jsonb_build_object(
               'title', mt.title,
               'cover_gradient', mt.cover_gradient,
               'cover_image_url', mt.cover_image_url
             )) from my_trips mt), '{}'::jsonb),
    coalesce((select count(*) from public.transfers tr
              where tr.trip_id in (select id from my_trips)), 0),
    coalesce((select obj from trip_visits), '{}'::jsonb)
  into v_points, v_trips, v_transfers, v_trip_visits;

  return jsonb_build_object(
    'points', v_points,
    'trips', v_trips,
    'transfers_total', v_transfers,
    'trip_visits', v_trip_visits
  );
end $$;

grant execute on function public.get_user_travel_stats() to authenticated;
