-- TRIP-146 Phase 6 — drop the dead local directory resolver RPC.
--
-- City search/resolve now goes through `search_gazetteer` (GeoNames), and the
-- only caller of `resolve_cities_local` — the `resolveCities` batch action in the
-- geoLocationiq edge function — was removed in this same change. Nothing else
-- references it (verified: no other DB function, no n8n workflow node, no
-- frontend call). The curated `cities` table is no longer queried by name at
-- runtime; affiliate is late-bound by geonameid (TRIP-146 Phase 4).

drop function if exists public.resolve_cities_local(jsonb);
