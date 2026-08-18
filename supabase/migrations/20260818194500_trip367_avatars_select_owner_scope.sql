-- TRIP-367: «new row violates row-level security policy» при смене аватара.
--
-- Корень (доказано пробами на live dev, каждая с откатом): бакет `avatars` —
-- единственный user-write бакет, куда фронт пишет с `upsert:true`, и у которого
-- НЕТ SELECT-политики. supabase-js при `upsert:true` отправляет запись как
-- `INSERT … ON CONFLICT (bucket_id,name) DO UPDATE`; Postgres под RLS отклоняет
-- такую команду, если на таблице нет SELECT-политики (DO UPDATE обязан прочитать
-- конфликтующую строку) → `new row violates row-level security policy` (403).
-- `trips`/`avatars_delete` работают, потому что у них SELECT-политика есть.
--
-- SELECT-политику `avatars_select` (bucket-wide) снял TRIP-48
-- (20260713120000) вместе с листингом бакета — тогда `upsert` ещё не требовал
-- SELECT; после смены реализации upsert на `ON CONFLICT` её отсутствие и стало
-- багом. Возвращаем её owner-scoped (НЕ bucket-wide) — так `ON CONFLICT` получает
-- нужный SELECT, а публичный листинг бакета не воскресает: зеркало трёх
-- существующих owner-scoped политик (`avatars_insert`/`update` — 20260811143722,
-- `avatars_delete` — 20260630210347). Ключ аватара = `<uid>/avatar`.
--
-- Публичное ЧТЕНИЕ аватаров идёт через /object/public/ (RLS не спрашивается),
-- поэтому эта политика его НЕ меняет — она нужна только внутреннему SELECT,
-- который `ON CONFLICT` делает под ролью `authenticated`.
--
-- Обёртка/идемпотентность — как в 20260811143722 (guard `to_regclass`,
-- `DROP POLICY IF EXISTS`).
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'storage.objects not present — skipping avatars_select policy';
    RETURN;
  END IF;

  EXECUTE $p$ DROP POLICY IF EXISTS "avatars_select" ON storage.objects $p$;
  EXECUTE $p$
    CREATE POLICY "avatars_select" ON storage.objects
      FOR SELECT TO public
      USING (
        (bucket_id = 'avatars'::text)
        AND (auth.uid() IS NOT NULL)
        AND ((storage.foldername(name))[1] = auth.uid()::text)
      )
  $p$;
END $$;
