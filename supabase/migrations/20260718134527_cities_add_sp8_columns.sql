-- TRIP-236 (part 3) — Sputnik8 provider columns in the cities affiliate directory.
--
-- `cities` is a sparse affiliate directory keyed on `geonameid` (city geo/identity
-- comes from `geo_gazetteer` + the `city_visits.name_i18n` snapshot, NOT from here).
-- Sputnik8 is already an activity partner in the fork panel (buildBookingPlatforms),
-- but its deep-link is built from name_en, which does not match the partner's own
-- city slug — so most links 404 to the homepage. This adds the two flat columns
-- needed to deep-link correctly, mirroring viator_dest_id / getyourguide_id and the
-- tripster_slug / tripster_id pair.
--
--   sp8_id   — the city's numeric id in Sputnik8 (feed field sp8_city_id).
--   sp8_slug — the city's URL slug (sputnik8.com/ru/<slug>).
--
-- Feed source: n8n webhook GET /webhook/sp8_cities (1000 cities, no auth).
-- This migration is SCHEMA ONLY. Enrichment is a follow-up: an offline resolver
-- maps sp8 rows → geonameid and UPDATEs existing cities rows only (no new rows are
-- inserted — sp8 cities absent from cities are skipped), gated on a manual audit.

ALTER TABLE public.cities
  ADD COLUMN IF NOT EXISTS sp8_id   text,
  ADD COLUMN IF NOT EXISTS sp8_slug text;

-- Bound the new text columns (TRIP-169 caps policy). Sputnik8 slugs are short path
-- segments (≤26 chars in the feed); the id is a short numeric string.
ALTER TABLE public.cities
  ADD CONSTRAINT cities_sp8_slug_len CHECK (sp8_slug IS NULL OR char_length(sp8_slug) <= 128),
  ADD CONSTRAINT cities_sp8_id_len   CHECK (sp8_id   IS NULL OR char_length(sp8_id)   <= 32);

CREATE INDEX IF NOT EXISTS cities_sp8_idx
  ON public.cities (sp8_slug)
  WHERE sp8_slug IS NOT NULL;
