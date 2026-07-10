# Triplanio: полный аудит платёжной системы 2026-07-10

Read-only аудит всего контура (createStripeCheckout → stripe-webhook → реестр purchase/subscription → recompute_* → кэш users.subscription_*/trips.is_pro_trip → reconcile-on-read → Pro-гейты). Код НЕ менялся.

## Вердикт
Ядро после переписывания 2026-06-28 архитектурно здоровое: single-writer, реестр+деривация, идемпотентность на двух концах (webhook_event + нативные Stripe idempotency-keys), fail-loud вердикты (TRIP-208), детерминированный грейс (TRIP-158), каталог в БД, провайдер-шов (PaymentAdapter), Tier-B гранты + CI-страж. P0 не найдено.

## P1 (три)
1. **Рефанд/диспут ПОДПИСКИ — недолговечная ревокация.** `charge.refunded` ставит строке subscription локальный status='refunded', но Stripe-подписка остаётся active → любой следующий refetch истины (reconcile stuck-PRO, `customer.subscription.updated`, `invoice.paid`) перезаписывает status verbatim из Stripe → Pro возвращается ≤10 мин; следующий биллинг-цикл снова начислит. Для purchase (pro_trip) всё консистентно (истина = charge). Системный фикс: рефанд подписки должен либо (а) отменять подписку у провайдера в том же хендлере (adapter.cancelSubscription — «Stripe = истина» восстанавливается), либо (б) жить в отдельном override-поле (refunded_at на subscription), которое recompute учитывает, а status-синки не затирают.
2. **`incomplete_expired` отсутствует в CHECK `subscription_status_check`**, а webhook/reconcile пишут `sub.status` verbatim. Переход incomplete→incomplete_expired (checkout завершён, платёж не прошёл за 23ч) → в webhook CHECK-violation → 500 → вечные ретраи Stripe; в reconcile — молчаливый пропуск (error insert'а не проверяется). Cutover сам нормализовал легаси `incomplete_expired`→`expired` в данных — словарь знал о статусе, но маппинга в рантайме нет. Фикс: единая функция нормализации provider-status→наш словарь (в subscriptionRow/адаптере) + тест-фиксация полного множества Stripe-статусов.
3. **`planTripWithAi` — по-прежнему без Pro-гейта** (только rate-limit 30/час) — открытый продуктовый вопрос с аудита 2026-06-29, не решён. Плюс локальные дубли `getRequestUser`/`supabaseAdmin` инлайном и захардкоженный n8n URL. Ждёт решения Pavel; техника — тот же серверный паттерн, что в parseBookingWithAi/callTriplanioAi.

## P2 (главное)
- **Reconcile-on-read без терминального состояния**: каждый юзер с provider_customer (в т.ч. бросивший чекаут, никогда не платил) сверяется со Stripe каждые 10 мин активности НАВСЕГДА. Нужен backoff/маркер «нечего сверять».
- **webhook_event без ретеншена** + полный payload jsonb (рост+PII) → pg_cron-чистка / payload только для failed.
- **reconcile stuck-FREE молча глотает ошибки insert/update** (нет проверки error) → лог+Sentry по паттерну ensureWrite.
- Псевдо-try/catch вокруг notifications-insert в webhook: supabase-js не бросает, error не читается → сбой невидим.
- `checkSubscriptionStatus` отвечает по ЛЮБОМУ tripId любому authenticated (isPro/isOwner чужого трипа + триггер reconcile владельца чужими руками; троттлы смягчают) → участник-гейт.
- `unsupported_event`-аномалия на каждый неподдержанный тип; сверка событий Stripe Dashboard-endpoint так и НЕ сделана (Stripe MCP в сессии не авторизован).
- status='duplicate' (вторая оплаченная подписка) — юзер продолжает ПЛАТИТЬ за демотированную; авто-возвратов нет осознанно, но нет и операционной процедуры по needs_review.
- Гигиена users (Tier C): у authenticated табличные DELETE/TRUNCATE/MAINTAIN (baseline) + политика users_delete_own → self-DELETE строки users в обход anonymize_my_account (платящих спасает FK purchase/subscription). REVOKE + дроп политики.
- Тесты: чистые билдеры покрыты (deno test BLOCKING), но сам конвейер вебхука (ветки switch, ordering-guard, дубль-детект) и recompute/is_user_pro — без тестов.

## Закрыто относительно прошлых аудитов
Баг «отмена не понижает Pro без строки trip_subscriptions» (memory 2026-06-22) — закрыт новой архитектурой (upsert-материализация + reconcile stuck-FREE). P0 «authenticated пишет колонки энтайтлмента» — закрыт (колоночные гранты users = allowlist без subscription_*/entitlement_synced_at; trips = полный Tier B).
