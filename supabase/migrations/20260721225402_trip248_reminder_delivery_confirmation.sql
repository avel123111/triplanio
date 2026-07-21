-- TRIP-248: split "claim" from "delivered" for Telegram reminders.
--
-- getPendingReminders inserts a telegram_reminder_logs row (sent_at = now())
-- BEFORE handing the reminder to n8n, as an anti-double-send claim. So today a
-- row means "dispatched to n8n", not "delivered to Telegram". If delivery then
-- fails silently (n8n run still reports success), the reminder is lost forever
-- and nothing notices — this is exactly the TRIP-248 incident.
--
-- These two columns let the n8n "Mark delivered" node record the real send:
--   sent_at      = handed to n8n (claim, written by the edge function)
--   delivered_at = Telegram actually sent (written by n8n after Send text)
--   output       = the exact message text that was sent (kept for audit/debug)
-- A later watchdog can then alert on rows that were claimed but never delivered.

alter table public.telegram_reminder_logs
  add column if not exists delivered_at timestamptz,
  add column if not exists output       text;

-- Cap the free-text column (input-integrity layer, CI guard 2g). Telegram's
-- hard message limit is 4096 chars, so the sent text can never exceed it.
alter table public.telegram_reminder_logs
  add constraint telegram_reminder_logs_output_len
  check (output is null or char_length(output) <= 4096);

-- Grandfather every existing row as delivered, otherwise a future
-- undelivered-watchdog would fire on the entire historical backlog. Safe:
-- these events are already in the past.
update public.telegram_reminder_logs
   set delivered_at = sent_at
 where delivered_at is null;

-- Narrow partial index for the watchdog scan "claimed but not delivered".
create index if not exists idx_reminder_logs_undelivered
  on public.telegram_reminder_logs (sent_at)
  where delivered_at is null;
