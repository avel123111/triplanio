-- TRIP-214 — resolveCities: устранить залп `search_gazetteer` без лимита
-- конкурентности.
--
-- Клиентский batch-резолв городов (AI-планнер `applyAiDraft`, цепочка пересадок
-- в EventEditDialog) раньше делал `Promise.all(items.map(rpc search_gazetteer))`
-- — N ОДНОВРЕМЕННЫХ PostgREST-вызовов тяжёлой SECURITY DEFINER-функции, по
-- одному на город, без батча/дедупа/лимита. На маршруте из 10-20 городов это
-- залп из 10-20 запросов в общий пул соединений (шумный сосед). Комментарии в
-- вызывающем коде утверждали про «ONE batch edge call с дедупом/кэшем» — тот
-- edge-слой выпилен в TRIP-146, и защита исчезла вместе с ним.
--
-- Системный фикс (не throttle): один серверный batch-резолвер = 1 round-trip,
-- 1 соединение из пула, 1 план запроса. Чтобы одиночный typeahead и batch не
-- разъехались по ранжированию, логика матчинга вынесена в ОДНО общее ядро
-- `search_gazetteer_core`; и одиночный `search_gazetteer`, и новый
-- `search_gazetteer_batch` — тонкие обёртки над ним (единый источник правды).

-- 1) Ядро поиска/ранжирования. Тело — байт-в-байт из текущего search_gazetteer
--    (миграция 20260630122000), только имя другое. INTERNAL: клиент его не зовёт
--    (IF3 ярусной модели TRIP-124) — вызывается лишь из обёрток ниже, которые
--    сами SECURITY DEFINER, поэтому исполняются под владельцем и EXECUTE на ядре
--    им гарантирован владением.
drop function if exists public.search_gazetteer_core(text, text, int);
create function public.search_gazetteer_core(q text, lang text default 'en', lim int default 10)
returns table (geonameid bigint, display text, subtitle text, country_code text,
               population bigint, feature_code text, lat double precision, lng double precision,
               name_i18n jsonb)
language sql stable security definer set search_path = public, pg_temp as $fn$
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
         coalesce((select an.alternate_name from geo_alt_names an
                    where an.geonameid = g.geonameid and an.isolanguage = lang
                    order by an.is_preferred desc nulls last limit 1), g.name) as display,
         nullif(concat_ws(', ',
           coalesce((select an.alternate_name from geo_admin1 r join geo_alt_names an on an.geonameid = r.geonameid
                      where r.code = g.country_code || '.' || g.admin1_code and an.isolanguage = lang
                      order by an.is_preferred desc nulls last limit 1), nullif(g.admin1_name,'')),
           coalesce((select an.alternate_name from geo_country c join geo_alt_names an on an.geonameid = c.geonameid
                      where c.code = g.country_code and an.isolanguage = lang
                      order by an.is_preferred desc nulls last limit 1), g.country_code)
         ), '') as subtitle,
         g.country_code, g.population, g.feature_code, g.lat, g.lng,
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
  where t.q_all is not null
    and g.feature_code not in ('PPLX','PPLH','PPLQ','PPLW','PPLCH')
  order by 3.0 * (case when g.name_doc @@ t.q_name then 1 else 0 end)
         + 1.0 * (case when nn.nm = t.qn or nn.nm = t.qn_lat then 1 else 0 end)
         + 0.5 * (case when nn.nm like t.first_tok||'%' or nn.nm like t.first_lat||'%' then 1 else 0 end)
         + 1.2 * log((coalesce(g.population,0) + 1)::numeric) desc,
           g.population desc nulls last
  limit lim;
$fn$;

-- Ядро — internal: снять дефолтный PUBLIC EXECUTE (грабля Postgres, IF3).
revoke all on function public.search_gazetteer_core(text, text, int) from public;

-- 2) Одиночный RPC (typeahead) — тонкая обёртка над ядром. CREATE OR REPLACE с
--    тем же контрактом сохраняет существующие гранты (anon-исполнимость
--    «публичного поиска» не трогаем — по решению Pavel).
create or replace function public.search_gazetteer(q text, lang text default 'en', lim integer default 10)
returns table (geonameid bigint, display text, subtitle text, country_code text,
               population bigint, feature_code text, lat double precision, lng double precision,
               name_i18n jsonb)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select * from public.search_gazetteer_core(q, lang, lim);
$fn$;

-- 3) Batch RPC — резолв МНОГИХ названий за ОДИН вызов. `items` = jsonb-массив
--    объектов `{ q, cc, lang }` (cc/lang опциональны). Порядок сохраняется через
--    WITH ORDINALITY; на каждый вход возвращается ЛУЧШИЙ единственный матч,
--    выровненный по `ord` (1-based). Семантика фильтра по стране идентична
--    прежнему клиенту: предпочесть матч по country_code, иначе — лучший общий.
--    Клэмп на 50 входов — чтобы патологический вывод AI не стал одним гигантским
--    запросом. Входы без q/без матча просто отсутствуют в выдаче (клиент
--    трактует пропущенный ord как пустой результат).
drop function if exists public.search_gazetteer_batch(jsonb, text);
create function public.search_gazetteer_batch(items jsonb, lang text default 'en')
returns table (ord int, geonameid bigint, display text, subtitle text, country_code text,
               population bigint, feature_code text, lat double precision, lng double precision,
               name_i18n jsonb)
language sql stable security definer set search_path = public, pg_temp as $fn$
  with inp as (
    select e.ord::int                                     as ord,
           coalesce(e.item->>'q', '')                     as q,
           upper(coalesce(e.item->>'cc', ''))             as cc,
           coalesce(nullif(e.item->>'lang', ''), lang)    as ilang
    from jsonb_array_elements(coalesce(items, '[]'::jsonb)) with ordinality as e(item, ord)
    where e.ord <= 50
  )
  select i.ord, c.geonameid, c.display, c.subtitle, c.country_code,
         c.population, c.feature_code, c.lat, c.lng, c.name_i18n
  from inp i
  cross join lateral (
    select r.geonameid, r.display, r.subtitle, r.country_code,
           r.population, r.feature_code, r.lat, r.lng, r.name_i18n
    from (
      select sc.*, row_number() over () as rn
      from public.search_gazetteer_core(i.q, i.ilang, 10) sc
    ) r
    where i.q <> ''
    order by (case when i.cc <> '' and r.country_code = i.cc then 0 else 1 end), r.rn
    limit 1
  ) c;
$fn$;

-- Batch — client-вызываемая (как одиночный поиск): тот же публичный read-only
-- поиск без per-user данных. Явные гранты обоим client-ролям (детерминированно,
-- независимо от дефолтного PUBLIC).
grant execute on function public.search_gazetteer_batch(jsonb, text) to anon, authenticated;
