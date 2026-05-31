-- Telegram multi-account: many-to-many (trip_id ↔ telegram_chat_id).
-- Identity becomes (trip_id, telegram_chat_id); user_id is "linked_by" only.
-- Applied to dev (nydhzevdizkfaxdlikgc) and prod (tizscxrpuopobgcxbekf) 2026-05-31.

alter table public.trip_telegram_integrations
  alter column telegram_chat_id set not null;

alter table public.trip_telegram_integrations
  alter column user_id drop not null;

alter table public.trip_telegram_integrations
  drop constraint trip_telegram_integrations_user_id_fkey,
  add  constraint trip_telegram_integrations_user_id_fkey
       foreign key (user_id) references public.users(id) on delete set null;

alter table public.trip_telegram_integrations
  add constraint trip_telegram_integrations_trip_chat_uniq
  unique (trip_id, telegram_chat_id);

comment on column public.trip_telegram_integrations.user_id is
  'linked_by: who initiated the binding. NOT part of identity; identity = (trip_id, telegram_chat_id). Nullable + ON DELETE SET NULL.';
