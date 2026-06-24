---
name: triplanio-native-iap
description: Направление нативного приложения (Flutter) и предлагаемая архитектура in-app purchases для Pro
metadata: 
  node_type: memory
  type: project
  originSessionId: 36bebf22-1a3b-42b5-878c-ff0b42e7393b
---

Обсуждение 2026-06-03: если делаем нативные мобильные приложения.

**Стек натива — РЕШЕНО Pavel: Flutter** (единый Dart-кодбейс под iOS+Android). **Web — РЕШЕНО: параллельный полноценный продукт** (не мостик) → два независимых UI-слоя (React-web на Vercel + Flutter-натив) на один backend, вечный налог на паритет фич. Это усиливает аргумент за единый entitlement: 3 канала оплаты (Stripe-web + Apple IAP + Play Billing) надо свести в один Pro.

**Mapbox на Flutter:** офиц. mapbox_maps_flutter (iOS+Android, НЕ web). Геокодинг/Directions = REST, дёргаются из Flutter http. Web остаётся на Mapbox GL JS — две интеграции карты на один Mapbox-аккаунт.

**Почему Stripe сам по себе не закрывает Pro в нативе:** Pro = цифровая подписка. По правилам Apple/Google прямой Stripe для цифровых подписок в приложении запрещён вне узких юрисдикций (iOS digital goods через Stripe — только US и только редирект на внешнюю web-страницу; Android — US+EEA in-app). Вне этого обязателен Apple StoreKit IAP / Google Play Billing (комиссия 15–30%).

**ОТКРЫТО — слой покупок: сырой in_app_purchase vs RevenueCat.** in_app_purchase (офиц. плагин Flutter) = клиентская часть поверх StoreKit/Play Billing, серверную обвязку (валидация чеков App Store Server API + Google Play Developer API, продления/возвраты/grace, уведомления App Store Server Notifications V2 + Google RTDN, сведение 3 каналов в 1 Pro) пишем САМИ. RevenueCat (purchases_flutter) = всё это из коробки + единый entitlement. Я рекомендую RevenueCat ради скорости/снижения риска (web параллельный → 3 канала), но сырой путь валиден если важна независимость/нет вендора в платёжном пути — решение Pavel, ждёт. Можно прикинуть объём сырого пути предметно.

**RevenueCat НЕ обходит сторы** — это слой поверх StoreKit/Play Billing, агрегатор подписок и единый entitlement. Под капотом всё равно комиссии Apple/Google. У них есть Web Billing (бета, поверх Stripe) — но для прод-денег на web рано, наш прямой Stripe зрелее. RevenueCat берём ТОЛЬКО для нативного IAP. Pricing: бесплатно до $2,500 MTR, далее 1%.

**Предлагаемая архитектура (моя рекомендация, ждёт одобрения):**
- 3 канала → 1 entitlement: iOS=Apple IAP, Android=Play Billing, web=прямой Stripe.
- RevenueCat = источник истины по ЧЕКАМ/покупкам. Supabase = источник истины по ПРИКЛАДНОМУ Pro-статусу/доступу (НЕ отдаём RevenueCat роль арбитра доступа — сохраняем нашу enforcement-логику).
- Поток: покупка → RevenueCat валидирует чек → RevenueCat webhook → edge-функция Supabase → канонический writer Pro. Фронт читает Pro из Supabase как сейчас.
- SDK: purchases_flutter (офиц. RevenueCat) + supabase_flutter. Backend (Supabase/edge/Stripe-webhooks/n8n/гео) переиспользуется целиком; React-UI — нет.

**Фазы:** Ф0 канонизация одного Pro-writer setProEntitlement(user_id, source, expiry) (рефактор, до RevenueCat, дёргается и Stripe-, и RevenueCat-webhook); Ф1 RevenueCat+каталог продуктов (App Store Connect/Play Console/Stripe маппинг, цены с учётом комиссии); Ф2 RevenueCat webhook→Supabase, дедуп по user_id (защита от двойного Pro Stripe-web+Apple-IAP); Ф3 Flutter paywall+restore purchases; Ф4 anti-steering (в iOS purchase-path=Apple IAP, без рекламы web-оплаты), кросс-грант web→натив, sandbox-тесты.

Связано: [[triplanio-pro-model]] [[triplanio-stripe-integration]] [[triplanio-userid-migration]] [[triplanio-pro-audit]].
