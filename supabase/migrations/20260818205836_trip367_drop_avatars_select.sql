-- TRIP-367 (follow-up к 20260818194500): снимаем `avatars_select`.
--
-- 20260818194500 вернул owner-scoped `avatars_select`, чтобы `upsert:true`
-- (`INSERT … ON CONFLICT DO UPDATE`) прошёл под RLS. Но это столкнулось с
-- инвариантом TRIP-48 «публичный бакет = ноль SELECT-политик» (гард 2e
-- `check-security-tiers`) и заморозило дев-деплой.
--
-- Правильный паттерн аватара — не SELECT-политика, а уникальный ключ на версию
-- (`<uid>/<uuid>`) + указатель в профиле, БЕЗ `upsert`. Плоский INSERT в новый
-- ключ конфликта не даёт → SELECT-политика не нужна (то же, что делают обложки
-- трипа и официальный Supabase-пример аватаров). Смена ключа реализована во
-- фронте (`ScreenAccount.handleAvatarUpload`); здесь снимаем ставшую ненужной
-- политику, чтобы восстановить инвариант 2e и разморозить деплой.
--
-- Обёртка/идемпотентность — как в 20260713120000 / 20260811143722.
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'storage.objects not present — skipping drop of avatars_select';
    RETURN;
  END IF;

  EXECUTE $p$ DROP POLICY IF EXISTS "avatars_select" ON storage.objects $p$;
END $$;
