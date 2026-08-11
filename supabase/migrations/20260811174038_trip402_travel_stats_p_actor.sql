-- TRIP-402: get_user_travel_stats переходит на явный p_actor — ярус A эпика
-- «единая дверь в данные» (TRIP-374, блок 3, домен статистики).
--
-- ЗАЧЕМ. Ридер потребляют ДВА экрана (Statistics.jsx + Trips.jsx-главная); оба
-- уходят на edge getTravelStats (actor из JWT → RPC под service_role) в ОДНОМ
-- PR. Под service_role `auth.uid()` внутри функции возвращает NULL, поэтому
-- актор обязан приезжать ДАННЫМИ — параметром p_actor, который резолвит edge.
--
-- ★ АТОМАРНО С REVOKE (handoff §0). Раз оба прямых вызывателя уходят на edge
-- здесь же, прямого клиентского вызова не остаётся → EXECUTE у authenticated/anon
-- снимается В ЭТОЙ ЖЕ миграции. Окна «оба пути живы» для этой RPC нет → нет
-- IDOR: клиент не сможет позвать её с чужим p_actor (EXECUTE снят), а edge
-- подставляет p_actor только из проверенного JWT. Версионирование не нужно.
--
-- ★★ p_actor БЕЗ default (не `default null`) НАМЕРЕННО. `p_actor uuid default
-- null` + сохранённый argless-путь = ровно IDOR §0: EXECUTE у authenticated +
-- honored p_actor = чтение чужих статов. Только явный обязательный p_actor + снятый
-- EXECUTE закрывают это по построению.
--
-- Смена сигнатуры ()→(uuid) — это НОВАЯ функция для Postgres, поэтому DROP старой
-- (argless) + CREATE новой, а не CREATE OR REPLACE (тот завёл бы вторую
-- перегрузку, и argless-путь остался бы жив — та самая дыра). Новая функция
-- получает PUBLIC EXECUTE по умолчанию → REVOKE FROM public,anon,authenticated
-- (идиома TRIP-49: специфичный REVOKE не снимает PUBLIC-грант) + явный GRANT
-- service_role (после DROP его собственный грант тоже исчез).
--
-- Тело — байт-в-байт TRIP-270 (набор transfer_rows, owner_pro, JSON-ключи,
-- SECURITY DEFINER, пин search_path=public,pg_temp по TRIP-54), единственная
-- правка: источник актора auth.uid() → p_actor. Деплой через CI/CD (job migrate).

drop function if exists public.get_user_travel_stats();

create function public.get_user_travel_stats(p_actor uuid)
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

-- Least-privilege EXECUTE: снять PUBLIC-грант новой функции (иначе anon/authenticated
-- держат EXECUTE через PUBLIC — грабля TRIP-49), оставить только service_role (edge).
revoke execute on function public.get_user_travel_stats(uuid) from public, anon, authenticated;
grant  execute on function public.get_user_travel_stats(uuid) to service_role;
