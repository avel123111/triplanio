-- 0051_widen_trip_subscriptions_status_check
--
-- Ф2/Ф3 made stripe-webhook a single writer that stores the Stripe subscription
-- status verbatim (active/trialing/past_due/canceled/unpaid/incomplete/…) plus
-- charge-derived refunded/disputed. The original CHECK only allowed
-- ('active','cancelled','expired'), so every non-active write (dunning, cancel,
-- refund, dispute, trialing) violated the constraint -> webhook 500 -> Stripe
-- retried forever and entitlement never updated. This widens the set to cover all
-- statuses the code writes. It only ADDS values, so existing rows stay valid;
-- legacy spellings ('cancelled','expired') are kept for back-compat.
--
-- Applied manually (MCP apply_migration) to BOTH projects 2026-06-21:
--   prod tizscxrpuopobgcxbekf, dev nydhzevdizkfaxdlikgc.

alter table trip_subscriptions drop constraint if exists trip_subscriptions_status_check;

alter table trip_subscriptions add constraint trip_subscriptions_status_check
  check (status in (
    -- Stripe subscription statuses (verbatim, recurring rows)
    'active','trialing','past_due','canceled','unpaid','incomplete','incomplete_expired','paused',
    -- charge-derived (refund / chargeback)
    'refunded','disputed',
    -- legacy spellings (pre-Ф2 rows; back-compat)
    'cancelled','expired'
  ));
