-- 0054: T1/P0-1 — энтайтлмент пишет только сервер (service_role).
--
-- Контекст: у anon и authenticated стоит дефолтный табличный GRANT ALL (Supabase),
-- который покрывает ВСЕ колонки. Колоночный REVOKE его не вычитает (no-op).
-- Поэтому: снимаем табличные INSERT/UPDATE и возвращаем их колоночно только на
-- не-энтайтлмент колонки.
--
-- anon: INSERT/UPDATE НЕ возвращаем. Все write-RLS на users/trips требуют auth.uid()
--       (у anon = NULL) → запись anon и так невозможна; грант ему не нужен (least-privilege).
-- authenticated: возвращаем INSERT/UPDATE на все колонки, КРОМЕ энтайтлмент-ных.
--
-- ВАЖНО (синтаксис GRANT): список колонок привязывается ТОЛЬКО к непосредственно
-- предшествующей привилегии. `GRANT INSERT, UPDATE (cols)` означало бы «INSERT на
-- уровне ТАБЛИЦЫ + UPDATE на колонках» → вернуло бы табличный INSERT и дыра по INSERT
-- осталась бы открытой. Поэтому список колонок указывается ОТДЕЛЬНО для INSERT и UPDATE:
-- `GRANT INSERT (cols), UPDATE (cols)`.
--
-- Закрываемые колонки (только сервер через service_role):
--   users.subscription_status, users.subscription_end_date,
--   users.stripe_customer_id, users.entitlement_synced_at, trips.is_pro_trip
-- SELECT/DELETE/REFERENCES/TRIGGER/TRUNCATE и service_role не трогаем.
--
-- ГРАБЛИ НА БУДУЩЕЕ: после перехода на колоночный грант новые колонки users/trips
-- НЕ будут автоматически доступны authenticated на запись — каждую новую пишимую
-- клиентом колонку надо грантить явно в своей миграции.

-- ── users ─────────────────────────────────────────────────────────────────
REVOKE INSERT, UPDATE ON public.users FROM anon;
REVOKE INSERT, UPDATE ON public.users FROM authenticated;

GRANT INSERT (id, email, full_name, avatar_url, language, theme,
              notify_email_invites, notify_email_updates, created_at, updated_at),
      UPDATE (id, email, full_name, avatar_url, language, theme,
              notify_email_invites, notify_email_updates, created_at, updated_at)
  ON public.users TO authenticated;

-- ── trips ─────────────────────────────────────────────────────────────────
REVOKE INSERT, UPDATE ON public.trips FROM anon;
REVOKE INSERT, UPDATE ON public.trips FROM authenticated;

GRANT INSERT (id, title, description, cover_image_url, notes, details, share_token,
              created_at, updated_at, cover_gradient, created_by, editing_by, editing_since),
      UPDATE (id, title, description, cover_image_url, notes, details, share_token,
              created_at, updated_at, cover_gradient, created_by, editing_by, editing_since)
  ON public.trips TO authenticated;
