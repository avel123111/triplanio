-- TRIP-32 (гигиена платёжного фундамента) — дроп мёртвых полей схемы.
--
-- Аудит 2026-06-29: эти колонки нигде в рантайме НЕ читаются (проверено grep'ом по
-- edge-функциям, RPC/RLS и фронту). Большинство и не пишутся; collection_state
-- ПИСАЛСЯ вебхуком, но не читался ни одним потребителем (грейс держит recompute по
-- provider_meta.next_payment_attempt, статус — по subscription.status), поэтому был
-- write-only — записи убраны в этом же PR (stripe-webhook). Дроп безопасен.
--
-- Это аддитивная зачистка: ничего не зависит от дропаемых колонок.

ALTER TABLE public.purchase        DROP COLUMN IF EXISTS raw;

ALTER TABLE public.subscription    DROP COLUMN IF EXISTS raw;
ALTER TABLE public.subscription    DROP COLUMN IF EXISTS current_period_start;
ALTER TABLE public.subscription    DROP COLUMN IF EXISTS collection_state;

ALTER TABLE public.webhook_event   DROP COLUMN IF EXISTS redelivery_count;
ALTER TABLE public.webhook_event   DROP COLUMN IF EXISTS attempts;

ALTER TABLE public.provider_price  DROP COLUMN IF EXISTS provider_price_id;
