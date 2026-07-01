/**
 * format — единый «наш формат» платёжного факта.
 *
 * Платёжка отвечает на один вопрос: «юзер/трип сейчас Pro?». Чистая схема —
 * конвейер: провайдер присылает вебхук на СВОЁМ языке → мы переводим в НАШ единый
 * формат ОДИН раз на входе → пишем в таблицы → считаем Pro. Этот тип и есть тот
 * «наш формат»: провайдер-нейтральная ФОРМА ВХОДА, сумма двух случаев,
 * дискриминированная по `kind`:
 *   - purchase     — разовая покупка (Trip Pro): кто, что (+ trip_id), провайдерские
 *                    id, статус, сумма/валюта;
 *   - subscription — подписка (Account Pro): + период/cancel_at_period_end/грейс.
 *
 * Билдеры `buildPurchaseRow` / `buildSubscriptionUpsertRow` принимают арм этого
 * union (без дискриминатора `kind`) и возвращают строку для своей таблицы. Будущий
 * общий `applyFacts(fact: PaymentFact)` (вынос переводчика в адаптер — отдельная
 * задача, по триггеру второго провайдера) диспатчит по `fact.kind`: форма, на
 * которую будет проецировать RevenueCat/IAP, зафиксирована здесь заранее.
 *
 * ВАЖНО: тип описывает ФОРМУ ВХОДА (что перевели из формата провайдера), НЕ
 * строку-результат. Операции (.insert/.upsert, onConflict, идемпотентность,
 * recompute, revoke) остаются у вызывающего — это решения про запись, не про форму.
 */

import type { PurchaseInsertInput } from './purchaseRow.ts';
import type { SubscriptionUpsertInput } from './subscriptionRow.ts';

export type PaymentFact =
  | ({ kind: 'purchase' } & PurchaseInsertInput)
  | ({ kind: 'subscription' } & SubscriptionUpsertInput);
