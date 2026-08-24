-- Фоны share-карточки: отдельный публичный бакет `card-bg-presets`.
--
-- Модель НАМЕРЕННО без таблицы-каталога (сравни с обложками трипов,
-- 20260820191733_trip_cover_presets.sql): на фон карточки никто не ссылается
-- персистентно — карточка растеризуется в PNG в момент генерации, URL фона
-- нигде не сохраняется, поэтому у каталога здесь нет работы. Роли каталога
-- закрывает сам бакет:
--   формат   → ПАПКА `story/` либо `post/` (у 9:16 и 4:5 разный арт; ось одной
--              коллекции, а не второй бакет — решение Pavel 2026-08-24); файлы
--              в корне бакета в витрину не попадают по построению;
--   порядок  → префикс имени файла (01-…, 02-…); листинг сортируется по имени;
--   снятие   → удалить файл (сломанных ссылок не бывает по построению);
--   id       → не нужен.
-- Кураторство: Pavel заливает файлы в папки story/ и post/ через дашборд — всё.
--
-- Читатель ОДИН: edge `render-share-card` листает бакет под service_role и
-- отдаёт публичные URL в overlay-ответе (`backgrounds`) — дверь экрана
-- конструктора (TRIP-374: чтение группируется по экрану). Прямого листинга с
-- фронта нет по построению: политик на бакете ноль (инвариант TRIP-48 —
-- аноним не получает listing), байты раздаются по /object/public/ URL.
--
-- public=true, БЕЗ SELECT-политики и БЕЗ политик записи (пишет только дашборд/
-- service_role, обходящий RLS). MIME-белый список без svg/html (TRIP-281:
-- фон инлайнится data-URI в SVG карточки и рисуется в canvas — активному
-- контенту в этом бакете взяться неоткуда). Гард на наличие storage-схемы —
-- как у остальных бакетов.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage.buckets not present - skipping card-bg-presets bucket';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('card-bg-presets', 'card-bg-presets', true, 5242880,
          ARRAY['image/webp', 'image/png', 'image/jpeg'])
  ON CONFLICT (id) DO UPDATE
    SET public = EXCLUDED.public,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;
END $$;
