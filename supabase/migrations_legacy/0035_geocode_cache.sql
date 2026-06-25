-- TRIP-145 (P1): Postgres cache for LocationIQ geocoding results.
--
-- Geocoding goes through the `geoLocationiq` edge function with a single server
-- key → one shared LocationIQ rate-limit across all users (Free ~2 req/s). Under
-- concurrency the limit is exhausted, LocationIQ returns 429 → edge returns 502 →
-- cities land unresolved (red, off the map). Cities are immutable, so caching
-- their geocode result removes ~90% of upstream traffic and is effectively
-- permanent (ODbL allows storage; the "Search by LocationIQ" attribution stays
-- in the UI). The edge reads this table before going upstream and writes it on a
-- successful 200; transient errors (429/502) are NOT written, so the cache can
-- never be poisoned by a rate-limit blip.
--
-- Key = action + normalized query + lang:
--   * search / autocomplete → query_key = lower(trim(collapsed whitespace))
--                             (autocomplete also folds its `tag` bias into the key)
--   * reverse               → query_key = "<lat.5>,<lon.5>" (~1 m, cities don't move)
-- `lang` is part of the key because display names come back localized per locale.
-- `results` stores the RAW LocationIQ array (pass-through); normalization into the
-- app's city shape stays client-side in src/lib/geo.js.
--
-- Access path: edge functions only, via the service-role client (bypasses RLS).
-- RLS is enabled with no policies so anon/authenticated roles get zero access.

CREATE TABLE IF NOT EXISTS public.geocode_cache (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action        text        NOT NULL,
  query_key     text        NOT NULL,
  lang          text        NOT NULL,
  results       jsonb       NOT NULL,
  hit_count     integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT geocode_cache_action_query_lang_key UNIQUE (action, query_key, lang)
);

-- The unique constraint already provides the lookup index used by the edge
-- (SELECT ... WHERE action = $1 AND query_key = $2 AND lang = $3).

ALTER TABLE public.geocode_cache ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only the service-role edge client touches this table.
