-- TRIP-215: set-based rewrite of get_user_travel_stats (kill per-row SECDEF calls).
--
-- WHY: this RPC feeds the home "My trips" list AND the Statistics screen (both
-- share the react-query cache ['travel-stats', user?.id]). Two spots evaluated a
-- SECURITY DEFINER predicate once PER ROW instead of once as a set:
--
--   P1 (dominant) — membership was `from trips t where is_trip_participant(t.id)`.
--     is_trip_participant is SECDEF, so the planner treats it as a black box: it
--     can't inline it into a join or apply an index, and runs it for EVERY row of
--     the whole trips table (each call = 2 EXISTS). Cost grows with the size of
--     the WHOLE database, not with the user's own trips — other people's trips
--     slow down your screen.
--   P2 — the per-trip Pro badge called is_trip_pro(mt.id) in a loop over the
--     user's trips. Each call is a nested SECDEF matryoshka: re-reads the trips
--     row (already read by my_trips, minus created_by/is_pro_trip) + is_user_pro.
--
-- HOW (declarative, not a point patch): express intent once as a set so the
-- planner picks index paths itself.
--
--   Step 1 — membership as the EXACT two arms of is_trip_participant
--     (baseline: created_by = auth.uid() OR an active trip_members row), unioned.
--     UNION (not UNION ALL) dedups the creator-who-is-also-a-member. my_trips now
--     also carries created_by + is_pro_trip so trips is never re-read for Pro.
--   Step 2 — is_trip_pro leaves the loop. Its value is assembled from the already
--     -read is_pro_trip + ONE is_user_pro call per DISTINCT owner (usually 1-3,
--     not per trip). The Pro formula is NOT hand-copied into SQL: is_user_pro
--     stays the single source (a third copy would drift against the SQL function
--     and the FE mirror isProActive, which a drift-guard test pins). is_pro_trip
--     is DEFAULT false but NULLABLE, so the outer coalesce(..., false) from
--     is_trip_pro is preserved verbatim — else a NULL is_pro_trip on a non-Pro
--     owner's trip would leak `null` instead of `false` into the JSON contract.
--   Step 3 — index the FK columns both arms need: trip_members(user_id) and
--     trips(created_by). trip_members(user_id) also speeds is_trip_participant
--     itself (it backs 18 RLS policies), so this is broad hygiene, not a patch.
--
-- Everything else is unchanged: the JSON contract is byte-for-byte identical (both
-- readers untouched), the other CTEs, the transfers count, the auth guard, the
-- empty-aggregate coalesces, SECURITY DEFINER, and — critically — the pinned
-- `search_path = public, pg_temp` (TRIP-54; CREATE OR REPLACE without the SET
-- clause would wipe the pin). CREATE OR REPLACE preserves grants (TRIP-49 target:
-- authenticated + service_role). Deploys via CI/CD (job migrate) on merge dev→main.

create or replace function public.get_user_travel_stats()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_points jsonb; v_trips jsonb; v_transfers int; v_trip_visits jsonb;
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
    coalesce((select count(*) from public.transfers tr where tr.trip_id in (select id from my_trips)),0),
    coalesce((select obj from trip_visits),'{}'::jsonb)
  into v_points, v_trips, v_transfers, v_trip_visits;
  return jsonb_build_object('points',v_points,'trips',v_trips,'transfers_total',v_transfers,'trip_visits',v_trip_visits);
end $function$;

-- Step 3 — index the FK columns the two membership arms (and is_trip_participant's
-- 18 RLS policies) rely on. Idempotent; tables are small, plain CREATE INDEX is safe.
create index if not exists idx_trip_members_user_id on public.trip_members (user_id);
create index if not exists idx_trips_created_by on public.trips (created_by);
