---
name: triplanio-payments-foundation-rebuild
description: "TRIP-32 → эпик «Платёжный фундамент»: решение переписать схему платежей начисто (greenfield) с сохранением движка деривации права; ключевые архитектурные решения"
metadata:
  node_type: memory
  type: project
---

★РЕШЕНИЕ 2026-06-28 (Pavel, тред TRIP-32): пока 0 живых клиентов/оплат — строим ЧИСТЫЙ платёжный фундамент СРАЗУ И ЦЕЛИКОМ (не заплатка двойной оплаты, не эволюция на месте). Источник целевой модели — `payments-architecture.md` (аттач в TRIP-32). TRIP-32 (двойная оплата) становится подзадачей нового эпика и закрывается КАК СЛЕДСТВИЕ фундамента.

**Почему сейчас:** стоимость/риск рефактора биллинга растут с масштабом. Сейчас миграция тривиальна (prod ~3 подписки, dev ~28 строк, дублей 0). «Потом» = миграция живых денег под нагрузкой = худший момент. Тайминг-аргумент Pavel принят как решающий.

**Что СОХРАНЯЕМ (здоровое ядро, НЕ переписывать вслепую):** движок деривации права — `recompute_user_entitlement` + `revokeLostProFeatures*` (откат Pro-аддонов/telegram). Сегодня он по факту правильный: один писатель кэша, его зовут все пути (вебхук + reconcile-on-read). Плюс выстраданная логика вебхука (ensureWrite/anti-swallow, verbatim-статус, Basil-формат invoice, 2-путёвый рефанд, дённинг-грейс, ленивый customer_id, anomaly-таксономия, price→product маппинг на subscription.updated). Это СПЕКА для переноса, список — в треде TRIP-32.

**Что чистим ВОКРУГ ядра (greenfield-схема):** раздельные `purchase` (разовые trip-pro) / `subscription` (account-pro) вместо двухцелевой `trip_subscriptions`; каталог в БД `product`+`provider_price` (вместо хардкода stripeCatalog.ts) — делаем СРАЗУ; `provider_customer` таблицей (вместо колонки users.stripe_customer_id) — СРАЗУ; `webhook_event` (богаче stripe_events); `outbound_idempotency` (НАШ idem-ключ + предчек активного права в /checkout = чистое лекарство двойной оплаты, до денег, синхронно в нашей БД); дубли пишем строкой `duplicate`+`needs_review` (прозрачно), не прячем `break`.

**РЕШЕНИЕ по доступу/кэшу (важно, отвергнут «computed-on-the-fly» из дока):** ОСТАВЛЯЕМ материализованный кэш права (быстрые бейджи = чтение колонки, не N запросов на 20 трипов). Инвариант: у кэша РОВНО ОДИН писатель (recompute), его зовут ВСЕ пути (вебхук/реконсиляция/cron-истечение), он же откатывает аддоны. Дрейф убирается дисциплиной «один писатель»+реконсиляция, НЕ отказом от кэша. Откат аддонов НЕЛЬЗЯ вешать на событие вебхука (реконсиляция-снятие Pro его не вызовет) — он живёт в recompute. Предикат сравнивает end_date>now() → кэш само-истекает на чтение; cron нужен лишь проактивно докатить откат.

**Адаптер (шов под мультипровайдер):** ядро провайдер-агностично; вся Stripe-специфика за контрактом `PaymentAdapter` (`_shared/payments/stripeAdapter.ts`): verify-signature, refetch объекта, map price/SKU→product_code, create checkout, create portal-session. Сейчас одна реализация (Stripe). RevenueCat/Telegram — НЕ делаем, только задел: новый провайдер = новый файл-адаптер, ядро не трогаем. `trip_subscriptions` уже имеет provider/platform/provider_meta.

**НЕ строим сейчас:** весь Этап 2 (reconcile-cron, retry-очередь, billing_event_log, manual_grant) и Этап 3 (RC/TG). reconcile-cron — близкий приоритет после ядра.

**Процесс:** strangler — новые таблицы рядом, переключаем запись→чтение→дочистка мёртвого. Каждая фаза = свой PR в dev, мерджит Pavel. Дизайн-док ДО кода (правило новых таблиц). Связь: [[triplanio-payments-deep-audit]] [[triplanio-payments-phase-status]] [[triplanio-pro-model]] [[triplanio-stripe-integration]] [[triplanio-cancel-downgrade-no-tripsubrow-bug]]
