-- TRIP-248: delivery watchdog for Telegram reminders (pg_cron).
--
-- Depends on the delivered_at column (previous migration). A reminder whose
-- claim row (sent_at) never gets a delivered_at stamp means "handed to n8n but
-- never sent" — a silent non-delivery. This watchdog runs in Postgres itself
-- (independent of n8n: catches even a fully-down n8n) and posts to the same
-- Sentry ingest DSN the n8n workflows already use. Alert-only; re-delivery, if
-- ever wanted, is a separate opt-in.

-- caps-guard: allow-uncapped — no new table columns here; `v_trips text` is a
-- plpgsql local variable (aggregated trip id list for the alert), not a column.

-- pg_net is already enabled (baseline); pg_cron is available but not yet on.
create extension if not exists pg_cron;

-- Checks for claimed-but-undelivered reminders and fires one Sentry event when
-- any exist. SECURITY INVOKER (runs as the cron owner); execute is revoked from
-- the public role so only the scheduler can call it — never anon/authenticated.
create or replace function public.tg_reminders_undelivered_watchdog()
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count  int;
  v_oldest timestamptz;
  v_trips  text;
begin
  -- Uses idx_reminder_logs_undelivered. Lower bound (30 min) clears the current
  -- delivery tick (window 20 min, delivery takes seconds); upper bound (24 h)
  -- keeps the alert from re-firing forever on ancient rows.
  select count(*), min(sent_at), coalesce(string_agg(distinct trip_id::text, ', '), '')
    into v_count, v_oldest, v_trips
  from public.telegram_reminder_logs
  where delivered_at is null
    and sent_at < now() - interval '30 minutes'
    and sent_at > now() - interval '24 hours';

  if coalesce(v_count, 0) = 0 then
    return;
  end if;

  -- Same Sentry DSN as the n8n reminder workflows. Stable fingerprint so Sentry
  -- groups repeat firings into one issue instead of spamming. environment is
  -- hardcoded 'production': on dev this query finds nothing (history backfilled
  -- as delivered, no live reminder traffic), so it never posts there.
  perform net.http_post(
    url := 'https://o4511457186283520.ingest.de.sentry.io/api/4511498293870672/store/?sentry_key=9c578daf4586c7383f902d365a22b983&sentry_version=7',
    body := jsonb_build_object(
      'platform', 'other',
      'level', 'error',
      'logger', 'pg_cron',
      'environment', 'production',
      'message', format('TG Reminders: %s reminder(s) claimed but not delivered', v_count),
      'tags', jsonb_build_object('surface', 'supabase', 'check', 'tg_reminders_undelivered'),
      'fingerprint', jsonb_build_array('supabase', 'tg-reminders', 'undelivered'),
      'extra', jsonb_build_object('count', v_count, 'oldest_sent_at', v_oldest, 'trips', v_trips)
    ),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
end;
$$;

revoke all on function public.tg_reminders_undelivered_watchdog() from public;

-- Every 15 min, offset +7 so it runs after the delivery tick (0/15/30/45), not
-- alongside it. Re-scheduling the same job name is idempotent in pg_cron.
select cron.schedule(
  'tg-reminders-undelivered',
  '7,22,37,52 * * * *',
  $$ select public.tg_reminders_undelivered_watchdog(); $$
);
