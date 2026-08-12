-- TRIP-400 шаг C — закрытие ДВЕРИ ЗАПИСИ public.users (эпик TRIP-374, ярус C→B по DML).
--
-- A+B перевёл 5 прямых users.update на шов account/profile и чтение на getMe.
-- Теперь снимаем у authenticated право писать users напрямую через PostgREST:
-- единственная дверь записи профиля — edge под service_role.
--
-- ★ ЧТО СНИМАЕМ И ЧТО ОСТАЁТСЯ:
--   • DELETE (table-level) — снимаем;
--   • UPDATE — снимаем; но у authenticated его НЕТ на table-level, он КОЛОНОЧНЫЙ
--     (avatar_url/full_name/language/unit_system/email/id/theme/created_at/updated_at,
--     сверено live dev+prod). Колоночный грант ПЕРЕЖИВАЕТ table-level REVOKE
--     (грабля TRIP-49: revoke «мимо» выглядит сделанным и не работает) — поэтому
--     снимаем ЯВНО по колонкам. Эффективность проверяется постдеплой live-гардом
--     2e (has_table_privilege / has_any_column_privilege), НЕ текстом миграции.
--   • SELECT — ОСТАЁТСЯ (authSelect=true): чтение уже за getMe, но снятие SELECT
--     живёт в домене регистрации (последний) вместе с insert().select() профиля.
--   • INSERT — ОСТАЁТСЯ: его снимет тот же домен регистрации (там колоночный
--     insert().select()). Здесь трогаем ТОЛЬКО UPDATE/DELETE.
--   • anon — уже без DML (Ф3), не трогаем.
--
-- Райдеры тем же файлом: дроп мёртвой users.theme, дефолт языка ru→en, три
-- SET NOT NULL (0 NULL на dev И prod проверено ДО миграции — класс «литеральный
-- guardRow на nullable-колонке», handoff §7.9a).
--
-- ddl-guard: allow-destructive — TRIP-400 шаг C: REVOKE UPDATE/DELETE (закрытие
--   двери users), DROP COLUMN users.theme (0 читателей по 6 источникам, тема
--   живёт в localStorage через ThemeContext), NOT NULL-райдеры (0 NULL dev+prod).

-- 1. Снять запись у authenticated.
REVOKE UPDATE, DELETE ON public.users FROM authenticated;
-- Колоночные UPDATE-гранты (theme исключён — его ACL уходит с DROP ниже).
REVOKE UPDATE (id, email, full_name, avatar_url, language, unit_system, created_at, updated_at)
  ON public.users FROM authenticated;

-- 2a. Мёртвая колонка users.theme: 0 читателей (src/functions/migrations/locales/
--     css/n8n), тема хранится в localStorage. DROP уносит CHECK users_theme_check
--     и колоночные ACL theme.
ALTER TABLE public.users DROP COLUMN IF EXISTS theme;

-- 2b. Дефолт языка ru→en (публичный дефолт продукта — en).
ALTER TABLE public.users ALTER COLUMN language SET DEFAULT 'en';

-- 2c. NOT NULL там, где значение уже гарантировано (дефолты + логика домена):
--     source_kind (шов форсит 'manual'/триггер), kind, visibility. Целостность —
--     в БД (handoff Р4 §0). 0 NULL на dev И prod проверено до миграции.
ALTER TABLE public.budget_expenses   ALTER COLUMN source_kind SET NOT NULL;
ALTER TABLE public.budget_categories ALTER COLUMN kind        SET NOT NULL;
ALTER TABLE public.trip_documents    ALTER COLUMN visibility  SET NOT NULL;
