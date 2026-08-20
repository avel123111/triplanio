-- Обложки трипа: галерея пресетов (замена дефолтных градиентов).
--
-- Модель: пресет — это общий справочник картинок. Выбор пресета КОПИРУЕТ его
-- публичный URL в существующий `trips.cover_image_url` (ровно как загрузка своего
-- фото) — трип ссылается на КАРТИНКУ, а не на «пресет», поэтому удаление пресета
-- из галереи ничью обложку не ломает. Куратор набора — Pavel через дашборд
-- Supabase (залил файл в бакет + вставил строку в `cover_presets`); отдельного
-- админ-UI в приложении нет. Клиент читает каталог только через edge-витрину
-- `getCoverPresets` (дверь auth, service_role) — прямого доступа к таблице нет.
--
-- `trips.cover_gradient` тут НЕ трогаем: колонка остаётся в схеме мёртвой (фронт
-- перестаёт её читать/писать), физический DROP + переписывание RPC — отдельный PR.

-- ── Публичный бакет `trip-cover-presets` ────────────────────────────────────
-- public=true: файлы раздаются по прямому /object/public/ URL (минует RLS). БЕЗ
-- SELECT-политики — публичный «download-by-URL» бакет её не требует, а bucket-wide
-- `SELECT TO public` отдал бы анону листинг всего содержимого (инвариант TRIP-48).
-- БЕЗ политик записи вообще: заливает только Pavel через дашборд (service_role
-- обходит RLS). Гард на наличие storage-схемы — как у остальных бакетов.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage.buckets not present - skipping trip-cover-presets bucket';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('trip-cover-presets', 'trip-cover-presets', true, 5242880,
          ARRAY['image/webp', 'image/png', 'image/jpeg'])
  ON CONFLICT (id) DO UPDATE
    SET public = EXCLUDED.public,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;
END $$;

-- ── Таблица-каталог `cover_presets` (ярус D — справочник) ────────────────────
-- Клиент таблицу напрямую не читает и не пишет: RLS on без политик (deny-all),
-- REVOKE ALL у anon/authenticated; пишет дашборд/сервис-роль (обходит RLS),
-- читает edge `getCoverPresets` под service_role. `image_url` — публичный URL из
-- бакета выше; тип — капнутый домен url_text (≤2048, слой целостности TRIP-169).
CREATE TABLE IF NOT EXISTS public.cover_presets (
  id         uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  image_url  public.url_text NOT NULL,
  -- Порядок в галерее; меньше — раньше. Разрывы допустимы.
  sort       integer NOT NULL DEFAULT 0,
  -- Мягкое снятие пресета с витрины: active=false прячет из галереи, но уже
  -- выбранные обложки не трогает (они ссылаются на URL, а не на строку).
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cover_presets OWNER TO postgres;
ALTER TABLE public.cover_presets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cover_presets FROM anon, authenticated;

-- Витрина отдаёт active-пресеты по возрастанию sort — индекс под эту выборку.
CREATE INDEX IF NOT EXISTS idx_cover_presets_active_sort
  ON public.cover_presets (sort) WHERE active;
