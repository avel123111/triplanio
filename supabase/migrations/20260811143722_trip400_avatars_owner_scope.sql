-- TRIP-400 (security-фикс, root-cause TRIP-367): owner-scope на запись в бакет
-- `avatars`.
--
-- Дефект: политики `avatars_insert`/`avatars_update` из baseline проверяли лишь
-- `auth.uid() IS NOT NULL` — путь ЛЮБОЙ. Любой залогиненный мог писать/перезаписывать
-- объект под ЧУЖИМ `<uid>/`-префиксом (аватар другого пользователя). Это
-- противоречит и собственному комментарию политики, и уже owner-scoped
-- `avatars_delete` (миграция 20260630210347). Закрываем той же формой:
-- `(storage.foldername(name))[1] = auth.uid()::text` — писать можно только под
-- своим префиксом (ключ аватара = `<uid>/avatar`).
--
-- ⚠️ Это НЕ причина «new row violates RLS» из TRIP-367: политика PERMISSIVE и
-- залогиненного ПУСКАЕТ (сверено live dev). Тот баг — `auth.uid()` NULL при
-- аплоаде (клиентская авторизация storage), чинится отдельно на фронте.
-- Ужесточение лишь закрывает дыру доступа, загрузку не лечит.
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'storage.objects not present — skipping avatars owner-scope policies';
    RETURN;
  END IF;

  EXECUTE $p$ DROP POLICY IF EXISTS "avatars_insert" ON storage.objects $p$;
  EXECUTE $p$
    CREATE POLICY "avatars_insert" ON storage.objects
      FOR INSERT TO public
      WITH CHECK (
        (bucket_id = 'avatars'::text)
        AND (auth.uid() IS NOT NULL)
        AND ((storage.foldername(name))[1] = auth.uid()::text)
      )
  $p$;

  EXECUTE $p$ DROP POLICY IF EXISTS "avatars_update" ON storage.objects $p$;
  EXECUTE $p$
    CREATE POLICY "avatars_update" ON storage.objects
      FOR UPDATE TO public
      USING (
        (bucket_id = 'avatars'::text)
        AND (auth.uid() IS NOT NULL)
        AND ((storage.foldername(name))[1] = auth.uid()::text)
      )
      WITH CHECK (
        (bucket_id = 'avatars'::text)
        AND (auth.uid() IS NOT NULL)
        AND ((storage.foldername(name))[1] = auth.uid()::text)
      )
  $p$;
END $$;
