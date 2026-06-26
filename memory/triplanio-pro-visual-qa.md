---
name: triplanio-pro-visual-qa
description: Аудит ВСЕХ точек входа Pro-визуала (плашки/модалки/бейджи/гейты) + QA-чеклист и правила визуализации в Notion
metadata: 
  node_type: memory
  type: project
  originSessionId: 22ba24df-8dbb-465a-bb11-79858ee67aa9
---

★Полный аудит отображения Pro в triplanio_new @ dev (94fd246), 2026-06-16. Правила визуализации → Notion-страница «Pro / Premium — точки входа, состояния и правила визуализации» (под корнем «Triplanio», id 3812c9f1-427e-813a-875c-e2bd0c405a9c). QA-чеклист (.xlsx, 16 точек входа EP-01…EP-16, 72 строки, листы Чеклист/Матрица доступности/Правило офферов/Легенда) — в outputs `Triplanio_Pro_QA_Checklist_2026-06-16.xlsx` (папка «Triplanio docs» НЕ примонтирована, Pavel перенесёт сам).

**16 живых точек входа Pro:** EP-01 бейдж PRO в шапке (`isProActive`), EP-02 карточка подписки Аккаунта (loading/no-sub/with-sub/annual/cancelled + awaitingWebhook), EP-03 страница `/pro` (skeleton/2-3 плана/selected/ошибки already_active·recent_pending·generic·iframe/processing), EP-04 PaymentResultDialog success/fail (через StripeReturnModals, глобально), EP-05 бейдж карточки трипа, EP-06 баннер лимита, EP-07 TripLimitDialog (Variant D), EP-08 полноэкранный блокер планнера, EP-09 сайдбар-плашка `.pro-up` (owner btn / participant lockmsg), EP-10 ProUpsellModal mode=info, EP-11 ProUpsellModal в Settings (upgrade/info по роли), EP-12 карточки фич Settings, EP-13 EventAiBlock (checking/locked/available/idle/uploaded/parsing/parsed/error), EP-14 гейт бюджет-виджета, EP-15 ChatWidget, EP-16 видимость линз.

**Правило офферов 2 vs 3 (Pavel):** `/pro` показывает 2 подписки (monthly+yearly) ВСЕГДА; +`pro_trip` (3) только если `/pro?tripId` И смотрящий = владелец (`checkSubscriptionStatus.isOwner`). Логика `hidePerTrip = hidePerTrip==='1' || !tripId || tripOwner!==true` (Pro.jsx:37).

**Гейты функций (не только визуал):** редактирование ПРОШЛОГО трипа `canEditMode = role!=='viewer' && (!isTripInPast || tripIsPro)` (TripView:951) — прошлый трип правит только если трип Pro; 2-й активный трип = нужна подписка; budget/chat/telegram/AI-парсер = Pro-аддоны; копия Pro-трипа не наследует Pro.

**Расхождения/баг-риски для QA:** (1) бейдж карточки трипа (EP-05) завязан ТОЛЬКО на `is_pro_trip` → трип, Pro через подписку владельца, бейджа НЕ имеет; (2) в структурном редакторе участнику lockmsg ведёт на `/pro?tripId` вместо инфо-модалки (как в TripView); (3) viewer в Settings: тоггл не-Pro аддона падает серверным FORBIDDEN с общим тостом ошибки; (4) budget-locked модалка ведёт viewer в настройки, где он ничего не включит.

★TRIP-63 (PR #182 → dev, 2026-06-26): несоответствия 1/2/3/5 закрыты (FE-only, reuse-first). №1 — `TripStructureEdit.onProInfo` (оба сайдбара) теперь открывает `ProUpsellModal mode='info'` (reuse, зеркало TripView), не nav('/pro'). №2 — снят `&hidePerTrip=1` в `SettingsLens.openUpgrade` → владелец из Настроек видит 3 оффера как из сайдбара/AI-блока (Pro.jsx и так режет per-trip не-владельцу). №3 — бейдж карточки трипа стал owner-aware ПОЛНОСТЬЮ (TRIP-121, тот же PR): миграция `20260626200000_travel_stats_owner_aware_pro` добавила per-trip `is_pro = public.is_trip_pro(id)` (канон-предикат 0055) в RPC `get_user_travel_stats` (Главная и так зовёт его 1 раз → ноль новых запросов); DEFINER-RPC вправе звать `is_trip_pro` (она revoked для anon/authenticated → IDOR-защита), булеан только по participant-набору → биллинг владельца не утекает. `Trips.normalizeTrip` читает серверный `is_pro` с фолбэком на клиентский предикат (`is_pro_trip || (role==='owner' && isProActive)`) для безопасного раската. Теперь участник чужого Pro-через-подписку трипа тоже видит бейдж. (per-card useTripProStatus отвергнут = N edge-вызовов на карточку.) №5 — решение Pavel: НЕ ветвить модалку, а вернуть viewer ВЕСЬ экран Settings задизейбленным (reuse disabled-fieldset из identity-блока), активна только «Выйти» → тупик budget-замка исчезает сам (см. [[triplanio-viewer-write-rls-escalation]] — это разворот hide-подхода TRIP-137). Остаток DoD: проставить ссылки на TRIP-63 в Notion-статье у несоответствий.

**Мёртвый код (НЕ тестировать):** ProBadge.jsx, ProLockedDialog.jsx, TripProInfoDialog.jsx, PaymentSuccessDialog.jsx, PaymentFailDialog.jsx (не импортируются; заменены ProUpsellModal / PaymentResultDialog / инлайн `badge--pro`).

Связано: [[triplanio-pro-model]] [[triplanio-pro-audit]] [[triplanio-overlay-pro-unification]] [[triplanio-pro-status-hook]]
