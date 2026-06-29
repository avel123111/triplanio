-- ============================================================================
-- TRIP-146 Phase 5 — бэкфилл существующих city_visits на geonameid + name_i18n.
--
-- DATA-операция (гоняет Pavel под service_role / в SQL-редакторе, dev и prod
-- отдельно). Резолвит каждый визит через search_gazetteer по английскому имени
-- (city_name_en, иначе city_name) + country + близость координат → geonameid,
-- и проставляет снимок name_i18n (en/es/ru). `city_id` НЕ трогаем — в v2 он
-- вестигиален (аффилиат привязан late-binding по geonameid; дроп city_id в
-- Phase 6). Идемпотентно: заполняем только пустые geonameid.
--
-- Несрезолвленные визиты (нон-сити/кривые имена) остаются geonameid = NULL —
-- поддерживаемое состояние (как сегодня city_id = NULL): аффилиат для них пуст,
-- читатели деградируют без ошибок.
--
-- Замер на dev (read-only): 439/456 резолвятся (96%), 17 в null.
-- ============================================================================

-- ----- ОТЧЁТ (read-only, прогнать сначала) ---------------------------------
-- with r as (
--   select cv.id, m.geonameid
--   from city_visits cv
--   left join lateral (
--     select s.geonameid,
--       case when cv.latitude is not null then 6371*acos(least(1,greatest(-1,
--         sin(radians(cv.latitude))*sin(radians(s.lat))
--         + cos(radians(cv.latitude))*cos(radians(s.lat))*cos(radians(cv.longitude - s.lng))))) end as km
--     from public.search_gazetteer(coalesce(nullif(cv.city_name_en,''), cv.city_name), 'en', 20) s
--     where (cv.country_code is null or cv.country_code = '' or upper(cv.country_code) = s.country_code)
--     order by km asc nulls last limit 1
--   ) m on true
--   where cv.geonameid is null
-- )
-- select count(*) total_empty, count(*) filter (where geonameid is not null) will_fill from r;

-- ----- ПРИМЕНЕНИЕ ----------------------------------------------------------
set statement_timeout = '600s';

with r as (
  select cv.id, m.geonameid, m.name_i18n
  from public.city_visits cv
  left join lateral (
    select s.geonameid, s.name_i18n,
      case when cv.latitude is not null then
        6371*acos(least(1, greatest(-1,
          sin(radians(cv.latitude))*sin(radians(s.lat))
          + cos(radians(cv.latitude))*cos(radians(s.lat))*cos(radians(cv.longitude - s.lng))))) end as km
    from public.search_gazetteer(coalesce(nullif(cv.city_name_en,''), cv.city_name), 'en', 20) s
    where (cv.country_code is null or cv.country_code = '' or upper(cv.country_code) = s.country_code)
    order by km asc nulls last
    limit 1
  ) m on true
  where cv.geonameid is null            -- идемпотентно: не трогаем уже заполненные
)
update public.city_visits cv
set geonameid = r.geonameid,
    name_i18n = coalesce(cv.name_i18n, r.name_i18n)
from r
where r.id = cv.id and r.geonameid is not null;

-- ----- ПРОХОД 2: добор оставшихся по ЛОКАЛЬНОМУ имени (city_name) -----------
-- У части старых визитов city_name_en — мусор от LocationIQ (TRIP-58): Монако→
-- "Nice", Рим→"Vatican City", Валетта→"Malta", Милан→"Livigno & Bormio". Проход 1
-- по английскому имени на них промахивается, но ЛОКАЛЬНОЕ city_name резолвится
-- (search_gazetteer держит кириллицу/любой скрипт). Добираем оставшиеся null.
with r2 as (
  select cv.id, m.geonameid, m.name_i18n
  from public.city_visits cv
  left join lateral (
    select s.geonameid, s.name_i18n,
      case when cv.latitude is not null then
        6371*acos(least(1, greatest(-1,
          sin(radians(cv.latitude))*sin(radians(s.lat))
          + cos(radians(cv.latitude))*cos(radians(s.lat))*cos(radians(cv.longitude - s.lng))))) end as km
    from public.search_gazetteer(cv.city_name, 'ru', 20) s
    where (cv.country_code is null or cv.country_code = '' or upper(cv.country_code) = s.country_code)
    order by km asc nulls last
    limit 1
  ) m on true
  where cv.geonameid is null
)
update public.city_visits cv
set geonameid = r2.geonameid,
    name_i18n = coalesce(cv.name_i18n, r2.name_i18n)
from r2
where r2.id = cv.id and r2.geonameid is not null;

-- ----- ВАЛИДАЦИЯ -----------------------------------------------------------
-- select count(*) total, count(geonameid) with_gid,
--        count(*) filter (where geonameid is null) still_null
-- from public.city_visits;
