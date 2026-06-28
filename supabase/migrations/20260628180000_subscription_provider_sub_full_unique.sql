-- TRIP-32 (фикс пост-cutover, смоук dev): сделать uq_subscription_provider_sub
-- ПОЛНЫМ unique-индексом, чтобы он работал как arbiter для upsert(onConflict).
--
-- Причина: вебхук переведён с insert на upsert(onConflict='provider_subscription_id')
-- — это убирает гонку checkout.session.completed ↔ invoice.paid для одной подписки
-- (давала unique-violation → 500 → Stripe retry; видно в логах dev как
-- «invoice.paid insert failed»). PostgREST `ON CONFLICT (provider_subscription_id)`
-- не матчит ЧАСТИЧНЫЙ индекс (тот требует предикат в ON CONFLICT). Полный unique
-- на nullable-колонке ведёт себя так же (несколько NULL допустимо, non-null
-- уникальны) — поэтому конверсия безопасна и данные не трогает.

DROP INDEX IF EXISTS public.uq_subscription_provider_sub;
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_provider_sub
  ON public.subscription (provider_subscription_id);
