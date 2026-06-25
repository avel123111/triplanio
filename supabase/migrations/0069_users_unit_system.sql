-- 0069: TRIP-25 — система мер пользователя (км ⇄ мили), настройка на Account.
--
-- Хранение per-account по образцу users.language: колонка + клиентский апдейт.
-- Значение всегда метрика по умолчанию; конверсия в мили делается ТОЛЬКО на выводе
-- (см. fmtDistance в src/lib/i18n). Сервер дистанцию не считает и не форматирует.
--
-- ВАЖНО (грабли из 0054): users перешёл на колоночный GRANT — новые пишимые клиентом
-- колонки НЕ доступны authenticated на запись автоматически. Поэтому ниже явно
-- грантим INSERT/UPDATE (unit_system), иначе update users.unit_system из клиента
-- (I18nContext.setUnits) молча не пройдёт.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS unit_system text NOT NULL DEFAULT 'metric'
    CHECK (unit_system IN ('metric', 'imperial'));

GRANT INSERT (unit_system), UPDATE (unit_system)
  ON public.users TO authenticated;
