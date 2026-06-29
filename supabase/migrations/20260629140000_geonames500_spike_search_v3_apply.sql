-- TRIP-145 — search engine v3 for the GeoNames spike (THROWAWAY; Supabase dev only).
-- RE-APPLY under a fresh timestamp: 20260629130000 carries this same v3 SQL but was already
-- recorded in the journal (failed mid-way under an earlier deploy yet got journaled), so db
-- push skips it by version. This identical, idempotent copy runs as a NEW version to land v3.
-- Supersedes the earlier "v2 with per-language columns" attempt (that design was wrong:
-- localized names belong in the all-language dictionary geo_alt_names_test, NOT as fixed
-- name_ru/name_en/name_es columns — adding a language must not require a schema change).
--
-- Engine:
--   * separator-normalized FTS (tsvector 'simple') with per-token PREFIX (:*) + AND
--   * each token is matched as itself OR its ru->lat transliteration, so a Cyrillic query
--     finds latin-only cities (тиас -> tias -> Tías) — fixes the тиас=0 / tias=Tías gap
--   * region + country localized names folded into the search document (qualifiers match)
--   * blended ranking: 1.0*exact + 0.5*prefix (on the localized name OR its translit) + 1.2*log10(pop)
--   * display / subtitle / ranking name all come from geo_alt_names_test by (geonameid, lang)
--     — works for ANY language the dictionary holds; no per-language columns.
--
-- DATA NOTE: geo_alt_names_test is meant to hold ALL languages (loaded out-of-git from the
-- GeoNames alternateNamesV2 dump). The `doc` build below reads whatever languages are present;
-- re-run the "build doc" UPDATE after (re)loading the dictionary. Pure SQL, no bulk data here.

set statement_timeout = '600s';  -- doc rebuild over 234k rows

create extension if not exists pg_trgm with schema public;
create extension if not exists unaccent with schema public;

-- clean up the abandoned per-language columns if a prior attempt added them
alter table geo_gazetteer_test
  drop column if exists name_ru,
  drop column if exists name_en,
  drop column if exists name_es,
  add  column if not exists doc tsvector;

-- the dictionary must hold MANY names per (geonameid, language) once ALL languages are
-- loaded, so drop the single-name (geonameid,isolanguage) PK and keep a plain index.
alter table geo_alt_names_test drop constraint if exists geo_alt_names_test_pkey;
create index if not exists gan_geo_lang on geo_alt_names_test (geonameid, isolanguage);

-- ru -> lat transliteration (digraphs first, then 1:1; ь dropped). Approximate, good for matching.
create or replace function public.translit_ru_lat(s text) returns text
language sql immutable set search_path to 'public' as $fn$
  select translate(
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
      lower(coalesce(s,'')),
      'щ','shch'),'ж','zh'),'ч','ch'),'ш','sh'),'ю','yu'),'я','ya'),
      'х','kh'),'ц','ts'),'ё','yo'),'й','y'),'э','e'),'ъ',''),
    'абвгдезиклмнопрстуфыь','abvgdeziklmnoprstufy');
$fn$;

-- localized region/country names per code (all languages present in the dictionary)
create temp table _reg as
  select r.code, string_agg(a.alternate_name, ' ') as names
  from geo_admin1_test r join geo_alt_names_test a on a.geonameid = r.geonameid group by r.code;
create temp table _cty as
  select c.code, string_agg(a.alternate_name, ' ') as names
  from geo_country_test c join geo_alt_names_test a on a.geonameid = c.geonameid group by c.code;
create temp table _cityalt as
  select a.geonameid, string_agg(a.alternate_name, ' ') as names from geo_alt_names_test a group by a.geonameid;

-- build the search document (latin+cyrillic tokens; CJK/arabic dropped — UI is ru/en/es).
-- RE-RUN this UPDATE after (re)loading geo_alt_names_test with more languages.
update geo_gazetteer_test g set doc = to_tsvector('simple',
  regexp_replace(lower(unaccent(
    coalesce(g.search_blob,'') || ' ' ||
    coalesce(ca.names, '') || ' ' ||
    coalesce(g.admin1_name,'') || ' ' || coalesce(rg.names,'') || ' ' ||
    coalesce(g.country_code,'') || ' ' || coalesce(ct.names,'')
  )), '[^a-z0-9а-яё]+', ' ', 'g'))
from geo_gazetteer_test gg
  left join _cityalt ca on ca.geonameid = gg.geonameid
  left join _reg rg on rg.code = gg.country_code || '.' || gg.admin1_code
  left join _cty ct on ct.code = gg.country_code
where gg.geonameid = g.geonameid;

create index if not exists gaz_doc on geo_gazetteer_test using gin (doc);

drop function if exists public.search_gazetteer(text, text, int);
create function public.search_gazetteer(q text, lang text default 'en', lim int default 10)
returns table (geonameid bigint, display text, subtitle text, country_code text,
               population bigint, feature_code text, lat double precision, lng double precision)
language sql stable security definer set search_path to 'public' as $$
  with nq as (
    select trim(regexp_replace(lower(unaccent(coalesce(q,''))), '[^a-z0-9а-яё]+', ' ', 'g')) as qn
  ),
  arr as (select qn, regexp_split_to_array(qn, ' ') as a from nq where qn <> ''),
  tsq as (
    select qn,
           public.translit_ru_lat(qn)      as qn_lat,
           a[1]                              as first_tok,
           public.translit_ru_lat(a[1])     as first_lat,
           to_tsquery('simple', nullif(array_to_string(array(
             select '(' || e || ':* | ' || public.translit_ru_lat(e) || ':*)'
             from unnest(a) e where e <> ''
           ), ' & '), '')) as query
    from arr
  )
  select g.geonameid,
         coalesce((select a.alternate_name from geo_alt_names_test a
                    where a.geonameid = g.geonameid and a.isolanguage = lang
                    order by a.is_preferred desc nulls last limit 1), g.name) as display,
         nullif(concat_ws(', ',
           coalesce((select a.alternate_name from geo_admin1_test r join geo_alt_names_test a on a.geonameid = r.geonameid
                      where r.code = g.country_code || '.' || g.admin1_code and a.isolanguage = lang
                      order by a.is_preferred desc nulls last limit 1), nullif(g.admin1_name,'')),
           coalesce((select a.alternate_name from geo_country_test c join geo_alt_names_test a on a.geonameid = c.geonameid
                      where c.code = g.country_code and a.isolanguage = lang
                      order by a.is_preferred desc nulls last limit 1), g.country_code)
         ), '') as subtitle,
         g.country_code, g.population, g.feature_code, g.lat, g.lng
  from tsq
  join geo_gazetteer_test g on g.doc @@ tsq.query
  left join lateral (
    select regexp_replace(lower(unaccent(
             coalesce((select a.alternate_name from geo_alt_names_test a
                        where a.geonameid = g.geonameid and a.isolanguage = lang
                        order by a.is_preferred desc nulls last limit 1), g.name))),
           '[^a-z0-9а-яё]+', ' ', 'g') as nm
  ) nn on true
  where tsq.query is not null
    and g.feature_code not in ('PPLX','PPLH','PPLQ','PPLW','PPLCH')
  order by 1.0 * (case when nn.nm =    tsq.qn or nn.nm =    tsq.qn_lat              then 1 else 0 end)
         + 0.5 * (case when nn.nm like tsq.first_tok||'%' or nn.nm like tsq.first_lat||'%' then 1 else 0 end)
         + 1.2 * log((coalesce(g.population,0) + 1)::numeric) desc,
           g.population desc nulls last
  limit lim;
$$;

grant execute on function public.search_gazetteer(text, text, int) to anon;
