-- TRIP-48: kill anonymous listing of public storage buckets.
--
-- A public bucket serves objects by direct URL through /object/public/ which
-- BYPASSES RLS; the SELECT policy on storage.objects only governs `.list()` and
-- the authenticated endpoint. So a public "download-by-URL" bucket needs no
-- SELECT policy at all — a bucket-wide `SELECT TO public` just hands anons a full
-- listing of every object (user_id / trip_id paths, counts, timestamps).
--
-- Two fixes here:
--   1) avatars — drop the bucket-wide SELECT policy. The FE now writes a single
--      deterministic key `<uid>/avatar` (no extension), so nothing lists the
--      bucket anymore: upload is owner-scoped INSERT/UPDATE, display is the public
--      URL (bypasses RLS), account deletion sweeps via service role.
--   2) share-cards + share-maps — dead buckets (TRIP-193 Ф2 renders the card in
--      the browser as a local blob; render-share-card returns only SVG and nothing
--      writes to or reads these buckets). We cannot DROP them from SQL: the
--      platform trigger storage.protect_delete (protect_objects_delete /
--      protect_buckets_delete) forbids DELETE on storage.objects/buckets — that
--      path is Storage-API only. So neutralise them instead: drop every policy and
--      flip `public` -> false. With no SELECT policy and public=false nothing is
--      served or listable; their leftover objects (a few dozen orphans from the
--      cancelled Ф1) become unreachable. A physical Storage-API teardown of the
--      objects + bucket rows is a separate hygiene job, not a security dependency.
--
-- Guarded on storage schema presence (idempotent, matches existing storage
-- migrations). UPDATE on storage.buckets is allowed (only the name-length trigger
-- fires on UPDATE, and the name is unchanged); only DELETE is blocked.
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    -- 1) avatars: remove bucket-wide listing (owner-scoped insert/update/delete stay).
    EXECUTE $p$ DROP POLICY IF EXISTS "avatars_select" ON storage.objects $p$;

    -- 2) share-cards / share-maps: drop every policy (no listing, no writes).
    EXECUTE $p$ DROP POLICY IF EXISTS "share_cards_select" ON storage.objects $p$;
    EXECUTE $p$ DROP POLICY IF EXISTS "share_maps_select" ON storage.objects $p$;
    EXECUTE $p$ DROP POLICY IF EXISTS "share_maps_insert" ON storage.objects $p$;
    EXECUTE $p$ DROP POLICY IF EXISTS "share_maps_delete" ON storage.objects $p$;
  END IF;

  IF to_regclass('storage.buckets') IS NOT NULL THEN
    -- Cannot DELETE the dead buckets (protect_delete). Make them private so they
    -- serve/list nothing; leftover objects become unreachable orphans.
    UPDATE storage.buckets SET public = false WHERE id IN ('share-cards', 'share-maps');
  END IF;
END $$;
