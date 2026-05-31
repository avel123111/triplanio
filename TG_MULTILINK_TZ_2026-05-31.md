# ТЗ: Multi-Telegram на трип + восстановление привязки (2026-05-31)

## Цель
Восстановить привязку Telegram к трипу в новом приложении и сделать модель **many-to-many** (trip ↔ telegram_chat_id): к одному трипу — несколько чатов, один чат — к нескольким трипам. Webhook бота принадлежит n8n (вариант A); supabase `telegramWebhook` становится внутренним binding-эндпоинтом, доставку сообщений берёт n8n. Из supabase уходит `TELEGRAM_BOT_TOKEN`.

## Модель доступа (финальная)
Доступ чата к боту/напоминаниям = существование строки `trip_telegram_integrations(trip_id, telegram_chat_id)`. Идентичность строки — пара (trip_id, telegram_chat_id). `user_id` — только «кто привязал» (для UI), не часть идентичности и не скоуп авторизации.

Управление привязками (`getIntegration`/`setActive`/`disconnect`) авторизуется по **участию в трипе** (`isCallerParticipant(tripId, user.id)`): любой участник управляет всеми привязками трипа.

Очистка доступа (fail-closed, привязан к членству, не к строке `users`):
- Трип удалён → привязки удалены (уже: `deleteMyAccount`/каскад по trip_id).
- Аккаунт удалён → `deleteMyAccount` уже удаляет привязки по `user_id` (строка 101) — не трогаем.
- **Участник исключён/вышел → удаляем его привязки этого трипа** (НОВОЕ, см. `removeTripMember`).
- `ON DELETE SET NULL` на FK `user_id` — чисто integrity-backstop для нештатного удаления юзера в обход приложения (строка не падает по FK, остаётся управляемой участниками трипа). НЕ «ради групп» — групповые чаты вне scope.

**Scope:** один трип ↔ несколько ЛИЧНЫХ Telegram-чатов (M2M личных аккаунтов), как в дизайне. Групповые чаты (общий chat_id) deep-link-флоу `?start=` не покрывает — отдельная задача, не в этом ТЗ.

## 1. Миграция БД
Состояние проверено: prod — 2 строки (один chat_id `629608724` на 2 трипа, без null, без дублей), dev — 0 строк. Миграция безопасна на обоих. Применять на **dev → проверка → prod**.

```sql
-- chat_id всегда заполнен (pending выкинули из дизайна)
alter table trip_telegram_integrations
  alter column telegram_chat_id set not null;

-- user_id = "кто привязал"; не часть идентичности
alter table trip_telegram_integrations
  alter column user_id drop not null;
alter table trip_telegram_integrations
  drop constraint trip_telegram_integrations_user_id_fkey,
  add  constraint trip_telegram_integrations_user_id_fkey
       foreign key (user_id) references public.users(id) on delete set null;

-- одна привязка чата к трипу → даёт честный upsert onConflict(trip_id, telegram_chat_id)
alter table trip_telegram_integrations
  add constraint trip_telegram_integrations_trip_chat_uniq
  unique (trip_id, telegram_chat_id);

comment on column trip_telegram_integrations.user_id is
  'Кто инициировал привязку (linked_by). НЕ часть идентичности; идентичность = (trip_id, telegram_chat_id). Nullable + ON DELETE SET NULL.';
```
Колонку оставляем с именем `user_id` (не переименовываем) — чтобы не трогать зависимые `getTripByTelegramChatId`/`_shared/tripPayload.ts`. Смысл — в комментарии.

## 2. Переменные окружения (supabase)
- ДОБАВИТЬ: `TELEGRAM_BOT_USERNAME` (статичный публичный username бота, напр. `triplanio_bot`).
- УДАЛИТЬ: `TELEGRAM_BOT_TOKEN` (после правок функций — ссылка строится из username, сообщения шлёт n8n).
- УДАЛИТЬ: `TELEGRAM_WEBHOOK_SECRET` / `?s=` — не нужен. Telegram больше не зовёт supabase напрямую; единственный вызыватель `telegramWebhook` — n8n.
- ПЕРЕИСПОЛЬЗУЕМ: `N8N_SECRET` (уже есть в env и уже настроен в n8n как httpBearerAuth). `telegramWebhook` авторизуется через `requireN8nSecret(req)` — та же конвенция, что у `getTripByTelegramChatId`/`getPendingReminders`/`getDailyReminders`.
- Единственный телеграмовский секрет во всём флоу — bot token, живёт в n8n.

## 3. Edge-функции

### telegramStartLink — правка
- **БАГ-ФИКС (критично):** сейчас `isCallerParticipant(tripId, user.email!)` — а функция ждёт `userId` (uuid, сравнение с `trips.created_by`/`trip_members.user_id`). С email проверка ВСЕГДА false → 403 для всех. Исправить на `isCallerParticipant(tripId, user.id)`.
- Убрать вызов `getMe` (и зависимость от `TELEGRAM_BOT_TOKEN`).
- Ссылку строить как `https://t.me/${Deno.env.get('TELEGRAM_BOT_USERNAME')}?start=${token}`.
- Остальное без изменений (вставка `telegram_link_tokens` с TTL 10 мин).
- Примечание: deep-link `?start=` работает только в ЛИЧНЫХ чатах. Несколько личных аккаунтов на трип — ок. Групповые чаты — вне scope (нужен отдельный `?startgroup=`-флоу).

### telegramWebhook — правка (внутренний binding-эндпоинт, вызывается из n8n)
- Авторизация: `requireN8nSecret(req)` (Bearer N8N_SECRET) вместо `?s=`-секрета — как у `getTripByTelegramChatId`. verify_jwt=false остаётся.
- Логика `/start <token>`: валидация токена (есть/`used_at` null/не истёк) → **upsert по onConflict(trip_id, telegram_chat_id)** (поля: trip_id и user_id из токена, telegram_chat_id/username/first_name из апдейта, is_active=true, linked_at=now) → пометить токен `used_at`.
- **Не отправлять Telegram-сообщения.** Вместо `sendMessage` — вернуть JSON:
  - успех: `{ ok: true, action: 'linked', trip_title }`
  - нет токена: `{ ok: true, action: 'welcome' }` (n8n покажет welcome)
  - ошибки: `{ ok: false, reason: 'invalid' | 'used' | 'expired' }`
- Убрать использование `TELEGRAM_BOT_TOKEN`/`getMe`/`sendMessage`.
- Транзакционность: пометку `used_at` делать только после успешного upsert (DB-работа целиком в функции, не дробить на n8n).

### telegramGetIntegration — правка (список вместо одной строки)
- Сейчас: `(trip_id, user_id).limit(1)` → `{ connected, integration }`.
- Стало: авторизация `isCallerParticipant(tripId, user.id)`; вернуть `{ integrations: [{ id, telegram_chat_id, telegram_username, telegram_first_name, is_active, linked_at }] }` по всем привязкам трипа, сорт по linked_at.

### telegramSetActive — правка (таргет по привязке)
- Тело: `{ tripId, integrationId, isActive }`.
- Авторизация `isCallerParticipant(tripId, user.id)`; проверить, что `integrationId` принадлежит `tripId`; `update is_active` по `id`.

### telegramDisconnect — правка (таргет по привязке)
- Тело: `{ tripId, integrationId }`.
- Авторизация `isCallerParticipant(tripId, user.id)`; проверить принадлежность; `delete` по `id` (одна строка, не по user_id).
- Рефактор: сейчас функция катит свой `createClient`/`getUser` — перевести на `_shared` (`getRequestUser`/`supabaseAdmin`), как остальные.

### removeTripMember — правка (очистка привязок при исключении/выходе)
После `delete trip_members` (строка 42) добавить, при наличии `member.user_id` (у offline-участников он null):
```ts
if (member.user_id) {
  await supabaseAdmin
    .from('trip_telegram_integrations')
    .delete()
    .eq('trip_id', member.trip_id)
    .eq('user_id', member.user_id);
}
```
Зависимость: единственная точка и для «исключить» (MembersLens), и для «выйти из трипа» (SettingsLens) — обе зовут `removeTripMember`.

### deleteMyAccount — без изменений
Строка 101 (`trip_telegram_integrations.delete().eq('user_id', userId)`) уже корректно чистит привязки. Побочный эффект: групповую привязку, инициированную удаляемым юзером, тоже снесёт — приемлемо для v1.

### Удаляем
- `telegramSetWebhook` — не нужен (n8n регистрирует webhook сам). Удалить mirror в `base44/` и из плана.
- `telegramGetBotInfo`, `telegramGetWebhookInfo` — удалить ПОСЛЕ запуска n8n-флоу (диагностика старого webhook). **Обе используют `TELEGRAM_BOT_TOKEN`** → удалить их ДО снятия токена из env (иначе 500).

## 4. n8n — TG Chat Bot (workflow id mJ4QQUW7rrGh4tys)
Добавить маршрутизацию входящих в начало воркфлоу (после `Telegram Trigger`, перед `Create a row`):

- **Switch/IF `is /start`**: условие `{{ $json.message.text }}` начинается с `/start`.
  - **TRUE → BINDING-ветка:**
    1. `HTTP Request` → `POST https://<supabase>/functions/v1/telegramWebhook`, тело = сырой `{{ $json }}` (update). Авторизация — та же httpBearerAuth-кредá (N8N_SECRET), что у ноды `getTripByTelegramChatId`.
    2. `Telegram` (Send message, креда бота n8n) — текст по ответу:
       - `action='linked'` → `✅ Готово! Подключено к поездке «{{trip_title}}». Буду присылать напоминания…`
       - `action='welcome'` → welcome-сообщение (см. ниже).
       - `ok=false` → текст по `reason` (invalid/used/expired → «Ссылка недействительна/использована/истекла, сгенерируйте новую в настройках поездки»).
    3. Ветка завершается (в AI Agent НЕ идёт).
  - **FALSE → существующий путь** (`Create a row` → … → AI Agent → Send a text message). Без изменений.

- **Welcome message flow**: голый `/start` без токена попадает в BINDING-ветку, `telegramWebhook` вернёт `action='welcome'`, Telegram-нода отправит приветствие: кто такой бот, что умеет (напоминания о трипе), как подключить (в настройках поездки → «Привязать Telegram»). Отдельный воркфлоу не нужен — это ветка того же Switch.

Грабли n8n (из прошлого опыта): `update_workflow` через MCP **не привязывает креды** HTTP/Telegram-нодам — проставить вручную в UI (Telegram cred бота для Send-ноды; httpBearerAuth/N8N_SECRET для HTTP-ноды `telegramWebhook`). После апдейта проверить `active=true`.

## 5. Фронт — TelegramAssistantPanel.jsx → новый дизайн
По uploads `trip-settings.jsx` (`TelegramSection` + `TelegramConnectDialog`):
- Список аккаунтов: имя = `telegram_first_name` (+ `@username` мелким), бейдж «Активен», иконка-удаление → `ConfirmDialog` → `telegramDisconnect({tripId, integrationId})`.
- Кнопка «Привязать ещё один Telegram-аккаунт» / пустое состояние «Привязать» → модалка коннекта.
- Модалка `TelegramConnectDialog`: `telegramStartLink({tripId})` → показать ссылку + «Открыть бота»; пока ждём — **поллинг** `telegramGetIntegration({tripId})` (раз в ~3 сек / по фокусу вкладки), при появлении новой привязки — авто-переход в «привязан».
- **Кнопку «Я нажал Start» убрать** — привязка подтверждается поллингом, кнопка ничего не подтверждает (нажатие в приложении ≠ Start в Telegram). Опционально оставить тихий линк «проверить сейчас» (форс-рефетч).
- Pending-статус и гранулярные настройки уведомлений — **НЕ делаем** (решение Pavel), единый тоггл `is_active` на привязку (если оставляем тоггл) либо только «удалить».
- i18n: ключи `telegram.*` уже есть, добавить недостающие под список/модалку.

## 6. Порядок сборки (строго по зависимостям)
1. Миграция на **dev** → проверка → **prod** (раздел 1).
2. Env: добавить `TELEGRAM_BOT_USERNAME` на dev+prod (раздел 2).
3. Правки функций (раздел 3) + деплой на dev+prod (`--no-verify-jwt` для `telegramWebhook`, см. config.toml).
4. n8n Switch + BINDING-ветка + welcome (раздел 4) — **только после шага 3**, т.к. зависит от JSON-контракта `telegramWebhook`.
5. Фронт (раздел 5) — push в dev и main.
6. После сквозной проверки: сначала удалить `telegramGetBotInfo`/`telegramGetWebhookInfo` (они юзают токен), ПОТОМ снять `TELEGRAM_BOT_TOKEN` из env. `TELEGRAM_BOT_TOKEN` используется в 4 функциях: telegramWebhook, telegramStartLink (правятся на шаге 3), telegramGetBotInfo, telegramGetWebhookInfo (удаляются здесь).

## 7. Анализ влияния / зависимости
- **ПРЕДПОСЫЛКА #0 (подтвердить Pavel):** бот в n8n (Telegram Trigger cred) и бот, чей username идёт в `TELEGRAM_BOT_USERNAME`/deep-link — ОДИН И ТОТ ЖЕ бот. Если разные — флоу не работает. Токен n8n-креды из кода не виден, нужно подтверждение.
- `getTripByTelegramChatId` (бот-сайд) — НЕ меняется (уже массив по chat_id). M2M на запись его не ломает.
- `_shared/tripPayload.ts` — проверено: таблицу `trip_telegram_integrations` НЕ трогает (поля is_active/linked_at добавляет сам `getTripByTelegramChatId`). Миграция его не задевает.
- Все читатели таблицы (проверено grep): `getTripByTelegramChatId`, `telegramDisconnect`, `telegramWebhook`, `telegramGetIntegration`, `telegramSetActive`, `deleteMyAccount` — все учтены в разделе 3.
- Рассылка напоминаний: воркфлоу **TG Reminders** (`hDCVQcNdgEyKEvnY`) сейчас **неактивен** (triggerCount 0) — напоминания не шлются. При активации должен веерить по ВСЕМ активным привязкам трипа (`idx_tti_active_trip`), а не брать одну строку. Спящая зависимость, проверить при включении.
- `is_active` — служит и «слать напоминания», и для бота «активный трип в чате»; семантика совместима.
- Документация Notion (AI Chatbots / Telegram) — обновить после внедрения.
