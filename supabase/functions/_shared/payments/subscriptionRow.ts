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
 * НЕ покрывает (осознанно): партиал-UPDATE'ы (checkout-existing, invoice.paid-existing,
 * customer.subscription.updated/deleted) — у них слишком разные узкие наборы полей,
 * прогон через общий билдер раздул бы его в god-функцию без снятия реального дубля.
 * Сброс грейса (`provider_meta: null`) в invoice.paid-existing остаётся явным инлайном.
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
  /**
   * Включать ли `current_period_end`, когда значение null.
   *  - true  (checkout-new / invoice.paid-new): ключ пишется всегда — поведение
   *    сохранено байт-в-байт (`current_period_end: periodEndIso`).
   *  - false (payment_failed / invoice.updated): ключ только при непустом значении
   *    (`...(periodEndIso ? { current_period_end } : {})`).
   * ⚠️ Эта асимметрия — НЕ дизайн, а унаследованная неконсистентность исходного
   *    кода; сохранена намеренно (характеризация), кандидат на отдельный фикс.
   */
  includePeriodEndWhenNull: boolean;
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

  if (input.currentPeriodEnd !== null || input.includePeriodEndWhenNull) {
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
