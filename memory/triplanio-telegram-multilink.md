---
name: triplanio-telegram-multilink
description: "Triplanio: рефактор привязки Telegram под many-to-many (trip ↔ chat_id) + n8n как владелец webhook"
metadata: 
  node_type: memory
  type: project
  originSessionId: bb7876fd-9ff7-4ba0-ace0-4e336aaac36f
---

# Triplanio: multi-Telegram на трип (рефактор привязки)

Контекст: разговорный TG-бот (n8n workflow «TG Chat Bot» id mJ4QQUW7rrGh4tys, Telegram Trigger) **забрал webhook бота** (у бота один webhook). Поэтому supabase `telegramWebhook` (/start handshake) апдейтов не получает → кнопка «Подключить Telegram» в новом приложении по факту не работает. В base44 проблемы не было — там разговорного бота не существовало, webhook был один потребитель. Это корневой блокер восстановления привязки. См. [[triplanio-telegram-bot]].

**Решение архитектуры (согласовано с Pavel 2026-05-31):**
- **Вариант A: n8n — единая точка webhook.** Telegram Trigger остаётся владельцем (токен бота живёт в n8n). В начало воркфлоу — Switch: `text начинается с /start` → BINDING-ветка, иначе → AI Agent (как сейчас).
- **BINDING-ветка**: n8n POST'ит в supabase `telegramWebhook?s=secret` (raw update). Функция делает ТРАНЗАКЦИОННО: валидация токена + upsert привязки + пометка used_at, и возвращает JSON `{ok:true, trip_title}` или `{ok:false, reason:'invalid'|'used'|'expired'}`. **Доставку сообщения (✅/ошибки) шлёт n8n** Telegram-нодой. → из supabase уходит TELEGRAM_BOT_TOKEN + sendMessage (токен только в n8n). DB-работа НЕ дробится на n8n-ноды (иначе рассинхрон токен/привязка).
- `telegramSetWebhook` НЕ нужен (n8n сам регистрирует webhook при активации) — выпиливаем. `telegramGetBotInfo`/`telegramGetWebhookInfo` выпилить ПОСЛЕ запуска n8n.

**Модель данных (many-to-many trip ↔ telegram_chat_id):**
- Ключ идентичности: `UNIQUE(trip_id, telegram_chat_id)` (раньше app-level upsert по (trip_id,user_id), DB-уникальности нет — только PK id + partial idx_tti_active_trip(trip_id,is_active) WHERE is_active). Один трип → много chat_id, один chat_id → много трипов.
- `user_id` → роль `linked_by` (только инфо «кто привязал» для UI). Сделать **nullable + ON DELETE SET NULL** (привязка переживает удаление инициатора / для групповых чатов).
- Авторизация `setActive`/`disconnect`/`getIntegration` переводится со «scope по user_id» на **isCallerParticipant(tripId)** — любой участник управляет всеми привязками трипа.
- email-колонок в новой схеме НЕТ (были в base44 user_email, не мигрированы) — дропать нечего.

**Изменения функций:**
- `telegramStartLink` — без изменений (или + создание pending-строки, см. ниже).
- `telegramWebhook` — внутренний binding-эндпоинт: upsert по (trip_id, chat_id), возвращает JSON, БЕЗ отправки сообщения.
- `telegramGetIntegration` — сейчас отдаёт ОДНУ запись по (trip_id,user_id).limit(1) (НЕ массив! массив по chat_id отдаёт другой — getTripByTelegramChatId, бот-сайд). Переделать на список `{integrations:[...]}` для трипа.
- `telegramSetActive` (сейчас: is_active по (trip,caller)) / `telegramDisconnect` (сейчас: delete по (trip,caller)) → таргет по integrationId, authz по участию.
- `TelegramAssistantPanel.jsx` → новый дизайн (список аккаунтов + модалка коннекта + удаление).

**Дизайн (uploads trip-settings.jsx: TelegramSection + TelegramConnectDialog) добавляет сверх текущего бэка — нужны решения Pavel, предложено отдельной фазой:**
1. статус `pending` (аккаунт в списке до нажатия Start) → создавать строку в startLink со status='pending' без chat_id; UNIQUE(trip_id,chat_id) WHERE chat_id IS NOT NULL.
2. гранулярные notif-настройки (заезды/переезды/дедлайны отмены/дайджест дня/упоминания) вместо булева is_active → jsonb notif_prefs; решить per-binding vs per-trip.
3. кастомный label аккаунта (сейчас только telegram_username/first_name).

**ТЗ:** `TG_MULTILINK_TZ_2026-05-31.md` в репо triplanio_new (полное, вычитанное против кода/БД).

**Найдено при вычитке зависимостей (важно):**
- Авторизация n8n→supabase: НЕ новый `TELEGRAM_WEBHOOK_SECRET`, а переиспользуем `requireN8nSecret()` (Bearer `N8N_SECRET`) — как getTripByTelegramChatId. Единственный TG-секрет = bot token, живёт в n8n.
- БАГ пре-существующий: `telegramStartLink` зовёт `isCallerParticipant(tripId, user.email!)`, а функция ждёт `userId` (uuid) → проверка ВСЕГДА false → 403 для всех. Чинить: `user.id`. (т.е. connect сломан в т.ч. тут, не только из-за webhook-конфликта).
- `TELEGRAM_BOT_TOKEN` в 4 функциях (telegramWebhook, telegramStartLink, telegramGetBotInfo, telegramGetWebhookInfo) — снимать токен ТОЛЬКО после удаления двух Get*Info.
- Scope: трип ↔ несколько ЛИЧНЫХ чатов (deep-link `?start=` работает только в private). Групповые чаты — вне scope (нужен `?startgroup=`). SET NULL = просто integrity-backstop, не «ради групп».
- ПРЕДПОСЫЛКА #0 (подтвердить Pavel): бот в n8n Telegram Trigger == бот из `TELEGRAM_BOT_USERNAME`/deep-link (один бот). Иначе флоу не работает.
- Рассылка: воркфлоу `TG Reminders` (hDCVQcNdgEyKEvnY) НЕактивен (triggerCount 0) — спящая зависимость, при включении должен веерить по всем активным привязкам.
- Проверено: prod 2 строки (без null/дублей), dev 0 строк — миграция безопасна. tripPayload.ts таблицу не трогает.

**ВНЕДРЕНО 2026-05-31:** миграция `0006_telegram_multilink_m2m.sql` применена на dev+prod (chat_id NOT NULL, user_id nullable+SET NULL, UNIQUE(trip_id,chat_id)). 6 edge-функций задеплоены на dev+prod (через Supabase MCP, бандл _shared работает): telegramStartLink (user.id фикс + username из env), telegramWebhook (verify_jwt=false, requireN8nSecret, upsert onConflict trip_id,telegram_chat_id, JSON-ответ action linked/welcome/reason, без sendMessage/bot-token), telegramGetIntegration (список+participant), telegramSetActive/telegramDisconnect (по integrationId+participant), removeTripMember (+очистка привязок). Файлы в репо обновлены, миграция добавлена в supabase/migrations. ОСТАЛОСЬ: env TELEGRAM_BOT_USERNAME=triplanio_bot на dev+prod (Pavel — MCP не ставит секреты); git commit+push dev и main; n8n Switch+binding+welcome; фронт-панель; потом снять TELEGRAM_BOT_TOKEN и удалить telegramGetBotInfo/GetWebhookInfo.

**Статус 2026-05-31 (ранее):** дизайн/ТЗ готовы. Решения Pavel: (A) split binding vs всё-в-n8n; (B) pending+notif_prefs — НЕ делаем (Pavel: игнорить pending и гранулярные настройки, единый тоггл is_active). Урок: вычитывать зависимости ДО выдачи «финала». Supabase prod tizscxrpuopobgcxbekf, dev nydhzevdizkfaxdlikgc.
