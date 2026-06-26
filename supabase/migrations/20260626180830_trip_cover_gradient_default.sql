-- TRIP-107: every trip always carries a built-in cover gradient.
--
-- Previously `trips.cover_gradient` had no default and was left NULL by the
-- create_trip RPC and by copyTrip, so the UI fell back to ad-hoc/procedural
-- gradients (legacy code, now removed). Make the column default to the built-in
-- 'gradient_1' and backfill existing NULLs so the fallback is dead everywhere.
-- A photo (`cover_image_url`), when present, still renders on top at view time.

ALTER TABLE public.trips
  ALTER COLUMN cover_gradient SET DEFAULT 'gradient_1';

UPDATE public.trips
  SET cover_gradient = 'gradient_1'
  WHERE cover_gradient IS NULL;
