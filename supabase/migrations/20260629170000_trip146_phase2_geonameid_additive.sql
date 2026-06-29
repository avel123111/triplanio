-- TRIP-146 Phase 2 — Geocoding v2 (GeoNames): additive identity + hot-path
-- localized-name snapshot. PURELY ADDITIVE. The existing LocationIQ path,
-- city_id FK and resolve_city_id/set_city_id trigger keep working in parallel
-- until the Phase 6 cutover. No backfill here (Phase 5). Clean rollback: the new
-- columns are nullable and unread until Phase 4.

-- city_visits: visit-level GeoNames identity key + a hot-path display snapshot
-- baked at save time to the app UI locales (en/es/ru) as jsonb. This snapshot
-- exists so trip/stats rendering NEVER joins the large gazetteer/alt-names
-- tables (~234k + ~1.7M rows) per visit. Display = name_i18n[lang] ||
-- city_name_en || city_name. city_name / city_name_en are intentionally kept.
alter table public.city_visits
  add column if not exists geonameid bigint,
  add column if not exists name_i18n jsonb;

comment on column public.city_visits.geonameid is
  'GeoNames geonameid — v2 city identity key (TRIP-146). Nullable during transition; resolved on save (Phase 4) / backfilled (Phase 5).';
comment on column public.city_visits.name_i18n is
  'Hot-path localized city-name snapshot {en,es,ru} baked at save from the gazetteer (TRIP-146). Avoids joining gazetteer/alt-names on render.';

-- cities: future directory identity key. Stays NULLABLE / NON-UNIQUE during the
-- transition; becomes the UNIQUE key at the Phase 3 rebuild/swap.
alter table public.cities
  add column if not exists geonameid bigint;

comment on column public.cities.geonameid is
  'GeoNames geonameid — becomes the unique directory key at the Phase 3 rebuild/swap (TRIP-146).';
