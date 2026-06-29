-- TRIP-145 — search v6: PERF fix for the GeoNames spike (THROWAWAY; Supabase dev only).
-- v5 regressed to ~1.6s/query: the RPC filtered with `(name_doc || blob_doc || area_doc) @@ q`.
-- Concatenating tsvectors at query time is NOT indexable -> Seq Scan over 234k rows.
-- Fix (no behaviour change):
--   * materialize all_doc = name_doc || blob_doc || area_doc as a stored, GIN-indexed column,
--     so the cross-field AND filter (`all token must match name OR blob OR area`) uses one index.
--   * the leading place token uses `(name_doc @@ q OR blob_doc @@ q)` — a BitmapOr of two GIN
--     indexes (single token, so OR is equivalent to the old concat). Verified: 2200ms -> ~17ms.
-- Ranking/semantics identical to v5 (historic names stay low priority via the name_doc boost).

set statement_timeout = '600s';

alter table geo_gazetteer_test add column if not exists all_doc tsvector;

-- concat of the already-built component vectors (no to_tsvector recompute)
update geo_gazetteer_test
  set all_doc = coalesce(name_doc, ''::tsvector) || coalesce(blob_doc, ''::tsvector) || coalesce(area_doc, ''::tsvector);

create index if not exists gaz_alldoc on geo_gazetteer_test using gin (all_doc);
drop index if exists gaz_areadoc;  -- area_doc is no longer queried on its own

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
    on (g.name_doc @@ t.q_name or g.blob_doc @@ t.q_name)   -- leading place token (indexed BitmapOr)
   and g.all_doc @@ t.q_all                                  -- every token in name/blob/area (indexed)
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
