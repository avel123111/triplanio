-- 0040_password_reset_attempts.sql
-- Backs the /login auth-UX hardening:
--   1) signup: detect already-registered emails               (edge fn: signupPrecheck)
--   2) reset:  detect unknown emails + rate-limit the requests (edge fn: requestPasswordReset)
--
-- Two objects:
--   A) public.password_reset_attempts — ledger for the 5/hour-per-email limit.
--   B) public.auth_email_status(text) — security-definer lookup over auth.users,
--      callable ONLY by service_role (the edge functions). It is an email-
--      enumeration oracle by design, so it must never be exposed to anon.

-- ── A) Rate-limit ledger ──────────────────────────────────────────────────────
create table if not exists public.password_reset_attempts (
  id          bigserial   primary key,
  email       text        not null,
  created_at  timestamptz not null default now()
);

-- Only lookup pattern: attempts for one email within a rolling window.
create index if not exists idx_pwd_reset_attempts_email_time
  on public.password_reset_attempts (lower(email), created_at desc);

-- Lock it down: only the service role (bypasses RLS) ever touches this table.
alter table public.password_reset_attempts enable row level security;
-- Intentionally NO policies → anon / authenticated cannot read or write.
revoke all on public.password_reset_attempts from anon, authenticated;

-- ── B) Email-status lookup (service-role only) ────────────────────────────────
-- Returns a single row describing the email across auth.users + auth.identities:
--   exists_user  — any account with this email
--   is_confirmed — at least one such account has confirmed its email
--   has_password — an email/password identity exists (provider = 'email')
--   has_oauth    — a social identity exists (provider <> 'email', e.g. google/apple)
create or replace function public.auth_email_status(p_email text)
returns table (
  exists_user  boolean,
  is_confirmed boolean,
  has_password boolean,
  has_oauth    boolean
)
language sql
security definer
set search_path = public, auth
as $$
  select
    count(u.*) > 0                                                            as exists_user,
    coalesce(bool_or(u.email_confirmed_at is not null), false)                as is_confirmed,
    coalesce(bool_or(i.provider = 'email'), false)                            as has_password,
    coalesce(bool_or(i.provider is not null and i.provider <> 'email'), false) as has_oauth
  from auth.users u
  left join auth.identities i on i.user_id = u.id
  where lower(u.email) = lower(p_email);
$$;

-- Enumeration oracle — keep it off the public API surface entirely.
revoke all on function public.auth_email_status(text) from public, anon, authenticated;
grant execute on function public.auth_email_status(text) to service_role;
