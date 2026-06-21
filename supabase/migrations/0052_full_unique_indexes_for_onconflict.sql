-- 0052_full_unique_indexes_for_onconflict
--
-- 0050 created the upsert keys as PARTIAL unique indexes (WHERE col IS NOT NULL).
-- Supabase .upsert({ onConflict: 'col' }) emits a bare `ON CONFLICT (col)`, which
-- Postgres does NOT bind to a partial index -> every recurring/one-time upsert in
-- stripe-webhook raised 42P10. That error was swallowed (the recurring branches
-- don't check the upsert error), so the ledger row was never written and the user
-- stayed `free` after a successful payment (root cause of the failed test charge).
--
-- Recreate the indexes as FULL unique indexes. The columns are nullable and NULLs
-- are distinct in a btree unique index, so legacy NULL rows are unaffected, but
-- `ON CONFLICT (col)` now binds correctly.
--
-- Applied manually (MCP apply_migration) to BOTH projects 2026-06-21:
--   prod tizscxrpuopobgcxbekf, dev nydhzevdizkfaxdlikgc.
-- This file backfills the repo so a rebuild reproduces the live schema (the DDL is
-- already applied; running it again is a no-op via DROP ... IF EXISTS + recreate).

drop index if exists uq_trip_subs_subscription;
drop index if exists uq_trip_subs_checkout;

create unique index if not exists uq_trip_subs_subscription
  on trip_subscriptions (stripe_subscription_id);

create unique index if not exists uq_trip_subs_checkout
  on trip_subscriptions (stripe_checkout_id);
