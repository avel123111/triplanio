-- get_user_travel_stats — минус мёртвый ключ `trip_visits`.
--
-- Что это было. До TRIP-403 главная (/trips) собирала карточку трипа из ответа
-- СТАТИСТИКИ: обложку и название брала из карты `trips`, а визиты каждого трипа —
-- из карты `trip_visits`. TRIP-403 завёл `get_my_trip_cards` (edge getTrips), где
-- карточка приезжает целиком одним вызовом, и увёл туда обоих читателей. Ключ
-- `trip_visits` остался в ответе без единого читателя.
--
-- Проверено перед сносом (все три источника ссылок, как требует
-- memory/feedback-dead-i18n-key-sweep-must-scan-backend): в `src/**`,
-- `supabase/functions/**` и `scripts/**` слово `trip_visits` встречается ровно
-- дважды и ОБА раза в комментарии, ни одного чтения поля. Через n8n функция тоже
-- недостижима: EXECUTE у anon/authenticated снят миграцией 20260811174038, её
-- единственный вызыватель — edge `getTravelStats`.
--
-- Цена молчания: карта визитов ПО ВСЕМ трипам пользователя собиралась и ехала
-- в КАЖДОМ ответе статистики — и на /stats, и на главной.
--
-- Тело функции дословно предыдущее (20260820201544), убраны CTE `trip_visits`,
-- его слот в `select … into` и ключ в `jsonb_build_object`. Сигнатура
-- (uuid → jsonb) не меняется → CREATE OR REPLACE сохраняет гранты.
create or replace function public.get_user_travel_stats(p_actor uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := p_actor;
  v_points jsonb; v_trips jsonb; v_transfers jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  with my_trips as (
    select t.id, t.title, t.cover_image_url, t.created_by, t.is_pro_trip
    from public.trips t where t.created_by = v_uid
    union
    select t.id, t.title, t.cover_image_url, t.created_by, t.is_pro_trip
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
    select jsonb_agg(jsonb_build_object(
      'transport_type', tr.transport_type,
      'start_date', coalesce((tr.start_datetime at time zone 'utc')::date, fv.end_date, tv.start_date)
    ) order by coalesce((tr.start_datetime at time zone 'utc')::date, fv.end_date, tv.start_date), tr.id) as arr
    from public.transfers tr
    left join all_visits fv on fv.id = tr.from_city_visit_id
    left join all_visits tv on tv.id = tr.to_city_visit_id
    where tr.trip_id in (select id from my_trips)
  )
  select
    coalesce((select arr from trip_points),'[]'::jsonb) || coalesce((select arr from custom_points),'[]'::jsonb),
    coalesce((select jsonb_object_agg(mt.id::text, jsonb_build_object('title',mt.title,
      'cover_image_url',mt.cover_image_url))
      from my_trips mt),'{}'::jsonb),
    coalesce((select arr from transfer_rows),'[]'::jsonb)
  into v_points, v_trips, v_transfers;
  return jsonb_build_object('points',v_points,'trips',v_trips,
    'transfers',v_transfers,'transfers_total',jsonb_array_length(v_transfers));
end $function$;
