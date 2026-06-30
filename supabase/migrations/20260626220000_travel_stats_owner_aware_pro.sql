-- TRIP-121: owner-aware Pro flag per trip in the home-screen stats RPC.
--
-- WHY: the trip-card "Pro" badge must reflect EFFECTIVE Pro — is_pro_trip OR the
-- trip OWNER has an active subscription — for EVERY trip the user sees, not just
-- their own. The client can resolve its own trips (it knows its own sub) but NOT
-- a foreign trip whose paying owner is someone else (and it must not see the
-- owner's billing). So the predicate has to be computed server-side.
--
-- HOW (reuse-first, zero new round-trips / RPCs): fold the canonical predicate
-- public.is_trip_pro(trip_id) (0055: is_pro_trip OR is_user_pro(created_by)) into
-- the per-trip object of get_user_travel_stats — the SINGLE RPC the home already
-- calls. This RPC is SECURITY DEFINER, so it may invoke is_trip_pro (which is
-- revoked from anon/authenticated to prevent IDOR). The boolean is returned ONLY
-- for trips in my_trips (is_trip_participant) — a set the user already sees — so
-- nothing about the owner's subscription leaks beyond "this trip is Pro", which a
-- participant already infers from the working Pro features.
--
-- Additive / idempotent (CREATE OR REPLACE); only the trips-map object gains an
-- 'is_pro' key. CREATE OR REPLACE preserves existing grants/owner. Deploys via
-- CI/CD (job migrate) on merge dev→main. FE is backward-compatible: it falls back
-- to the client predicate when 'is_pro' is absent (older RPC build), so deploy
-- order does not matter.

create or replace function public.get_user_travel_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_points jsonb; v_trips jsonb; v_transfers int; v_trip_visits jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  with my_trips as (
    select t.id, t.title, t.cover_gradient, t.cover_image_url
    from public.trips t where public.is_trip_participant(t.id)
  ),
  all_visits as (
    select cv.id, cv.trip_id, cv.kind, cv.city_name, cv.country_code,
           cv.latitude, cv.longitude, cv.start_date, cv.end_date
    from public.city_visits cv join my_trips mt on mt.id = cv.trip_id
  ),
  trip_points as (
    select jsonb_agg(jsonb_build_object('id',id,'kind','trip','trip_id',trip_id,
      'city_name',city_name,'country_code',country_code,'lat',latitude,'lng',longitude,
      'start_date',start_date,'end_date',end_date)) as arr
    from all_visits where kind='transit'
  ),
  custom_points as (
    select jsonb_agg(jsonb_build_object('id',ucv.id,'kind','custom','trip_id',null,
      'city_name',ucv.city_name,'country_code',ucv.country_code,'lat',ucv.lat,'lng',ucv.lng,
      'start_date',ucv.start_date,'end_date',ucv.end_date)) as arr
    from public.user_custom_visits ucv where ucv.user_id = v_uid
  ),
  trip_visits as (
    select jsonb_object_agg(trip_id::text, rows) as obj from (
      select trip_id, jsonb_agg(jsonb_build_object('kind',kind,'city_name',city_name,
        'country_code',country_code,'start_date',start_date,'end_date',end_date)) as rows
      from all_visits group by trip_id
    ) g
  )
  select
    coalesce((select arr from trip_points),'[]'::jsonb) || coalesce((select arr from custom_points),'[]'::jsonb),
    coalesce((select jsonb_object_agg(mt.id::text, jsonb_build_object('title',mt.title,
      'cover_gradient',mt.cover_gradient,'cover_image_url',mt.cover_image_url,
      'is_pro',public.is_trip_pro(mt.id))) from my_trips mt),'{}'::jsonb),
    coalesce((select count(*) from public.transfers tr where tr.trip_id in (select id from my_trips)),0),
    coalesce((select obj from trip_visits),'{}'::jsonb)
  into v_points, v_trips, v_transfers, v_trip_visits;
  return jsonb_build_object('points',v_points,'trips',v_trips,'transfers_total',v_transfers,'trip_visits',v_trip_visits);
end $$;
