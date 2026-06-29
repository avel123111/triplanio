-- TRIP-145 — search engine v4/v5 for the GeoNames spike (THROWAWAY; Supabase dev only).
-- Field-weighted, structured matching (aligned with Pelias/Nominatim practice):
--   * THREE documents per city instead of one flat `doc`:
--       name_doc = the city's CURRENT names (name + asciiname + dictionary names) — HIGH priority.
--       blob_doc = the flat search_blob (current + HISTORIC/obscure names, e.g. Taldykorgan
--                  carries "Gavrilovka") — kept for findability but LOW priority.
--       area_doc = region + country names (the admin qualifiers).
--   * Structured match: the LEADING place token must hit name_doc OR blob_doc (so historic
--     names still find the place); every token (place + trailing qualifiers like "сша"/
--     "франция") must hit name_doc / blob_doc / area_doc. A region-only token does NOT
--     surface the region's cities ("мехико" stops dragging in New Mexico — region lives only
--     in area_doc, and the place token is required in name/blob, not area).
--   * Ranking: +3.0 when the CURRENT name (name_doc) matches the leading token, so a match
--     via a historic name (blob_doc only, e.g. Taldykorgan for "гаврилов") is kept but ranked
--     well below real "Gavrilov*" cities; then +1.0 exact / +0.5 prefix / +1.2*log10(pop).
-- Pure SQL over existing data. After the all-language reload adds is_historic, you can also
-- split historic out of blob_doc for an even cleaner low-priority tier.

set statement_timeout = '600s';

create extension if not exists pg_trgm with schema public;
create extension if not exists unaccent with schema public;

alter table geo_gazetteer_test
  add column if not exists name_doc tsvector,
  add column if not exists area_doc tsvector,
  add column if not exists blob_doc tsvector;

-- per-city dictionary names. After the all-language reload adds is_historic, change to
--   ... from geo_alt_names_test where not coalesce(is_historic,false) ...
-- Single-session db push (prod applies ALL migrations in one session): clear any
-- temp tables left over from a prior search migration, else CREATE TEMP collides.
drop table if exists _reg, _cty, _cityalt, _cityname;
create temp table _cityname as
  select geonameid, string_agg(alternate_name, ' ') as names from geo_alt_names_test group by geonameid;
create temp table _reg as
  select r.code, string_agg(a.alternate_name, ' ') as names
  from geo_admin1_test r join geo_alt_names_test a on a.geonameid = r.geonameid group by r.code;
create temp table _cty as
  select c.code, string_agg(a.alternate_name, ' ') as names
  from geo_country_test c join geo_alt_names_test a on a.geonameid = c.geonameid group by c.code;

update geo_gazetteer_test g set
  name_doc = to_tsvector('simple', regexp_replace(lower(unaccent(
    coalesce(g.name,'') || ' ' || coalesce(g.asciiname,'') || ' ' || coalesce(cn.names,'')
  )), '[^a-z0-9а-яё]+', ' ', 'g')),
  blob_doc = to_tsvector('simple', regexp_replace(lower(unaccent(coalesce(g.search_blob,''))), '[^a-z0-9а-яё]+', ' ', 'g')),
  area_doc = to_tsvector('simple', regexp_replace(lower(unaccent(
    coalesce(g.admin1_name,'') || ' ' || coalesce(rg.names,'') || ' ' ||
    coalesce(g.country_code,'') || ' ' || coalesce(ct.names,'')
  )), '[^a-z0-9а-яё]+', ' ', 'g'))
from geo_gazetteer_test gg
  left join _cityname cn on cn.geonameid = gg.geonameid
  left join _reg rg on rg.code = gg.country_code || '.' || gg.admin1_code
  left join _cty ct on ct.code = gg.country_code
where gg.geonameid = g.geonameid;

create index if not exists gaz_namedoc on geo_gazetteer_test using gin (name_doc);
create index if not exists gaz_areadoc on geo_gazetteer_test using gin (area_doc);
create index if not exists gaz_blobdoc on geo_gazetteer_test using gin (blob_doc);

drop function if exists public.search_gazetteer(text, text, int);
create function public.search_gazetteer(q text, lang text default 'en', lim int default 10)
returns table (geonameid bigint, display text, subtitle text, country_code text,
               population bigint, feature_code text, lat double precision, lng double precision)
language sql stable security definer set search_path to 'public' as $$
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
         coalesce((select an.alternate_name from geo_alt_names_test an
                    where an.geonameid = g.geonameid and an.isolanguage = lang
                    order by an.is_preferred desc nulls last limit 1), g.name) as display,
         nullif(concat_ws(', ',
           coalesce((select an.alternate_name from geo_admin1_test r join geo_alt_names_test an on an.geonameid = r.geonameid
                      where r.code = g.country_code || '.' || g.admin1_code and an.isolanguage = lang
                      order by an.is_preferred desc nulls last limit 1), nullif(g.admin1_name,'')),
           coalesce((select an.alternate_name from geo_country_test c join geo_alt_names_test an on an.geonameid = c.geonameid
                      where c.code = g.country_code and an.isolanguage = lang
                      order by an.is_preferred desc nulls last limit 1), g.country_code)
         ), '') as subtitle,
         g.country_code, g.population, g.feature_code, g.lat, g.lng
  from t
  join geo_gazetteer_test g
    on (g.name_doc || g.blob_doc) @@ t.q_name
   and (g.name_doc || g.blob_doc || g.area_doc) @@ t.q_all
  left join lateral (
    select regexp_replace(lower(unaccent(
             coalesce((select an.alternate_name from geo_alt_names_test an
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
$$;

grant execute on function public.search_gazetteer(text, text, int) to anon;

-- old single doc no longer used by the RPC
drop index if exists gaz_doc;
alter table geo_gazetteer_test drop column if exists doc;
