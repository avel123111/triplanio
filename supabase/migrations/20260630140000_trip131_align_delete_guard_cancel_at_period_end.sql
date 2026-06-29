-- TRIP-131: выровнять бек-гард удаления аккаунта по фронту.
--
-- Фронт (ScreenAccount: hasActiveSub = isPro && !plan.cancelled) разрешает удаление
-- аккаунта, если подписка ЗАПЛАНИРОВАНА к отмене (cancel_at_period_end=true), даже
-- пока статус ещё энтайтлинг ('active'/'trialing'/'past_due') и Pro действует до
-- конца оплаченного периода. Бек же блокировал при ЛЮБОЙ энтайтлинг-подписке →
-- юзер видел диалог удаления, а сервер отбивал 'active_subscription'.
--
-- Приводим к единой логике: блокируем удаление только при энтайтлинг-подписке БЕЗ
-- запланированной отмены. При cancel_at_period_end=true отмена уже инициирована,
-- авто-продления не будет → orphan-charge не возникнет, заставлять ждать конца
-- периода не нужно (требование сторов).
--
-- Изменено единственное условие гарда (+ cancel_at_period_end = false); остальное
-- тело функции идентично деплою (миграция 20260628170000). Правка вынесена в новую
-- миграцию: тот файл уже в журнале → db push его повторно не накатывает.
CREATE OR REPLACE FUNCTION public.anonymize_my_account(p_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
declare v_active_sub int;
begin
  if p_user_id is null then return jsonb_build_object('code','unauthorized'); end if;

  select count(*) into v_active_sub from public.subscription
  where user_id = p_user_id
    and product_code in ('account_pro_monthly','account_pro_yearly')
    and status in ('active','trialing','past_due')
    and cancel_at_period_end = false;
  if v_active_sub > 0 then return jsonb_build_object('code','active_subscription'); end if;

  -- purely-personal records
  delete from public.chat_reads             where user_id = p_user_id;
  delete from public.notifications          where user_id = p_user_id;
  delete from public.telegram_link_tokens   where user_id = p_user_id;
  delete from public.telegram_reminder_logs where user_id = p_user_id;
  delete from public.trip_telegram_integrations where user_id = p_user_id;
  delete from public.user_custom_visits     where user_id = p_user_id;
  delete from public.trip_member_blocks     where user_id = p_user_id;

  delete from public.trip_documents where created_by = p_user_id and visibility = 'private';

  update public.users
  set email='deleted+'||p_user_id::text||'@deleted.invalid', full_name=null, avatar_url=null, deleted_at=now()
  where id = p_user_id;

  update public.trip_members set user_full_name=null, invite_email=null where user_id = p_user_id;

  update public.chat_messages  set user_full_name = null where user_id   = p_user_id;
  update public.trip_documents set created_by_name = null where created_by = p_user_id;

  delete from auth.sessions   where user_id = p_user_id;
  delete from auth.identities where user_id = p_user_id;
  update auth.users set email='deleted+'||p_user_id::text||'@deleted.invalid', updated_at=now() where id = p_user_id;

  return jsonb_build_object('code','ok');
end; $$;
