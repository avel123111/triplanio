-- TRIP-281: приём файлов — серверные ограничения формата, размера и схемы URL.
--
-- Разбор показал, что до этой миграции ЕДИНСТВЕННЫМ ограничением на загрузку был
-- атрибут `accept` в разметке. Он влияет только на диалог выбора файла и не
-- проверяет ничего: перетаскиванием или прямым запросом в бакет `trips` уезжал
-- файл ЛЮБОГО типа размером до 52 МБ (в интерфейсе обещано 4–10 МБ). В проде уже
-- лежали 3 объекта с `content-type: text/html` — фильтр не работал.
--
-- Что здесь делается, тремя независимыми слоями:
--
--  1) Белый список MIME на бакетах. Это ЕДИНСТВЕННЫЙ гейт, который нельзя обойти
--     из браузера, поэтому именно он несущий; список во фронте (`src/lib/fileType.js`)
--     — его зеркало ради понятной ошибки до похода в сеть.
--
--     Граница проведена по признаку «браузер это ИСПОЛНЯЕТ»: из хранимых форматов
--     так ведут себя только HTML и SVG, они и исключены. Офисные файлы браузер
--     никогда не исполняет (макросу нужен настольный Office и явное «разрешить
--     содержимое»), поэтому legacy .doc/.xls остаются — их реально присылают
--     турагентства, и запрет ломал бы живой сценарий, ничего не давая взамен.
--
--     `application/octet-stream` в списке НАМЕРЕННО: когда браузер не знает тип
--     (HEIC в ряде десктопных браузеров), он проставляет в multipart-части именно
--     его, и без этого пункта отвалились бы легальные фото. Небезопасным это не
--     делает — octet-stream браузер всегда скачивает, а не отображает.
--
--  2) Размер на сервере приводится к тому, что обещает интерфейс (10 МБ).
--
--  3) `trip_documents.file_url` получает проверку СХЕМЫ. Раньше стоял только
--     кэп длины (TRIP-169), поэтому в поле можно было записать `javascript:…`,
--     и клик по «документу» исполнял чужой код на triplanio.com. Фронт уже
--     обезврежен в точках показа, но инвариант формы обязан жить в БД: это
--     единственный слой, который видят все пути записи.

-- ── 1–2. Бакеты: формат + размер ────────────────────────────────────────────
DO $$
DECLARE
  -- Картинки, которые браузер отображает, но не исполняет. Без image/svg+xml.
  image_types text[] := ARRAY[
    'image/jpeg', 'image/png', 'image/gif',
    'image/webp', 'image/heic', 'image/heif', 'image/avif'
  ];
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage.buckets not present — skipping upload limits';
    RETURN;
  END IF;

  UPDATE storage.buckets
     SET allowed_mime_types = image_types || ARRAY[
           'application/pdf',
           'application/msword',
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
           'application/vnd.ms-excel',
           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
           'text/csv',
           'application/octet-stream'
         ],
         file_size_limit = 10485760  -- 10 МБ, как в интерфейсе (было 52 МБ)
   WHERE id = 'trips';

  -- Аватары: бакет ПУБЛИЧНЫЙ и читается без авторизации, а в белом списке лежал
  -- image/svg+xml. Любой зарегистрированный мог разместить SVG со скриптом по
  -- прямой ссылке на нашем домене. Оставляем только неисполняемые картинки.
  --
  -- octet-stream нужен по той же причине, что и у `trips`: без него аватар в HEIC
  -- (браузер не знает тип → шлёт octet-stream) падал бы с невнятной ошибкой
  -- хранилища. Злоупотребление ограничено самой раскладкой бакета: ключ жёстко
  -- `<uid>/avatar` с upsert, то есть не больше одного объекта на пользователя.
  UPDATE storage.buckets
     SET allowed_mime_types = image_types || ARRAY['application/octet-stream']
   WHERE id = 'avatars';
END $$;

-- ── 3. Схема ссылки на файл ─────────────────────────────────────────────────
-- NOT VALID: проверяем только новые и изменяемые строки. Существующие данные
-- чисты (проверено на проде: 0 записей с иной схемой), но валидация задним
-- числом заблокировала бы таблицу без нужды.
ALTER TABLE public.trip_documents
  DROP CONSTRAINT IF EXISTS td_file_url_scheme;

ALTER TABLE public.trip_documents
  ADD CONSTRAINT td_file_url_scheme
  CHECK (file_url IS NULL OR file_url ~* '^https?://') NOT VALID;

ALTER TABLE public.trip_documents
  DROP CONSTRAINT IF EXISTS td_link_url_scheme;

ALTER TABLE public.trip_documents
  ADD CONSTRAINT td_link_url_scheme
  CHECK (link_url IS NULL OR link_url ~* '^https?://') NOT VALID;

-- ── 4. Черновые обложки — своя папка на пользователя ────────────────────────
-- Все четыре политики бакета `trips` (TRIP-118) пускали ЛЮБОГО залогиненного в
-- ВЕСЬ префикс `_drafts/`: чужую отложенную обложку можно было и прочитать, и
-- удалить. Ключ теперь `_drafts/<userId>/…` (см. `draftStoragePath`), и второй
-- сегмент обязан совпадать с auth.uid().
--
-- Ветка `_can_access_trip_file` не трогается — это по-прежнему участ-скоупный
-- доступ к файлам сохранённого трипа.
--
-- Бэкфилл не нужен: на момент миграции в `_drafts/` ноль объектов (проверено на
-- проде). Старый плоский ключ под новую политику не подойдёт, и это правильно —
-- такие объекты были бы ничьими.
DO $$
DECLARE
  -- Свой черновик: `_drafts/<uid>/<файл>`.
  own_draft text := $pred$
    (("storage"."foldername"("name"))[1] = '_drafts'
     AND ("storage"."foldername"("name"))[2] = "auth"."uid"()::text)
    OR "public"."_can_access_trip_file"("name")
  $pred$;
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'storage.objects not present — skipping trips draft policies';
    RETURN;
  END IF;

  EXECUTE format($f$
    DROP POLICY IF EXISTS "trips_select" ON "storage"."objects";
    CREATE POLICY "trips_select" ON "storage"."objects"
      FOR SELECT TO "public"
      USING ("bucket_id" = 'trips' AND (%1$s));

    DROP POLICY IF EXISTS "trips_insert" ON "storage"."objects";
    CREATE POLICY "trips_insert" ON "storage"."objects"
      FOR INSERT TO "public"
      WITH CHECK ("bucket_id" = 'trips' AND (%1$s));

    DROP POLICY IF EXISTS "trips_update" ON "storage"."objects";
    CREATE POLICY "trips_update" ON "storage"."objects"
      FOR UPDATE TO "public"
      USING ("bucket_id" = 'trips' AND (%1$s))
      WITH CHECK ("bucket_id" = 'trips' AND (%1$s));

    DROP POLICY IF EXISTS "trips_delete" ON "storage"."objects";
    CREATE POLICY "trips_delete" ON "storage"."objects"
      FOR DELETE TO "public"
      USING ("bucket_id" = 'trips' AND (%1$s));
  $f$, own_draft);
END $$;
