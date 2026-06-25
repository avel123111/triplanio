-- 0050_payments_entitlement_foundation.sql
-- Payments Ф2 — entitlement foundation.
-- Goal (root problems #1/#3): make trip_subscriptions the single source of truth and
-- users.subscription_* / trips.is_pro_trip a derived cache written ONLY by
-- recompute_user_entitlement(). Real Stripe current_period_end replaces now+30/365.
-- Additive & idempotent (IF NOT EXISTS); safe to run on both projects.

-- users: customer id (Ф3 populate) + reconcile throttle column (Ф3 use)
alter table users add column if not exists stripe_customer_id text;
create index if not exists idx_users_stripe_customer on users(stripe_customer_id);
alter table users add column if not exists entitlement_synced_at timestamptz;

-- trip_subscriptions: status-driven entitlement + cheap multi-provider задел (form only)
alter table trip_subscriptions add column if not exists provider text not null default 'stripe';
alter table trip_subscriptions add column if not exists platform text not null default 'web';
alter table trip_subscriptions add column if not exists current_period_end timestamptz;
alter table trip_subscriptions add column if not exists cancel_at_period_end boolean not null default false;
alter table trip_subscriptions add column if not exists provider_meta jsonb;

-- upsert keys (webhook writes ledger via on-conflict). Partial unique: NULLs allowed,
-- no clash with legacy rows. Verified no existing duplicates in prod/dev before adding.
create unique index if not exists uq_trip_subs_subscription
  on trip_subscriptions(stripe_subscription_id) where stripe_subscription_id is not null;
create unique index if not exists uq_trip_subs_checkout
  on trip_subscriptions(stripe_checkout_id) where stripe_checkout_id is not null;

-- Single writer of the user-level cache. STATUS-driven (Stripe status verbatim):
-- active/trialing/past_due hold Pro; everything else (canceled/unpaid/refunded/disputed/…) does not.
-- subscription_end_date is what the fail-closed frontend gate (isProActive: end>now) reads,
-- so for past_due it must be a FUTURE date: next_payment_attempt (Ф3, from provider_meta)
-- or a 3-day fallback. Idempotent, transactional, no external calls.
create or replace function recompute_user_entitlement(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_end timestamptz;
begin
  select max(
    case
      when ts.status = 'past_due' then
        greatest(
          coalesce(
            (ts.provider_meta->>'next_payment_attempt')::timestamptz + interval '1 day',
            now() + interval '3 days'
          ),
          now() + interval '1 minute'
        )
      else coalesce(ts.current_period_end, ts.end_date)
    end
  )
  into v_end
  from trip_subscriptions ts
  where ts.user_id = p_user_id
    and ts.type in ('pro_monthly', 'pro_yearly')
    and ts.status in ('active', 'trialing', 'past_due');

  if v_end is not null then
    update users
       set subscription_status = 'pro',
           subscription_end_date = v_end
     where id = p_user_id;
  else
    update users
       set subscription_status = 'free',
           subscription_end_date = null
     where id = p_user_id;
  end if;
end;
$$;
