-- TRIP-282 — drop the two dead e-mail notification preferences.
--
-- `users.notify_email_invites` / `notify_email_updates` were written by the
-- account screen and read by NOBODY: no edge function, no trigger, no n8n
-- workflow ever looked at them. The product sends exactly two e-mails
-- (inviteTripMember + resendTripInvite, both unconditional), and there is no
-- "trip updates" e-mail channel at all — so the toggles promised a control that
-- did not exist. The UI is removed in the same PR; nothing reads or writes
-- these columns any more.
--
-- Contract phase: no data to preserve — every row in dev and prod carries the
-- `true` default, nobody ever flipped either flag.
--
-- ddl-guard: allow-destructive — TRIP-282, contract, columns unused (the only
-- writer was ScreenAccount.jsx, removed in this PR; zero readers repo-wide).

alter table public.users
  drop column if exists notify_email_invites,
  drop column if exists notify_email_updates;
