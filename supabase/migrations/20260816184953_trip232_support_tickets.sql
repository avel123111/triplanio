-- TRIP-232: обратная связь пользователя (баг-репорты) — таблица + приватный бакет.
--
-- Тикет пишется ТОЛЬКО сервис-ролью из edge-функции supportTicketCreate; из
-- браузера в БД не пишем. Ярус B (авторитетное, edge-only): клиентского DML/SELECT
-- нет, RLS включена без политик (deny-all), service_role её обходит. Триггеров нет
-- намеренно — pg insert-trigger на эту таблицу вешает n8n (уведомление в
-- Telegram/Linear). resolved/resolved_at проставляются вручную.
--
-- Файлы (скриншоты) грузятся браузером напрямую в приватный бакет `support` —
-- ровно тот же объявленный шов, что и загрузка байтов документов трипа (front →
-- Supabase Storage, documentMutations §G); edge получает уже готовые пути и кладёт
-- их в `files`. Читает файлы только сервис-роль (n8n) — клиентского SELECT нет.

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id          uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  -- Человеко-читаемый счётчик тикетов (для переписки «тикет #NN»). IDENTITY, как
  -- cities.id — своя последовательность на окружение, возможны разрывы; это НЕ id.
  number      bigint GENERATED ALWAYS AS IDENTITY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Точка входа. text+CHECK (конвенция репо, не enum-тип: легче расширять без
  -- ALTER TYPE) — при добавлении кнопки в трип/неавторизованную зону сюда добавим
  -- 'trip'/'public'. char_length — для CI-гарда 2g (guard дословно ищет cap).
  source      text NOT NULL DEFAULT 'settings'
              CHECK (source IN ('settings') AND char_length(source) <= 32),
  -- Обязательны в авторизованной зоне (edge проставляет user_id из JWT, lang шлёт
  -- клиент); nullable под будущую неавторизованную зону.
  user_id     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  -- Появится, когда повесим кнопку внутрь трипа; сейчас всегда NULL.
  trip_id     uuid REFERENCES public.trips(id) ON DELETE SET NULL,
  lang        text CHECK (char_length(lang) <= 16),
  text        text CHECK (char_length(text) <= 1000),
  -- [{ path, name, size, mime }] — пути в бакете `support`; оригинальное имя/размер
  -- для показа в переписке. Не text[] ради имени/размера рядом с путём.
  files       jsonb NOT NULL DEFAULT '[]'::jsonb
              CHECK (jsonb_typeof(files) = 'array'),
  -- Доп. контекст сессии/устройства (url, версия, viewport, ua, tz). Пустой {}
  -- допустим.
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb
              CHECK (jsonb_typeof(meta) = 'object'),
  resolved    boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  -- Отправка требует непустой текст И/ИЛИ хотя бы один файл (аналог AI-парсера).
  -- Инвариант живёт в БД — единственном слое, покрывающем все пути записи (TRIP-169).
  CONSTRAINT support_tickets_text_or_files CHECK (
    (text IS NOT NULL AND char_length(btrim(text)) > 0)
    OR jsonb_array_length(files) > 0
  )
);

ALTER TABLE public.support_tickets OWNER TO postgres;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
-- Ярус B: ни anon, ни authenticated не пишут и не читают напрямую — только edge
-- под сервис-ролью (обходит RLS). Deny-all по построению (RLS on, политик нет).
REVOKE ALL ON public.support_tickets FROM anon, authenticated;

-- Разбор входящих обычно по свежести — индекс под сортировку/поллинг n8n.
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at
  ON public.support_tickets (created_at DESC);

-- ── Приватный бакет `support` для скриншотов ────────────────────────────────
-- Приватный (public=false): читает только сервис-роль (n8n). Браузер (авторизо-
-- ванный) кладёт файл напрямую — INSERT-политика ниже; DELETE — чтобы подмести
-- осиротевший файл, если тикет не сохранился. Клиентского SELECT нет.
-- Гард на наличие storage-схемы — как у остальных бакетов.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage.buckets not present - skipping support bucket';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('support', 'support', false, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp'])
  ON CONFLICT (id) DO UPDATE
    SET public = EXCLUDED.public,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE $p$ DROP POLICY IF EXISTS "support_insert" ON storage.objects $p$;
    EXECUTE $p$ CREATE POLICY "support_insert" ON storage.objects
      FOR INSERT TO public
      WITH CHECK (bucket_id = 'support'::text AND auth.uid() IS NOT NULL) $p$;

    EXECUTE $p$ DROP POLICY IF EXISTS "support_delete" ON storage.objects $p$;
    EXECUTE $p$ CREATE POLICY "support_delete" ON storage.objects
      FOR DELETE TO public
      USING (bucket_id = 'support'::text AND auth.uid() IS NOT NULL) $p$;
  END IF;
END $$;
