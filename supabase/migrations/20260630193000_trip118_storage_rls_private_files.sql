-- TRIP-118 (follow-up) — Защитить ФАЙЛЫ документов на уровне Storage-RLS.
--
-- Предыстория: TRIP-118 закрыл утечку на уровне СТРОК (таблица trip_documents —
-- пер-командные политики + фильтр в getTripDetails). Но сами ФАЙЛЫ лежат в одном
-- приватном бакете `trips` по пути `<tripId>/<uuid>-<имя>`, а его политики гейтили
-- доступ ТОЛЬКО на «залогинен»:
--     trips_select/insert/delete : bucket_id='trips' AND auth.uid() IS NOT NULL
-- Ни участия в трипе, ни владельца. Поэтому любой залогиненный юзер мог
--   * storage.list('<любой tripId>/') → перечислить ВСЕ ключи файлов чужого трипа,
--   * createSignedUrl(key)            → скачать любой из них (приватные/личные доки,
--                                        вложения броней/сервисов, обложки),
--   * delete/upload                   → удалить/подменить чужие файлы.
-- Случайный uuid в имени защищал лишь от угадывания одного пути — list() его обходит.
-- Это тот же баг TRIP-118, но на слое файлов: строку RLS прятала, а файл оставался
-- открыт через Storage API в обход и таблицы, и фильтра getTripDetails.
--
-- Модель прав на файл (согласована с Pavel, «Вариант 2» — правило смотрит в таблицу):
--   * Доступ к файлу `<tripId>/...` есть только у УЧАСТНИКА этого трипа, И
--   * файл не должен быть ЧУЖИМ приватным документом: если на его storage_path
--     ссылается строка trip_documents с visibility='private' и created_by ≠ тебя —
--     отказ (приватный док виден только автору, даже со-участнику).
--   * Файлы вне trip_documents (вложения броней/сервисов, обложки) — общий контент
--     трипа: пускаем по участию.
--   * Префикс `_drafts/` — обложки, загруженные ДО создания трипа (ещё нет tripId,
--     нет привязки к участию, нечувствительны): оставляем доступными любому
--     залогиненному, как было. Подметаются по возрасту.
--
-- service_role (teardown/anonymize/getPublicTrip и пр. серверные функции) RLS
-- обходит — эти политики его не затрагивают. Уже выданные signed-URL самоподписаны
-- и продолжают работать (допустимый форвардинг владельцем) — RLS их не отзывает.

-- ── Хелпер: доступен ли вызывающему файл бакета `trips` по его пути ──
-- tripId = первый сегмент пути (`storage.foldername(name)[1]`). Для не-uuid префикса
-- (в т.ч. `_drafts`) возвращает false — такие случаи обрабатывает сама политика.
-- STABLE/INVOKER: читает auth.uid() и участие из контекста запроса; роль роли не имеет.
-- Подзапрос ограничен trip_id того же трипа (использует idx_trip_documents_trip_id).
CREATE OR REPLACE FUNCTION "public"."_can_access_trip_file"("p_object_name" "text")
    RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT CASE
    WHEN ("storage"."foldername"(p_object_name))[1]
         ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    THEN
      "public"."is_trip_participant"((("storage"."foldername"(p_object_name))[1])::"uuid")
      AND NOT EXISTS (
        SELECT 1
        FROM "public"."trip_documents" d
        CROSS JOIN LATERAL "jsonb_array_elements"(COALESCE(d."documents", '[]'::"jsonb")) e
        WHERE e->>'storage_path' = p_object_name
          AND d."trip_id" = (("storage"."foldername"(p_object_name))[1])::"uuid"
          AND d."visibility" = 'private'
          AND d."created_by" IS DISTINCT FROM "auth"."uid"()
      )
    ELSE false
  END;
$$;

ALTER FUNCTION "public"."_can_access_trip_file"("text") OWNER TO "postgres";
GRANT ALL ON FUNCTION "public"."_can_access_trip_file"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."_can_access_trip_file"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_can_access_trip_file"("text") TO "service_role";

-- Общий предикат для всех четырёх команд: участ-скоупный доступ к файлу ИЛИ
-- черновая обложка под `_drafts/` (любой залогиненный). bucket_id фиксируем здесь.
-- INSERT использует тот же предикат: для нового пути строки в trip_documents ещё
-- нет → NOT EXISTS истинно → сводится к проверке участия (нельзя залить в чужой трип).

DROP POLICY IF EXISTS "trips_select" ON "storage"."objects";
CREATE POLICY "trips_select" ON "storage"."objects"
  FOR SELECT TO "public"
  USING (
    "bucket_id" = 'trips'
    AND (
      (("storage"."foldername"("name"))[1] = '_drafts' AND "auth"."uid"() IS NOT NULL)
      OR "public"."_can_access_trip_file"("name")
    )
  );

DROP POLICY IF EXISTS "trips_insert" ON "storage"."objects";
CREATE POLICY "trips_insert" ON "storage"."objects"
  FOR INSERT TO "public"
  WITH CHECK (
    "bucket_id" = 'trips'
    AND (
      (("storage"."foldername"("name"))[1] = '_drafts' AND "auth"."uid"() IS NOT NULL)
      OR "public"."_can_access_trip_file"("name")
    )
  );

-- UPDATE: на бакете раньше политики не было (любой апдейт блокировался). Добавляем
-- участ-скоупную, чтобы перенос draft-обложки под `<tripId>/` (storage.move) работал
-- и контролировался теми же правами.
DROP POLICY IF EXISTS "trips_update" ON "storage"."objects";
CREATE POLICY "trips_update" ON "storage"."objects"
  FOR UPDATE TO "public"
  USING (
    "bucket_id" = 'trips'
    AND (
      (("storage"."foldername"("name"))[1] = '_drafts' AND "auth"."uid"() IS NOT NULL)
      OR "public"."_can_access_trip_file"("name")
    )
  )
  WITH CHECK (
    "bucket_id" = 'trips'
    AND (
      (("storage"."foldername"("name"))[1] = '_drafts' AND "auth"."uid"() IS NOT NULL)
      OR "public"."_can_access_trip_file"("name")
    )
  );

DROP POLICY IF EXISTS "trips_delete" ON "storage"."objects";
CREATE POLICY "trips_delete" ON "storage"."objects"
  FOR DELETE TO "public"
  USING (
    "bucket_id" = 'trips'
    AND (
      (("storage"."foldername"("name"))[1] = '_drafts' AND "auth"."uid"() IS NOT NULL)
      OR "public"."_can_access_trip_file"("name")
    )
  );
