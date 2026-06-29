-- TRIP-102 follow-up: удалить мёртвые storage-политики.
--
-- На storage.objects висели 6 RLS-политик, гейтящих bucket_id, которых нет среди бакетов
-- (есть только avatars + trips): trip-covers ×3 и documents ×3. Они мертвы (объектов в этих
-- бакетах быть не может) — убираем на живых prod/dev. На чистой БД baseline их уже не создаёт,
-- поэтому здесь DROP ... IF EXISTS = no-op. Guard на to_regclass: если storage-схема ещё не
-- поднята при прогоне — блок тихо пропускается.
DO $do$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'storage.objects not present — skipping dead-policy cleanup';
    RETURN;
  END IF;

  EXECUTE $p$ DROP POLICY IF EXISTS "Authenticated upload trip covers" ON storage.objects $p$;
  EXECUTE $p$ DROP POLICY IF EXISTS "Owner delete trip covers" ON storage.objects $p$;
  EXECUTE $p$ DROP POLICY IF EXISTS "Public read trip covers" ON storage.objects $p$;
  EXECUTE $p$ DROP POLICY IF EXISTS "documents_delete" ON storage.objects $p$;
  EXECUTE $p$ DROP POLICY IF EXISTS "documents_insert" ON storage.objects $p$;
  EXECUTE $p$ DROP POLICY IF EXISTS "documents_select" ON storage.objects $p$;
END
$do$;
