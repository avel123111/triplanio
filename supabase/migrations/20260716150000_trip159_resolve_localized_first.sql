-- TRIP-159: AI-город резолвится по ЛОКАЛИЗОВАННОМУ имени в первую очередь,
-- английское — только фолбэк.
--
-- Проблема (prod): `search_gazetteer_batch` резолвил города по английскому имени
-- (`name_en`) от ИИ. Но газеттир (GeoNames cities500) хранит канонические
-- alt-names на всех языках, а AI-английское имя — это ГАДАНИЕ модели
-- («Pereslavl-Zalessky» вместо реального «Pereslavl'-Zalesskiy»). FTS в
-- search_gazetteer_core требует совпадения ВСЕХ токенов как префиксов, поэтому
-- один неверный токен (`zalessky` не префикс `zalesskiy`) рушит весь матч —
-- «Переславль-Залесский» не находился, хотя в базе он есть (geonameid 511359).
--
-- Фикс: на каждый город пробуем ДВА запроса — по локализованному имени юзера
-- (`q`, в его языке) и по английскому (`q_en`, в 'en') — и берём лучший,
-- предпочитая совпадение по стране, а внутри — локализованный источник (src 0).
-- Русские города надёжно резолвятся по ru-имени; мелкие иностранные (Хальштатт),
-- у которых нет ru-alt-name, — по английскому фолбэку. Контракт не меняется:
-- одна лучшая строка на вход, выравнивание по 1-based `ord`, cap 50, тот же
-- RETURNS TABLE. Payload обзавёлся ключом `q_en` (см. src/lib/geo-cities.js);
-- старые вызовы без `q_en` работают как «только локализованный запрос».
--
-- CREATE OR REPLACE сохраняет существующие гранты (revoke anon/authenticated,
-- TRIP-214) — сигнатура (jsonb, text) не меняется.

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
      -- `row_number() over ()` намеренно без ORDER BY — фиксирует СОБСТВЕННЫЙ
      -- ранг search_gazetteer_core (он уже order by ... limit 10) как тай-брейкер;
      -- не «чинить» в over (order by ...) — это молча изменит выбор города.
      select sc.*, 0 as src, row_number() over () as rn
      from public.search_gazetteer_core(i.q, i.ilang, 10) sc
      where i.q <> ''
      union all
      select sc.*, 1 as src, row_number() over () as rn
      from public.search_gazetteer_core(i.q_en, 'en', 10) sc
      where i.q_en <> '' and i.q_en <> i.q
    ) r
    -- сперва совпадение по стране (если задана), затем локализованный источник,
    -- затем внутренний ранг search_gazetteer_core.
    order by (case when i.cc <> '' and r.country_code = i.cc then 0 else 1 end),
             r.src, r.rn
    limit 1
  ) c;
$function$;
