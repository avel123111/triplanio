-- TRIP-403: get_user_travel_stats ужат до stats-факта — снят is_pro из trips-мапы.
-- Ярус A эпика «единая дверь в данные» (TRIP-374, блок 3, домен главной).
--
-- ЗАЧЕМ. Это фикс провала 402 (перегруженный ридер). Owner-aware Pro-бейдж жил в
-- ДВУХ местах — в get_user_travel_stats.trips[id].is_pro (для главной) и должен
-- быть в одном. Бейдж переехал в новый композит getTrips (get_my_trip_cards,
-- ярус B): is_pro теперь оттуда. Здесь единственное вычисляемое/owner-aware поле
-- (может дрейфовать → обязано быть одноисточниковым) снимается из stats-ридера.
--
-- ★ title + covers ОСТАЮТСЯ. Сверено по коду: их читает экран статистики —
-- Statistics.jsx передаёт trips-мапу в VisitPanel, где свотч ссылки на трип берёт
-- cover_image_url/cover_gradient (VisitPanel.jsx:91,94), а подпись — title (:139);
-- title также нужен longestTrip (travel-stats.js). Это СЫРЫЕ колонки trips,
-- обслуживают ОДИН экран (статистику), дрейфовать не могут — их сосуществование с
-- getTrips.covers/title = принятая сделка (как visits/title у ТЗ). Снимается ТОЛЬКО
-- is_pro. Мапа остаётся под именем `trips` (несёт covers, не только лейблы) →
-- Statistics.jsx не меняется.
--
-- Следствие: owner_pro CTE и вызов is_user_pro в этом ридере становятся мёртвыми
-- (is_pro ушёл) → удалены вместе с полем. Остальное тело — байт-в-байт TRIP-402
-- (набор transfer_rows, points/trip_visits, SECURITY DEFINER, search_path).
--
-- Сигнатура (uuid) НЕ меняется → CREATE OR REPLACE (сохраняет гранты service_role,
-- выданные TRIP-402: EXECUTE у public/anon/authenticated уже снят, повтор не нужен).
-- Оба потребителя мапы (главная-виджеты + статистика) мигрируют этим же PR; RPC
-- внутренняя, не версионируем. Деплой через CI/CD (job migrate).

create or replace function public.get_user_travel_stats(p_actor uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := p_actor;
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
    --
    -- start_datetime is NULLABLE (a transfer can be saved without a departure
    -- time), so the date falls back to the SAME anchor the timeline already uses
    -- for exactly this case (src/pages/TripView.jsx: explicit day → from-visit's
    -- last day → to-visit's arrival day). Without it an undated transfer would
    -- count under "all time" but vanish from every single-year view, and the two
    -- screens would disagree about when the trip moved.
    select jsonb_agg(jsonb_build_object(
      'transport_type', tr.transport_type,
      'start_date', coalesce((tr.start_datetime at time zone 'utc')::date, fv.end_date, tv.start_date)
    ) order by coalesce((tr.start_datetime at time zone 'utc')::date, fv.end_date, tv.start_date), tr.id) as arr
    from public.transfers tr
    left join all_visits fv on fv.id = tr.from_city_visit_id
    left join all_visits tv on tv.id = tr.to_city_visit_id
    where tr.trip_id in (select id from my_trips)
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
      'cover_gradient',mt.cover_gradient,'cover_image_url',mt.cover_image_url))
      from my_trips mt),'{}'::jsonb),
    coalesce((select arr from transfer_rows),'[]'::jsonb),
    coalesce((select obj from trip_visits),'{}'::jsonb)
  into v_points, v_trips, v_transfers, v_trip_visits;
  return jsonb_build_object('points',v_points,'trips',v_trips,
    'transfers',v_transfers,'transfers_total',jsonb_array_length(v_transfers),
    'trip_visits',v_trip_visits);
end $function$;
