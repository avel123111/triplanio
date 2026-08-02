-- TRIP-296 (1/2): состояние сообщения чата становится серверным.
--
-- Сегодня «Triplanio печатает» — это догадка браузера («последнее сообщение в
-- моём кэше содержит @Triplanio и оно не от бота»). Догадка не переживает
-- перезагрузку, у разных участников разная, и гаснет только следующим
-- сообщением — поэтому неотвеченный вопрос оставляет индикатор висеть навсегда
-- (в dev так висят 7 чатов из 11, в prod 14% упоминаний остались без ответа).
--
-- Здесь появляются два серверных факта на самой строке сообщения:
--   client_msg_id  — идентификатор, сгенерированный отправителем ДО запроса:
--                    даёт идемпотентность (ретрай/двойной клик не плодят строк)
--                    и точную склейку оптимистичной строки с настоящей;
--   ai_*           — прогон ассистента, вызванный ЭТИМ сообщением.
--
-- Прогон живёт на сообщении-триггере, а не в отдельной таблице: прогон у
-- сообщения ровно один, это его атрибут; ноль новых сущностей; состояние едет
-- клиентам по уже существующей realtime-подписке чата (таблица уже в
-- публикации supabase_realtime и уже REPLICA IDENTITY FULL, поэтому UPDATE
-- доедет без дополнительной настройки).
--
-- Узор — из TRIP-248 (Telegram-напоминания): «заявка» (queued/running) →
-- «подтверждение» (done/failed) → сторож по частичному индексу закрывает то,
-- по чему никто не вернулся (timeout).

alter table public.chat_messages
  add column if not exists client_msg_id   uuid,
  add column if not exists ai_status       text,
  add column if not exists ai_requested_at timestamptz,
  add column if not exists ai_finished_at  timestamptz,
  add column if not exists ai_error        text,
  add column if not exists ai_reply_id     uuid,
  add column if not exists ai_attempts     integer not null default 0;

comment on column public.chat_messages.client_msg_id is
  'UUID отправителя, сгенерированный до запроса. Идемпотентность send_chat_message + склейка оптимистичной строки. TRIP-296.';
comment on column public.chat_messages.ai_status is
  'Прогон ассистента, вызванный этим сообщением: queued|running|done|failed|timeout. NULL = сообщение к ассистенту не обращалось. TRIP-296.';
comment on column public.chat_messages.ai_reply_id is
  'Ответ ассистента на это сообщение. Держит идемпотентность finish_ai_run: повтор той же доставки возвращает существующий ответ, а не вставляет второй. TRIP-296.';

-- Статусы — закрытый список. char_length здесь не декоративный: CI-гард 2g
-- (check-column-caps) требует явный кэп у КАЖДОЙ новой text-колонки, и статус
-- не исключение.
alter table public.chat_messages
  add constraint chat_messages_ai_status_chk
  check (ai_status is null or (char_length(ai_status) <= 20
         and ai_status in ('queued', 'running', 'done', 'failed', 'timeout')));

-- Причина отказа — машинный код (PRO_REQUIRED / RATE_LIMITED / WEBHOOK_ERROR /
-- TIMEOUT), человеческий текст живёт в i18n на фронте, а не в базе.
alter table public.chat_messages
  add constraint chat_messages_ai_error_len
  check (ai_error is null or char_length(ai_error) <= 300);

-- Ретрофит кэпа длины на саму переписку. Канон TRIP-169 — домен long_text
-- (10000). Колонка старая, поэтому гард 2g её не ловил (он смотрит только
-- НОВЫЕ колонки), а в ретрофит-список TRIP-169 чат тогда не попал: сейчас самый
-- длинный текст 606 символов в dev и 3999 в prod, так что проверка пройдёт без
-- правки данных.
alter table public.chat_messages
  add constraint chat_messages_text_len
  check (char_length(text) <= 10000);

alter table public.chat_messages
  add constraint chat_messages_ai_reply_fkey
  foreign key (ai_reply_id) references public.chat_messages(id) on delete set null;

-- Идемпотентность отправки. Частичный уникальный индекс: у исторических строк
-- client_msg_id пуст, и они друг другу не мешают.
create unique index if not exists chat_messages_client_msg_id_uniq
  on public.chat_messages (chat_id, client_msg_id)
  where client_msg_id is not null;

-- Узкий скан для сторожа «прогон открыт слишком долго» (зеркало
-- idx_reminder_logs_undelivered из TRIP-248).
create index if not exists idx_chat_messages_ai_open
  on public.chat_messages (ai_requested_at)
  where ai_status in ('queued', 'running');

-- ── Выравнивание realtime dev↔prod ───────────────────────────────────────────
-- Найдено при разборе: в prod chat_messages в публикации supabase_realtime и с
-- REPLICA IDENTITY FULL (как описывает baseline), а в dev таблицы в публикации
-- НЕТ ВООБЩЕ и identity = default. То есть в dev живая доставка сообщений не
-- работала совсем: чужие реплики появлялись только при перезагрузке экрана.
-- Новое состояние прогона едет клиентам теми же событиями, поэтому дрейф надо
-- закрыть здесь, иначе индикатор в dev не оживёт. Идемпотентно: повторное
-- добавление таблицы в публикацию — ошибка, поэтому через проверку.
alter table public.chat_messages replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end
$$;
