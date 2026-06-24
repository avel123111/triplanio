---
name: triplanio-tg-connected-accounts
description: "Account-level \"Подключённые аккаунты\" (Telegram) секция + новый endpoint + общий unlink-модал + выпил легаси настроек трипа"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6043ec31-b460-493f-9e78-cbc1ee8df72d
---

Реализовано 2026-05-31 (оба потока, деплой на prod+dev).

**П.1 — модалка удаления TG в настройках трипа.** Живые настройки трипа = вкладка «Настройки» в `TripView` → `SettingsLens.jsx` → `TelegramSection` (НЕ отдельный роут). Браузерный `window.confirm` заменён на общий `src/components/common/TelegramUnlinkDialog.jsx` (design `Dialog`, i18n `telegram.unlink_*`). Тот же компонент используется и в аккаунте — единый источник.

**П.2 — секция «Подключённые аккаунты» в `ScreenAccount.jsx`** (роут `/settings`, компонент `ConnectedAccountsSection`). Состояния: пустое (CTA «К трипам»→`/trips`), свёрнутый Telegram-узел (счётчик = число РАЗНЫХ трипов), раскрытый список. **Строка = привязка** (integrationId): один трип может дать несколько строк. Субтитр строки = **@nickname** (не даты — решение Pavel). «Перейти»→`/trip/:id?lens=settings`, «Отвязать»→`TelegramUnlinkDialog`→`telegramDisconnect({tripId, integrationId})`.

**Новый edge-fn `telegramGetMyIntegrations`** (verify_jwt=true, дефолт): `trip_telegram_integrations WHERE user_id=caller` + join trips(title, created_by) + роль вызывающего. Группировка по `user_id` = «кто привязал» (linked_by) — в скоупе личных чатов = владелец чата. Задеплоен на оба проекта (prod tizscxrpuopobgcxbekf, dev nydhzevdizkfaxdlikgc).

**Выпилено легаси:** `src/pages/TripSettings.jsx` (роут `/trip/:id/settings`), `components/settings/TelegramAssistantPanel.jsx`, `components/settings/AddonRow.jsx`; убраны import+route в `App.jsx` и `matchPath` в `AppHeader.jsx`.

Связано: [[triplanio-telegram-multilink]] (M2M-модель, user_id=linked_by), [[triplanio-frontend-repo]], [[triplanio-i18n-no-hardcode]].

Известный минорный нюанс: для роли viewer `?lens=settings` блокируется (VIEWER_BLOCKED_LENSES) → «Перейти» упадёт на timeline. Долг: `telegramWebhook/index.ts` остался с незакоммиченным multilink-WIP (отдельная TG_MULTILINK_TZ, в этот коммит НЕ входит).
