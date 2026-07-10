/**
 * subscriptionRow — единый конструктор строки UPSERT'а в таблицу `subscription`
 * для рекуррентных вебхук-веток (single-writer формы строки подписки).
 *
 * Зачем: четыре ветки stripe-webhook собирали почти одинаковый объект из ~9 полей
 * руками (checkout-new / invoice.paid-new / invoice.payment_failed /
 * invoice.updated). Дубль сам по себе не баг, но он держал ЛОВУШКУ upsert-семантики:
 *
 *   при upsert «поля НЕТ в объекте» и «поле = null» — РАЗНОЕ:
 *     • поля нет  → старое значение в строке СОХРАНЯЕТСЯ;
 *     • поле null → старое значение ЗАТИРАЕТСЯ в null.
 *
 * Самое коварное поле — `provider_meta` (грейс-метка дённинга): в одной ветке его
 * надо ОТСУТСТВИЕ (не трогать), в другой — выставить `{ next_payment_attempt }`, в
 * третьей (invoice.paid по существующей строке) — СБРОСИТЬ в null. Спутать эти три
 * состояния молча — значит оставить юзера в ложном грейсе или потерять грейс. Здесь
 * выбор делается ОДНИМ явным дискриминатором `ProviderMetaDirective`, а не россыпью
 * спред-тернарников по веткам.
 *
 * Чистая функция: только примитивы на вход, объект на выход. Никаких импортов
 * рантайма (Stripe / supabaseAdmin) — поэтому покрывается обычным `deno test`.
 *
 * onConflict ('provider_subscription_id') и выбор .upsert vs .update остаются у
 * вызывающего — это решение про операцию, не про форму строки.
 *
 * Общий 3-полевой refresh (status / cancel_at_period_end / current_period_end?)
 * вынесен в buildSubscriptionRefreshPatch (ниже) — его слово-в-слово повторяли
 * checkout-existing, invoice.paid-existing и обе ветки reconcileEntitlement.
 *
 * Через билдеры осознанно НЕ гоним широкие партиал-UPDATE'ы
 * (customer.subscription.updated/deleted) — у них слишком разные узкие наборы полей
 * (product_code / provider_event_at / canceled_at), это раздуло бы билдер в
 * god-функцию. Сброс грейса (`provider_meta: null`) в invoice.paid-existing тоже
 * остаётся явным инлайном на call-site (в refresh-хелпер не заносится).
 */

import type { ProductCode } from './catalog.ts';

/**
 * Что сделать с колонкой `provider_meta` при записи:
 *  - leave → НЕ включать ключ (старое значение строки сохраняется при upsert-as-update);
 *  - clear → записать null (сброс грейс-метки после успешной оплаты);
 *  - set   → записать `{ next_payment_attempt }` (актуальная дата ретрая дённинга).
 */
export type ProviderMetaDirective =
  | { mode: 'leave' }
  | { mode: 'clear' }
  | { mode: 'set'; nextPaymentAttempt: string };

export interface SubscriptionUpsertInput {
  userId: string;
  productCode: ProductCode;
  providerSubscriptionId: string | null;
  /** Статус подписки verbatim из Stripe (или 'duplicate' при детекте дубля). */
  status: string;
  cancelAtPeriodEnd: boolean;
  currency: string;
  billingInterval: 'month' | 'year';
  currentPeriodEnd: string | null;
  providerMeta: ProviderMetaDirective;
  /** needs_review — только ветки с детектом дубля (checkout-new / invoice.paid-new). */
  needsReview?: boolean;
  /** provider_ref — только checkout-new (id чек-сессии). */
  providerRef?: string;
  /** amount — только checkout-new (session.amount_total). */
  amount?: number | null;
}

/**
 * Собирает объект строки для `.from('subscription').upsert(row, { onConflict:
 * 'provider_subscription_id' })`. Ключ присутствует в результате тогда и только
 * тогда, когда соответствующая ветка исходника его писала.
 */
export function buildSubscriptionUpsertRow(input: SubscriptionUpsertInput): Record<string, unknown> {
  const row: Record<string, unknown> = {
    user_id: input.userId,
    product_code: input.productCode,
    provider: 'stripe',
    provider_subscription_id: input.providerSubscriptionId,
    status: input.status,
    cancel_at_period_end: input.cancelAtPeriodEnd,
    currency: input.currency,
    billing_interval: input.billingInterval,
  };

  // current_period_end пишем ТОЛЬКО когда Stripe реально вернул дату. null'ом не
  // затираем известный «оплачено до» — его читает recompute как границу права
  // (max(... else current_period_end)). Тот же безопасный паттерн уже в
  // reconcileEntitlement / invoice.payment_failed / invoice.updated.
  if (input.currentPeriodEnd !== null) {
    row.current_period_end = input.currentPeriodEnd;
  }
  if (input.needsReview !== undefined) row.needs_review = input.needsReview;
  if (input.providerRef !== undefined) row.provider_ref = input.providerRef;
  if (input.amount !== undefined) row.amount = input.amount;

  switch (input.providerMeta.mode) {
    case 'set':
      row.provider_meta = { next_payment_attempt: input.providerMeta.nextPaymentAttempt };
      break;
    case 'clear':
      row.provider_meta = null;
      break;
    case 'leave':
      break;
  }

  return row;
}

/**
 * Общий партиал-патч «освежить подписку из Stripe»: ровно три поля, которые
 * checkout-existing / invoice.paid-existing / reconcileEntitlement (обе ветки)
 * писали руками одинаково. Вход — объект из примитивов (НЕ Stripe.Subscription:
 * модуль остаётся чистым и без рантайм-импортов; объект, а не позиционные
 * аргументы — status и currentPeriodEnd оба строковые, перестановку ловим по имени).
 *
 * current_period_end пишем ТОЛЬКО когда дата известна — null'ом не затираем
 * «оплачено до» (тот же безопасный паттерн, что в buildSubscriptionUpsertRow).
 * provider_meta НЕ трогаем: сброс грейса в invoice.paid остаётся явным на call-site.
 */
export function buildSubscriptionRefreshPatch(
  input: { status: string; cancelAtPeriodEnd: boolean; currentPeriodEnd: string | null },
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    status: input.status,
    cancel_at_period_end: input.cancelAtPeriodEnd,
  };
  if (input.currentPeriodEnd !== null) patch.current_period_end = input.currentPeriodEnd;
  return patch;
}
