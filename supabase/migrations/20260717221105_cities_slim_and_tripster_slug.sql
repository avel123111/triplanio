-- TRIP-236 — Tripster provider in the cities affiliate directory (part 1: schema).
--
-- `cities` is a sparse affiliate directory keyed on `geonameid` (city geo/identity
-- comes from `geo_gazetteer` + the `city_visits.name_i18n` snapshot, NOT from here).
-- Two schema changes:
--   1. Drop columns that only duplicate the gazetteer and are read by nobody
--      (verified: no FE, edge function, RPC, view, trigger or FK references them).
--      Geo is sourced from geo_gazetteer; these were dead weight.
--   2. Add `tripster_slug` — the city's slug in the Tripster experiences directory
--      (experience.tripster.ru/experience/<slug>/), used by the fork "Tripster"
--      affiliate deep-link. Same flat-column pattern as viator_dest_id /
--      getyourguide_id. Seeded from the Tripster feed in a follow-up migration.
--
-- PK stays on `id` (nothing references cities.id); `geonameid` keeps its unique
-- index and remains the lookup key for provider hydration.

ALTER TABLE public.cities
  DROP COLUMN IF EXISTS country_code,
  DROP COLUMN IF EXISTS lat,
  DROP COLUMN IF EXISTS lng,
  DROP COLUMN IF EXISTS time_zone,
  DROP COLUMN IF EXISTS source;

ALTER TABLE public.cities
  ADD COLUMN IF NOT EXISTS tripster_slug text;

CREATE INDEX IF NOT EXISTS cities_tripster_idx
  ON public.cities (tripster_slug)
  WHERE tripster_slug IS NOT NULL;
