/**
 * reconcileEntitlementStripe — Сверка Б: наш реестр против Stripe (TRIP-153).
 *
 * Сверка А (SQL, почасовая) сверяет КЭШ с РЕЕСТРОМ и в Stripe не ходит. Она по
 * построению слепа к случаю «в Stripe подписка есть, а у нас ноль строк»: реестр
 * пуст, recompute даёт free, кэш уже free — расхождения нет. Именно этот случай и
 * закрывает эта функция.
 *
 * Он не гипотетический: подписка, заведённая МИМО чекаута (дашборд, купон, компа),
 * у нас не материализуется никогда — `customer.subscription.created` вебхук не
 * обрабатывает, а `customer.subscription.updated` работает только `if (existing)`,
 * то есть из этого состояния вебхук не выберется и последующими событиями (TRIP-361).
 *
 * ЧТО ОНА НЕ ДЕЛАЕТ:
 *   • не пишет своей формулы права — решение «что записать» живёт в чистом
 *     `reconcilePlan.ts`, форма строки — в общем `buildSubscriptionUpsertRow`,
 *     вердикт права — в `recompute_user_entitlement`. Здесь только исполнение;
 *   • не досылает уведомления и письма задним числом. Сверка выдаёт ПРАВО, а не
 *     сообщает о нём: событие произошло когда-то, а письмо пришло бы сегодня;
 *   • не трогает то, что совпало (тогда список находок = список записей, и
 *     report-прогон предсказывает apply-прогон).
 *
 * ПОРЯДОК ЗАПИСИ: реестр → потом кэш (recompute). Падение на полпути оставляет кэш
 * прежним, то есть платящий не может провалиться во Free из-за сбоя сверки.
 *
 * Рельс: зовётся по расписанию из n8n с `Bearer <N8N_SECRET>` — та же форма, что у
 * getPendingReminders/aiGate (в манифесте дверей это значение 'n8n'). Поэтому
 * `verify_jwt = false` в config.toml, а проверка секрета — в теле.
 */
import { corsFor } from '../_shared/cors.ts';
import { requireN8nSecret } from '../_shared/n8nAuth.ts';
import { supabaseAdmin as admin } from '../_shared/supabaseAdmin.ts';
import { captureEdgeError, reportPaymentAnomaly } from '../_shared/sentry.ts';
import { getPeriodEndUnix, unixToIso } from '../_shared/getPeriodEnd.ts';
import { StripeAdapter } from '../_shared/payments/stripeAdapter.ts';
import { isFullyRefunded } from '../_shared/payments/refund.ts';
import {
  stripeEnv, isProductCode, billingIntervalForProduct,
  getActiveProviderProducts, type ProductCode,
} from '../_shared/payments/catalog.ts';
import { buildSubscriptionUpsertRow } from '../_shared/payments/subscriptionRow.ts';
import { buildPurchaseRow } from '../_shared/payments/purchaseRow.ts';
import { revokeLostProFeaturesForUser, revokeLostProFeaturesForTrip } from '../_shared/revokeLostProFeatures.ts';
import {
  planUserSubscriptions, ENTITLING_STATUSES,
  type StripeSubView, type LocalSubRow,
} from '../_shared/payments/reconcilePlan.ts';
import type Stripe from 'npm:stripe@17.0.0';

type Mode = 'report' | 'apply';

interface Journal {
  runId: string;
  mode: Mode;
  found: number;
  fixed: number;
  unfixable: number;
  failed: number;
  scannedStripe: number;
}

async function finding(
  j: Journal,
  kind: string,
  subjectType: string,
  subjectId: string,
  opts: { before?: unknown; after?: unknown; source?: unknown; action?: 'fixed' | 'reported' | 'failed'; error?: string } = {},
) {
  const action = opts.action ?? (j.mode === 'apply' ? 'fixed' : 'reported');
  j.found += 1;
  if (action === 'fixed') j.fixed += 1;
  else if (action === 'failed') { j.failed += 1; j.unfixable += 1; }
  else j.unfixable += 1;
  const { error } = await admin.from('reconcile_finding').insert({
    run_id: j.runId, kind, subject_type: subjectType, subject_id: subjectId,
    before: opts.before ?? null, after: opts.after ?? null, source: opts.source ?? null,
    action, error: opts.error ?? null,
  });
  if (error) console.error('reconcile_finding insert failed:', error.message);
}

/** Нормализованный срез подписки — ровно то, от чего зависит вердикт плана. */
function toView(s: Stripe.Subscription, codeByProduct: Map<string, ProductCode>): StripeSubView {
  const price = s.items?.data?.[0]?.price as Stripe.Price | undefined;
  const productId = typeof price?.product === 'string'
    ? price.product : ((price?.product as { id?: string } | undefined)?.id ?? null);
  // Каталог — источник истины; metadata подписки лишь фолбэк (у заведённых из
  // дашборда её может не быть вовсе).
  const metaCode = s.metadata?.product_code;
  const fromCatalog: ProductCode | null = productId ? codeByProduct.get(productId) ?? null : null;
  const productCode: ProductCode | null = fromCatalog ?? (isProductCode(metaCode) ? metaCode : null);
  return {
    id: s.id,
    status: s.status,
    currentPeriodEnd: unixToIso(getPeriodEndUnix(s)),
    cancelAtPeriodEnd: s.cancel_at_period_end === true,
    created: s.created,
    currency: s.currency || 'usd',
    productCode,
  };
}

// sentry: manual — авторизуется своим N8N_SECRET (не withHandler), домены ошибок
// пишет сама через captureEdgeError/reportPaymentAnomaly ниже.
Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const denied = requireN8nSecret(req);
  if (denied) return denied;

  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) return Response.json({ error: 'STRIPE_SECRET_KEY missing' }, { status: 500, headers: corsHeaders });

  const body = await req.json().catch(() => ({}));
  const mode: Mode = body?.mode === 'apply' ? 'apply' : 'report';

  const { data: runRow, error: runErr } = await admin
    .from('reconcile_run').insert({ kind: 'stripe', mode, status: 'running' }).select('id').single();
  if (runErr || !runRow) {
    await captureEdgeError(new Error(`reconcile_run insert: ${runErr?.message}`), 'reconcileEntitlementStripe');
    return Response.json({ error: 'cannot open run' }, { status: 500, headers: corsHeaders });
  }

  const j: Journal = { runId: runRow.id, mode, found: 0, fixed: 0, unfixable: 0, failed: 0, scannedStripe: 0 };
  const adapter = new StripeAdapter(key, stripeEnv(key));
  let runStatus: 'ok' | 'partial' | 'failed' = 'ok';
  let fatal: string | null = null;

  try {
    const codeByProduct = new Map<string, ProductCode>(
      (await getActiveProviderProducts('stripe', adapter.env))
        .map((r) => [r.provider_product_id, r.product_code] as [string, ProductCode]),
    );

    // ---- Владелец подписки: metadata.user_id, иначе provider_customer ----
    const { data: pcRows } = await admin.from('provider_customer')
      .select('user_id, provider_customer_id').eq('provider', 'stripe');
    const userByCustomer = new Map<string, string>(
      (pcRows ?? []).map((r) => [r.provider_customer_id as string, r.user_id as string]),
    );

    // ==================================================================
    // 1. Подписки: ПОЛНАЯ выгрузка, затем группировка по юзеру
    // ==================================================================
    // Полная, а не выборка кандидатов: выборка — это предикат, а промах предиката
    // не краснеет, он молча не проверяет.
    const byUser = new Map<string, StripeSubView[]>();
    for await (const s of adapter.listAllSubscriptions()) {
      j.scannedStripe += 1;
      const view = toView(s, codeByProduct);
      const customerId = typeof s.customer === 'string' ? s.customer : s.customer?.id ?? null;
      const userId = (s.metadata?.user_id as string | undefined)
        || (customerId ? userByCustomer.get(customerId) : undefined);
      if (!userId) {
        // Чинить не к кому: подписка есть, а чья — неизвестно.
        await finding(j, 'unattributable', 'subscription', s.id, {
          action: 'reported',
          source: { status: s.status, customer: customerId, current_period_end: view.currentPeriodEnd },
        });
        continue;
      }
      const list = byUser.get(userId) ?? [];
      list.push(view);
      byUser.set(userId, list);
    }

    // Юзеры с нашими энтайтлинг-строками, которых в выгрузке Stripe нет вовсе —
    // их тоже надо прогнать через план, иначе «пропала в Stripe» никогда не найдётся.
    const { data: liveLocal } = await admin.from('subscription')
      .select('user_id').in('status', [...ENTITLING_STATUSES]);
    for (const r of liveLocal ?? []) {
      const userId = r.user_id as string;
      if (!byUser.has(userId)) byUser.set(userId, []);
    }

    for (const [userId, stripeSubs] of byUser) {
      try {
        const { data: rows } = await admin.from('subscription')
          .select('id, provider_subscription_id, status, current_period_end, cancel_at_period_end, needs_review')
          .eq('user_id', userId);
        const localRows: LocalSubRow[] = (rows ?? []).map((r) => ({
          id: r.id as string,
          providerSubscriptionId: (r.provider_subscription_id as string | null) ?? null,
          status: r.status as string,
          currentPeriodEnd: (r.current_period_end as string | null) ?? null,
          cancelAtPeriodEnd: r.cancel_at_period_end === true,
          needsReview: r.needs_review === true,
        }));

        const plan = planUserSubscriptions(stripeSubs, localRows);

        // Настоящая двойная оплата: две живые подписки В STRIPE. Разбор — TRIP-152.
        if (plan.liveInStripe > 1) {
          await finding(j, 'multi_live_sub', 'user', userId, {
            action: 'reported', source: { live_in_stripe: plan.liveInStripe, winner: plan.winnerSubId },
          });
        }

        if (plan.writes.length === 0) continue;

        // Порядок из плана — часть контракта: демоушены раньше повышения, иначе
        // между двумя запросами существуют две живые строки и вторая падает на
        // uq_subscription_user_live.
        for (const w of plan.writes) {
          if (mode === 'apply') {
            // Различаем по ЯВНОМУ op, а не по тому, какие поля оказались null:
            // у 'cancel_local' subId тоже заполнен (это id подписки, которой нет в
            // Stripe), поэтому вывод намерения из nullability промахивался мимо
            // обеих веток и строка молча не гасилась.
            if (w.op === 'cancel_local' && w.localRowId) {
              const { error } = await admin.from('subscription')
                .update({ status: w.status }).eq('id', w.localRowId);
              if (error) throw new Error(`subscription cancel ${w.localRowId}: ${error.message}`);
            } else if (w.op === 'upsert' && w.subId && w.productCode) {
              const { error } = await admin.from('subscription').upsert(
                buildSubscriptionUpsertRow({
                  userId, productCode: w.productCode, providerSubscriptionId: w.subId,
                  status: w.status, needsReview: w.needsReview,
                  cancelAtPeriodEnd: w.cancelAtPeriodEnd, currentPeriodEnd: w.currentPeriodEnd,
                  currency: w.currency, billingInterval: billingIntervalForProduct(w.productCode),
                  providerMeta: { mode: 'leave' },
                }), { onConflict: 'provider_subscription_id' });
              if (error) throw new Error(`subscription upsert ${w.subId}: ${error.message}`);
            } else {
              // Ни одна ветка не подошла — план несёт форму, которую исполнитель
              // применить не умеет. Молчать нельзя: finding() ниже проставил бы
              // action='fixed', и журнал соврал бы о денежном состоянии. Ровно этот
              // класс уже кусал (вывод намерения из nullability пропускал
              // cancel_local), поэтому выход громкий, а не пропуск.
              throw new Error(
                `unapplicable plan write: op=${w.op} sub=${w.subId} local=${w.localRowId} product=${w.productCode}`,
              );
            }
          }
          await finding(j, w.reason, 'subscription', w.subId ?? w.localRowId ?? userId, {
            before: w.before, after: w.after, source: { user_id: userId, winner: plan.winnerSubId },
          });
        }

        // Кэш — ПОСЛЕДНИМ и ОДИН раз на юзера, не на подписку.
        if (mode === 'apply') {
          const { error } = await admin.rpc('recompute_user_entitlement', { p_user_id: userId });
          if (error) throw new Error(`recompute_user_entitlement: ${error.message}`);
          await revokeLostProFeaturesForUser(admin, userId);
        }
      } catch (e) {
        await finding(j, 'sub_status_drift', 'user', userId, {
          action: 'failed', error: (e as Error).message,
        });
        runStatus = 'partial';
      }
    }

    // ==================================================================
    // 2. Разовые покупки Trip Pro: по клиенту, а не глобальным списком
    // ==================================================================
    for (const [customerId, userId] of userByCustomer) {
      try {
        for await (const pi of adapter.listPaymentIntentsByCustomer(customerId)) {
          j.scannedStripe += 1;
          const { data: existing } = await admin.from('purchase')
            .select('id, trip_id, status').eq('provider_charge_id', pi.id).limit(1);
          const row = existing?.[0] ?? null;

          const charge = (typeof pi.latest_charge === 'object' ? pi.latest_charge : null) as Stripe.Charge | null;
          const refunded = charge !== null && isFullyRefunded(charge);
          const revoked = refunded || charge?.disputed === true;

          if (!row) {
            if (pi.status !== 'succeeded') continue;
            const tripId = (pi.metadata?.trip_id as string | undefined) || null;
            const code = pi.metadata?.product_code;
            // Без metadata привязать платёж к трипу нечем — исторические платежи её
            // не имеют (её проставляет payment_intent_data, TRIP-153 ч.4).
            if (!tripId || code !== 'trip_pro_lifetime') {
              await finding(j, 'unattributable', 'purchase', pi.id, {
                action: 'reported',
                source: { user_id: userId, amount: pi.amount, currency: pi.currency, has_metadata: !!pi.metadata?.trip_id },
              });
              continue;
            }
            if (mode === 'apply') {
              const { error } = await admin.from('purchase').insert(buildPurchaseRow({
                userId, tripId, productCode: 'trip_pro_lifetime',
                providerChargeId: pi.id, providerRef: null,
                status: 'active', needsReview: false,
                amount: pi.amount, currency: pi.currency || 'usd',
                purchasedAt: unixToIso(pi.created) ?? new Date().toISOString(),
              }));
              if (error) throw new Error(`purchase insert ${pi.id}: ${error.message}`);
              const { error: rErr } = await admin.rpc('recompute_trip_entitlement', { p_trip_id: tripId });
              if (rErr) throw new Error(`recompute_trip_entitlement: ${rErr.message}`);
            }
            await finding(j, 'purchase_missing', 'purchase', pi.id, {
              after: { status: 'active', trip_id: tripId },
              source: { user_id: userId, amount: pi.amount, currency: pi.currency },
            });
          } else if (row.status === 'active' && revoked) {
            const newStatus = refunded ? 'refunded' : 'disputed';
            if (mode === 'apply') {
              const { error } = await admin.from('purchase')
                .update({ status: newStatus, ...(newStatus === 'refunded' ? { refunded_at: new Date().toISOString() } : {}) })
                .eq('id', row.id);
              if (error) throw new Error(`purchase update ${row.id}: ${error.message}`);
              if (row.trip_id) {
                const { error: rErr } = await admin.rpc('recompute_trip_entitlement', { p_trip_id: row.trip_id });
                if (rErr) throw new Error(`recompute_trip_entitlement: ${rErr.message}`);
                await revokeLostProFeaturesForTrip(admin, row.trip_id as string);
              }
            }
            await finding(j, 'purchase_refunded_in_stripe', 'purchase', pi.id, {
              before: { status: 'active' }, after: { status: newStatus },
              source: { user_id: userId, trip_id: row.trip_id },
            });
          }
        }
      } catch (e) {
        await finding(j, 'purchase_missing', 'user', userId, { action: 'failed', error: (e as Error).message });
        runStatus = 'partial';
      }
    }
  } catch (e) {
    fatal = (e as Error).message;
    runStatus = 'failed';
    await captureEdgeError(e, 'reconcileEntitlementStripe');
  }

  if (runStatus === 'ok' && j.failed > 0) runStatus = 'partial';

  await admin.from('reconcile_run').update({
    finished_at: new Date().toISOString(), status: runStatus,
    scanned_stripe_objects: j.scannedStripe,
    found: j.found, fixed: j.fixed, unfixable: j.unfixable, error: fatal,
  }).eq('id', j.runId);

  // Алерт уровня error по любым находкам — решение «на старте ничего не глушим».
  // Идентификаторов в сообщении нет: SDK группирует по тексту, а run_id и числа
  // уезжают в extra (иначе каждый прогон рождал бы новый issue).
  if (j.found > 0 || runStatus !== 'ok') {
    await reportPaymentAnomaly('entitlement_reconcile_stripe', {
      run_id: j.runId, mode, status: runStatus,
      found: j.found, fixed: j.fixed, unfixable: j.unfixable,
      scanned_stripe_objects: j.scannedStripe, error: fatal,
    }, 'error');
  }

  return Response.json({
    run_id: j.runId, mode, status: runStatus,
    scanned_stripe_objects: j.scannedStripe,
    found: j.found, fixed: j.fixed, unfixable: j.unfixable,
  }, { headers: corsHeaders });
});
