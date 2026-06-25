-- 0063_anonymize_scrub_author_name_snapshots
--
-- Extend anonymize_my_account (TRIP-78 account soft-delete) to also scrub the
-- denormalized author-name snapshots on RETAINED content:
--   - chat_messages.user_full_name  (pre-existing snapshot — was never scrubbed)
--   - trip_documents.created_by_name (added in 0062 for the chat+docs author
--     resolution mechanism, src/lib/resolveAuthor.js)
--
-- Why: anonymization already nulls the trip_members.user_full_name/invite_email
-- cache "иначе настоящее имя продолжало бы светиться". The same reasoning
-- applies to these two snapshots — without this, a deleted user's real name
-- lingered in the DB at rest. Display is unaffected (resolveAuthor checks the
-- live is_deleted profile BEFORE the snapshot, so the UI shows "deleted
-- account" either way); this purely removes the retained PII.
--
-- CREATE OR REPLACE keeps the signature, so no DROP needed. Idempotent and safe
-- to run on dev + prod.

CREATE OR REPLACE FUNCTION public.anonymize_my_account(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_active_sub int;
begin
  if p_user_id is null then return jsonb_build_object('code','unauthorized'); end if;

  select count(*) into v_active_sub from public.trip_subscriptions
  where user_id = p_user_id and type in ('pro_monthly','pro_yearly') and status='active';
  if v_active_sub > 0 then return jsonb_build_object('code','active_subscription'); end if;

  -- purely-personal records
  delete from public.chat_reads             where user_id = p_user_id;
  delete from public.notifications          where user_id = p_user_id;
  delete from public.telegram_link_tokens   where user_id = p_user_id;
  delete from public.telegram_reminder_logs where user_id = p_user_id;
  delete from public.trip_telegram_integrations where user_id = p_user_id;
  delete from public.user_custom_visits     where user_id = p_user_id;
  delete from public.trip_member_blocks     where user_id = p_user_id;

  update public.users
  set email='deleted+'||p_user_id::text||'@deleted.invalid', full_name=null, avatar_url=null, deleted_at=now()
  where id = p_user_id;

  update public.trip_members set user_full_name=null, invite_email=null where user_id = p_user_id;

  -- Scrub denormalized author-name snapshots on RETAINED content (PII at rest).
  -- Display already renders "deleted account" via is_deleted, so this only
  -- removes the lingering real name from the row. Mirrors the trip_members
  -- cache scrub above. chat_messages.user_full_name = pre-existing snapshot;
  -- trip_documents.created_by_name = added in 0062.
  update public.chat_messages  set user_full_name = null where user_id   = p_user_id;
  update public.trip_documents set created_by_name = null where created_by = p_user_id;

  delete from auth.sessions   where user_id = p_user_id;
  delete from auth.identities where user_id = p_user_id;
  update auth.users set email='deleted+'||p_user_id::text||'@deleted.invalid', updated_at=now() where id = p_user_id;

  return jsonb_build_object('code','ok');
end; $function$;
