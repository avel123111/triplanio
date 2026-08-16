# triplanio-telegram-unlink-seam (TRIP-415)

Отвязка Telegram унифицирована в ОДНОМ шве `disconnectTripTelegram`
(`supabase/functions/_shared/telegramTeardown.ts`). Он удаляет строки
`trip_telegram_integrations` (скоуп по `trip_id`, сужается `integrationId`/`userId`)
И внутри себя шлёт по каждому снятому `telegram_chat_id` **external-only** событие
`trip_telegram_unlinked` (n8n доставляет прощальное сообщение в чат). Emit стоит
ОДИН раз в шве → срабатывает из всех бизнес-точек входа, считать сценарии не нужно.

Точки входа, идущие через шов (все эмитят): ручная отвязка (`telegramDisconnect`,
настройки трипа + профиль) · потеря Pro трипом/владельцем (`revokeLostProFeatures*`,
из `stripe-webhook` + `reconcileEntitlement`) · выход участника
(`trip-member-self/leave` afterWrite) · удаление участника (`trip-member/remove`
afterWrite) · **выключение аддона `telegram_assistant`** (`trip-settings/settings`
afterWrite, TRIP-415).

Ключевой фикс TRIP-415: раньше выключение аддона гасило только флаг
`details.addons.telegram_assistant`, а строки привязки жили → `get_pending_reminders`
гейтит лишь по `is_active` (НЕ по аддону, НЕ по `is_trip_pro`), и бот продолжал
слать напоминания. Теперь `afterWrite['trip-settings/settings']` в `mutateEffects.ts`
держит инвариант «аддон выключен ⇒ привязок нет»: перечитывает аддон, при
выключенном — teardown через шов (серверно, не зависит от фронта; идемпотентно,
self-healing). На фронте (`SettingsLens.toggleFeature`) перед выключением при живых
привязках — `useConfirm` (канон ДС).

Ловушка/дизайн-решение: **destroy-кейсы НЕ идут через шов и НЕ эмитят намеренно** —
удаление трипа рвёт привязки FK `ON DELETE CASCADE` (шов в `trip-owner/delete`
afterWrite = no-op, каскад успел раньше), удаление аккаунта — прямой атомарный
`DELETE` в SQL `anonymize_my_account`. Это два РАЗНЫХ слоя гарантий: шов = бизнес-
отвязка «трип жив, привязку сорвали» (+ farewell); БД = целостность при уничтожении
родителя (сильнее best-effort edge). Farewell там не шлём — трипа/аккаунта уже нет.

Событие `trip_telegram_unlinked`: `EmitIds.chat_id` (строка привязки к моменту emit
удалена → chat_id едет id-слотом, не читается из БД), резолвер в `emitResolvers.ts`
(грузит `trip` ради названия + прокидывает `chat_id`), EXTERNAL-only в `notifyRules.ts`
(в `INAPP` спеки нет — адресат Telegram-чат, не пользователь; in-app-строку не пишем).
Требует n8n-ветку `notify/trip_telegram_unlinked` (вне репо).

Связано: [[triplanio-pro-rollback-addons]] (SQL revoke_*_pro_addons гасит флаг),
[[triplanio-tg-connected-accounts]] (секция подключённых аккаунтов + `TelegramUnlinkDialog`),
[[triplanio-honest-refusal-answers]] (edge-отказы статусом).
