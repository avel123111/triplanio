---
name: triplanio-payments-phase-status
description: Triplanio платежи/Pro — статус ремедиэйшна (T1–T7) + handoff для следующей сессии
metadata: 
  node_type: memory
  type: project
  originSessionId: c5d99d3e-69e4-4650-9347-dbda7e9e9872
---

★★ОБНОВЛЕНО 2026-06-21 (доп. сессия): НЕЗАВИСИМЫЙ АУДИТ подтвердил live — P0 закрыт (0 INSERT/UPDATE грантов на энтайтлмент-колонки prod+dev), вебхук v30 на prod УЖЕ содержит T3/T5/T7 (handoff «деплой PENDING» был устаревшим), parseBookingWithAi v12 гейтнут. СДЕЛАНО в эту сессию: (1) T6-добивка — все 5 edge-копий предиката (getActiveTrips/copyTrip/updateTripSettings/getUserPlan/checkSubscriptionStatus) переведены на RPC is_user_pro/is_trip_pro; isActivePro-хелпер удалён; getUserPlan/checkSubscriptionStatus сохранили сырое чтение только для reconcile-триггера+ответа; (2) тест-замок src/lib/subscription.test.js (isProActive⟷SQL, 4 кейса) + subscription.js: импорт supabase сделан ленивым (чтобы модуль грузился в node --test); lint+65 тестов зелёные; (3) миграция 0057 REVOKE EXECUTE recompute_user_entitlement от anon/authenticated — ПРИМЕНЕНА в обе БД (acl=postgres+service_role); (4) 3 фейк-Pro в prod (avel123111/dddyakonova/ilya.manager) СБРОШЕНЫ в free (pro-без-леджера в prod=0); (5) доки: 16 старых PAYMENTS_* удалены, единый `Triplanio docs/PAYMENTS_STATE_2026-06-21.md` (+ADR оставлен); Notion «Stripe — поток оплаты» обновлён (блок 2026-06-21 + правки CK-1/комп). ⚠️ОСТАЛОСЬ Pavel: git push dev (5 edge + subscription.js + subscription.test.js + 0057) → deploy 5 функций verify_jwt=true в ОБА проекта → dev→main. Stripe-легаси O3 (€0.05 yearly и др.) не архивированы. Команды — в PAYMENTS_STATE §6.

★ОБНОВЛЕНО 2026-06-21 (сессия закрыла T4+T5+T7). Полный handoff: `Triplanio docs/PAYMENTS_HANDOFF_NEXT_2026-06-21_v3.md`. План-источник истины: `Triplanio docs/PAYMENTS_REMEDIATION_PLAN_2026-06-21.md`. Ранние CK-дыры (CK-1 рефанд подписки, проглатывание ошибок записи) — ЗАКРЫТЫ в T3.

**Git — всё на origin/dev, дерево чистое, dev==origin/dev:**
- T7 `df94148` — pro_trip dedup по stripe_checkout_id (убрал ложный double_paid на crash-ретрае).
- T5 `7c12838` — observability: новый `reportPaymentAnomaly(tag,ctx,level)` в `_shared/sentry.ts`; вебхук 3 денежные аномалии (pro_trip_double_paid/sub_unresolved_user/refund_no_ledger)→error + default unsupported_event→info; reconcile_recovered_sub→warning.
- T4 `20b7489` — единый StripeReturnModals (поллинг getUserPlan+checkUserAuth рефреш AuthContext.user; кнопка Pro disabled в окне ожидания против повторной оплаты); удалён дубль-поллер ScreenAccount; чистка i18n account.activating_pro.
- Прошлая сессия (тоже на dev): T1 `6598f06`(0054), T6-ядро `bdd9eaa`/`1cde163`(0055/0056), T2 `bdd9eaa`, T3 `c4fc9e6`.
⚠️ **main НЕ содержит НИЧЕГО из T1–T7** — Pavel мержит dev→main сам (Vercel Hobby блокирует чужие коммиты).

**PENDING деплой (НЕ делал из песочницы — verify_jwt-риск canon-10 + git-лок EPERM):** stripe-webhook (`--no-verify-jwt`) + getUserPlan + checkSubscriptionStatus (потребители изменённого `_shared/reconcileEntitlement`) в ОБА проекта; re-verify canon-10 verify_jwt=false. Команды — handoff §3.1. Sentry: создать правило `kind:payment_anomaly AND level:error`→нотификация; проверить секрет `SENTRY_DSN` в обоих проектах (без него reporting=no-op).

**Осталось:** T6-добивка — слить 5 edge-копий предиката Pro (getActiveTrips/copyTrip/updateTripSettings/getUserPlan/checkSubscriptionStatus) на `is_user_pro`/`is_trip_pro` (формула: status='pro' AND end_date IS NOT NULL AND end_date>now(); null=НЕ pro). ГЛАВНЫЙ незакрытый код, нужен апрув подхода (RPC vs `_shared/proPredicate.ts`) по Hard rule #6. Хвосты: H3 (3 фейк-Pro в prod: avel123111 до 2026-09, ilya.manager/dddyakonova до 2036 — все без ledger/customer), H4 (архив легаси-цен Stripe + продукт prod_UZ9Yn841dRm7v0), H5/H6 (опц. defense-in-depth/заужение trip_subscriptions_select), T7ч2 advisory-lock (отложен), дрейф-cron (отложен), Notion-апдейт. **T8 бюджет ОТМЕНЁН** (системные траты пишутся всегда, RLS не трогать).

**Грабли:** typecheck/check:design на dev КРАСНЫЕ ещё до наших правок (типографика CalendarLens/PublicTrip блокирует, checkJs Trips/FlowMap/PanelAi) — не наш регресс, вынести отдельным таском. GateGuard требует фактов перед каждым Edit/Write.

Архитектура (ledger→recompute→кэш, идемпотентность, status-driven гейт, мультипровайдер) — КОРРЕКТНА, не переписывать. Связь: [[triplanio-payments-deep-audit]] [[triplanio-pro-model]] [[triplanio-stripe-integration]] [[triplanio-deploy-verify-jwt]] [[triplanio-vercel-hobby-blocks-collaborator-commits]]
