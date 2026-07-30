-- TRIP-311 — where a signup came from, on the account itself.
--
-- The campaign mark used everywhere else (TRIP-316) rides PostHog's storage, and
-- PostHog does not exist for anyone who has not agreed to cookies. These four
-- columns are the ONLY attribution that survives a refusal, which is what keeps
-- "which campaign produced this signup" answerable for the whole funnel rather
-- than only for the consenting part of it.
--
-- Written exactly once, when the profile row is created (AuthContext), and never
-- updated afterwards: this is the birth fact of the account, not a live value.
-- The data is UNTRUSTED — it starts life in a query string a stranger controls
-- and travels through client-editable auth metadata — so it feeds marketing
-- reporting only. Nothing gates, limits, prices or bills on it, and there are no
-- policy changes: the columns live on `users`, already covered by its RLS.
--
-- `public.short_text` caps length at 300 (TRIP-169 input-integrity layer), so a
-- pasted novel in utm_campaign cannot bloat the row. NULL means the visit simply
-- carried no marks, which is the normal case for direct and organic traffic.
alter table public.users
  add column if not exists signup_utm_source   public.short_text,
  add column if not exists signup_utm_medium   public.short_text,
  add column if not exists signup_utm_campaign public.short_text,
  add column if not exists signup_gclid        public.short_text;

comment on column public.users.signup_utm_source   is 'utm_source of the visit that created this account (TRIP-311). Untrusted, marketing reporting only.';
comment on column public.users.signup_utm_medium   is 'utm_medium of the visit that created this account (TRIP-311). Untrusted, marketing reporting only.';
comment on column public.users.signup_utm_campaign is 'utm_campaign of the visit that created this account (TRIP-311). Untrusted, marketing reporting only.';
comment on column public.users.signup_gclid        is 'Google click id of the visit that created this account (TRIP-311). Untrusted, marketing reporting only.';
