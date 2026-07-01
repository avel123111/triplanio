-- TRIP-118 — Защитить приватные документы на уровне RLS.
--
-- Предыстория: на trip_documents висела единственная политика trip_documents_all
-- (FOR ALL) с проверкой ТОЛЬКО на участие в трипе:
--     USING (is_trip_participant(trip_id)) WITH CHECK (is_trip_participant(trip_id))
-- Ни visibility, ни created_by в ней не учитывались. Поэтому:
--   * SELECT возвращал приватные доки ВСЕХ участников (приватность держал только
--     фронт, фильтруя на клиенте) — чужой private утекал через прямой REST/DevTools;
--   * UPDATE/DELETE позволяли любому участнику править/удалять чужой private.
--
-- Модель прав (согласована с Pavel):
--   * shared  — читать/править/удалять может любой участник трипа;
--   * private — читать/править/удалять может ТОЛЬКО создатель (created_by),
--               плюс автоматическая зачистка через service_role (teardown/anonymize,
--               которые RLS обходят и здесь не затрагиваются).
--
-- Реализация: дробим FOR ALL на пер-командные политики, привязывая private к владельцу.
-- Прямые мутации доков идут через PostgREST (insert/delete в DocsLens), поэтому эти
-- политики их полностью покрывают. Утечку через getTripDetails (service_role обходит
-- RLS) закрывает отдельный серверный фильтр в самой функции.

DROP POLICY IF EXISTS "trip_documents_all" ON "public"."trip_documents";

-- Чтение: участник видит shared-доки трипа + свои собственные private.
CREATE POLICY "trip_documents_select" ON "public"."trip_documents"
  FOR SELECT
  USING (
    "public"."is_trip_participant"("trip_id")
    AND ("visibility" = 'shared' OR "created_by" = "auth"."uid"())
  );

-- Вставка: только участник и только как автор своей строки
-- (нельзя создать док от имени другого пользователя).
CREATE POLICY "trip_documents_insert" ON "public"."trip_documents"
  FOR INSERT
  WITH CHECK (
    "public"."is_trip_participant"("trip_id")
    AND "created_by" = "auth"."uid"()
  );

-- Правка: shared — любой участник; private — только создатель.
-- WITH CHECK зеркалит USING, чтобы участник не мог переклеить чужую строку.
CREATE POLICY "trip_documents_update" ON "public"."trip_documents"
  FOR UPDATE
  USING (
    "public"."is_trip_participant"("trip_id")
    AND ("visibility" = 'shared' OR "created_by" = "auth"."uid"())
  )
  WITH CHECK (
    "public"."is_trip_participant"("trip_id")
    AND ("visibility" = 'shared' OR "created_by" = "auth"."uid"())
  );

-- Удаление: те же правила, что и правка.
CREATE POLICY "trip_documents_delete" ON "public"."trip_documents"
  FOR DELETE
  USING (
    "public"."is_trip_participant"("trip_id")
    AND ("visibility" = 'shared' OR "created_by" = "auth"."uid"())
  );
