-- TRIP-524 — ключ справочника становится ПОЛЕМ существующего резолва, а не
-- второй дверью.
--
-- ★ ЧТО ИСПРАВЛЯЕТСЯ. Миграция 20260908124528 завела `gaz_by_ids` — отдельный
-- клиентский вход в справочник «по ключу». Гард 2r справедливо покраснел: у
-- справочника уже ЕСТЬ клиентский вход для этой задачи — `search_gazetteer_batch`
-- («резолвни мне вот эти города»), и вопрос «искать по имени или взять по ключу»
-- это не другой ВИД ДОСТУПА, а другая ТОЧНОСТЬ ЗАПРОСА. Второй вход заставлял
-- вызывателя разбирать список на две дороги, сводить ответы картой и курсором и
-- поднимать цель гарда — три следствия из одной лишней двери.
--
-- КАК СЕЙЧАС. Элемент `items` дополнительно принимает `id`:
--   { q, q_en, cc, id? }
-- `id` есть и такой город в справочнике существует → строка берётся ПО КЛЮЧУ,
-- поиск не запускается вовсе. `id` нет или он выдуман → те же две ветки поиска,
-- что и раньше (локализованное имя → английский фолбэк, скоуп по стране).
-- Выравнивание по `ord` и кэп 50 записей не меняются, `expandBatchRows` на
-- фронте ничего про ключ не знает.
--
-- ⚠️ ПРОВЕРКА СУЩЕСТВОВАНИЯ КЛЮЧА ДЕЛАЕТСЯ В `inp`, А НЕ В ВЕТКАХ. Иначе
-- пришлось бы гейтить поиск условием «ключ не сработал», а это значит выполнить
-- поиск и выбросить результат: два вызова `search_gazetteer_core` на каждый
-- город (замер TRIP-491: поиск — самая дорогая часть справочника). Здесь ключ
-- один раз резолвится точечным обращением по первичному ключу, и дальше
-- `i.id is null` гейтит ветки поиска бесплатно.
--
-- ⚠️ `id` ПРИХОДИТ ИЗ jsonb ОТ КЛИЕНТА, поэтому каст живёт ВНУТРИ `case`, а не
-- рядом с проверкой в общем `where`: порядок вычисления условий `and` Postgres
-- не обещает (Expression Evaluation Rules), и `geonameid = (…)::bigint` он
-- вправе взять индексным условием ПЕРЕД регуляркой — тогда «Portland» в ключе
-- роняет резолв ВСЕГО батча ошибкой 22P02. `case` порядок гарантирует. Кэп в 18
-- цифр — та же защита с другого конца: 19+ цифр проходят `\d+`, но не влезают в
-- bigint (22003), и это опять упавший батч вместо честного «нет такого города».
--
-- Тело меняется через `create or replace`: сигнатура ТА ЖЕ, что у
-- 20260908124528 (`lim` там и появился), сносить и пересоздавать нечего.
create or replace function public.search_gazetteer_batch(items jsonb, lang text default 'en'::text, lim integer default 1)
 returns table(ord integer, geonameid bigint, display text, subtitle text, country_code text, population bigint, feature_code text, lat double precision, lng double precision, name_i18n jsonb)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  with inp as (
    select e.ord::int                                     as ord,
           coalesce(e.item->>'q', '')                     as q,
           coalesce(e.item->>'q_en', '')                  as q_en,
           upper(coalesce(e.item->>'cc', ''))             as cc,
           coalesce(nullif(e.item->>'lang', ''), lang)    as ilang,
           -- Ключ = СУЩЕСТВУЮЩИЙ geonameid либо NULL. Выдуманный ключ (как и
           -- мусор вместо числа) превращается здесь в NULL, и город честно
           -- уходит в поиск по имени.
           (select g.geonameid
              from public.geo_gazetteer g
             where g.geonameid = case when e.item->>'id' ~ '^\d{1,18}$'
                                      then (e.item->>'id')::bigint end) as id
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
      -- src -1 = ключ: точный город, ранжировать нечего. `rn` типизируем под
      -- `row_number()` соседних веток — иначе union не сойдётся по типу.
      select g.geonameid, p.display, p.subtitle, g.country_code,
             g.population, g.feature_code, g.lat, g.lng, p.name_i18n,
             -1 as src, 1::bigint as rn
      from public.geo_gazetteer g
      cross join lateral public.gaz_project(g.geonameid, i.ilang) p
      where g.geonameid = i.id
      union all
      -- src 0 = локализованное имя (язык юзера); src 1 = английское (фолбэк).
      -- core скоупим по стране города (i.cc): кандидаты только из неё.
      select sc.*, 0 as src, row_number() over () as rn
      from public.search_gazetteer_core(i.q, i.ilang, 10, i.cc) sc
      where i.id is null and i.q <> ''
      union all
      select sc.*, 1 as src, row_number() over () as rn
      from public.search_gazetteer_core(i.q_en, 'en', 10, i.cc) sc
      where i.id is null and i.q_en <> '' and i.q_en <> i.q
    ) r
    order by r.src, r.rn
    limit greatest(1, least(coalesce(lim, 1), 10))
  ) c;
$function$;

revoke all on function public.search_gazetteer_batch(jsonb, text, integer) from public, anon, authenticated;
grant execute on function public.search_gazetteer_batch(jsonb, text, integer) to anon, authenticated;

-- ddl-guard: allow-destructive — TRIP-524: сносится ровно один объект.
-- `gaz_by_ids` — несостоявшаяся вторая дверь: единственным её читателем был
-- `citiesByIds`, который этой же правкой удаляется с фронта; функция прожила в
-- dev несколько часов и в prod не уезжала.
drop function if exists public.gaz_by_ids(bigint[], text);
