-- TRIP-146 Phase 6 — adopt the GeoNames gazetteer tables as permanent.
--
-- The spike (TRIP-145) built them with a `_test` suffix; they are now the live
-- data behind `search_gazetteer` (prod city search depends on them). Drop the
-- throwaway suffix and re-point the RPC at the canonical names. Indexes/columns
-- ride along with the rename; only `search_gazetteer` referenced the old names
-- (verified — no other function or view does), so it is recreated here in the
-- same migration, after the renames, to stay valid.

alter table if exists public.geo_gazetteer_test rename to geo_gazetteer;
alter table if exists public.geo_alt_names_test rename to geo_alt_names;
alter table if exists public.geo_admin1_test   rename to geo_admin1;
alter table if exists public.geo_country_test  rename to geo_country;

create or replace function public.search_gazetteer(q text, lang text default 'en', lim integer default 10)
 returns table(geonameid bigint, display text, subtitle text, country_code text, population bigint, feature_code text, lat double precision, lng double precision, name_i18n jsonb)
 language sql
 stable security definer
 set search_path to 'public'
as $fn$
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
         -- Hot-path snapshot: city name in the app UI locales. Each falls back to
         -- the canonical GeoNames name when that locale has no alt-name.
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
