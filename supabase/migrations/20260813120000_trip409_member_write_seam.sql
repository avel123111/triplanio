-- TRIP-409 — домен «участники» за единой дверью (эпик TRIP-374, блок 3).
--
-- Четыре RPC-тела действий шва (`_shared/resources/tripMember*.ts`,
-- `tripInviteLink.ts`): invite / remove / respond / create-link. Конвенция эпика
-- (как chat/route): SECURITY DEFINER, `search_path=public,pg_temp`, актор приходит
-- ДАННЫМИ (`p_actor` от шва, не `auth.uid()` — под service_role он NULL),
-- авторизация (роль/участие) уже проверена ШВОМ на `p_trip`; здесь — целостность,
-- скоуп `trip_id` в теле (IDOR), find-or-reactivate/атомарность. EXECUTE только
-- service_role (клиент вызывает через edge-шов, не напрямую).
--
-- Бизнес-исходы invite (already_member/self/owner/created/reactivated) едут
-- ДАННЫМИ в `outcome` (не `raise`: инвариант шва трактует ошибку БД как 500).

-- ── Целостность: не дублируем pending-инвайт на один email ────────────────────
-- Частичный UNIQUE (гонку pending гасит ON CONFLICT в invite). Только строки-
-- приглашения (есть email, аккаунта ещё нет); offline (email NULL) и активные
-- (user_id задан) — вне индекса. membership-UNIQUE (trip_id,user_id) — НЕ здесь
-- (уходит в домен регистрации вместе с харднингом link_pending_invites).
create unique index if not exists trip_members_pending_email_uidx
  on public.trip_members (trip_id, lower(invite_email))
  where user_id is null and invite_email is not null;

-- ── invite: пригласить по email (find-or-reactivate одной транзакцией) ─────────
create or replace function public.invite_trip_member(
  p_trip uuid, p_email text, p_role text, p_actor uuid
) returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
  v_email       text := lower(btrim(coalesce(p_email, '')));
  v_actor_email text;
  v_owner       uuid;
  v_uid         uuid;
  v_uname       text;
  v_existing    public.trip_members;
  v_row         public.trip_members;
begin
  if p_actor is null then raise exception 'actor is required' using errcode = '42501'; end if;

  -- Себя пригласить нельзя (сверяем email актора).
  select email into v_actor_email from public.users where id = p_actor;
  if v_actor_email is not null and lower(v_actor_email) = v_email then
    return jsonb_build_object('outcome', 'self');
  end if;

  select created_by into v_owner from public.trips where id = p_trip;

  -- Аккаунт приглашаемого (если зарегистрирован) — нужен id (owner-guard) + имя.
  select id, full_name into v_uid, v_uname from public.users where lower(email) = v_email limit 1;

  -- Владельца трипа пригласить нельзя (он owner через trips.created_by, а не строка).
  if v_uid is not null and v_uid = v_owner then
    return jsonb_build_object('outcome', 'owner');
  end if;

  -- Существующая строка членства: по email, затем по user_id (юзер уже связан).
  select * into v_existing from public.trip_members
    where trip_id = p_trip and lower(invite_email) = v_email limit 1;
  if v_existing.id is null and v_uid is not null then
    select * into v_existing from public.trip_members
      where trip_id = p_trip and user_id = v_uid limit 1;
  end if;

  if v_existing.id is not null then
    if v_existing.status = 'declined' then
      -- declined → pending (реактивация той же строки: FK нотификаций/история целы).
      update public.trip_members set
        status = 'pending', role = p_role, invite_email = v_email,
        user_id = v_uid, user_full_name = coalesce(v_uname, ''),
        invited_by = p_actor, created_by = p_actor, accepted_at = null, updated_at = now()
      where id = v_existing.id returning * into v_row;
      return jsonb_build_object('outcome', 'reactivated', 'member', to_jsonb(v_row));
    end if;
    -- pending / active / offline — уже приглашён или участник (email-UNIQUE не
    -- ловит юзера с проставленным user_id, membership-UNIQUE отложен).
    return jsonb_build_object('outcome', 'already_member', 'member', to_jsonb(v_existing));
  end if;

  -- Свежее приглашение. ON CONFLICT — молчаливый backstop гонки pending-email.
  insert into public.trip_members
    (trip_id, invite_email, user_id, user_full_name, role, status, invited_by, created_by)
  values (p_trip, v_email, v_uid, coalesce(v_uname, ''), p_role, 'pending', p_actor, p_actor)
  on conflict (trip_id, lower(invite_email)) where user_id is null and invite_email is not null
    do update set status = 'pending', role = excluded.role, invited_by = excluded.invited_by, updated_at = now()
  returning * into v_row;
  return jsonb_build_object('outcome', 'created', 'member', to_jsonb(v_row));
end;
$$;

-- ── remove: удалить участника + записать блок АТОМАРНО ─────────────────────────
-- Блок = security-контроль (rule #13): удалённый админом не вернётся по ссылке.
-- delete + insert блока в ОДНОЙ транзакции RPC (best-effort afterWrite проглотил
-- бы сбой блока). Блок только если у строки был аккаунт (offline блокировать нечем).
create or replace function public.remove_trip_member(
  p_member uuid, p_trip uuid, p_actor uuid
) returns void
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare v_uid uuid;
begin
  if p_actor is null then raise exception 'actor is required' using errcode = '42501'; end if;
  delete from public.trip_members where id = p_member and trip_id = p_trip returning user_id into v_uid;
  if not found then raise exception 'member not found' using errcode = 'P0002'; end if;
  if v_uid is not null then
    insert into public.trip_member_blocks (trip_id, user_id, blocked_by)
    values (p_trip, v_uid, p_actor)
    on conflict (trip_id, user_id) do update set blocked_at = now(), blocked_by = excluded.blocked_by;
  end if;
end;
$$;

-- ── respond: ответить на приглашение (accept/decline + owner-stray) ────────────
-- Возвращает outcome (accepted/declined/owner_stray); mark-read+emit решает
-- afterWrite. Владение (user_id/email) + pending уже проверил guardRow в edge.
create or replace function public.respond_trip_invite(
  p_member uuid, p_trip uuid, p_action text, p_actor uuid
) returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare v_owner uuid; v_name text;
begin
  if p_actor is null then raise exception 'actor is required' using errcode = '42501'; end if;

  -- Владелец держит стрэй-инвайт в свой трип: активация понизила бы его до
  -- viewer/admin — вместо этого стрэй удаляем (TRIP-143).
  select created_by into v_owner from public.trips where id = p_trip;
  if v_owner = p_actor then
    delete from public.trip_members where id = p_member and trip_id = p_trip;
    return jsonb_build_object('outcome', 'owner_stray');
  end if;

  if p_action = 'decline' then
    update public.trip_members set status = 'declined', updated_at = now()
      where id = p_member and trip_id = p_trip;
    return jsonb_build_object('outcome', 'declined');
  end if;

  -- accept: активация. Денорм-имя пишем как есть (принцип №0, слайс 1 сохраняет).
  select full_name into v_name from public.users where id = p_actor;
  update public.trip_members set
    status = 'active', accepted_at = now(), user_id = p_actor,
    user_full_name = coalesce(v_name, (select email from public.users where id = p_actor)), updated_at = now()
  where id = p_member and trip_id = p_trip;
  return jsonb_build_object('outcome', 'accepted');
end;
$$;

-- ── create-link: общая ссылка-приглашение (find-or-create) ────────────────────
create or replace function public.create_trip_invite_link(
  p_trip uuid, p_role text, p_actor uuid
) returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare v_tok text; v_role text; v_exp timestamptz;
begin
  if p_actor is null then raise exception 'actor is required' using errcode = '42501'; end if;

  -- Reuse живой стабильной ссылки на (trip, role), чтобы URL не менялся.
  select token, role, expires_at into v_tok, v_role, v_exp from public.trip_invite_links
    where trip_id = p_trip and role = p_role and revoked_at is null and expires_at > now()
    order by created_at desc limit 1;
  if found then
    return jsonb_build_object('token', v_tok, 'role', v_role, 'expiresAt', v_exp, 'reused', true);
  end if;

  v_tok := encode(extensions.gen_random_bytes(24), 'hex');
  v_exp := now() + interval '7 days';
  insert into public.trip_invite_links (trip_id, token, role, created_by, expires_at)
  values (p_trip, v_tok, p_role, p_actor, v_exp)
  returning token, role, expires_at into v_tok, v_role, v_exp;
  return jsonb_build_object('token', v_tok, 'role', v_role, 'expiresAt', v_exp, 'reused', false);
end;
$$;

-- EXECUTE только service_role (вызов через edge-шов, не напрямую с клиента).
-- ⚠ Snимать И у anon/authenticated: Supabase ALTER DEFAULT PRIVILEGES авто-грантит
-- EXECUTE им на КАЖДУЮ новую public-функцию → `from public` одного мало (иначе
-- SECURITY DEFINER RPC вызываем напрямую в обход гейта шва — auth-bypass, rule #13).
revoke execute on function public.invite_trip_member(uuid, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.remove_trip_member(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.respond_trip_invite(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.create_trip_invite_link(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.invite_trip_member(uuid, text, text, uuid) to service_role;
grant execute on function public.remove_trip_member(uuid, uuid, uuid) to service_role;
grant execute on function public.respond_trip_invite(uuid, uuid, text, uuid) to service_role;
grant execute on function public.create_trip_invite_link(uuid, text, uuid) to service_role;
