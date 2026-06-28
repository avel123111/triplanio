---
name: triplanio-pro-status-hook
description: Общий кэш-хук useTripProStatus — почему плашка upgrade моргала на границе edit и как починено
metadata: 
  node_type: memory
  type: project
  originSessionId: 28ca31eb-4876-422b-922e-556933b34bb7
---

Trip-level Pro резолв вынесен в общий react-query хук `useTripProStatus(tripId, isProTrip)` в `src/lib/subscription.js`. Возвращает `{ isPro, resolved }`; кэш по `['trip-owner-pro', tripId]`, staleTime 5м.

**Почему сделано:** раньше резолв был локальным `useState(false)`+`useEffect`(invoke checkSubscriptionStatus), СКОПИРОВАН один-в-один в `TripView` и `TripStructureEdit`. Линзы трипа переключаются как state внутри одной смонтированной `TripView` → `proResolved` живёт → плашки upgrade не моргают. Но `/trip/:id/edit` — отдельный роут → полный ремаунт страницы → свежий `proResolved=false` → повторный фетч → плашка моргает на входе в edit и на выходе из него.

**Как чинит:** кэш по tripId → второй маунт (пересечение границы edit↔trip) читает данные синхронно, `resolved` сразу true, моргания нет. Первый холодный вход всё ещё резолвится асинхронно (намеренно — баннер не показываем преждевременно на pro-трипах).

**Why:** убирает мигание И дубль логики (правило проекта: не дублировать).
**How to apply:** любой Pro-гейтинг в новом экране трипа — через этот хук, не копировать fetch. Связано с [[triplanio-pro-model]], [[triplanio-pro-audit]].

**★ACCOUNT-уровень — `useProStatus()` (TRIP-135, PR #227 в dev 2026-06-28).** Отдельный хук `src/lib/useProStatus.js` (НЕ в subscription.js — тот держится без top-level `@/`-импортов ради `node --test` drift-guard). Унифицирует «is THIS user Pro» на одном источнике, чтобы плашка аккаунта и Pro-бейдж не противоречили (был баг: плашка «Free» рядом с Pro-бейджем). Три слоя: **вердикт** = `isProActive(user)` (кэш users, та же формула, что `is_user_pro`); **детали** = `getUserPlan` (цена/период/cancelled/тип) — при сбое показываем лицо Pro + «Повторить», НИКОГДА не «Free»; **свежесть** = `getUserPlan` гоняет ленивый `reconcileEntitlement`, и при расхождении серверного вердикта с кэшем хук ресинкает строку через `checkUserAuth`. Корень бага: `loadPlan` делал `setPlan(data ?? null)` — а `supabase-js` при 5xx/timeout отдаёт `{data:null}` без throw → `derivePlanState(null)='no-sub'` → «Free». `ScreenAccount` теперь: `derivePlanState(isPro, plan)` → `no-sub | pro-pending | with-sub | annual | cancelled`. is_user_pro / drift-guard / серверный энфорсмент НЕ трогали. **Мультипровайдер (держать в голове, кода нет):** вердикт провайдеро-нейтрален (читает кэш users ← `recompute_user_entitlement` ← `trip_subscriptions`, без Stripe); Stripe-специфичен только слой деталей (`actualPrice`) и дорогой reconcile-on-read (`list-by-customer`). Под IAP/RevenueCat: добавить `provider`-измерение в trip_subscriptions + провайдеро-диспетчеризованный reconcile; вердикт и `is_user_pro` остаются. Связано с [[triplanio-cities-seed-only]] (тот же PR).

Заодно: меню edit и трипа — ОДИН компонент `TripSidebar` (src/components/trips/TripSidebar.jsx). На edit он рендерится как `collapsed` rail с раскрытием по hover. Баг переноса «Редактировать структуру»: у `.app-side--rail .app-side__item` стоял `white-space:nowrap`, не сбрасывался в `.is-open` → текст уезжал за 220px. Фикс в app.css: `.app-side--rail.is-open .app-side__item{white-space:normal;overflow:visible}` + label normal.
