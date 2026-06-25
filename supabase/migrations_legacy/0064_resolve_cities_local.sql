-- 0064_resolve_cities_local
--
-- Name-keyed directory lookup for the AI city-resolve pipeline (cost cut for the
-- single free LocationIQ key). Given a batch of { name_en, country_code } items,
-- match each against the curated `cities` directory BEFORE any geocoder call:
-- a hit returns coords + ready partner ids (viator/gyg/iata), so geoLocationiq
-- skips LocationIQ entirely for known cities. Misses (null in the output) fall
-- through to LocationIQ in the edge function.
--
-- This is distinct from the existing coords→city path (resolve_city_id /
-- set_city_id trigger), which runs at city_visits INSERT to attach city_id by
-- coordinates. Here we match by NAME, before we have coordinates, to avoid the
-- upstream call in the first place.
--
-- Output is a jsonb array positionally aligned to the input array (null = miss).

create extension if not exists unaccent;

create or replace function public.resolve_cities_local(p_items jsonb)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with items as (
    select (ord - 1)::int                                    as idx,
           nullif(btrim(elem->>'name_en'), '')               as name_en,
           upper(nullif(btrim(elem->>'country_code'), ''))   as cc
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
         with ordinality as t(elem, ord)
  ),
  -- Best curated match per input position: prefer non-manual rows, then rows
  -- that already carry a viator id, then lowest id (stable).
  matched as (
    select distinct on (i.idx)
           i.idx,
           c.id, c.name_en, c.country_code, c.lat, c.lng,
           c.time_zone, c.iata_code, c.viator_dest_id, c.getyourguide_id
    from items i
    join cities c
      on i.name_en is not null
     and i.cc is not null
     and lower(unaccent(c.name_en)) = lower(unaccent(i.name_en))
     and upper(c.country_code) = i.cc
    order by i.idx,
             (c.source is distinct from 'manual') desc,
             (c.viator_dest_id is not null) desc,
             c.id
  )
  select coalesce(
    jsonb_agg(
      case when m.id is null then null else jsonb_build_object(
        'city_id',         m.id,
        'name_en',         m.name_en,
        'country_code',    m.country_code,
        'lat',             m.lat,
        'lng',             m.lng,
        'time_zone',       m.time_zone,
        'iata_code',       m.iata_code,
        'viator_dest_id',  m.viator_dest_id,
        'getyourguide_id', m.getyourguide_id
      ) end
      order by i.idx
    ),
    '[]'::jsonb
  )
  from items i
  left join matched m on m.idx = i.idx;
$$;

revoke all on function public.resolve_cities_local(jsonb) from public, anon;
grant execute on function public.resolve_cities_local(jsonb) to service_role;


-- learn_city: self-healing directory (#4). When geoLocationiq resolves a city
-- via LocationIQ that the directory did NOT have, promote it so the next lookup
-- by name hits resolve_cities_local and skips the upstream call. Idempotent:
-- if a row with the same normalized (name_en, country_code) already exists it is
-- returned untouched. Gated — name_en + country_code + finite coords required.
-- source='locationiq' keeps these distinct from the curated seed and the
-- coords-keyed 'manual' stubs created by set_city_id, so they can be audited or
-- backfilled (viator/gyg) separately.
create or replace function public.learn_city(
  p_name_en      text,
  p_country_code text,
  p_lat          double precision,
  p_lng          double precision
) returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id   bigint;
  v_name text := nullif(btrim(coalesce(p_name_en, '')), '');
  v_cc   text := upper(nullif(btrim(coalesce(p_country_code, '')), ''));
begin
  if v_name is null or v_cc is null or p_lat is null or p_lng is null then
    return null;
  end if;

  select id into v_id
  from cities
  where upper(country_code) = v_cc
    and lower(unaccent(name_en)) = lower(unaccent(v_name))
  limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into cities (name_en, country_code, lat, lng, source)
  values (v_name, v_cc, p_lat, p_lng, 'locationiq')
  returning id into v_id;
  return v_id;
exception when others then
  return null;
end;
$$;

revoke all on function public.learn_city(text, text, double precision, double precision) from public, anon;
grant execute on function public.learn_city(text, text, double precision, double precision) to service_role;
