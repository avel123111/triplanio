-- TRIP-411 — домен «регистрация» за единой дверью (эпик TRIP-374, ПОСЛЕДНИЙ домен
-- блока 3). Клиентский INSERT `public.users` уходит за шов действием
-- `account/register` (RPC `create_user_profile`), связывание pending-инвайтов и
-- выпуск уведомления переезжают из триггера БД в edge — триггер удаляется. В БД по
-- регистрации остаётся ТОЛЬКО целостность (два констрейнта), вся логика на edge.
--
-- Прод-аудит ДО постановки констрейнтов (read-only, момент работы): дублей
-- membership `(trip_id,user_id)` — 0, регистронезависимых дублей `lower(email)` — 0
-- на prod и dev. Оба индекса ставятся без чистки данных.
--
-- ★ membership-UNIQUE — новый ИНВАРИАНТ, и его обязаны соблюдать ВСЕ, кто пишет
-- `trip_members.user_id`. Их четыре: связывание в `create_user_profile` (гвард
-- NOT EXISTS), `invite_trip_member` и `respond_trip_invite` (харднинг ниже, ловят
-- `unique_violation` → дружелюбный исход, не 500), `redeemTripInviteLink` (edge-TS,
-- вне этой миграции). Ни один путь под констрейнтом не даёт 500.

-- ── Целостность 1: не дублируем членство одного юзера в трипе ──────────────────
-- Частичный: offline-строки (`user_id` null) и pending-инвайты по email вне
-- индекса. Ставится ВМЕСТЕ со своими уже-безопасными писателями (иначе уронил бы
-- линковку при двойном pending — причина, по которой констрейнт отложен сюда из
-- TRIP-409). Пред-проверки «уже участник» в edge/RPC остаются дружелюбным
-- fast-path, но ЕДИНСТВЕННЫЙ источник истины «нет дубля членства» — этот индекс.
create unique index if not exists trip_members_trip_user_uidx
  on public.trip_members (trip_id, user_id)
  where user_id is not null;

-- ── Целостность 2: регистронезависимая уникальность email (Р3, defense-in-depth) ─
-- БД сама, независимо от Auth, гарантирует, что нет двух `users` с одним email в
-- разном регистре — ровно так, как линковка инвайтов матчит `lower()`. Функциональный
-- unique-индекс заменяет прежний констрейнт по сырому email. `email` NOT NULL, так
-- что `lower(email)` не бывает null. Ничто в коде не ссылается на имя
-- `users_email_key` и не делает `ON CONFLICT (email)` (сверено).
alter table public.users drop constraint if exists users_email_key;
create unique index if not exists users_email_lower_uidx on public.users (lower(email));

-- ── register: идемпотентная вставка профиля + связывание pending-инвайтов ──────
-- Идентичность (`id/email/full_name/avatar_url`) RPC берёт САМ из `auth.users` по
-- `p_actor` (server-trust); клиент их НЕ шлёт. Клиент шлёт только `p_language`
-- (знает язык лендинга) и `p_marks` (реклама из URL) — whitelist марок ТУТ, на
-- сервере: только 4 колонки `signup_*`, чужую колонку профиля клиент не выставит.
-- `ON CONFLICT DO NOTHING` (без цели — покрывает и id-PK, и `lower(email)`) делает
-- повтор из двух вкладок идемпотентным no-op вместо `unique_violation`. Контракт
-- `{ created, profile, linked }`: `created` — ДАННЫЕ (оба исхода успех), фронт по
-- нему решает `user_signed_up`.
create or replace function public.create_user_profile(
  p_actor uuid, p_language text, p_marks jsonb
) returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
  v_auth    auth.users%rowtype;
  v_email   text;
  v_name    text;
  v_avatar  text;
  v_lang    text;
  v_row     public.users%rowtype;
  v_created boolean := false;
  v_linked  jsonb := '[]'::jsonb;
begin
  if p_actor is null then raise exception 'actor is required' using errcode = '42501'; end if;

  -- Идентичность из auth.users (сессия гарантирует строку; FK users_id_fkey выполнен).
  select * into v_auth from auth.users where id = p_actor;
  if v_auth.id is null then raise exception 'auth user not found' using errcode = 'P0002'; end if;
  v_email  := v_auth.email;
  v_name   := coalesce(v_auth.raw_user_meta_data->>'full_name', v_auth.raw_user_meta_data->>'name', '');
  v_avatar := nullif(v_auth.raw_user_meta_data->>'avatar_url', '');

  -- Язык лендинга авторитетен (enum ru/en/es); мимо enum — дефолт схемы 'ru'.
  v_lang := case when p_language in ('ru', 'en', 'es') then p_language else 'ru' end;

  -- Whitelist марок на СЕРВЕРЕ: только 4 колонки, оба написания (param и column —
  -- старые письма-подтверждения несут column-имена), усечение до кэпа short_text(300).
  insert into public.users (
    id, email, full_name, avatar_url, language,
    signup_utm_source, signup_utm_medium, signup_utm_campaign, signup_gclid
  ) values (
    p_actor, v_email, v_name, v_avatar, v_lang,
    left(coalesce(p_marks->>'utm_source',   p_marks->>'signup_utm_source'),   300),
    left(coalesce(p_marks->>'utm_medium',   p_marks->>'signup_utm_medium'),   300),
    left(coalesce(p_marks->>'utm_campaign', p_marks->>'signup_utm_campaign'), 300),
    left(coalesce(p_marks->>'gclid',        p_marks->>'signup_gclid'),        300)
  )
  on conflict do nothing
  returning * into v_row;

  if v_row.id is not null then
    v_created := true;
  else
    -- Конфликт по id/email: идемпотентный no-op, читаем существующую строку.
    select * into v_row from public.users where id = p_actor;
  end if;

  -- Связывание pending-инвайтов — ТОЛЬКО при создании (повтор уже связал на 1-м
  -- вызове). Гвард NOT EXISTS не даёт дубль членства (активная строка того же
  -- юзера в трипе → инвайт не линкуется). Пер-трип pending один (pending-email-
  -- UNIQUE из TRIP-409), поэтому мульти-UPDATE не сталкивает две строки одного
  -- трипа. Обёртка на редкую гонку с параллельным invite/redeem: линковка best-
  -- effort, её сбой не роняет signup.
  if v_created then
    begin
      with linked as (
        update public.trip_members m
           set user_id = p_actor, updated_at = now()
         where m.user_id is null
           and m.status = 'pending'
           and lower(m.invite_email) = lower(v_email)
           and not exists (
             select 1 from public.trip_members m2
              where m2.trip_id = m.trip_id and m2.user_id = p_actor
           )
        returning m.id, m.trip_id
      )
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'trip_id', trip_id)), '[]'::jsonb)
        into v_linked from linked;
    exception when unique_violation then
      v_linked := '[]'::jsonb;
    end;
  end if;

  return jsonb_build_object('created', v_created, 'profile', to_jsonb(v_row), 'linked', v_linked);
end;
$$;

-- EXECUTE только service_role (вызов через edge-шов account/register, не с клиента).
-- Supabase ALTER DEFAULT PRIVILEGES авто-грантит EXECUTE anon/authenticated на новую
-- public-функцию → снимаем и у них (иначе SECDEF RPC зовём напрямую в обход гейта).
revoke execute on function public.create_user_profile(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_user_profile(uuid, text, jsonb) to service_role;

-- ── Триггер связывания УДАЛЯЕМ: логика переехала в create_user_profile + edge ──
-- После снятия клиентского INSERT (Слайс 2) `register` — единственный создатель
-- `users`, значит единственный, кто связывает. Слепой `INSERT notifications` из
-- триггера (ронял signup в TRIP-311) заменён на `emit('invite_linked')` best-effort
-- в afterWrite register (n8n резолвит получателя/текст/канал).
drop trigger if exists trg_link_pending_invites on public.users;
drop function if exists public.link_pending_invites();

-- ── Харднинг invite_trip_member: ловим membership-UNIQUE → already_member ──────
-- Форвард-правка (applied 20260813200514 не трогаем). Пред-проверка «уже участник»
-- остаётся дружелюбным fast-path, но редкая гонка мимо неё под новым констрейнтом
-- дала бы `unique_violation` → 500 через `unwrapDbResult`. Ловим и маппим в тот же
-- `outcome:'already_member'` — констрейнт становится единственным источником истины.
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
    return jsonb_build_object('outcome', 'created', 'member', to_jsonb(v_row));
  exception when unique_violation then
    -- (trip_id,user_id) уже есть → уже участник (тот же исход, что пред-проверка).
    select * into v_existing from public.trip_members
      where trip_id = p_trip and user_id = v_uid limit 1;
    return jsonb_build_object('outcome', 'already_member', 'member', to_jsonb(v_existing));
  end;
end;
$$;

-- ── Харднинг respond_trip_invite: accept под membership-UNIQUE безопасен ───────
-- accept ставит user_id=p_actor. Если актор УЖЕ участник трипа (редкая гонка),
-- активация pending-строки дала бы `unique_violation` → 500. Ловим: pending-инвайт
-- избыточен → снимаем его, ответ = accepted (участник существует). Ветки decline и
-- owner_stray user_id не ставят — их не трогаем. Applied 20260813200514 не трогаем.
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
  begin
    update public.trip_members set
      status = 'active', accepted_at = now(), user_id = p_actor,
      user_full_name = coalesce(nullif(btrim(v_name), ''), (select email from public.users where id = p_actor)), updated_at = now()
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
