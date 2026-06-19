-- Travel statistics feature (Trips home + "My statistics" screen).
--
-- Adds:
--   1) user_custom_visits — manual visits NOT tied to a trip (user adds a city +
--      dates to their own travel map/stats). Owned per-user, RLS by auth.uid().
--   2) get_user_travel_stats() — one compact payload for both screens. Returns
--      the visit POINTS (trip transit cities + custom visits), a trips dictionary
--      (for the side panel + covers) and transfers_total (live "переезды" count
--      on the home screen). All aggregation / year filtering happens client-side
--      in src/lib/travel-stats.js over `points` — counts stay in ONE source of
--      truth (src/lib/trip-cities.js); we deliberately do NOT recompute country/
--      city counts in SQL.
--
-- "My trips" = the exact set the user sees on the home screen: trips they own OR
-- are an active member of (mirrors is_trip_participant / trips_select RLS).
--
-- Points are transit cities only (kind='transit'), matching trip-cities.js scope
-- (anchors + waypoints are not destinations and never count). Distance is NOT
-- returned (out of scope); transfer mode split (air/ground) is NOT returned
-- (transit details intentionally omitted) — only the total row count.
--
-- Deploy MANUALLY to prod (tizscxrpuopobgcxbekf) + dev (nydhzevdizkfaxdlikgc).

-- 1) Manual visits table --------------------------------------------------------
create table if not exists public.user_custom_visits (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  city_name     text not null,
  country_code  text,                 -- ISO-3166-1 alpha-2, from the geocoder
  lat           double precision,
  lng           double precision,
  start_date    date,
  end_date      date,
  created_at    timestamptz not null default now()
);

create index if not exists user_custom_visits_user_idx
  on public.user_custom_visits (user_id);

alter table public.user_custom_visits enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='user_custom_visits' and policyname='ucv_select') then
    create policy ucv_select on public.user_custom_visits
      for select using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='user_custom_visits' and policyname='ucv_insert') then
    create policy ucv_insert on public.user_custom_visits
      for insert with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='user_custom_visits' and policyname='ucv_update') then
    create policy ucv_update on public.user_custom_visits
      for update using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='user_custom_visits' and policyname='ucv_delete') then
    create policy ucv_delete on public.user_custom_visits
      for delete using (user_id = auth.uid());
  end if;
end $$;

-- 2) Aggregated payload RPC -----------------------------------------------------
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
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- The user's trips = owned OR active member (mirrors is_trip_participant).
  with my_trips as (
    select t.id, t.title, t.cover_gradient, t.cover_image_url
    from public.trips t
    where t.created_by = v_uid
       or exists (
            select 1 from public.trip_members m
            where m.trip_id = t.id and m.user_id = v_uid and m.status = 'active'
          )
  ),
  trip_points as (
    select jsonb_agg(jsonb_build_object(
             'id', cv.id,
             'kind', 'trip',
             'trip_id', cv.trip_id,
             'city_name', cv.city_name,
             'country_code', cv.country_code,
             'lat', cv.latitude,
             'lng', cv.longitude,
             'start_date', cv.start_date,
             'end_date', cv.end_date
           )) as arr
    from public.city_visits cv
    join my_trips mt on mt.id = cv.trip_id
    where cv.kind = 'transit'
  ),
  custom_points as (
    select jsonb_agg(jsonb_build_object(
             'id', ucv.id,
             'kind', 'custom',
             'trip_id', null,
             'city_name', ucv.city_name,
             'country_code', ucv.country_code,
             'lat', ucv.lat,
             'lng', ucv.lng,
             'start_date', ucv.start_date,
             'end_date', ucv.end_date
           )) as arr
    from public.user_custom_visits ucv
    where ucv.user_id = v_uid
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
              where tr.trip_id in (select id from my_trips)), 0)
  into v_points, v_trips, v_transfers;

  return jsonb_build_object(
    'points', v_points,
    'trips', v_trips,
    'transfers_total', v_transfers
  );
end $$;

grant execute on function public.get_user_travel_stats() to authenticated;
