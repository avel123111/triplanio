-- TRIP-408 (2/2): инбокс за единой дверью — ридер + запись флага `read`, и
-- `notifications` закрывается ЦЕЛИКОМ (эпик TRIP-374).
--
-- Было: браузер читал `notifications` напрямую (список + счётчик непрочитанных)
-- под RLS `user_id = auth.uid()`, а на каждую invite-строку делал ОТДЕЛЬНОЕ
-- чтение `trip_members` (водопад N запросов) ради статуса приглашения. Флаг
-- `read` клиент ставил прямым UPDATE.
--
-- Стало:
--   * чтение — edge-ридер `getInbox` → `get_inbox(p_actor)` возвращает
--     `{ list, unreadCount }`; `list` обогащён `member_status` (LEFT JOIN
--     trip_members) — водопад убран в один запрос; `unreadCount` — честный COUNT
--     (не «сколько влезло в список»);
--   * запись флага `read` — за дверь записи (edge `inbox`, движок mutate):
--     `mark_notification_read` (одна строка) и `mark_all_notifications_read`
--     (все непрочитанные актора). Скоуп `user_id = p_actor` — ВНУТРИ RPC
--     (integrity), актор инъектит шов из JWT;
--   * `notifications` закрыта: клиент не читает и не пишет напрямую. Вставку
--     делают только триггеры/service_role (edge). Ярус B (полное закрытие).
--
-- Все три функции — SECURITY DEFINER, зовутся только edge под service_role:
-- EXECUTE снят у public/anon/authenticated (дефолтные привилегии), выдан
-- service_role.

-- ── Ридер инбокса ────────────────────────────────────────────────────────────
create or replace function public.get_inbox(p_actor uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    -- Список newest-first, лимит как у прежнего клиента (LIST_LIMIT=100).
    -- member_status: статус invite-строки из trip_members одним join (не водопад);
    -- для не-invite строк (trip_member_id null) — null.
    'list', coalesce(
      (
        select jsonb_agg(
                 to_jsonb(n) || jsonb_build_object('member_status', m.status)
                 order by n.created_at desc
               )
        from (
          select *
          from public.notifications
          where user_id = p_actor
          order by created_at desc
          limit 100
        ) n
        left join public.trip_members m on m.id = n.trip_member_id
      ),
      '[]'::jsonb
    ),
    -- Честный счётчик: реальный total непрочитанных, а не длина списка.
    'unreadCount', (
      select count(*)
      from public.notifications
      where user_id = p_actor and read is not true
    )
  );
$$;

comment on function public.get_inbox(uuid) is
  'Ридер инбокса за швом (TRIP-408): { list, unreadCount } для p_actor. list newest-first (лимит 100) с member_status из trip_members одним join; unreadCount — честный COUNT непрочитанных. Зовётся edge getInbox под service_role.';

-- ── Флаг read: одна строка ───────────────────────────────────────────────────
create or replace function public.mark_notification_read(p_actor uuid, p_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.notifications
     set read = true
   where id = p_id and user_id = p_actor and read is not true;
$$;

comment on function public.mark_notification_read(uuid, uuid) is
  'Пометить одно уведомление прочитанным. Скоуп user_id=p_actor внутри (integrity). За дверью записи (edge inbox/read). TRIP-408.';

-- ── Флаг read: все непрочитанные актора ──────────────────────────────────────
create or replace function public.mark_all_notifications_read(p_actor uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.notifications
     set read = true
   where user_id = p_actor and read is not true;
$$;

comment on function public.mark_all_notifications_read(uuid) is
  'Пометить прочитанными все уведомления актора. За дверью записи (edge inbox/read-all). TRIP-408.';

-- ── Права функций: только service_role ───────────────────────────────────────
revoke execute on function public.get_inbox(uuid)                    from public, anon, authenticated;
revoke execute on function public.mark_notification_read(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.mark_all_notifications_read(uuid)  from public, anon, authenticated;
grant  execute on function public.get_inbox(uuid)                    to service_role;
grant  execute on function public.mark_notification_read(uuid, uuid) to service_role;
grant  execute on function public.mark_all_notifications_read(uuid)  to service_role;

-- ── Закрытие таблицы notifications ───────────────────────────────────────────
-- Клиент больше не читает и не пишет напрямую (чтение → getInbox, запись флага →
-- edge inbox). Вставку делают триггеры/service_role в обход RLS.
revoke select, insert, update, delete on public.notifications from authenticated, anon;

-- Политики под снятые гранты никогда не сработают: удаляем, чтобы схема не
-- утверждала того, чего нет (как chat_messages в TRIP-296). INSERT-политики нет —
-- вставка всегда шла service_role/триггером.
drop policy if exists notifications_select on public.notifications;
drop policy if exists notifications_update on public.notifications;
drop policy if exists notifications_delete on public.notifications;
