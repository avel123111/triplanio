-- TRIP-334 — удаление аккаунта не должно оставлять приглашение-призрак.
--
-- anonymize_my_account затирала у своих строк trip_members имя и адрес
-- (user_full_name/invite_email), но саму строку оставляла. Для ПРИНЯТОГО
-- членства это верно: за человеком остался контент, и список участников
-- честно подписывает его «Удалённый аккаунт». Для НЕПРИНЯТОГО приглашения
-- строка мертва по построению:
--   • принять его некому — anonymize тут же сносит auth.identities и сессии,
--     войти в этот аккаунт больше нельзя;
--   • «Отправить повторно» падает всегда — resendTripInvite шлёт письмо на
--     invite_email, который эта же функция обнулила;
--   • при этом строка продолжает висеть в списке с ролью (в проде — АДМИН)
--     и статусом «Ожидает».
--
-- Тело функции взято из ЖИВОГО pg_get_functiondef (dev и prod совпадают
-- md5-в-md5), baseline устарел — см. приём из TRIP-223.

CREATE OR REPLACE FUNCTION public.anonymize_my_account(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- Приглашения, которые уже никто не примет — до затирания подписи ниже,
  -- чтобы оно касалось только выживающих (принятых) членств. Строки status
  -- 'offline' не задеваются: у них user_id всегда NULL.
  delete from public.trip_members
  where user_id = p_user_id and status in ('pending','declined');

  update public.trip_members set user_full_name=null, invite_email=null where user_id = p_user_id;

  update public.chat_messages  set user_full_name = null where user_id   = p_user_id;
  update public.trip_documents set created_by_name = null where created_by = p_user_id;

  delete from auth.sessions   where user_id = p_user_id;
  delete from auth.identities where user_id = p_user_id;
  update auth.users set email='deleted+'||p_user_id::text||'@deleted.invalid', updated_at=now() where id = p_user_id;

  return jsonb_build_object('code','ok');
end; $function$;

-- Разовая уборка призраков, оставленных прежней версией функции.
-- Идемпотентна: повторный прогон не находит строк.
delete from public.trip_members tm
using public.users u
where u.id = tm.user_id
  and u.deleted_at is not null
  and tm.status in ('pending','declined');
