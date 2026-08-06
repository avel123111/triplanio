/**
 * reconcilePlan — ЧИСТОЕ решение «что записать», отдельно от исполнения (TRIP-153).
 *
 * Сверка Б сравнивает наш реестр `subscription` со Stripe. Вся сложность там не в
 * походе по сети, а в решении: какая из подписок юзера даёт право, что делать с
 * остальными и В КАКОМ ПОРЯДКЕ писать. Это решение живёт здесь чистой функцией —
 * только примитивы на вход, план на выход, ноль импортов рантайма (Stripe /
 * supabaseAdmin). Тот же приём, что у `subscriptionRow.ts` / `purchaseRow.ts`:
 * покрывается обычным `deno test` без дубля Supabase-клиента.
 *
 * ★ПОЧЕМУ ПОРЯДОК ЗАПИСИ — ЧАСТЬ КОНТРАКТА, А НЕ ДЕТАЛЬ
 * На `subscription` висит частичный UNIQUE `uq_subscription_user_live (user_id)
 * WHERE status IN ('active','trialing','past_due')` (20260628170000:31), а
 * обработчика `23505` для подписок в коде НЕТ. Значит если сначала повысить нового
 * победителя, а потом понизить прежнего, между двумя запросами существуют ДВЕ живые
 * строки — и вторая запись падает на индексе. Поэтому план всегда идёт
 * ДЕМОУШЕНЫ → ПОТОМ ПОВЫШЕНИЕ: двух живых строк не существует ни в один момент, и
 * транзакция для этого не нужна.
 *
 * ★ПОЧЕМУ ПОБЕДИТЕЛЬ ВЫБИРАЕТСЯ ДЕТЕРМИНИРОВАННО, А НЕ `isDuplicateEntitlingSub`
 * Тот предикат — check-then-write и зависит от ПОРЯДКА ОБХОДА: при двух живых
 * подписках он объявит дублем ту, что просто пришла второй, и можно демотировать
 * актуальную, наделив правом протухшую. Вебхуку это не мешает — он всегда видит одну
 * подписку. У сверки на руках вся картина, поэтому угадывать не надо: победитель —
 * максимальный `current_period_end`, тай-брейк по максимальному `created`.
 *
 * ★ПИШЕМ ТОЛЬКО РАСХОЖДЕНИЯ. Совпало — записи нет вообще. Отсюда свойство, ради
 * которого это и сделано: список находок = список записей, то есть `report`-прогон
 * предсказывает `apply`-прогон.
 */

import type { ProductCode } from './catalog.ts';

/** Статусы Stripe, дающие право (те же, что читает recompute_user_entitlement). */
export const ENTITLING_STATUSES: ReadonlySet<string> = new Set(['active', 'trialing', 'past_due']);

/** Нормализованный срез подписки Stripe — ровно то, от чего зависит вердикт. */
export interface StripeSubView {
  id: string;
  status: string;
  /** ISO или null, если Stripe даты не вернул. */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** unix-секунды создания подписки — тай-брейк. */
  created: number;
  currency: string;
  productCode: ProductCode | null;
}

/** Наша строка реестра (только поля, участвующие в сравнении). */
export interface LocalSubRow {
  id: string;
  providerSubscriptionId: string | null;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  needsReview: boolean;
}

export type WriteReason =
  | 'sub_status_drift'      // строка есть с обеих сторон, состояние разошлось
  | 'sub_missing_in_stripe' // наша энтайтлинг-строка, которой в Stripe нет вовсе
  | 'duplicate';            // энтайтлинговая в Stripe, но проигравшая по правилу победителя

/**
 * Что физически сделать. Намерение объявляется ЯВНО, а не выводится из того, какие
 * поля оказались null: первая редакция исполнителя различала операции по «есть ли
 * subId», и ветка `sub_missing_in_stripe` (у неё subId ЕСТЬ — это наш id подписки,
 * которой нет в Stripe, а productCode null) не попадала ни в один случай, поэтому
 * строка молча не гасилась.
 */
export type WriteOp =
  | 'upsert'        // создать/обновить строку по provider_subscription_id
  | 'cancel_local'; // погасить нашу строку по её id (в Stripe такой подписки нет)

export interface PlannedSubWrite {
  op: WriteOp;
  /** Порядок применения. Демоушены идут раньше повышения — см. шапку. */
  order: number;
  /** id подписки в Stripe; null — только у строк, которых в Stripe нет. */
  subId: string | null;
  /** id нашей строки, если она уже есть (иначе создаём). */
  localRowId: string | null;
  /** Желаемое состояние. */
  status: string;
  needsReview: boolean;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  currency: string;
  productCode: ProductCode | null;
  reason: WriteReason;
  before: { status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null;
  after: { status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean };
}

export interface UserSubPlan {
  writes: PlannedSubWrite[];
  /** Сколько энтайтлинговых подписок у юзера в STRIPE. >1 = настоящая двойная оплата. */
  liveInStripe: number;
  /** id победителя, если он есть. */
  winnerSubId: string | null;
}

/** Сравнение дат по эпохам: строковое сравнение ISO↔pg-формата некорректно. */
function epoch(iso: string | null): number {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

/**
 * Победитель среди энтайтлинговых подписок Stripe: максимальный current_period_end,
 * тай-брейк по максимальному created. Нет энтайтлинговых — победителя нет.
 * Экспортируется ради теста: правило выбора важнее, чем путь, которым его зовут.
 */
export function pickWinner(subs: readonly StripeSubView[]): StripeSubView | null {
  let best: StripeSubView | null = null;
  for (const s of subs) {
    if (!ENTITLING_STATUSES.has(s.status)) continue;
    if (best === null) { best = s; continue; }
    const d = epoch(s.currentPeriodEnd) - epoch(best.currentPeriodEnd);
    if (d > 0 || (d === 0 && s.created > best.created)) best = s;
  }
  return best;
}

function stateOf(r: LocalSubRow) {
  return { status: r.status, currentPeriodEnd: r.currentPeriodEnd, cancelAtPeriodEnd: r.cancelAtPeriodEnd };
}

/**
 * План по ОДНОМУ юзеру. `stripeSubs` — все его подписки в Stripe (любого статуса),
 * `localRows` — все его строки реестра.
 *
 * Строки без `productCode` (продукт не из нашего каталога) пропускаются: право они
 * не дают, а писать чужой продукт в наш реестр нечего.
 */
export function planUserSubscriptions(
  stripeSubs: readonly StripeSubView[],
  localRows: readonly LocalSubRow[],
): UserSubPlan {
  const known = stripeSubs.filter((s) => s.productCode !== null);
  const winner = pickWinner(known);
  const liveInStripe = known.filter((s) => ENTITLING_STATUSES.has(s.status)).length;
  const byId = new Map(localRows.filter((r) => r.providerSubscriptionId).map((r) => [r.providerSubscriptionId!, r]));

  const losers: PlannedSubWrite[] = [];
  const promotions: PlannedSubWrite[] = [];

  for (const s of known) {
    const local = byId.get(s.id) ?? null;
    const isWinner = winner !== null && s.id === winner.id;

    // Проигравшая, но энтайтлинговая в Stripe → 'duplicate' + needs_review: право
    // получает только победитель, а факт второй живой подписки должен быть виден.
    const entitlingLoser = !isWinner && ENTITLING_STATUSES.has(s.status);
    const desiredStatus = entitlingLoser ? 'duplicate' : s.status;
    const desiredNeedsReview = entitlingLoser;

    // Совпало — не трогаем вообще (и в журнал не пишем).
    if (local
      && local.status === desiredStatus
      && local.needsReview === desiredNeedsReview
      && local.cancelAtPeriodEnd === s.cancelAtPeriodEnd
      && epoch(local.currentPeriodEnd) === epoch(s.currentPeriodEnd)) continue;

    const after = {
      status: desiredStatus,
      currentPeriodEnd: s.currentPeriodEnd,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    };
    const before = local ? stateOf(local) : null;

    const write: PlannedSubWrite = {
      op: 'upsert',
      order: 0,
      subId: s.id,
      localRowId: local?.id ?? null,
      status: desiredStatus,
      needsReview: desiredNeedsReview,
      currentPeriodEnd: s.currentPeriodEnd,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      currency: s.currency,
      productCode: s.productCode,
      reason: entitlingLoser ? 'duplicate' : 'sub_status_drift',
      before,
      after,
    };
    (isWinner ? promotions : losers).push(write);
  }

  // Наши энтайтлинг-строки, которых в выгрузке Stripe нет вовсе → 'canceled'.
  // Это тоже демоушен, поэтому идёт в ту же группу, что и проигравшие.
  const seen = new Set(known.map((s) => s.id));
  for (const r of localRows) {
    if (r.providerSubscriptionId && seen.has(r.providerSubscriptionId)) continue;
    if (!ENTITLING_STATUSES.has(r.status)) continue;
    losers.push({
      op: 'cancel_local',
      order: 0,
      subId: r.providerSubscriptionId,
      localRowId: r.id,
      status: 'canceled',
      needsReview: r.needsReview,
      currentPeriodEnd: r.currentPeriodEnd,
      cancelAtPeriodEnd: r.cancelAtPeriodEnd,
      currency: '',
      productCode: null,
      reason: 'sub_missing_in_stripe',
      before: stateOf(r),
      after: { status: 'canceled', currentPeriodEnd: r.currentPeriodEnd, cancelAtPeriodEnd: r.cancelAtPeriodEnd },
    });
  }

  // ДЕМОУШЕНЫ → ПОТОМ ПОВЫШЕНИЕ (см. шапку: иначе ловим 23505 на uq_subscription_user_live).
  const writes = [...losers, ...promotions].map((w, i) => ({ ...w, order: i }));
  return { writes, liveInStripe, winnerSubId: winner?.id ?? null };
}
