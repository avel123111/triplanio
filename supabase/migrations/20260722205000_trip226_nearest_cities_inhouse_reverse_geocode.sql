-- TRIP-226 — inhouse reverse geocoding для GPS-города старта/финиша.
--
-- Проблема: «мой город» по GPS шёл в LocationIQ (reverseGeocode), возвращал
-- объект БЕЗ geonameid/name_i18n → после дропа city_visits.city_name (TRIP-146
-- Ф6) якорь рождался с пустым именем. Уводим определение города по координатам
-- на СВОЙ газеттир: RPC nearest_cities резолвит lat/lng в 2-3 ближайших города
-- прямо в БД, каждый — полноценный газеттир-город (geonameid + name_i18n{en,es,ru}),
-- поэтому дальше якорь ведёт себя как обычный город.
--
-- Три части:
--   1) индекс geo_gazetteer(lat) — без него любой поиск ближайшего = seq-scan
--      всех ~234k строк (~950мс на тап). Индекс превращает bbox по широте в
--      index range scan (десятки мс). Нативный btree, без PostGIS/cube.
--   2) gaz_project(geonameid, lang) — общий хелпер проекции display/subtitle/
--      name_i18n (единый источник локализации города). Вынесен из
--      search_gazetteer_core, чтобы поиск и nearest_cities печатали имена
--      ОДИНАКОВО (иначе копипаст → дрейф локалей). Internal (REVOKE PUBLIC).
--   3) nearest_cities(_lat,_lng,_lim,_lang) — client-вызываемая secdef-функция,
--      та же TABLE-форма, что search_gazetteer (фронтовый mapGazCity без правок).

-- ── 1. Индекс скорости ──────────────────────────────────────────────────────
create index if not exists gaz_lat on public.geo_gazetteer using btree (lat);

-- ── 2. Общий хелпер проекции ────────────────────────────────────────────────
-- Собирает локализованные display / subtitle(регион, страна) / name_i18n{en,es,ru}
-- по одному geonameid. Идентична инлайн-проекции, что была в search_gazetteer_core.
-- SECURITY DEFINER: читает tier-D таблицы (geo_*), у которых REVOKE у anon/auth
-- (доступ только через secdef-RPC). Internal — EXECUTE только у владельца-дефайнера
-- (вызывается из search_gazetteer_core и nearest_cities), клиенту недоступна.
create or replace function public.gaz_project(_geonameid bigint, _lang text default 'en')
returns table(display text, subtitle text, name_i18n jsonb)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select
    coalesce((select an.alternate_name from geo_alt_names an
               where an.geonameid = g.geonameid and an.isolanguage = _lang
               order by an.is_preferred desc nulls last limit 1), g.name) as display,
    nullif(concat_ws(', ',
      coalesce((select an.alternate_name from geo_admin1 r join geo_alt_names an on an.geonameid = r.geonameid
                 where r.code = g.country_code || '.' || g.admin1_code and an.isolanguage = _lang
                 order by an.is_preferred desc nulls last limit 1), nullif(g.admin1_name,'')),
      coalesce((select an.alternate_name from geo_country c join geo_alt_names an on an.geonameid = c.geonameid
                 where c.code = g.country_code and an.isolanguage = _lang
                 order by an.is_preferred desc nulls last limit 1), g.country_code)
    ), '') as subtitle,
    jsonb_build_object(
      'en', coalesce((select an.alternate_name from geo_alt_names an
                       where an.geonameid = g.geonameid and an.isolanguage = 'en'
                       order by an.is_preferred desc nulls last limit 1), g.name),
      'es', coalesce((select an.alternate_name from geo_alt_names an
                       where an.geonameid = g.geonameid and an.isolanguage = 'es'
                       order by an.is_preferred desc nulls last limit 1), g.name),
      'ru', coalesce((select an.alternate_name from geo_alt_names an
                       where an.geonameid = g.geonameid and an.isolanguage = 'ru'
                       order by an.is_preferred desc nulls last limit 1), g.name)
    ) as name_i18n
  from geo_gazetteer g
  where g.geonameid = _geonameid;
$function$;

revoke all on function public.gaz_project(bigint, text) from public;

-- ── 3. Рефактор search_gazetteer_core: инлайн-проекция → gaz_project ──────────
-- Поведение НЕ меняется: те же три выражения переехали в хелпер и зовутся через
-- LATERAL. Всё остальное (полнотекст, translit, скоуп по стране, ранжирование)
-- дословно как было. Сверяется побайтово выдачей search_gazetteer до/после.
create or replace function public.search_gazetteer_core(q text, lang text default 'en', lim integer default 10, cc text default ''::text)
returns table(geonameid bigint, display text, subtitle text, country_code text, population bigint, feature_code text, lat double precision, lng double precision, name_i18n jsonb)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with nq as (
    select trim(regexp_replace(lower(unaccent(coalesce(q,''))), '[^a-z0-9а-яё]+', ' ', 'g')) as qn
  ),
  arr as (select qn, regexp_split_to_array(qn, ' ') as a from nq where qn <> ''),
  t as (
    select qn,
           public.translit_ru_lat(qn)    as qn_lat,
           a[1]                           as first_tok,
           public.translit_ru_lat(a[1])   as first_lat,
           to_tsquery('simple', '(' || a[1] || ':* | ' || public.translit_ru_lat(a[1]) || ':*)') as q_name,
           to_tsquery('simple', nullif(array_to_string(array(
             select '(' || e || ':* | ' || public.translit_ru_lat(e) || ':*)'
             from unnest(a) e where e <> ''
           ), ' & '), '')) as q_all
    from arr
  )
  select g.geonameid,
         p.display,
         p.subtitle,
         g.country_code, g.population, g.feature_code, g.lat, g.lng,
         p.name_i18n
  from t
  join geo_gazetteer g
    on (g.name_doc @@ t.q_name or g.blob_doc @@ t.q_name)
   and g.all_doc @@ t.q_all
  left join lateral (
    select regexp_replace(lower(unaccent(
             coalesce((select an.alternate_name from geo_alt_names an
                        where an.geonameid = g.geonameid and an.isolanguage = lang
                        order by an.is_preferred desc nulls last limit 1), g.name))),
           '[^a-z0-9а-яё]+', ' ', 'g') as nm
  ) nn on true
  cross join lateral public.gaz_project(g.geonameid, lang) p
  where t.q_all is not null
    and g.feature_code not in ('PPLX','PPLH','PPLQ','PPLW','PPLCH')
    -- ЖЁСТКИЙ скоуп: если cc задан — только эта страна; иначе (cc='') без ограничения.
    and (nullif(cc,'') is null or g.country_code = upper(cc))
  -- В СКОУПЕ: точное совпадение имени вперёд населения (populous префикс-тёзка
  -- внутри страны не должен хоронить точный матч). Без cc — константа, порядок прежний.
  order by (case when nullif(cc,'') is not null and (nn.nm = t.qn or nn.nm = t.qn_lat) then 0 else 1 end),
           3.0 * (case when g.name_doc @@ t.q_name then 1 else 0 end)
         + 1.0 * (case when nn.nm = t.qn or nn.nm = t.qn_lat then 1 else 0 end)
         + 0.5 * (case when nn.nm like t.first_tok||'%' or nn.nm like t.first_lat||'%' then 1 else 0 end)
         + 1.2 * log((coalesce(g.population,0) + 1)::numeric) desc,
           g.population desc nulls last
  limit lim;
$function$;

-- ── 4. nearest_cities: координаты → 2-3 ближайших газеттир-города ─────────────
-- Строго по расстоянию (без порога населения — решение продукта). Отсекаем лишь
-- НЕ-города: заброшенные/снесённые/исторические/фермы (PPLX/PPLH/PPLQ/PPLW/PPLCH),
-- как в search_gazetteer_core. bbox ±2° (index range scan по lat); если в окне
-- меньше _lim кандидатов (редкая точка в океане/глуши) — безлимитный fallback
-- (One-Time Filter гейтит его: полный проход только когда окно недобрало).
-- Дистанция — cos-корректированный евклид (для сравнения-сортировки достаточно,
-- haversine не нужен). Проекция gaz_project считается ТОЛЬКО на финальных _lim.
create or replace function public.nearest_cities(_lat double precision, _lng double precision, _lim integer default 3, _lang text default 'en')
returns table(geonameid bigint, display text, subtitle text, country_code text, population bigint, feature_code text, lat double precision, lng double precision, name_i18n jsonb)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with box as (
    select g.geonameid,
           ((g.lat - _lat)^2 + ((g.lng - _lng) * cos(radians(_lat)))^2) as d2
    from geo_gazetteer g
    where g.lat between _lat - 2 and _lat + 2
      and g.lng between _lng - 2 and _lng + 2
      and g.feature_code like 'PPL%'
      and g.feature_code not in ('PPLX','PPLH','PPLQ','PPLW','PPLCH')
    order by d2 asc
    limit _lim
  ),
  wide as (
    -- Fallback: выполняется, только если bbox недобрал (One-Time Filter false → скан
    -- пропускается целиком в частом случае). Безлимитный поиск ближайших по планете.
    select g.geonameid,
           ((g.lat - _lat)^2 + ((g.lng - _lng) * cos(radians(_lat)))^2) as d2
    from geo_gazetteer g
    where (select count(*) from box) < _lim
      and g.feature_code like 'PPL%'
      and g.feature_code not in ('PPLX','PPLH','PPLQ','PPLW','PPLCH')
    order by d2 asc
    limit _lim
  ),
  nearest as (
    select geonameid, d2 from (
      select geonameid, d2, 0 as tier from box
      union all
      select geonameid, d2, 1 as tier from wide
    ) u
    order by tier, d2 asc
    limit _lim
  )
  select n.geonameid,
         p.display, p.subtitle,
         g.country_code, g.population, g.feature_code, g.lat, g.lng,
         p.name_i18n
  from nearest n
  join geo_gazetteer g on g.geonameid = n.geonameid
  cross join lateral public.gaz_project(n.geonameid, _lang) p
  order by n.d2 asc;
$function$;

revoke all on function public.nearest_cities(double precision, double precision, integer, text) from public;
grant execute on function public.nearest_cities(double precision, double precision, integer, text) to anon, authenticated;
