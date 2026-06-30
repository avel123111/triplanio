-- TRIP-135: make `cities` a seed/ETL-only reference dimension — never written
-- from any runtime entry point.
--
-- Two runtime functions used to write `cities`, both during the trip planner flow,
-- and they were redundant:
--   • set_city_id (BEFORE INSERT/UPDATE trigger on city_visits, SECURITY INVOKER):
--       on a resolver miss it ran `INSERT INTO cities (... 'manual')` AS the calling
--       role. `cities` has RLS enabled with only a SELECT policy (no INSERT policy),
--       so that insert ALWAYS failed with "new row violates row-level security
--       policy for table cities" — which aborted the whole city_visits insert and
--       broke trip saving (and produced orphaned empty trips). It never inserted a
--       single row (0 rows with source='manual' on prod+dev).
--   • learn_city (SECURITY DEFINER), called fire-and-forget from the geoLocationiq
--       `resolveCities` edge action: it DID grow the directory (source='locationiq'),
--       but those rows carry no iata code and no viator_dest_id, so they enable no
--       activities and no partner links — they only handed a visit a stable city_id.
--
-- Decision (TRIP-135): the directory grows ONLY via curated seeds/ETL (iata-seed,
-- viator, getyourguide). Runtime flows must never write `cities`. So:
--   1. set_city_id becomes resolve-only: on a miss it leaves city_id as-is (NULL).
--      NULL city_id is already a supported, existing state (FK is nullable; readers
--      — Viator activity hydration — degrade gracefully to empty on a null city_id).
--   2. learn_city is dropped entirely (its only caller is removed in the same change
--      set, in supabase/functions/geoLocationiq/index.ts).
--
-- resolve_cities_local (directory-first READ) is untouched — it only reads.

-- 1. Resolve-only trigger: never INSERT into cities.
CREATE OR REPLACE FUNCTION set_city_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_city_id bigint;
BEGIN
  -- Resolve against the curated cities dimension (read-only). On a hit, attach the
  -- directory id; on a miss, leave city_id as whatever the caller set (typically
  -- NULL). We NEVER create a row in `cities` here — the directory is seed-only.
  v_city_id := resolve_city_id(
    new.country_code,
    new.latitude,
    new.longitude,
    new.city_name_en
  );

  IF v_city_id IS NOT NULL THEN
    new.city_id := v_city_id;
  END IF;

  RETURN new;
END;
$$;

-- 2. Remove the only runtime directory-writer. No callers remain after this change.
DROP FUNCTION IF EXISTS learn_city(text, text, double precision, double precision);
