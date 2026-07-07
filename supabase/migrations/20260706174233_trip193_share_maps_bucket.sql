-- TRIP-193: transient bucket for client-captured map snapshots.
--
-- The share card's map is captured from the live Mapbox GL map in the browser
-- (user-chosen angle, Standard style, real route) and uploaded here at
-- share-maps/{trip_id}/{uuid}.png. The render-share-card edge function downloads
-- it, composites the card, then DELETES it (single-use). Private bucket; the file
-- is a plain map image but there's no reason to expose it publicly.
--
-- RLS mirrors the `trips` bucket: any authenticated user may write/read/delete
-- (the function validates the path is under the caller's trip; objects are
-- short-lived and swept after render). Guarded on storage schema presence.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage.buckets not present - skipping share-maps bucket';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('share-maps', 'share-maps', false, 8388608, ARRAY['image/png'])
  ON CONFLICT (id) DO UPDATE
    SET public = EXCLUDED.public,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE $p$ DROP POLICY IF EXISTS "share_maps_insert" ON storage.objects $p$;
    EXECUTE $p$ CREATE POLICY "share_maps_insert" ON storage.objects
      FOR INSERT TO public WITH CHECK ((bucket_id = 'share-maps'::text) AND (auth.uid() IS NOT NULL)) $p$;
    EXECUTE $p$ DROP POLICY IF EXISTS "share_maps_select" ON storage.objects $p$;
    EXECUTE $p$ CREATE POLICY "share_maps_select" ON storage.objects
      FOR SELECT TO public USING ((bucket_id = 'share-maps'::text) AND (auth.uid() IS NOT NULL)) $p$;
    EXECUTE $p$ DROP POLICY IF EXISTS "share_maps_delete" ON storage.objects $p$;
    EXECUTE $p$ CREATE POLICY "share_maps_delete" ON storage.objects
      FOR DELETE TO public USING ((bucket_id = 'share-maps'::text) AND (auth.uid() IS NOT NULL)) $p$;
  END IF;
END $$;
