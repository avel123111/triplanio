-- TRIP-32 / «Платёжный фундамент» — Ф2b: жёсткое переключение на новый реестр + дроп старого.
--
-- Решение Pavel: без параллельной двойной записи. Деривация права читает новый
-- реестр (purchase/subscription), существующие строки trip_subscriptions
-- мигрируются, старая таблица (и stripe_events) ДРОПАЮТСЯ сразу. Edge-функции
-- (webhook/checkout/reconcile/getUserPlan/billingPortal) в этом же PR переведены
-- на новые таблицы — после мерджа в dev ничего не читает дропнутое.
--
-- Единая механика дубля (унификация): одна энтайтлинг-строка на scope
-- (purchase — на trip_id, subscription — на user_id), partial-unique; вторая
-- ложится status='duplicate' + needs_review. Две active подписки у юзера
-- легитимно невозможны (Stripe меняет план НА МЕСТЕ), поэтому инвариант жёсткий.

-- ---------------------------------------------------------------------------
-- 1. subscription: добор полей под деривацию/дубль + жёсткий инвариант
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscription ADD COLUMN IF NOT EXISTS provider_meta jsonb;

-- 'duplicate' в словарь статусов (симметрично purchase) — демотированная вторая
-- энтайтлинг-подписка; деривация её игнорирует.
ALTER TABLE public.subscription DROP CONSTRAINT IF EXISTS subscription_status_check;
ALTER TABLE public.subscription ADD CONSTRAINT subscription_status_check
  CHECK (status IN ('pending', 'trialing', 'active', 'past_due', 'canceled',
                    'expired', 'incomplete', 'unpaid', 'paused', 'refunded',
                    'disputed', 'duplicate'));

-- Жёсткий инвариант «одна энтайтлинг-подписка на юзера» (провайдер-агностично —
-- бэкстоп и против двойной оплаты через двух провайдеров). Заменяет не-уникальный
-- idx из Ф1.
DROP INDEX IF EXISTS public.idx_subscription_user_live;
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_user_live
  ON public.subscription (user_id) WHERE status IN ('active', 'trialing', 'past_due');

-- ---------------------------------------------------------------------------
-- 2. Деривация права читает новый реестр (единственный писатель кэша)
-- ---------------------------------------------------------------------------
-- Account Pro: max период по энтайтлинг-подпискам юзера (past_due — грейс как раньше).
CREATE OR REPLACE FUNCTION public.recompute_user_entitlement(p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
declare
  v_end timestamptz;
begin
  select max(
    case
      when s.status = 'past_due' then
        greatest(
          coalesce(
            (s.provider_meta->>'next_payment_attempt')::timestamptz + interval '1 day',
            now() + interval '3 days'
          ),
          now() + interval '1 minute'
        )
      else s.current_period_end
    end
  )
  into v_end
  from subscription s
  where s.user_id = p_user_id
    and s.product_code in ('account_pro_monthly', 'account_pro_yearly')
    and s.status in ('active', 'trialing', 'past_due');

  if v_end is not null then
    update users set subscription_status = 'pro', subscription_end_date = v_end where id = p_user_id;
  else
    update users set subscription_status = 'free', subscription_end_date = null where id = p_user_id;
  end if;
end;
$$;
ALTER FUNCTION public.recompute_user_entitlement(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.recompute_user_entitlement(uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.recompute_user_entitlement(uuid) TO service_role;

-- Trip Pro (разовая): trips.is_pro_trip = есть активная trip_pro_lifetime покупка трипа.
-- Раньше webhook писал is_pro_trip напрямую; теперь это деривация из purchase.
CREATE OR REPLACE FUNCTION public.recompute_trip_entitlement(p_trip_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
begin
  update trips
     set is_pro_trip = exists(
       select 1 from purchase p
       where p.trip_id = p_trip_id
         and p.product_code = 'trip_pro_lifetime'
         and p.status = 'active'
     )
   where id = p_trip_id;
end;
$$;
ALTER FUNCTION public.recompute_trip_entitlement(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.recompute_trip_entitlement(uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.recompute_trip_entitlement(uuid) TO service_role;

-- Гард удаления аккаунта читал trip_subscriptions → переводим на subscription
-- (тело функции без изменений, кроме источника подписки; энтайтлинг-статусы).
CREATE OR REPLACE FUNCTION public.anonymize_my_account(p_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
declare v_active_sub int;
begin
  if p_user_id is null then return jsonb_build_object('code','unauthorized'); end if;

  select count(*) into v_active_sub from public.subscription
  where user_id = p_user_id
    and product_code in ('account_pro_monthly','account_pro_yearly')
    and status in ('active','trialing','past_due');
  if v_active_sub > 0 then return jsonb_build_object('code','active_subscription'); end if;

  -- purely-personal records
  delete from public.chat_reads             where user_id = p_user_id;
  delete from public.notifications          where user_id = p_user_id;
  delete from public.telegram_link_tokens   where user_id = p_user_id;
  delete from public.telegram_reminder_logs where user_id = p_user_id;
  delete from public.trip_telegram_integrations where user_id = p_user_id;
  delete from public.user_custom_visits     where user_id = p_user_id;
  delete from public.trip_member_blocks     where user_id = p_user_id;

  delete from public.trip_documents where created_by = p_user_id and visibility = 'private';

  update public.users
  set email='deleted+'||p_user_id::text||'@deleted.invalid', full_name=null, avatar_url=null, deleted_at=now()
  where id = p_user_id;

  update public.trip_members set user_full_name=null, invite_email=null where user_id = p_user_id;

  update public.chat_messages  set user_full_name = null where user_id   = p_user_id;
  update public.trip_documents set created_by_name = null where created_by = p_user_id;

  delete from auth.sessions   where user_id = p_user_id;
  delete from auth.identities where user_id = p_user_id;
  update auth.users set email='deleted+'||p_user_id::text||'@deleted.invalid', updated_at=now() where id = p_user_id;

  return jsonb_build_object('code','ok');
end; $$;

-- ---------------------------------------------------------------------------
-- 3. Миграция данных trip_subscriptions → purchase / subscription
-- ---------------------------------------------------------------------------
-- Разовые → purchase. distinct on (trip_id) среди active гарантирует инвариант
-- «одна active на трип»; не-active (refunded/disputed) переносим как есть.
INSERT INTO public.purchase
  (user_id, trip_id, product_code, provider, provider_charge_id, provider_ref,
   status, amount, currency, purchased_at, created_at)
SELECT DISTINCT ON (ts.trip_id, (ts.status = 'active'))
       ts.user_id, ts.trip_id, 'trip_pro_lifetime', coalesce(ts.provider, 'stripe'),
       ts.stripe_payment_intent_id, ts.stripe_checkout_id,
       case ts.status when 'active' then 'active'
                      when 'refunded' then 'refunded'
                      when 'disputed' then 'disputed'
                      else 'duplicate' end,
       ts.amount_paid, coalesce(ts.currency, 'usd'), ts.start_date, ts.created_at
  FROM public.trip_subscriptions ts
 WHERE ts.type = 'pro_trip' AND ts.user_id IS NOT NULL
 ORDER BY ts.trip_id, (ts.status = 'active'), ts.start_date DESC NULLS LAST
ON CONFLICT DO NOTHING;

-- Подписки → subscription. row_number демотирует вторую энтайтлинг-строку юзера
-- в 'duplicate'+needs_review (соблюдает uq_subscription_user_live). Нормализуем
-- британское 'cancelled'→'canceled', 'incomplete_expired'→'expired'.
INSERT INTO public.subscription
  (user_id, product_code, provider, provider_subscription_id, provider_ref,
   status, current_period_end, cancel_at_period_end, amount, currency,
   billing_interval, needs_review, created_at)
SELECT t.user_id,
       case t.type when 'pro_monthly' then 'account_pro_monthly' else 'account_pro_yearly' end,
       coalesce(t.provider, 'stripe'), t.stripe_subscription_id, t.stripe_checkout_id,
       case when t.entitling AND t.rn > 1 then 'duplicate' else t.norm_status end,
       t.current_period_end, coalesce(t.cancel_at_period_end, false), t.amount_paid,
       coalesce(t.currency, 'usd'),
       case t.type when 'pro_monthly' then 'month' else 'year' end,
       (t.entitling AND t.rn > 1),
       t.created_at
  FROM (
    SELECT ts.*,
           case ts.status when 'cancelled' then 'canceled'
                          when 'incomplete_expired' then 'expired'
                          else ts.status end as norm_status,
           (ts.status in ('active', 'trialing', 'past_due')) as entitling,
           row_number() over (
             partition by ts.user_id, (ts.status in ('active', 'trialing', 'past_due'))
             order by ts.start_date desc nulls last
           ) as rn
      FROM public.trip_subscriptions ts
     WHERE ts.type in ('pro_monthly', 'pro_yearly') AND ts.user_id IS NOT NULL
  ) t
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Дроп старого (решение Pavel — сразу, на 0 клиентов)
-- ---------------------------------------------------------------------------
-- Идемпотентность вебхука теперь в webhook_event; trip_subscriptions заменён
-- purchase/subscription. Ни одна edge-функция после этого PR их не читает.
DROP TABLE IF EXISTS public.trip_subscriptions;
DROP TABLE IF EXISTS public.stripe_events;
