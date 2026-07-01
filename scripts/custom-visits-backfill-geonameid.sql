-- ============================================================================
-- TRIP-65 — бэкфилл существующих user_custom_visits (ручные точки статистики)
-- на geonameid + полный снимок name_i18n (en/es/ru).
--
-- DATA-операция (гоняет Pavel под service_role / в SQL-редакторе, dev и prod
-- отдельно) ПОСЛЕ деплоя миграции 20260701120000. Резолвит каждую ручную точку
-- через search_gazetteer по английскому имени + country + близость координат →
-- geonameid, и обогащает name_i18n до полного en/es/ru.
--
-- ВАЖНО: колонка city_name уже ДРОПНУТА миграцией. Английское имя сохранено в
-- name_i18n->>'en' (миграция засеяла его из city_name перед дропом) — резолвим
-- по нему. Идемпотентно: заполняем только пустые geonameid.
--
-- Несрезолвленные точки остаются geonameid = NULL (нон-сити/кривые имена) —
-- поддерживаемое состояние: дедуп для них падает на фолбэк name_i18n.en|cc
-- (текущее поведение, без регрессии). Зеркало Phase 5 для city_visits
-- (scripts/visits-backfill-geonameid.sql), адаптировано под lat/lng + name_i18n->>'en'.
--
-- Замер (dev/prod): ~60 prod / 11 dev строк — объём крошечный, таймаут не грозит.
-- ============================================================================

-- ----- ОТЧЁТ (read-only, прогнать сначала) ---------------------------------
-- with r as (
--   select ucv.id, m.geonameid
--   from user_custom_visits ucv
--   left join lateral (
--     select s.geonameid,
--       case when ucv.lat is not null then 6371*acos(least(1,greatest(-1,
--         sin(radians(ucv.lat))*sin(radians(s.lat))
--         + cos(radians(ucv.lat))*cos(radians(s.lat))*cos(radians(ucv.lng - s.lng))))) end as km
--     from public.search_gazetteer(ucv.name_i18n->>'en', 'en', 20) s
--     where (ucv.country_code is null or ucv.country_code = '' or upper(ucv.country_code) = s.country_code)
--     order by km asc nulls last limit 1
--   ) m on true
--   where ucv.geonameid is null and coalesce(ucv.name_i18n->>'en','') <> ''
-- )
-- select count(*) total_empty, count(*) filter (where geonameid is not null) will_fill from r;

-- ----- ПРИМЕНЕНИЕ ----------------------------------------------------------
set statement_timeout = '600s';

-- ПРОХОД 1: по английскому имени (name_i18n->>'en').
with r as (
  select ucv.id, m.geonameid, m.name_i18n
  from public.user_custom_visits ucv
  left join lateral (
    select s.geonameid, s.name_i18n,
      case when ucv.lat is not null then
        6371*acos(least(1, greatest(-1,
          sin(radians(ucv.lat))*sin(radians(s.lat))
          + cos(radians(ucv.lat))*cos(radians(s.lat))*cos(radians(ucv.lng - s.lng))))) end as km
    from public.search_gazetteer(ucv.name_i18n->>'en', 'en', 20) s
    where (ucv.country_code is null or ucv.country_code = '' or upper(ucv.country_code) = s.country_code)
    order by km asc nulls last
    limit 1
  ) m on true
  where ucv.geonameid is null and coalesce(ucv.name_i18n->>'en','') <> ''
)
update public.user_custom_visits ucv
set geonameid = r.geonameid,
    name_i18n = r.name_i18n                 -- заменяем en-стаб на полный en/es/ru снимок
from r
where r.id = ucv.id and r.geonameid is not null;

-- ----- ВАЛИДАЦИЯ -----------------------------------------------------------
-- select count(*) total, count(geonameid) with_gid,
--        count(*) filter (where geonameid is null) still_null
-- from public.user_custom_visits;
