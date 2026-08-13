-- TRIP-409 райдер #5 — подпись send_chat_message под норму маршрута.
--
-- Было: (p_trip, p_text, p_client_msg_id default null, p_actor default null) —
-- актор ПОСЛЕДНИМ и с default null (слабее нормы). Маршрут (add_city и др.)
-- ставит p_actor ОБЯЗАТЕЛЬНЫМ, перед опциональным, без default. Две конвенции
-- инъекции актора = зоопарк. Приводим к норме: p_actor третьим, без default;
-- p_client_msg_id — последний опциональный. Тело не меняется (аргументы шлёт шов
-- ПО ИМЕНИ — `_shared/resources/tripChat.ts`; server-side callTriplanioAi тоже по
-- имени), поэтому вызыватели не ломаются.
--
-- Типовая сигнатура прежняя (uuid,text,uuid,uuid) → нельзя CREATE OR REPLACE
-- (меняются имена/порядок параметров) → DROP+CREATE. Новая функция по умолчанию
-- получает EXECUTE у PUBLIC → сразу REVOKE + GRANT service_role (как было).

drop function if exists public.send_chat_message(uuid, text, uuid, uuid);

create function public.send_chat_message(
  p_trip uuid, p_text text, p_actor uuid, p_client_msg_id uuid default null
) returns public.chat_messages
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_chat_id uuid;
  v_text    text := btrim(coalesce(p_text, ''));
  v_ai      boolean;
  v_row     public.chat_messages;
begin
  -- Актор приходит ДАННЫМИ от шва (не auth.uid(): под service_role он NULL).
  -- Клиент актора не называет — его инъектит buildPlan из проверенного JWT.
  if p_actor is null then
    raise exception 'actor is required' using errcode = '42501';
  end if;

  -- Групповой чат трипа. Не найден → NOT_FOUND (целостность по построению;
  -- авторизацию «участник/Pro» уже проверил шов на p_trip).
  select id into v_chat_id
  from public.chats
  where trip_id = p_trip and type = 'group';

  if v_chat_id is null then
    raise exception 'chat not found' using errcode = 'P0002';
  end if;

  if v_text = '' then
    raise exception 'message is empty' using errcode = '22023';
  end if;
  if char_length(v_text) > 10000 then
    raise exception 'message is too long' using errcode = '22001';
  end if;

  -- Идемпотентность: тот же client_msg_id — та же строка (повтор после обрыва).
  if p_client_msg_id is not null then
    select * into v_row
    from public.chat_messages
    where chat_id = v_chat_id and client_msg_id = p_client_msg_id;
    if found then
      return v_row;
    end if;
  end if;

  v_ai := public.mentions_assistant(v_text);

  begin
    insert into public.chat_messages (
      chat_id, trip_id, user_id, created_by, user_full_name, text,
      client_msg_id, ai_status, ai_requested_at
    )
    values (
      v_chat_id, p_trip, p_actor, p_actor,
      (select full_name from public.users where id = p_actor),
      v_text,
      p_client_msg_id,
      case when v_ai then 'queued' end,
      case when v_ai then now() end
    )
    returning * into v_row;
  exception when unique_violation then
    -- Гонка двух одинаковых отправок: побеждает первая, вторая читает её строку.
    select * into v_row
    from public.chat_messages
    where chat_id = v_chat_id and client_msg_id = p_client_msg_id;
  end;

  return v_row;
end;
$function$;

-- Снимаем у public/anon/authenticated (Supabase default privileges авто-грантят
-- anon/authenticated на новую функцию) — EXECUTE только service_role, как норма.
revoke execute on function public.send_chat_message(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.send_chat_message(uuid, text, uuid, uuid) to service_role;
