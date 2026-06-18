-- Cleanup of the legacy IATA machinery, superseded by the cities dimension (0036).
--
-- iata_cities rows were copied into public.cities (source='iata-seed') and the
-- city_visits trigger now uses resolve_city_id/set_city_id. The old resolver,
-- old trigger function and the source table are no longer referenced.
--
-- KEPT on purpose: public.city_visits.iata_city_code — it is a derived mirror
-- (filled from cities.iata_code by set_city_id) and is still read by
-- src/components/bookings/buildBookingPlatforms.jsx for the Aviasales flight
-- deep-link. Do not drop it until that consumer reads iata from cities by city_id.

drop function if exists public.set_iata_city_code();
drop function if exists public.resolve_iata_city(text, text, double precision, double precision);
drop table if exists public.iata_cities;
