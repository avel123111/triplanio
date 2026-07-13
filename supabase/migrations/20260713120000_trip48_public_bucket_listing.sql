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
--   2) share-cards + share-maps — DROP the buckets whole. They are dead: the
--      TRIP-193 Ф2 share flow renders the card in the browser as a local blob;
--      render-share-card returns only SVG and nothing writes to or reads these
--      buckets. This mirrors how trip-covers was cleaned up (20260626190000).
--
-- Guarded on storage schema presence (idempotent, matches existing storage
-- migrations). Physical blobs of the dropped buckets (a handful) become
-- inaccessible orphans once the bucket rows are gone — no security surface.
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    -- 1) avatars: remove bucket-wide listing (owner-scoped insert/update/delete stay).
    EXECUTE $p$ DROP POLICY IF EXISTS "avatars_select" ON storage.objects $p$;

    -- 2) share-cards / share-maps: drop every policy, then the leftover object rows
    --    (a bucket cannot be deleted while it still owns objects).
    EXECUTE $p$ DROP POLICY IF EXISTS "share_cards_select" ON storage.objects $p$;
    EXECUTE $p$ DROP POLICY IF EXISTS "share_maps_select" ON storage.objects $p$;
    EXECUTE $p$ DROP POLICY IF EXISTS "share_maps_insert" ON storage.objects $p$;
    EXECUTE $p$ DROP POLICY IF EXISTS "share_maps_delete" ON storage.objects $p$;

    DELETE FROM storage.objects WHERE bucket_id IN ('share-cards', 'share-maps');
  END IF;

  IF to_regclass('storage.buckets') IS NOT NULL THEN
    DELETE FROM storage.buckets WHERE id IN ('share-cards', 'share-maps');
  END IF;
END $$;
