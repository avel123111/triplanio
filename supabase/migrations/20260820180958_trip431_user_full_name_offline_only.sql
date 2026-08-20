-- TRIP-431 Phase 2 — денорм `trip_members.user_full_name` только для без-аккаунтных.
-- Эпик TRIP-433 (преемник TRIP-374). Выверено по коду origin/dev 2026-08-20.
--
-- Инвариант: `user_full_name` непустой ⟺ строка без аккаунта (`user_id IS NULL`).
-- Легитимный писатель значения ровно один — оффлайн-гость (`add-offline` в
-- `_shared/resources/tripMember.ts`: `user_id=null`, `invite_email=null`,
-- `status='offline'`, имя вбито руками). Все живые invite/accept/redeem пути
-- имеют либо `user_id`, либо `invite_email` → слепок не нужен и является либо
-- мёртвым (протухает при переименовании), либо утечкой (имя аккаунта
-- pending/declined-участника показывалось всему трипу в обход `liveIdentityIds`).
-- Читатели уже деградируют корректно: active → живой профиль; pending/declined →
-- `invite_email` (см. `resolveAuthor`/`profiles.ts`).
--
-- Тела `invite_trip_member`/`respond_trip_invite` — ПОСЛЕДНИЕ `create or replace`
-- из шва 411 (20260814174219); правим их. Сигнатуры не меняются → `database.types.ts`
-- и гард 2t байт-в-байт. REVOKE/GRANT сохраняем идентично 411/409 (EXECUTE только
-- service_role — вызов через edge-шов, SECDEF мимо гейта не звать).
--
-- Read-only предусловие (dev+prod, 2026-08-20): строк `user_id IS NOT NULL AND
-- status <> 'active' AND coalesce(btrim(invite_email),'')=''` — 0 на обоих. Значит
-- бэкфилл в NULL не оставит ни одну строку без источника имени (у active — живой
-- профиль, у pending/declined — `invite_email`).

-- ── invite: declined→pending (реактивация) и свежая вставка не пишут слепок ─────
-- В обеих ветках есть либо `user_id` (зарегистрированный приглашаемый), либо
-- `invite_email` (приглашение по адресу) → `user_full_name` всегда NULL. Имя
-- приглашаемого из `users` больше не нужно, поэтому его SELECT снят (v_uname убран),
-- а `v_uid` (owner-guard + membership) остаётся.
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

  -- Аккаунт приглашаемого (если зарегистрирован) — нужен id (owner-guard + membership).
  select id into v_uid from public.users where lower(email) = v_email limit 1;

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
        -- user_full_name = NULL: есть user_id или invite_email, слепок не нужен.
        update public.trip_members set
          status = 'pending', role = p_role, invite_email = v_email,
          user_id = v_uid, user_full_name = null,
          invited_by = p_actor, created_by = p_actor, accepted_at = null, updated_at = now()
        where id = v_existing.id returning * into v_row;
        return jsonb_build_object('outcome', 'reactivated', 'member', to_jsonb(v_row));
      end if;
      -- pending / active / offline — уже приглашён или участник.
      return jsonb_build_object('outcome', 'already_member', 'member', to_jsonb(v_existing));
    end if;

    -- Свежее приглашение. ON CONFLICT — молчаливый backstop гонки pending-email.
    -- user_full_name = NULL: слепок только у оффлайн-гостя (add-offline).
    insert into public.trip_members
      (trip_id, invite_email, user_id, user_full_name, role, status, invited_by, created_by)
    values (p_trip, v_email, v_uid, null, p_role, 'pending', p_actor, p_actor)
    on conflict (trip_id, lower(invite_email)) where user_id is null and invite_email is not null
      do update set status = 'pending', role = excluded.role, invited_by = excluded.invited_by, updated_at = now()
    returning * into v_row;
    return jsonb_build_object('outcome', 'created', 'member', to_jsonb(v_row));
  exception when unique_violation then
    -- (trip_id,user_id) уже есть → уже участник (тот же исход, что пред-проверка).
    select * into v_existing from public.trip_members
      where trip_id = p_trip and user_id = v_uid limit 1;
    return jsonb_build_object('outcome', 'already_member', 'member', to_jsonb(v_existing));
  end;
end;
$$;

revoke execute on function public.invite_trip_member(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.invite_trip_member(uuid, text, text, uuid) to service_role;

-- ── accept: активация не пишет слепок (user_id=p_actor всегда задан) ────────────
-- Email-фолбэк убран совсем — раньше он клал СЫРОЙ email аккаунта в слепок,
-- видимый всему трипу. Имя active-участника резолвится из живого профиля.
create or replace function public.respond_trip_invite(
  p_member uuid, p_trip uuid, p_action text, p_actor uuid
) returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare v_owner uuid;
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

  -- accept: активация. user_full_name = NULL — active-участник читается из живого
  -- профиля; слепок остаётся только у оффлайн-гостя (add-offline).
  begin
    update public.trip_members set
      status = 'active', accepted_at = now(), user_id = p_actor,
      user_full_name = null, updated_at = now()
    where id = p_member and trip_id = p_trip;
    return jsonb_build_object('outcome', 'accepted');
  exception when unique_violation then
    -- Актор уже участник трипа (гонка): избыточный pending-инвайт снимаем, ответ
    -- accepted (участник существует). Не 500.
    delete from public.trip_members where id = p_member and trip_id = p_trip;
    return jsonb_build_object('outcome', 'accepted');
  end;
end;
$$;

revoke execute on function public.respond_trip_invite(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.respond_trip_invite(uuid, uuid, text, uuid) to service_role;

-- ── Бэкфилл осевшего слепка + инвариант CHECK (бэкфилл ДО constraint) ───────────
-- Бэкфилл: любая строка С аккаунтом теряет слепок (протухший/утечка). NULL
-- разрешён CHECK-ом, поэтому constraint не падает на очищенных данных.
update public.trip_members set user_full_name = null where user_id is not null;

-- Инвариант в БД (как char-CHECK TRIP-169): будущий 8-й писатель, положивший имя
-- при заданном user_id, регрессит ГРОМКО (23514), а не молча протухшим слепком.
-- Пустая строка допускается наравне с NULL (исторический эквивалент «нет слепка»).
alter table public.trip_members add constraint tm_snapshot_only_offline
  check (user_full_name is null or btrim(user_full_name) = '' or user_id is null);
