-- TRIP-145 — search engine v2 for the GeoNames spike (THROWAWAY; Supabase dev only).
-- Replaces the naive `LIKE '%q%' OR q <% blob` predicate + strict lexicographic rank with:
--   * separator-normalized FTS (tsvector 'simple') with per-token PREFIX (:*) + AND
--   * region + country localized names folded INTO the search document (so "city country"
--     and admin qualifiers can match — AND semantics, not one big substring)
--   * blended ranking: match_boost(exact/prefix on the LOCALIZED display name) + log10(population)
--     so a metropolis is not buried under tiny exact-name matches (mexico -> Mexico City on top).
-- Pure SQL over data already loaded by 20260629120000 (no bulk reload). REMOVE with the spike.

alter table geo_gazetteer_test
  add column if not exists name_ru text,
  add column if not exists name_en text,
  add column if not exists name_es text,
  add column if not exists doc    tsvector;

-- localized city display names (1 per lang; geo_alt_names_test PK is (geonameid,isolanguage))
update geo_gazetteer_test g set
  name_ru = (select a.alternate_name from geo_alt_names_test a where a.geonameid = g.geonameid and a.isolanguage = 'ru'),
  name_en = (select a.alternate_name from geo_alt_names_test a where a.geonameid = g.geonameid and a.isolanguage = 'en'),
  name_es = (select a.alternate_name from geo_alt_names_test a where a.geonameid = g.geonameid and a.isolanguage = 'es');

-- precompute localized region/country names per code (session-temp; dropped at session end)
create temp table _reg as
  select r.code, string_agg(a.alternate_name, ' ') as names
  from geo_admin1_test r join geo_alt_names_test a on a.geonameid = r.geonameid
  group by r.code;
create temp table _cty as
  select c.code, string_agg(a.alternate_name, ' ') as names
  from geo_country_test c join geo_alt_names_test a on a.geonameid = c.geonameid
  group by c.code;

-- search document = city names (all scripts) + localized city/region/country names; separators -> space
update geo_gazetteer_test g set doc = to_tsvector('simple',
  regexp_replace(lower(unaccent(
    coalesce(g.search_blob,'') || ' ' ||
    coalesce(g.name_ru,'') || ' ' || coalesce(g.name_en,'') || ' ' || coalesce(g.name_es,'') || ' ' ||
    coalesce(g.admin1_name,'') || ' ' || coalesce(rg.names,'') || ' ' ||
    coalesce(g.country_code,'') || ' ' || coalesce(ct.names,'')
  )), '[^a-z0-9а-яё]+', ' ', 'g'))
from geo_gazetteer_test gg
  left join _reg rg on rg.code = gg.country_code || '.' || gg.admin1_code
  left join _cty ct on ct.code = gg.country_code
where gg.geonameid = g.geonameid;

create index if not exists gaz_doc on geo_gazetteer_test using gin (doc);

-- drop first: the return type gains country_code, and CREATE OR REPLACE cannot change
-- an existing function's result type (42P13).
drop function if exists public.search_gazetteer(text, text, int);
create or replace function public.search_gazetteer(q text, lang text default 'en', lim int default 10)
returns table (geonameid bigint, display text, subtitle text, country_code text,
               population bigint, feature_code text, lat double precision, lng double precision)
language sql stable security definer set search_path to 'public' as $$
  with nq as (
    select trim(regexp_replace(lower(unaccent(coalesce(q,''))), '[^a-z0-9а-яё]+', ' ', 'g')) as qn
  ),
  arr as (select qn, regexp_split_to_array(qn, ' ') as a from nq where qn <> ''),
  tsq as (
    select qn, a[1] as first_tok,
           to_tsquery('simple',
             nullif(array_to_string(array(select e || ':*' from unnest(a) e where e <> ''), ' & '), '')) as query
    from arr
  )
  select g.geonameid,
         coalesce(case lang when 'ru' then g.name_ru when 'es' then g.name_es else g.name_en end, g.name) as display,
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
             coalesce(case lang when 'ru' then g.name_ru when 'es' then g.name_es else g.name_en end, g.name))),
           '[^a-z0-9а-яё]+', ' ', 'g') as nm
  ) nn on true
  where tsq.query is not null
    and g.feature_code not in ('PPLX','PPLH','PPLQ','PPLW','PPLCH')
  -- blended score (weights tuned on dev: metropolis must beat tiny exact matches):
  --   1.0*exact(localized name) + 0.5*prefix(first token) + 1.2*log10(population)
  order by 1.0 * (case when nn.nm = tsq.qn then 1 else 0 end)
         + 0.5 * (case when nn.nm like tsq.first_tok || '%' then 1 else 0 end)
         + 1.2 * log((coalesce(g.population,0) + 1)::numeric) desc,
           g.population desc nulls last
  limit lim;
$$;

grant execute on function public.search_gazetteer(text, text, int) to anon;
