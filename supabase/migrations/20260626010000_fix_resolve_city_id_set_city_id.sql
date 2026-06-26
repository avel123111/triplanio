-- TRIP-98: Fix geocoding bugs in resolve_city_id + set_city_id
--
-- Problems fixed:
--   1. resolve_city_id: `ORDER BY (country_code = p_country_code) DESC` evaluates
--      to NULL for viator cities (country_code IS NULL), and Postgres orders NULLs
--      FIRST by default — so viator cities beat exact country matches.
--      Fix: add optional p_name_en tiebreaker + NULLS LAST + exclude nameless manual rows.
--   2. set_city_id trigger: did not pass city_name_en to the resolver (tiebreaker
--      always NULL), and would create "ghost" manual cities for unnamed inserts.
--
-- Applied directly to both prod+dev via Management API 2026-06-26 (TRIP-98).

-- Drop old version (signature may differ)
DROP FUNCTION IF EXISTS resolve_city_id(text, float8, float8);
DROP FUNCTION IF EXISTS resolve_city_id(text, float8, float8, text);

CREATE OR REPLACE FUNCTION resolve_city_id(
  p_country_code text,
  p_lat          float8,
  p_lng          float8,
  p_name_en      text DEFAULT NULL   -- optional tiebreaker: prefer city with matching name
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_id bigint;
BEGIN
  SELECT id INTO v_id
  FROM cities
  WHERE
    -- Exclude nameless manual ghost rows (source='manual', name_en IS NULL)
    NOT (source = 'manual' AND name_en IS NULL)
    -- 30 km bounding box (fast index scan)
    AND ABS(lat - p_lat) < 0.3
    AND ABS(lng - p_lng) < 0.3
    -- Exact 30 km distance
    AND 6371 * 2 * asin(sqrt(
          power(sin(radians((lat - p_lat) / 2)), 2) +
          cos(radians(p_lat)) * cos(radians(lat)) *
          power(sin(radians((lng - p_lng) / 2)), 2)
        )) < 30
  ORDER BY
    -- 1) Exact name match (if caller passes p_name_en)
    (p_name_en IS NOT NULL AND lower(name_en) = lower(p_name_en)) DESC,
    -- 2) Same country — NULLS LAST so missing country_code never beats a real match
    (country_code = p_country_code) DESC NULLS LAST,
    -- 3) Nearest first
    6371 * 2 * asin(sqrt(
      power(sin(radians((lat - p_lat) / 2)), 2) +
      cos(radians(p_lat)) * cos(radians(lat)) *
      power(sin(radians((lng - p_lng) / 2)), 2)
    ))
  LIMIT 1;

  RETURN v_id;
END;
$$;


-- Fix set_city_id trigger: pass city_name_en as tiebreaker, skip ghost creation
-- for nameless inserts.
CREATE OR REPLACE FUNCTION set_city_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_city_id bigint;
BEGIN
  -- Resolve against the cities dimension using the new 4-arg signature
  v_city_id := resolve_city_id(
    new.country_code,
    new.latitude,
    new.longitude,
    new.city_name_en
  );

  IF v_city_id IS NOT NULL THEN
    new.city_id := v_city_id;
  ELSE
    -- Only create a manual ghost city when the insert has a non-null name
    -- (prevents nameless ghost rows that pollute the resolver).
    IF new.city_name_en IS NOT NULL THEN
      INSERT INTO cities (name_en, country_code, lat, lng, source)
      VALUES (new.city_name_en, new.country_code, new.latitude, new.longitude, 'manual')
      RETURNING id INTO v_city_id;
      new.city_id := v_city_id;
    END IF;
    -- If city_name_en is also NULL: leave city_id as whatever caller set (or NULL).
  END IF;

  RETURN new;
END;
$$;
