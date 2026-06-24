---
name: triplanio-entitlement-reconciliation-todo
description: TODO — сверка-самолечение Pro-статуса (вебхук + периодический authoritative re-fetch) для Stripe и будущего нативного IAP
metadata: 
  node_type: memory
  type: project
  originSessionId: 36bebf22-1a3b-42b5-878c-ff0b42e7393b
---

TODO (одобрено Pavel 2026-06-03): добавить механизм сверки-самолечения Pro-статуса, не полагаться только на вебхуки.

**Проблема:** вебхуки иногда теряются/задерживаются. Слепо верить «поймали все события» нельзя — можно тихо разойтись с реальным состоянием подписки (юзер заплатил/отменился, а Pro в Supabase не обновился).

**Решение:** вебхук (быстрая запись) ПЛЮС периодическая сверка с authoritative-API провайдера, которая подтверждает/чинит состояние и ловит пропущенные события. Триггеры сверки: на старте приложения и/или по расписанию (cron-задача).

**Покрывает оба канала одним механизмом:**
- Сейчас: Stripe (web) — дёргать Stripe API и сверять статус подписки с Pro в Supabase.
- Будущее (нативный IAP, см. [[triplanio-native-iap]]): тот же механизм для RevenueCat (или сырого Apple/Google API).

Оба канала пишут в единый writer setProEntitlement(user_id, source, …); сверка использует тот же writer. Источник истины по доступу = Supabase (НЕ провайдер). Связано: [[triplanio-stripe-integration]] [[triplanio-pro-model]] [[triplanio-native-iap]].
