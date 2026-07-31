-- TRIP-281: приём файлов — серверные ограничения формата, размера и схемы URL.
--
-- Разбор показал, что до этой миграции ЕДИНСТВЕННЫМ ограничением на загрузку был
-- атрибут `accept` в разметке. Он влияет только на диалог выбора файла и не
-- проверяет ничего: перетаскиванием или прямым запросом в бакет `trips` уезжал
-- файл ЛЮБОГО типа размером до 52 МБ (в интерфейсе обещано 4–10 МБ). В проде уже
-- лежали 3 объекта с `content-type: text/html` — фильтр не работал.
--
-- Что здесь делается — независимыми слоями, по одному на блок ниже:
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
--  3) Плоские колонки `trip_documents.file_url/file_name` удаляются: они мертвы,
--     и констрейнт на них выглядел бы защитой, не будучи ею.
--
--  4) Схема ссылки на файл получает проверку в БД. Раньше стоял только кэп длины
--     (TRIP-169), поэтому вместо ссылки писалось `javascript:…`, и клик по
--     «документу» исполнял чужой код на triplanio.com. Фронт уже обезврежен в
--     точках показа, но инвариант формы обязан жить в БД: это единственный слой,
--     который видят все пути записи. Проверка ставится на jsonb-массив
--     `documents` — именно его пишет и рендерит приложение.
--
--  5) Черновые обложки получают папку на пользователя: префикс `_drafts/` был
--     общим, чужой черновик читался и удалялся.

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

-- ── 3. Мёртвые колонки trip_documents.file_url / file_name ──────────────────
-- ddl-guard: allow-destructive — TRIP-281, contract-фаза: плоские `file_url` и
-- `file_name` не пишет НИКТО (единственный автор строки, DocsLens, кладёт только
-- title/notes/link_url/documents/visibility/created_by/created_by_name; UPDATE-пути
-- у таблицы нет вообще), значение NULL у 100% строк за всю историю (прод 7/7,
-- dev 40/40) и ни одна из шести точек показа их не рендерит — ссылка везде берётся
-- из массива `documents`. Читатели снимаются этим же коммитом (storageCleanup,
-- DocsLens, personalDocsTeardown). Индексов, вью и политик на колонках нет;
-- зависимые кэпы длины `td_file_url_len` / `td_file_name_len` уходят вместе с ними.
ALTER TABLE public.trip_documents
  DROP COLUMN IF EXISTS file_url,
  DROP COLUMN IF EXISTS file_name;

-- ── 4. Схема ссылки на файл ─────────────────────────────────────────────────
-- Ссылка на загруженный файл живёт в jsonb-массиве `documents` пяти хранилищ.
-- Подзапрос в CHECK запрещён, но `jsonb_path_exists` IMMUTABLE и работает
-- выражением, поэтому отдельная функция не нужна: путь выбирает элементы, чей
-- `file_url` НЕ начинается с http(s), а констрейнт требует, чтобы таких не было.
-- Регистр не важен (flag "i"), протокол-относительная `//host` тоже отсекается.
--
-- Констрейнты ВАЛИДНЫЕ, а не NOT VALID: нарушений 0 в обеих базах (прод 6/45/105/23/6,
-- dev 23/28/99/36/17 строк с документами), таблицы крошечные, и валидный констрейнт
-- гарантирует факт, а не только будущее. Легальная запись нарушить его не может —
-- приложение кладёт сюда подписанный URL Storage, он всегда https.
DO $$
DECLARE
  -- Элемент массива документов со ссылкой не-http(s).
  bad_url text := 'file_url ? (!(@ like_regex "^https?://" flag "i"))';
  spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('trip_documents', 'documents', 'td_documents_urls',  '$[*].'),
      ('hotel_stays',    'documents', 'hs_documents_urls',  '$[*].'),
      ('transfers',      'documents', 'tr_documents_urls',  '$[*].'),
      ('activities',     'documents', 'act_documents_urls', '$[*].'),
      -- У сервисов документы лежат внутри общего мешка `details`.
      ('trip_services',  'details',   'ts_documents_urls',  '$.documents[*].')
    ) AS t(tbl, col, cons, path)
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', spec.tbl, spec.cons);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (NOT jsonb_path_exists(%I, %L))',
      spec.tbl, spec.cons, spec.col, spec.path || bad_url);
  END LOOP;
END $$;

-- `link_url` — ссылка, которую пользователь вводит руками. Единственный писатель
-- уже прогоняет её через normalizeExternalUrl, в обеих базах нарушений 0.
ALTER TABLE public.trip_documents
  DROP CONSTRAINT IF EXISTS td_link_url_scheme;

ALTER TABLE public.trip_documents
  ADD CONSTRAINT td_link_url_scheme
  CHECK (link_url IS NULL OR link_url ~* '^https?://');

-- ── 5. Черновые обложки — своя папка на пользователя ────────────────────────
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
