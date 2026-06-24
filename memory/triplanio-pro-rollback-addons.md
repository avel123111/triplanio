---
name: triplanio-pro-rollback-addons
description: "Откат Pro-фич трипа при потере Pro — реализован (миграция применена prod+dev), функции ждут CLI-деплой+git"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7be48264-63dd-4851-a4d8-2588e6f449ef
---

★РЕАЛИЗОВАНО 2026-06-23, миграция применена prod+dev; edge-функции и git ЖДУТ (см. ниже). Закрывает дыру: откат Pro-фич трипа не работал вообще.

**Проблема (была):** флаги `trip.details.addons` (budget/chat/telegram_assistant) — «липкие». Их ставит `updateTripSettings` под Pro-гейтом, но никто не гасил при потере Pro. Гейтинг экранов читает ТОЛЬКО статичный флаг (`isAddonEnabled`/`isLensVisible` в tripMenu.js/TripView), живой Pro не сверяется. Webhook честно гасит `users.subscription_*`/`trips.is_pro_trip`, но `addons` и `trip_telegram_integrations` не трогал → Budget/Chat/Telegram работали бесплатно после отмены/возврата. TG хуже всех: `telegramWebhook`+reminder-функции (`get_pending_reminders`/`get_daily_reminders`) читают интеграции и Pro вообще не проверяют.

**Решение Pavel:** Budget/Chat — флипать флаг в данных (ручной возврат после ре-подписки, НЕ авто). Telegram — удалять строки `trip_telegram_integrations`. TG-disconnect — в ОДНОМ месте, звать из многих (будущее: групповые чаты, Telegram API). Фейл-сейф `is_trip_pro` в reminder/webhook НЕ ставим: удаление интеграций само гасит бота и напоминания (они источаются из той же таблицы) — гейт нужен лишь на вырожденный «webhook потерян + трип не открывали», отдельным тикетом.

**Что сделано (код в triplanio_new):**
- Миграция `0061_pro_rollback_addons.sql` — `revoke_trip_pro_addons(trip)`/`revoke_user_pro_addons(user)` returns table(trip_id): гейт `NOT is_trip_pro` (0055), флип budget/chat/telegram_assistant→false (jsonb_set, остальной details нетронут), вернуть trip_id где было что гасить ИЛИ есть TG-привязка. SECURITY DEFINER, service_role-only. **Применена prod+dev** (через apply_migration; провалидирована jsonb-логика + компиляция). В репо файл `00NN`, в БД таймстамп — обычный дрейф имён.
- `_shared/telegramTeardown.ts` — `disconnectTripTelegram(admin,{tripId,integrationId?})` = ЕДИНЫЙ источник TG-delete (та же семантика, что была инлайн в telegramDisconnect).
- `telegramDisconnect/index.ts` — ужат в обёртку над хелпером (контракт {ok,removed} сохранён; FE-вызыватели SettingsLens/ScreenAccount не трогаются).
- `_shared/revokeLostProFeatures.ts` — оркестратор: SQL-rpc (флаги) → `disconnectTripTelegram` по возвращённым trip_id. Best-effort (не бросает). `forUser` (fan-out по трипам владельца при потере подписки) + `forTrip` (pro_trip refund).
- `stripe-webhook/index.ts` — `recompute()` после rpc зовёт `revokeLostProFeaturesForUser` (покрывает ВСЕ sub-loss ветки, self-gating); ветка refund pro_trip после `is_pro_trip=false` зовёт `revokeLostProFeaturesForTrip`.
- `_shared/reconcileEntitlement.ts` — после финального recompute зовёт `revokeLostProFeaturesForUser` (покрывает тайм-лапс on-read, на который webhook не приходит).
- FE: данных не меняем — флипнутые сервером флаги сами перекрывают экраны; SettingsLens уже рисует Pro-locked по hasPro.

**ОСТАЛОСЬ (manual, не сделано в сессии):**
1. git (ветка dev): stage по одному пути — telegramTeardown.ts, revokeLostProFeatures.ts, reconcileEntitlement.ts, stripe-webhook/index.ts, telegramDisconnect/index.ts, 0061_*.sql; commit; push dev + main.
2. Деплой edge-функций на ОБА проекта (bundle тянет изменённые _shared): `stripe-webhook` (--no-verify-jwt, canon-10!), `telegramDisconnect`, `getUserPlan`, `checkSubscriptionStatus` (эти 3 — verify_jwt=true). После — re-verify list_edge_functions, что canon-10 остался verify_jwt=false.
3. Смоук: отменить тест-подписку / вернуть pro_trip на dev → проверить, что budget/chat-линзы исчезли и TG-привязки снесены.
4. Notion + Triplanio docs: задокументировать модель отката (см. [[triplanio-payments-phase-status]], [[triplanio-pro-visual-qa]]).

Связки: [[triplanio-payments-deep-audit]] (P0 dabl-райт энтайтлмента — отдельно), [[triplanio-pro-visual-qa]] (16 точек Pro-визуала), [[triplanio-deploy-topology]], [[triplanio-migration-naming-drift]].
