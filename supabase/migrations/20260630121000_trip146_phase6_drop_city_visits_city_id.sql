-- TRIP-146 Phase 6 — drop the dead `city_visits.city_id` column.
--
-- v2 keys cities by `geonameid`; affiliate is late-bound by geonameid, not by
-- this FK. Stats dedup moved to geonameid too (trip-cities.js cityKey), so
-- nothing reads city_id anymore (verified: 0 frontend/edge readers; only ~2 rows
-- on dev ever had a value, filled by the now-removed coords trigger). There is no
-- FK constraint on the column; its index `city_visits_city_id_idx` drops with it.
--
-- NOTE: `external_city_id` is intentionally KEPT — it remains a last-resort
-- dedup fallback for legacy rows that still lack a geonameid.

drop index if exists public.city_visits_city_id_idx;
alter table public.city_visits drop column if exists city_id;
