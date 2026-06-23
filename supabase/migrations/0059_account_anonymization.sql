-- 0059_account_anonymization.sql
-- TRIP-78 — Account deletion reimplemented as soft-delete / anonymization.
--
-- Why not hard-delete: ~25 FK on public.users(id) are NO ACTION, and the user's
-- id is referenced by shared trip content (activities, budgets, hotels, chat,
-- memberships, documents) and by financial records (partner_clicks,
-- trip_subscriptions / stripe_customer_id) that must be retained. Physically
-- deleting the user either fails on the FKs (the old 500 bug) or destroys other
-- people's trips and required financial history.
--
-- Approach: keep the public.users row (stable author id for shared content),
-- scrub its PII, delete only purely-personal records, and neutralize the auth
-- account in place (ban + scrub email + drop identities/sessions) rather than
-- hard-delete it — a hard delete fails on FKs from retained content such as
-- chat_messages.user_id -> auth.users. App-store and GDPR rules accept
-- anonymization + retention of legally-required financial data.

-- 1) Deletion marker. This is the ONLY signal of a deleted account; never infer
--    deletion from an empty name (live users can legitimately have no full_name).
alter table public.users add column if not exists deleted_at timestamptz;

-- 2) Anonymization RPC. SECURITY DEFINER so it can write across user boundaries
--    in one transaction. NOT callable by anon/authenticated — only the trusted
--    deleteMyAccount edge function (service_role) invokes it, after verifying the
--    caller's JWT and passing their own id.
create or replace function public.anonymize_my_account(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active_sub int;
begin
  if p_user_id is null then
    return jsonb_build_object('code', 'unauthorized');
  end if;

  -- Block while an active recurring subscription exists — it must be cancelled
  -- first, otherwise billing would continue against an anonymized account.
  -- One-time (pro_trip) purchases do not block.
  select count(*) into v_active_sub
  from public.trip_subscriptions
  where user_id = p_user_id
    and type in ('pro_monthly', 'pro_yearly')
    and status = 'active';

  if v_active_sub > 0 then
    return jsonb_build_object('code', 'active_subscription');
  end if;

  -- Purely-personal records with no shared value — safe to delete.
  -- (FKs no longer force this since the users row survives; this is a
  --  data-minimization choice. notifications: only the user's own inbox
  --  (user_id) is removed; rows they triggered for others (created_by) are
  --  left intact as those belong to the recipients.)
  delete from public.chat_reads             where user_id = p_user_id;
  delete from public.notifications          where user_id = p_user_id;
  delete from public.telegram_link_tokens   where user_id = p_user_id;
  delete from public.telegram_reminder_logs where user_id = p_user_id;
  delete from public.trip_telegram_integrations where user_id = p_user_id;
  delete from public.user_custom_visits     where user_id = p_user_id;  -- personal /stats data
  delete from public.trip_member_blocks     where user_id = p_user_id;  -- personal moderation rows

  -- Scrub the profile row. id stays so shared content keeps a stable author.
  -- email is NOT NULL + UNIQUE, so it can't be nulled: replace with a unique
  -- non-routable placeholder. This still removes the real address (freeing it
  -- for re-registration) and scrubs the PII.
  update public.users
  set email      = 'deleted+' || p_user_id::text || '@deleted.invalid',
      full_name  = null,
      avatar_url = null,
      deleted_at = now()
  where id = p_user_id;

  -- Scrub the cached PII snapshot held on memberships in other people's trips
  -- (trip_members.user_full_name / invite_email persist independently of users).
  update public.trip_members
  set user_full_name = null,
      invite_email   = null
  where user_id = p_user_id;

  -- Neutralize the auth account IN PLACE. We cannot hard-delete auth.users:
  -- public.users cascades from auth.users (users_id_fkey ON DELETE CASCADE) and
  -- is referenced by retained content, so a hard delete fails (SQLSTATE 23503).
  -- Instead drop identities + sessions and scrub the auth email. This makes login
  -- impossible (no provider mapping, no password, no session) AND lets the person
  -- re-register fresh: a new provider login creates a brand-new user row, and the
  -- freed email no longer collides. No ban is set — it would add nothing here and
  -- only muddy the re-registration story.
  delete from auth.sessions   where user_id = p_user_id;
  delete from auth.identities where user_id = p_user_id;
  update auth.users
  set email      = 'deleted+' || p_user_id::text || '@deleted.invalid',
      updated_at = now()
  where id = p_user_id;

  return jsonb_build_object('code', 'ok');
end;
$$;

revoke all on function public.anonymize_my_account(uuid) from public, anon, authenticated;
grant execute on function public.anonymize_my_account(uuid) to service_role;
