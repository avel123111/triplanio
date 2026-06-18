-- Central city dimension (cities) consolidating iata_cities + provider ids.
-- PHASE 1 (non-breaking, additive). See ТЗ VIATOR_CITIES_TZ_2026-06-18.
--
--  * public.cities: own surrogate id; name_en/country_code/lat/lng/time_zone;
--    iata_code + viator_dest_id + getyourguide_id (all nullable); source.
--  * seeded from the existing iata_cities reference rows (source='iata-seed').
--  * city_visits.city_id FK -> cities.
--  * resolve_city_id() is a COORDINATE-ONLY match (same country preferred, nearest
--    within R km). Name is intentionally NOT used for matching (Sevilla != Seville,
--    homonyms, languages).
--  * trigger sets city_id (lazily inserting a 'manual' city when nothing matches)
--    and keeps the legacy city_visits.iata_city_code MIRRORED from the resolved
--    city, so existing consumers (buildBookingPlatforms transfer / Aviasales link)
--    keep working unchanged. Also preserves the 0033 city_name_en backfill.
--
-- iata_cities, resolve_iata_city and the iata mirror column are removed later in a
-- separate cleanup migration, once all consumers read from cities by city_id.

-- 1) Dimension table -------------------------------------------------------------
create table if not exists public.cities (
  id              bigint generated always as identity primary key,
  name_en         text,
  country_code    text,
  lat             double precision,
  lng             double precision,
  time_zone       text,
  iata_code       text,            -- was iata_cities PK, now an attribute
  viator_dest_id  text,            -- filled by the Phase 2 Viator batch / lazy
  getyourguide_id text,            -- scaffold for future provider
  source          text,            -- 'iata-seed' | 'viator' | 'manual'
  updated_at      timestamptz not null default now()
);

create index if not exists cities_name_cc_idx on public.cities (lower(name_en), country_code);
create index if not exists cities_lat_idx on public.cities (lat);
create index if not exists cities_lng_idx on public.cities (lng);
create index if not exists cities_iata_idx on public.cities (iata_code) where iata_code is not null;
create index if not exists cities_viator_idx on public.cities (viator_dest_id) where viator_dest_id is not null;

alter table public.cities enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='cities' and policyname='cities_read') then
    create policy cities_read on public.cities for select using (true);
  end if;
end $$;

-- 2) Seed from the existing iata reference rows ----------------------------------
insert into public.cities (name_en, country_code, lat, lng, time_zone, iata_code, source)
select name_en, country_code, lat, lng, time_zone, code, 'iata-seed'
from public.iata_cities;

-- 3) city_visits.city_id ---------------------------------------------------------
alter table public.city_visits
  add column if not exists city_id bigint references public.cities(id);

create index if not exists city_visits_city_id_idx on public.city_visits (city_id);

-- 4) Coordinate-only resolver ----------------------------------------------------
-- Pure lookup (STABLE, no side effects). Nearest cities.id within R km, same country
-- preferred, else null. SECURITY DEFINER so triggers resolve regardless of caller RLS.
create or replace function public.resolve_city_id(
  p_country_code text,
  p_lat double precision,
  p_lng double precision
) returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id bigint;
  c_radius_km constant double precision := 30;
begin
  if p_lat is null or p_lng is null then
    return null;
  end if;

  select id into v_id
  from (
    select id,
      6371 * acos(least(1, greatest(-1,
        sin(radians(p_lat)) * sin(radians(lat)) +
        cos(radians(p_lat)) * cos(radians(lat)) * cos(radians(lng - p_lng))
      ))) as dist_km,
      (country_code = p_country_code) as same_country
    from cities
    where lat between p_lat - 0.5 and p_lat + 0.5
      and lng between p_lng - 0.5 and p_lng + 0.5
  ) q
  where dist_km <= c_radius_km
  order by same_country desc, dist_km
  limit 1;

  return v_id; -- may be null
end;
$$;

-- 5) Trigger: set city_id (lazy-create) + mirror iata_code + fill city_name_en ----
-- Never blocks the write: any failure leaves city_id / iata_city_code null.
create or replace function public.set_city_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_iata text;
  v_name_en text;
begin
  begin
    v_id := public.resolve_city_id(new.country_code, new.latitude, new.longitude);

    -- lazily register a canonical city when nothing matches (only with coords)
    if v_id is null and new.latitude is not null and new.longitude is not null then
      insert into public.cities (name_en, country_code, lat, lng, source)
      values (nullif(trim(coalesce(new.city_name_en, '')), ''), new.country_code,
              new.latitude, new.longitude, 'manual')
      returning id into v_id;
    end if;

    new.city_id := v_id;

    -- legacy mirror + en-name fill, derived from the resolved city
    if v_id is not null then
      select iata_code, name_en into v_iata, v_name_en from public.cities where id = v_id;
      new.iata_city_code := v_iata;
      if (new.city_name_en is null or length(trim(new.city_name_en)) = 0) and v_name_en is not null then
        new.city_name_en := v_name_en;
      end if;
    else
      new.iata_city_code := null;
    end if;
  exception when others then
    new.city_id := null;
    new.iata_city_code := null;
  end;
  return new;
end;
$$;

-- Replace the legacy iata trigger with the city_id trigger.
drop trigger if exists trg_city_visits_iata on public.city_visits;
drop trigger if exists trg_city_visits_city on public.city_visits;
create trigger trg_city_visits_city
before insert or update of latitude, longitude, city_name_en, country_code on public.city_visits
for each row execute function public.set_city_id();

-- 6) Backfill city_id for existing visits (match to seeded cities; unmatched stay
--    null until next edit / the Phase 2 Viator batch — their iata_city_code is
--    already set from the legacy trigger, so nothing regresses).
update public.city_visits v
set city_id = public.resolve_city_id(v.country_code, v.latitude, v.longitude)
where v.city_id is null;
