-- TRIP-44 (fix) — пере-применить удаление личных документов в anonymize_my_account
-- и подчистить уже осиротевшие строки.
--
-- Предыстория бага: исходная миграция этой задачи была названа 20260627120000,
-- но в dev раньше успела влиться миграция TRIP-46 (20260627180000). При мердже
-- PR #216 CI `db push` увидел нашу миграцию КАК «более раннюю, чем последняя
-- применённая на сервере» (out-of-order) и ПРОПУСТИЛ её — функция в БД осталась
-- старой. При этом edge `deleteMyAccount` задеплоился штатно и начал удалять
-- файлы личных доков из Storage. Итог: файл удалён, а строка trip_documents —
-- нет (RPC её не трогал).
--
-- Фикс: эта миграция носит таймстамп ПОЗЖЕ всех применённых, поэтому `db push`
-- накатит её в правильном порядке. Старый файл 20260627120000 удалён из репозитория
-- (он никогда не был в журнале и иначе вечно ломал бы `db push` как out-of-order).
--
-- 1) CREATE OR REPLACE функции — то, что не доехало (DELETE приватных доков перед
--    обнулением created_by_name). Идемпотентно.
-- 2) Бэкфилл — удалить УЖЕ осиротевшие приватные документы аккаунтов, которые были
--    удалены (deleted_at IS NOT NULL): их строки должны были уйти при удалении
--    аккаунта. Файлы Storage этих строк, если ещё остались, подметутся при удалении
--    трипа (у SQL нет доступа к бакетам); для аккаунтов, удалённых уже с новым edge,
--    файлы уже удалены.

-- 1) Функция ---------------------------------------------------------------
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

-- 2) Бэкфилл уже осиротевших строк ----------------------------------------
-- Приватные документы аккаунтов, которые уже удалены (обезличены) — их строки
-- должны были уйти при удалении аккаунта, но не ушли из-за пропущенной миграции.
delete from public.trip_documents d
using public.users u
where d.created_by = u.id
  and u.deleted_at is not null
  and d.visibility = 'private';
