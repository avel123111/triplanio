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
-- scrub its PII, delete only purely-personal records, and remove the auth
-- account (done by the edge function via the GoTrue admin API — not possible
-- from SQL). App-store and GDPR rules accept anonymization + retention of
-- legally-required financial data.

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

  -- Scrub the profile row. id stays so shared content keeps a stable author.
  update public.users
  set email      = null,
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

  return jsonb_build_object('code', 'ok');
end;
$$;

revoke all on function public.anonymize_my_account(uuid) from public, anon, authenticated;
grant execute on function public.anonymize_my_account(uuid) to service_role;
