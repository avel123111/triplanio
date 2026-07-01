-- TRIP-155: локальный кэш цен (lazy TTL) — убрать live-Stripe с горячего чтения.
--
-- getStripePrices (каталог) и getUserPlan.readActualPrice (фактическая цена юзера)
-- ходили в Stripe на КАЖДЫЙ запрос. Теперь цена материализуется в БД + метка
-- свежести price_synced_at; на чтении Stripe дёргается ТОЛЬКО когда запись
-- протухла (первый зашедший юзер перезаписывает кэш, остальные читают из БД).
-- Ни крона, ни новых вебхук-событий не вводим.

-- Каталог: материализация резолвнутой цены (default_price) + метка синхронизации.
ALTER TABLE public.provider_price
  ADD COLUMN IF NOT EXISTS unit_amount        bigint,
  ADD COLUMN IF NOT EXISTS currency           text,
  ADD COLUMN IF NOT EXISTS recurring_interval text,
  ADD COLUMN IF NOT EXISTS price_synced_at    timestamptz;

-- Подписка: amount/currency/billing_interval уже есть (фактическая цена юзера);
-- добавляем только метку свежести для lazy-refresh при чтении плана.
ALTER TABLE public.subscription
  ADD COLUMN IF NOT EXISTS price_synced_at timestamptz;
