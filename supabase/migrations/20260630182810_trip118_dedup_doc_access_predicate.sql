-- TRIP-118 (follow-up) — Вынести общий RLS-предикат доков в хелпер.
--
-- Базовая защита приватных доков уже приехала миграцией 20260630180032 (4 пер-
-- командные политики). Там предикат «участник И (shared ИЛИ владелец)» был
-- заинлайнен и повторялся 4 раза в 3 политиках (select USING, update USING+
-- WITH CHECK, delete USING). Эта миграция выносит его в общий STABLE-хелпер
-- _can_access_trip_document, чтобы правила чтения/правки/удаления не разъехались.
-- Поведение идентично инлайну — та же булева проверка, чистый рефактор.
--
-- INSERT НЕ трогаем: у него другой предикат (created_by = auth.uid(), без shared) —
-- нельзя вставить строку от чужого имени, в хелпер он не входит.
--
-- Делается отдельной форвард-миграцией (а не правкой 20260630180032), потому что
-- та уже в журнале dev/prod — правка применённого файла была бы мёртвой.

-- Общий предикат доступа к строке документа: участник трипа И (док общий ИЛИ ты автор).
-- STABLE: читает auth.uid() и опрашивает участие (через is_trip_participant). Контекст
-- пользователя (auth.uid()) резолвится из запроса, роль значения не имеет.
CREATE OR REPLACE FUNCTION "public"."_can_access_trip_document"(
  "p_trip_id" "uuid", "p_visibility" "text", "p_created_by" "uuid"
) RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT "public"."is_trip_participant"(p_trip_id)
     AND (p_visibility = 'shared' OR p_created_by = "auth"."uid"());
$$;

ALTER FUNCTION "public"."_can_access_trip_document"("uuid", "text", "uuid") OWNER TO "postgres";
GRANT ALL ON FUNCTION "public"."_can_access_trip_document"("uuid", "text", "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."_can_access_trip_document"("uuid", "text", "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_can_access_trip_document"("uuid", "text", "uuid") TO "service_role";

-- Пересоздаём чтение/правку/удаление через хелпер (INSERT не трогаем).
DROP POLICY IF EXISTS "trip_documents_select" ON "public"."trip_documents";
CREATE POLICY "trip_documents_select" ON "public"."trip_documents"
  FOR SELECT
  USING ("public"."_can_access_trip_document"("trip_id", "visibility", "created_by"));

DROP POLICY IF EXISTS "trip_documents_update" ON "public"."trip_documents";
CREATE POLICY "trip_documents_update" ON "public"."trip_documents"
  FOR UPDATE
  USING ("public"."_can_access_trip_document"("trip_id", "visibility", "created_by"))
  WITH CHECK ("public"."_can_access_trip_document"("trip_id", "visibility", "created_by"));

DROP POLICY IF EXISTS "trip_documents_delete" ON "public"."trip_documents";
CREATE POLICY "trip_documents_delete" ON "public"."trip_documents"
  FOR DELETE
  USING ("public"."_can_access_trip_document"("trip_id", "visibility", "created_by"));
