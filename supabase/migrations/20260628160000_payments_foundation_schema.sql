-- TRIP-32 / эпик «Платёжный фундамент» — Ф1: чистая greenfield-схема платежей.
--
-- Аддитивная миграция: НИЧЕГО не читает эти таблицы в рантайме на этом этапе.
-- Старый леджер trip_subscriptions остаётся единственным авторитетом до Ф4.
-- Здесь только создаём модель + сидируем каталог + бэкфиллим provider_customer.
--
-- Модель (см. payments-architecture.md, Этап 1):
--   product            — внутренний каталог продуктов (вместо хардкода stripeCatalog.ts)
--   provider_price     — маппинг продукт ↔ объект провайдера (Stripe product), цена
--                        резолвится динамически через default_price (не храним)
--   provider_customer  — связь юзера с платёжной идентичностью провайдера (cus_…)
--   purchase           — разовые покупки (источник Trip Pro)
--   subscription       — подписки (источник Account Pro)
--   webhook_event      — журнал входящих вебхуков (богаче stripe_events)
--   outbound_idempotency — идемпотентность исходящих вызовов (НАШ ключ дедупа /checkout)
--
-- Принципы безопасности (как у P0/TRIP-64): запись в платёжные таблицы — ТОЛЬКО
-- service_role (edge-функции через supabaseAdmin). anon/authenticated: SELECT
-- своих строк там, где это осмысленно (purchase/subscription/provider_customer),
-- и НИЧЕГО на каталоге/журнале/идемпотентности.
--
-- Enum'ы — text + CHECK (конвенция репо: легче расширять без ALTER TYPE).

-- ============================================================================
-- 1. product — внутренний каталог
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.product (
  code             text PRIMARY KEY,
  kind             text NOT NULL CHECK (kind IN ('one_time', 'subscription')),
  scope            text NOT NULL CHECK (scope IN ('trip', 'account')),
  billing_interval text CHECK (billing_interval IN ('month', 'year')),
  active           boolean NOT NULL DEFAULT true,
  metadata         jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.product OWNER TO postgres;
ALTER TABLE public.product ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product FROM anon, authenticated;

INSERT INTO public.product (code, kind, scope, billing_interval) VALUES
  ('trip_pro_lifetime',   'one_time',     'trip',    NULL),
  ('account_pro_monthly', 'subscription', 'account', 'month'),
  ('account_pro_yearly',  'subscription', 'account', 'year')
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- 2. provider_price — маппинг продукта на объект провайдера
-- ============================================================================
-- Якорь — provider_product_id (Stripe prod_…, стабилен). provider_price_id
-- (price_…) НЕ храним обязательным: актуальная цена резолвится динамически через
-- product.default_price (правило «не хардкодить цену», см. stripeCatalog.ts).
-- provider_env разделяет test/live, чтобы одна общая (dev==prod) миграция несла
-- оба набора, а рантайм выбирал строку по режиму секретного ключа.
CREATE TABLE IF NOT EXISTS public.provider_price (
  id                  uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  provider            text NOT NULL DEFAULT 'stripe' CHECK (provider IN ('stripe', 'revenuecat', 'telegram_stars')),
  provider_env        text NOT NULL CHECK (provider_env IN ('test', 'live')),
  provider_product_id text NOT NULL,
  provider_price_id   text,
  product_code        text NOT NULL REFERENCES public.product(code),
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.provider_price OWNER TO postgres;
ALTER TABLE public.provider_price ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_price FROM anon, authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_price_env_product
  ON public.provider_price (provider, provider_env, product_code) WHERE active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_price_product_id
  ON public.provider_price (provider, provider_env, provider_product_id);

-- Сид из stripeCatalog.ts (LIVE_PRODUCTS / TEST_PRODUCTS).
INSERT INTO public.provider_price (provider, provider_env, provider_product_id, product_code) VALUES
  ('stripe', 'live', 'prod_UYfZZsZnknkxDj', 'trip_pro_lifetime'),
  ('stripe', 'live', 'prod_UYfZf8WvFNE3cI', 'account_pro_monthly'),
  ('stripe', 'live', 'prod_UYfZBYzOWrKiLu', 'account_pro_yearly'),
  ('stripe', 'test', 'prod_UZnCx7GA3YlLJd', 'trip_pro_lifetime'),
  ('stripe', 'test', 'prod_UZnBPOlJL0xmue', 'account_pro_monthly'),
  ('stripe', 'test', 'prod_UZnBUDGL1PuyEN', 'account_pro_yearly')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 3. provider_customer — платёжная идентичность юзера у провайдера
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.provider_customer (
  id                   uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id              uuid NOT NULL REFERENCES public.users(id),
  provider             text NOT NULL DEFAULT 'stripe' CHECK (provider IN ('stripe', 'revenuecat', 'telegram_stars')),
  provider_customer_id text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.provider_customer OWNER TO postgres;
ALTER TABLE public.provider_customer ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_customer FROM anon, authenticated;
GRANT SELECT ON public.provider_customer TO authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_customer_provider_cus
  ON public.provider_customer (provider, provider_customer_id);
CREATE INDEX IF NOT EXISTS idx_provider_customer_user
  ON public.provider_customer (user_id);

CREATE POLICY provider_customer_select_own ON public.provider_customer
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Бэкфилл из users.stripe_customer_id (старая колонка живёт переходный период).
INSERT INTO public.provider_customer (user_id, provider, provider_customer_id)
  SELECT id, 'stripe', stripe_customer_id
    FROM public.users
   WHERE stripe_customer_id IS NOT NULL
ON CONFLICT (provider, provider_customer_id) DO NOTHING;

-- ============================================================================
-- 4. purchase — разовые покупки (источник Trip Pro)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.purchase (
  id                uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id           uuid NOT NULL REFERENCES public.users(id),
  trip_id           uuid REFERENCES public.trips(id) ON DELETE SET NULL,
  product_code      text NOT NULL REFERENCES public.product(code),
  provider          text NOT NULL DEFAULT 'stripe' CHECK (provider IN ('stripe', 'revenuecat', 'telegram_stars')),
  provider_charge_id text,
  provider_ref      text,
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'active', 'refunded', 'disputed', 'duplicate')),
  amount            numeric,
  currency          text NOT NULL DEFAULT 'usd',
  purchased_at      timestamptz,
  refunded_at       timestamptz,
  needs_review      boolean NOT NULL DEFAULT false,
  raw               jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.purchase OWNER TO postgres;
ALTER TABLE public.purchase ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchase FROM anon, authenticated;
GRANT SELECT ON public.purchase TO authenticated;

-- Один платёж = одна строка (когда charge известен).
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_provider_charge
  ON public.purchase (provider, provider_charge_id) WHERE provider_charge_id IS NOT NULL;
-- Не более одной АКТИВНОЙ Trip Pro на трип; второй успешный платёж → duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_active_trip
  ON public.purchase (trip_id) WHERE status = 'active' AND trip_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_user ON public.purchase (user_id);
CREATE INDEX IF NOT EXISTS idx_purchase_trip ON public.purchase (trip_id);

CREATE POLICY purchase_select_own ON public.purchase
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ============================================================================
-- 5. subscription — подписки (источник Account Pro)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.subscription (
  id                      uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id                 uuid NOT NULL REFERENCES public.users(id),
  product_code            text NOT NULL REFERENCES public.product(code),
  provider                text NOT NULL DEFAULT 'stripe' CHECK (provider IN ('stripe', 'revenuecat', 'telegram_stars')),
  provider_subscription_id text,
  provider_ref            text,
  status                  text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'trialing', 'active', 'past_due',
                                            'canceled', 'expired', 'incomplete', 'unpaid',
                                            'paused', 'refunded', 'disputed')),
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean NOT NULL DEFAULT false,
  canceled_at             timestamptz,
  amount                  numeric,
  currency                text NOT NULL DEFAULT 'usd',
  billing_interval        text CHECK (billing_interval IN ('month', 'year')),
  collection_state        text NOT NULL DEFAULT 'ok' CHECK (collection_state IN ('ok', 'past_due', 'grace')),
  provider_event_at       timestamptz,
  needs_review            boolean NOT NULL DEFAULT false,
  raw                     jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.subscription OWNER TO postgres;
ALTER TABLE public.subscription ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscription FROM anon, authenticated;
GRANT SELECT ON public.subscription TO authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_provider_sub
  ON public.subscription (provider, provider_subscription_id) WHERE provider_subscription_id IS NOT NULL;
-- Быстрый поиск «есть ли активная подписка у юзера» (деривация Account Pro).
CREATE INDEX IF NOT EXISTS idx_subscription_user_live
  ON public.subscription (user_id) WHERE status IN ('active', 'trialing', 'past_due');

CREATE POLICY subscription_select_own ON public.subscription
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ============================================================================
-- 6. webhook_event — журнал входящих вебхуков (идемпотентность входа)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.webhook_event (
  id                uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  provider          text NOT NULL DEFAULT 'stripe' CHECK (provider IN ('stripe', 'revenuecat', 'telegram_stars')),
  provider_event_id text NOT NULL,
  type              text,
  status            text NOT NULL DEFAULT 'received'
                    CHECK (status IN ('received', 'processing', 'processed', 'failed', 'ignored')),
  signature_valid   boolean,
  payload           jsonb,
  redelivery_count  integer NOT NULL DEFAULT 0,
  attempts          integer NOT NULL DEFAULT 0,
  last_error        text,
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz
);
ALTER TABLE public.webhook_event OWNER TO postgres;
ALTER TABLE public.webhook_event ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webhook_event FROM anon, authenticated;

-- Главный гард идемпотентности входа: один event_id = одна строка.
CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_event_provider_event
  ON public.webhook_event (provider, provider_event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_event_status ON public.webhook_event (status);

-- ============================================================================
-- 7. outbound_idempotency — идемпотентность исходящих вызовов (/checkout)
-- ============================================================================
-- НАШ детерминированный ключ из (user, product, trip): синхронный дедуп двух
-- вкладок в нашей БД, ДО обращения к провайдеру. Это и есть корневое лекарство
-- двойной оплаты (TRIP-32) — закрывается как следствие фундамента.
CREATE TABLE IF NOT EXISTS public.outbound_idempotency (
  idempotency_key text PRIMARY KEY,
  user_id         uuid REFERENCES public.users(id),
  operation       text NOT NULL,
  request_hash    text,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  response        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.outbound_idempotency OWNER TO postgres;
ALTER TABLE public.outbound_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.outbound_idempotency FROM anon, authenticated;
