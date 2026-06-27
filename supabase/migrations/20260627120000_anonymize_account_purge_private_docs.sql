-- TRIP-44 — при удалении аккаунта удалять ЛИЧНЫЕ документы по всем трипам.
--
-- Раньше anonymize_my_account только обнуляла created_by_name на trip_documents
-- (PII-снапшот), а сами строки личных документов (visibility='private') и их
-- файлы оставались по всем трипам удалённого аккаунта — скан паспорта/визы
-- продолжал лежать в БД и Storage.
--
-- Здесь добавляем удаление СТРОК личных документов пользователя (по всем трипам)
-- внутри той же транзакции. Файлы Storage чистит edge deleteMyAccount (у RPC нет
-- доступа к бакетам): он собирает storage_path личных доков ДО вызова RPC и
-- удаляет осиротевшие файлы ПОСЛЕ (best-effort, Storage-guard «Вариант A»).
--
-- Shared-документы (общий контент трипа) остаются, их created_by_name обнуляется
-- как и прежде. Порядок важен: сначала DELETE приватных, затем UPDATE имени на
-- оставшихся (shared) строках.

CREATE OR REPLACE FUNCTION "public"."anonymize_my_account"("p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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

  -- Personal documents across ALL trips (TRIP-44). Files in Storage are purged by
  -- the deleteMyAccount edge (no Storage access here). Must run BEFORE the
  -- created_by_name scrub below so only the retained shared rows get scrubbed.
  delete from public.trip_documents where created_by = p_user_id and visibility = 'private';

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
end; $$;
