-- TRIP-193: storage bucket for generated share cards.
--
-- `share-cards` holds the rendered PNGs at share-cards/{trip_id}/{content_hash}.png.
-- Public bucket: the card is served by its unguessable hash URL (contains no
-- share_token; QR points at the landing page, so publishing it does not expose
-- trip access). Writes are done by the render-share-card edge function using the
-- service role (bypasses RLS); reads go through the public object URL.
--
-- Fonts / default background / resvg wasm are bundled with the function as static
-- files, so no separate `share-assets` bucket is needed for the base version.
--
-- Guarded on storage schema presence (same pattern as the baseline buckets).
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage.buckets not present - skipping share-cards bucket';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('share-cards', 'share-cards', true, 10485760, ARRAY['image/png'])
  ON CONFLICT (id) DO UPDATE
    SET public = EXCLUDED.public,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

  -- Explicit public SELECT policy (public bucket already serves via the public
  -- object URL; this keeps parity with the other buckets' declared policies).
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE $p$ DROP POLICY IF EXISTS "share_cards_select" ON storage.objects $p$;
    EXECUTE $p$ CREATE POLICY "share_cards_select" ON storage.objects
      FOR SELECT TO public USING (bucket_id = 'share-cards'::text) $p$;
  END IF;
END $$;
