-- TRIP-159: ЖЁСТКИЙ скоуп резолва по стране (надстройка над localized-first).
--
-- Идёт ПОВЕРХ уже смёрженной 20260716150000 (localized-first: batch шлёт q+q_en,
-- страна там была лишь пост-предпочтением). Здесь country_code становится ЖЁСТКИМ
-- условием ВНУТРИ резолва. Отдельный файл-таймстамп — НЕ правка применённой
-- миграции (db push её по тому же таймстампу не перекатит). Фронт (q_en+cc в
-- payload, src/lib/geo-cities.js) уже в dev через #492.
--
-- Два бага на prod, один корень — «сильный вход, слабый резолвер»:
--   1) Переславль-Залесский не находился: резолвили по АНГЛИЙСКОМУ имени от ИИ
--      (гадание модели, `Pereslavl-Zalessky` ≠ реальный alt-name
--      `Pereslavl'-Zalesskiy`), а строгий AND-по-токенам рушился на одном неверном
--      токене. Русское имя при этом резолвится всегда.
--   2) «Вик» (Vík í Mýrdal, Исландия, geonameid 2625252) резолвился в город США,
--      хотя ИИ прислал country_code=IS. `search_gazetteer_core` отдаёт топ-10 по
--      населению; исландский Вик (pop 750) сидит ниже окна под populous-тёзками,
--      которые лишь НАЧИНАЮТСЯ на «vik» (Виктория, Викторвилл…). Страна
--      применялась ПОСТфильтром поверх уже обрезанного окна → в топ-10 нет IS →
--      брался populous-тёзка из чужой страны (в т.ч. чужой аффилиат — правило 13).
--
-- Системный фикс (не заплатка на один город):
--   S-1. Резолвим по ДВУМ именам — локализованному (язык юзера) первым,
--        английскому фолбэком. Газеттир имеет native alt-names, поэтому имя на
--        языке юзера покрывает шире; en спасает мелкие иностранные без ru-altname.
--   Country-scope. `country_code` от ИИ — высокоточный сигнал. Прокидываем его
--        В САМ резолв как ЖЁСТКОЕ условие (`where country_code = cc`), а не
--        постфильтром. Тогда население/префикс конкурируют ТОЛЬКО внутри страны:
--        по «vik» в IS матчится ровно Vík í Mýrdal → он и выбирается. Умирает весь
--        класс «тёзка не в той стране», а не один Вик. Физически невозможно
--        отправить в чужую страну (строго безопаснее для аффилиата).
--        Внутри страны — точное совпадение имени вперёд населения (чтобы populous
--        префикс-тёзка внутри той же страны не хоронил точный матч).
--   Пусто под скоупом → ноль строк → город «не разрешён» (жёлтая подсветка в
--        планировщике, уже есть) — честнее, чем уверенно-неверный populous-тёзка.
--
-- Реализация: `search_gazetteer_core` получает 4-й параметр `cc` (default '' =
-- без скоупа). При cc='' поведение БАЙТ-В-БАЙТ прежнее (новое условие WHERE —
-- no-op, тир exact-first — константа) → typeahead/ручной поиск не затронуты,
-- ре-ранжирования денежного пути без страны НЕТ. Скоуп включается только на
-- ИИ-резолве, где страна известна. `cc` в payload шлёт buildResolvePayload
-- (src/lib/geo-cities.js) — фронт менять не нужно.
--
-- Гранты (security-tiers): core НЕ публичен (REVOKE FROM PUBLIC), публичны только
-- обёртки search_gazetteer / search_gazetteer_batch (CREATE OR REPLACE сохраняет
-- их PUBLIC:EXECUTE). Старую 3-арг сигнатуру core дропаем после переключения
-- обёрток на 4-арг (её зовут только эти две обёртки — проверено).

-- 1) core с country-scope + exact-first-в-скоупе (4-арг).
create or replace function public.search_gazetteer_core(q text, lang text default 'en'::text, lim integer default 10, cc text default ''::text)
 returns table(geonameid bigint, display text, subtitle text, country_code text, population bigint, feature_code text, lat double precision, lng double precision, name_i18n jsonb)
 language sql
 stable security definer
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

-- core не публичен (как и раньше) — новую функцию Postgres грантит PUBLIC по
-- умолчанию, поэтому явно отзываем; зовут её только secdef-обёртки ниже.
revoke all on function public.search_gazetteer_core(text, text, integer, text) from public;

-- 2) Публичная обёртка typeahead — репойнт на 4-арг core (cc='' = прежнее поведение).
create or replace function public.search_gazetteer(q text, lang text default 'en'::text, lim integer default 10)
 returns table(geonameid bigint, display text, subtitle text, country_code text, population bigint, feature_code text, lat double precision, lng double precision, name_i18n jsonb)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select * from public.search_gazetteer_core(q, lang, lim, '');
$function$;

-- 3) Батч-резолв: оба имени (localized src 0, english src 1), core скоупим по cc.
-- Контракт не меняется: одна лучшая строка на вход, ord 1:1, cap 50. Payload
-- обзавёлся ключом `q_en` (см. src/lib/geo-cities.js); без него = «только q».
-- Раз core уже жёстко скоупит по стране, пост-сортировка по стране не нужна —
-- достаточно «localized вперёд english, затем внутренний ранг core».
create or replace function public.search_gazetteer_batch(items jsonb, lang text default 'en'::text)
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
      -- src 0 = локализованное имя (язык юзера); src 1 = английское (фолбэк).
      -- core скоупим по стране города (i.cc): кандидаты только из неё.
      select sc.*, 0 as src, row_number() over () as rn
      from public.search_gazetteer_core(i.q, i.ilang, 10, i.cc) sc
      where i.q <> ''
      union all
      select sc.*, 1 as src, row_number() over () as rn
      from public.search_gazetteer_core(i.q_en, 'en', 10, i.cc) sc
      where i.q_en <> '' and i.q_en <> i.q
    ) r
    order by r.src, r.rn
    limit 1
  ) c;
$function$;

-- 4) Старая 3-арг сигнатура core больше не нужна (обёртки зовут 4-арг).
drop function if exists public.search_gazetteer_core(text, text, integer);
