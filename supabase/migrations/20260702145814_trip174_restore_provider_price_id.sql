-- TRIP-174 (P0) — вернуть в схему колонку provider_price.provider_price_id.
--
-- Регресс от гонки двух платёжных PR:
--   * 20260629190000_trip32_drop_dead_payment_columns.sql дропнул provider_price_id
--     как МЁРТВУЮ (на тот момент честно — до TRIP-155 её никто не читал).
--   * 20260701211537_trip155_price_cache_columns.sql (кэш цен) СНОВА сделал её живой
--     в коде (catalog.ts читает row.provider_price_id и делает write-back), но в схему
--     добавил только соседей (unit_amount/currency/recurring_interval/price_synced_at) —
--     саму provider_price_id вернуть забыли.
-- Итог: catalog.ts:67 селектит несуществующую колонку → 42703 →
-- getActiveProviderProducts глотает ошибку и возвращает [] → тихо падает весь
-- каталожный путь (getStripePrices пустой, createStripeCheckout = 500 "No catalog entry").
--
-- Это та колонка, которую миграция TRIP-155 должна была добавить рядом с остальными
-- кэш-полями. Тип text, nullable (у ещё не синхронизированной строки = NULL — как
-- в ProviderProductRow.provider_price_id: string | null). Идемпотентно и безопасно
-- для prod (там колонки нет → создастся вместе с остальными TRIP-155-полями).

ALTER TABLE public.provider_price
  ADD COLUMN IF NOT EXISTS provider_price_id text;
