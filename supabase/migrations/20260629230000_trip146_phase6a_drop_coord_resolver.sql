-- TRIP-146 Phase 6a — drop the dead coordinate-based city resolver.
--
-- v2 keys cities by geonameid; the city picker writes geonameid directly and
-- affiliate is late-bound by geonameid (viator.js / getTripDetails / tripPayload).
-- Nothing reads the coordinate-resolved city_id anymore, so the BEFORE-INSERT
-- trigger that filled it (and its helpers) are dead weight. Removing the trigger
-- just means new visits no longer get a coords-resolved city_id — which is fine,
-- city_id is unused (dropped together with external_city_id in the TRIP-65 pass).
--
-- Held for later (still referenced): resolve_cities_local + the geoLocationiq
-- resolveCities action (dead path, removed in a focused edge cleanup); columns
-- city_id / external_city_id (still read by trip-cities.js stats dedup → TRIP-65).

drop trigger if exists trg_city_visits_city on public.city_visits;
drop function if exists public.set_city_id();
drop function if exists public.resolve_city_id(text, double precision, double precision, text);
drop function if exists public.apply_viator_reassign(jsonb, jsonb);
