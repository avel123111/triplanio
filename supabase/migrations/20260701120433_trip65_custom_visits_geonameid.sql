-- TRIP-65 — cross-locale city identity for MANUAL stat visits (user_custom_visits).
--
-- WHY: the trip-city path already dedups on the language-independent GeoNames
-- `geonameid` and localizes display from the per-visit `name_i18n` snapshot
-- (TRIP-146 cutover). Manual stat pins (user_custom_visits) were left behind:
-- they had no geonameid and no snapshot, so a hand-added "Москва" keyed on
-- `moscow|ru` never merged with a trip's Moscow (`gn:524901`) — the same city
-- counted twice — and its name stayed frozen in the locale it was added in.
--
-- This brings manual visits onto the SAME model as city_visits, minus the
-- partner-link baggage: `geonameid` (identity) + `name_i18n` (en/es/ru display
-- snapshot). No `city_name_en` column — manual pins have no Stay22/Booking/
-- Aviasales links, so the English fallback is simply `name_i18n->>'en'`. The old
-- single-locale `city_name` column is dropped, mirroring Phase 6 for city_visits.
--
-- Order (one pass, no name is ever lost):
--   1. add the two columns (additive, nullable);
--   2. backfill an 'en' snapshot from city_name for every existing row so display
--      survives the drop (real geonameid + full en/es/ru enrichment is a separate
--      non-blocking backfill script; unmatched rows keep working on the name key);
--   3. re-point the only reader (get_user_travel_stats custom_points) off city_name;
--   4. drop city_name.
--
-- Deploys via CI/CD (job migrate) on merge dev→main. Only AddPlaceDialog (writes)
-- and this RPC (reads) ever touched the column — verified: no trigger, view, index
-- or generated column depends on it.
--
-- ddl-guard: allow-destructive — TRIP-65, contract phase, user_custom_visits.city_name
--   is re-pointed off (get_user_travel_stats custom_points → name_i18n) and the
--   only writer (AddPlaceDialog) stops writing it in the SAME PR, before the drop.

-- 1. Identity + localized snapshot, additive.
alter table public.user_custom_visits
  add column if not exists geonameid bigint,
  add column if not exists name_i18n jsonb;

-- 2. Backfill: guarantee a non-empty display source before the drop. Seeds the
--    English slot from the existing single-locale city_name where the snapshot is
--    still empty (all pre-TRIP-65 rows). The enrichment script fills es/ru + the
--    real geonameid afterwards.
update public.user_custom_visits
   set name_i18n = jsonb_build_object('en', city_name)
 where (name_i18n is null or name_i18n = '{}'::jsonb) and coalesce(city_name, '') <> '';

-- 3. get_user_travel_stats — custom points now carry geonameid + name_i18n so the
--    client dedups them by geonameid and localizes their display, identical to
--    trip points. `city_name` on custom points now derives from the snapshot's
--    English slot (back-compat string; the client re-localizes via name_i18n).
create or replace function public.get_user_travel_stats()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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
      'is_pro',public.is_trip_pro(mt.id))) from my_trips mt),'{}'::jsonb),
    coalesce((select count(*) from public.transfers tr where tr.trip_id in (select id from my_trips)),0),
    coalesce((select obj from trip_visits),'{}'::jsonb)
  into v_points, v_trips, v_transfers, v_trip_visits;
  return jsonb_build_object('points',v_points,'trips',v_trips,'transfers_total',v_transfers,'trip_visits',v_trip_visits);
end $function$;

-- 4. Drop the single-locale column. Snapshot (name_i18n) is now the display source.
alter table public.user_custom_visits drop column city_name;
