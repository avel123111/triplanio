-- TRIP-117: the `avatars` storage bucket has INSERT/SELECT/UPDATE RLS policies
-- but NO DELETE policy, so every client-side avatar removal was silently denied
-- by RLS and left the object orphaned in the bucket:
--   • профиль «удалить аватар» (ScreenAccount.handleRemoveAvatar) — нулил
--     users.avatar_url, но файл оставался;
--   • замена аватара другим расширением (png→jpg) — старый avatar.<ext> оставался.
-- Add an own-folder DELETE policy: a user may delete only objects under their
-- own `<uid>/` prefix (avatars are keyed `<uid>/avatar.<ext>`). Account deletion
-- keeps purging avatars via the service role (deleteMyAccount), which bypasses RLS.
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'storage.objects not present — skipping avatars_delete policy';
    RETURN;
  END IF;

  EXECUTE $p$ DROP POLICY IF EXISTS "avatars_delete" ON storage.objects $p$;
  EXECUTE $p$
    CREATE POLICY "avatars_delete" ON storage.objects
      FOR DELETE TO public
      USING (
        (bucket_id = 'avatars'::text)
        AND (auth.uid() IS NOT NULL)
        AND ((storage.foldername(name))[1] = auth.uid()::text)
      )
  $p$;
END $$;
