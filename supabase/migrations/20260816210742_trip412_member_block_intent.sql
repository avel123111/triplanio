-- TRIP-412 — приглашения/блок-лист: бан по ЯВНОМУ намерению, а не побочка удаления.
--
-- Форвард-правка (applied `20260813200514`/`20260814174219` НЕ трогаем). Оживление
-- блок-листа в TRIP-409 сделало его семантически перегруженным и асимметричным:
--   · `remove_trip_member` писал блок при ЛЮБОМ user_id, не глядя на статус →
--     «Отменить приглашение» зарегистрированного = вечный бан (баг 2);
--   · блок снимал ТОЛЬКО `redeemTripInviteLink` → принятие инвайта в колокольчике
--     (`respond`) оставляло бан висеть (баг 1).
--
-- Целевая модель (как в нормальных приложениях): членство (`trip_members`) и бан
-- (`trip_member_blocks`) — ДВЕ ОРТОГОНАЛЬНЫЕ оси. Бан — явное намерение админа
-- («Удалить и заблокировать»), не вывод из статуса. Три операции разведены:
--   · remove(p_block=false) — кик/отмена инвайта, БЕЗ бана;
--   · remove(p_block=true)  — кик + бан (атомарно, security-контроль rule #13);
--   · unblock               — снять бан явно (раздел «Заблокированные»).
-- Переприглашение по email = явный разбан → снимаем блок в `invite` (обе ветки
-- принятия — respond и redeem — становятся консистентны, баг 1).

-- ── remove: удаление + бан ТОЛЬКО по p_block ──────────────────────────────────
-- Меняем сигнатуру (добавляем p_block) → старую 3-арг версию дропаем, чтобы не
-- было overload-неоднозначности у PostgREST. Бан пишется атомарно в ОДНОЙ
-- транзакции RPC (best-effort afterWrite проглотил бы сбой → удалённый снова
-- вошёл бы). Блок только для аккаунта (offline с user_id=null блокировать нечем).
drop function if exists public.remove_trip_member(uuid, uuid, uuid);
create function public.remove_trip_member(
  p_member uuid, p_trip uuid, p_actor uuid, p_block boolean default false
) returns void
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare v_uid uuid;
begin
  if p_actor is null then raise exception 'actor is required' using errcode = '42501'; end if;
  delete from public.trip_members where id = p_member and trip_id = p_trip returning user_id into v_uid;
  if not found then raise exception 'member not found' using errcode = 'P0002'; end if;
  -- Бан — ЯВНОЕ намерение (p_block), не побочка. Отмена инвайта и обычное удаление
  -- шлют p_block=false и бан НЕ пишут (баг 2). offline (user_id=null) — no-op.
  if coalesce(p_block, false) and v_uid is not null then
    insert into public.trip_member_blocks (trip_id, user_id, blocked_by)
    values (p_trip, v_uid, p_actor)
    on conflict (trip_id, user_id) do update set blocked_at = now(), blocked_by = excluded.blocked_by;
  end if;
end;
$$;

-- ── unblock: снять бан явно (раздел «Заблокированные») ─────────────────────────
-- Разбан ≠ восстановление членства: строку не создаёт, человеку нужен свежий
-- инвайт/ссылка, чтобы войти. Скоуп `p_trip` (IDOR закрыт телом, как остальные).
create or replace function public.unblock_trip_member(
  p_trip uuid, p_user uuid, p_actor uuid
) returns void
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
begin
  if p_actor is null then raise exception 'actor is required' using errcode = '42501'; end if;
  delete from public.trip_member_blocks where trip_id = p_trip and user_id = p_user;
end;
$$;

-- ── invite: переприглашение = явный разбан (снимаем блок в обеих ветках) ───────
-- Тело — версия TRIP-411 (харднинг membership-UNIQUE) + снятие блока на реальном
-- гранте (created/reactivated), когда приглашаемый — зарегистрированный аккаунт
-- (v_uid). already_member блок НЕ трогает (у активного/pending бана быть не может
-- по инварианту: pending создаёт только invite, а он разбанивает). Это закрывает
-- ОБА пути принятия — respond (колокольчик) и redeem (ссылка) — сразу (баг 1).
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

  -- Записи, ставящие user_id, в одной обёртке: гонка мимо пред-проверки под
  -- membership-UNIQUE → already_member, а не 500.
  begin
    if v_existing.id is not null then
      if v_existing.status = 'declined' then
        -- declined → pending (реактивация той же строки: FK нотификаций/история целы).
        update public.trip_members set
          status = 'pending', role = p_role, invite_email = v_email,
          user_id = v_uid, user_full_name = coalesce(v_uname, ''),
          invited_by = p_actor, created_by = p_actor, accepted_at = null, updated_at = now()
        where id = v_existing.id returning * into v_row;
        -- Переприглашение = явный разбан.
        if v_uid is not null then
          delete from public.trip_member_blocks where trip_id = p_trip and user_id = v_uid;
        end if;
        return jsonb_build_object('outcome', 'reactivated', 'member', to_jsonb(v_row));
      end if;
      -- pending / active / offline — уже приглашён или участник.
      return jsonb_build_object('outcome', 'already_member', 'member', to_jsonb(v_existing));
    end if;

    -- Свежее приглашение. ON CONFLICT — молчаливый backstop гонки pending-email.
    insert into public.trip_members
      (trip_id, invite_email, user_id, user_full_name, role, status, invited_by, created_by)
    values (p_trip, v_email, v_uid, coalesce(v_uname, ''), p_role, 'pending', p_actor, p_actor)
    on conflict (trip_id, lower(invite_email)) where user_id is null and invite_email is not null
      do update set status = 'pending', role = excluded.role, invited_by = excluded.invited_by, updated_at = now()
    returning * into v_row;
    -- Переприглашение = явный разбан.
    if v_uid is not null then
      delete from public.trip_member_blocks where trip_id = p_trip and user_id = v_uid;
    end if;
    return jsonb_build_object('outcome', 'created', 'member', to_jsonb(v_row));
  exception when unique_violation then
    -- (trip_id,user_id) уже есть → уже участник (тот же исход, что пред-проверка).
    select * into v_existing from public.trip_members
      where trip_id = p_trip and user_id = v_uid limit 1;
    return jsonb_build_object('outcome', 'already_member', 'member', to_jsonb(v_existing));
  end;
end;
$$;

-- EXECUTE только service_role (вызов через edge-шов, не напрямую с клиента).
-- Supabase ALTER DEFAULT PRIVILEGES авто-грантит EXECUTE anon/authenticated на
-- новую public-функцию → снимаем и у них (иначе SECDEF RPC зовём напрямую в обход
-- гейта шва). invite сохраняет грант из 20260814174219 (`create or replace` его не
-- снимает) — переграничивать не нужно; грантим только НОВЫЕ сигнатуры.
revoke execute on function public.remove_trip_member(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.unblock_trip_member(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_trip_member(uuid, uuid, uuid, boolean) to service_role;
grant execute on function public.unblock_trip_member(uuid, uuid, uuid) to service_role;
