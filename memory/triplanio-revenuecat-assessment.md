---
name: triplanio-revenuecat-assessment
description: Оценка переезда Stripe→RevenueCat для Triplanio + решение по источнику истины
metadata: 
  node_type: memory
  type: project
  originSessionId: 935524fb-ca17-4c6d-aebf-92829bc0c2e6
---

★АНАЛИЗ 2026-06-21 (ADR в Triplanio docs: `ADR_PAYMENTS_REVENUECAT_MIGRATION_2026-06-21.md`, статус Proposed, код НЕ начат). Вопрос Pavel: перенести Stripe web в RC ради «одного провайдера» + отдать статусы на RC.

Ключевые выводы (критически):
- RC ≠ платёжный провайдер, а слой энтайтлментов ПОВЕРХ провайдеров. В режиме Stripe Billing integration свой Stripe (продукты/вебхуки/Customer Portal/письма) ОСТАЁТСЯ. На web-only RC не сокращает стек — увеличивает (+1% MTR, +1 зависимость). «Один провайдер» достигается только на уровне дашборда/SDK, не инфры.
- RC оправдан ТОЛЬКО мобайлом (одна интеграция вместо StoreKit+Play+Stripe). Pavel подтвердил: мобайл в ближайших планах → решение = ПРИНЯТЬ RC, заложить СЕЙЧАС (prod пуст → ноль миграции живых подписчиков, дешёвый тайминг).
- Killer-ограничение: энтайтлменты RC на уровне app_user_id (юзера), НЕ per-resource. `pro_trip` (per-trip $5→trips.is_pro_trip) RC не представляет → свой ledger НЕ выкидывается ни в одном сценарии. «Отдать ВСЕ статусы на RC» нереализуемо.
- Источник истины (ответ Pavel'у): провайдер=SoT транзакций/lifecycle; наш recompute-кэш (users.subscription_*, trips.is_pro_trip) ОСТАЁТСЯ (fail-closed гейт на каждый рендер не может ходить во внешний API; RC+Stripe Billing даёт задержку отмены до 2ч и единичный billing-issue). «Отдать на RC» = заменить recompute(из Stripe-ledger) на recompute(из RC-события), сам кэш не убирается.
- Цена: RC бесплатно до $2.5k MTR, далее 1% gross MTR (для web так же). Stripe-fee остаётся (2.9%+$0.30+0.7% Billing). RC = +1% поверх.
- Ограничения RC+Stripe Billing: нет трайлов/купонов в RC-флоу; dunning грубее нашего ФИКС #7; sub-management только Stripe Customer Portal; Stripe-коннект делает только owner RC-проекта.
- План: Ф0 подготовка → Ф1 shadow (RC-вебхук пишет provider='revenuecat' без переключения гейта) → Ф2 web-recurring на RC-SoT → Ф3 мобайл. Мультипровайдерный задел (provider/platform/provider_meta, recompute как OR) уже в схеме — RC ложится адаптером.
- RC-аккаунт Pavel уже есть (проекты AI Cooker, Guidium) — для Triplanio проекта RC нет, greenfield.

★ДОП 2026-06-21: сравнение ВСЕХ вариантов web-биллинга с админкой RC → `RC_WEB_BILLING_OPTIONS_ANALYSIS_2026-06-21.md` (Triplanio docs). RC-проект УЖЕ существует: `proj9aca6415` (app Stripe `app1d86f84915`/acct_1TZbo54gdjGHpLmX = Connected Platform-наблюдатель, НЕ Web Billing + Test Store), продукты/энтайтлменты(`Triplanio Pro`+`Pro Trip`)/офферинги заведены, метрики 0 (прод пуст). Варианты: A=RC Web Billing+Purchase Links(хендофф-реко), B=RC Web Billing+Web SDK(встроенная касса), C=Stripe Billing+RC-наблюдатель(текущая связка), D=Paddle(MoR, отвергнут), E=свой Stripe+RC только mobile(статус-кво, хендофф не упоминает), F=фазовый E→A. ПОПРАВКА к хендоффу по цене: «RC Web Billing без 0.7%» верно лишь <$2.5k MTR; ВЫШЕ порога RC 1% заменяет 0.7% = +0.3% vs чистый Stripe; Stripe Billing+RC (C) = СТАК обоих = 1.7% (худший на масштабе). Водораздел не «RC vs Stripe» а «web vs mobile доля выручки». Реко: F если приоритет риск/экономия; A→B если «один мозг» И все 3 блокера (B2B/VAT, Индия, купоны/триал)=нет. Ждёт ответов Pavel §7. Код НЕ начат.

Связано: [[triplanio-payments-phase-status]] [[triplanio-stripe-integration]] [[triplanio-pro-model]] [[triplanio-payments-deep-audit]]. Открытые вопросы — см. §11 ADR + §7 OPTIONS.
