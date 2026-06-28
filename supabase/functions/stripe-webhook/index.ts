/**
 * stripe-webhook (Ф2b — платёжный фундамент)
 *
 * Single-writer entitlement: события пишут реестр purchase/subscription, затем
 * recompute_user_entitlement / recompute_trip_entitlement выводят кэш
 * (users.subscription_*, trips.is_pro_trip). НИКАКИХ прямых записей кэша.
 *
 * Идемпотентность входа — таблица webhook_event (provider, provider_event_id).
 * Дубль платежа — ЕДИНАЯ механика для purchase и subscription: вторая
 * энтайтлинг-строка не начисляется, ложится status='duplicate' + needs_review +
 * Sentry. Никаких авто-возвратов/авто-отмен.
 *
 * Адрес/имя функции не менялись (тот же Stripe endpoint). verify_jwt MUST stay
 * false (canon-10). Вся Stripe-специфика — за StripeAdapter.
 *
 * Write integrity: ensureWrite() — ошибка записи права → Sentry + throw, событие
 * НЕ помечается processed, Stripe ретраит (хендлеры идемпотентны).
 */

import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import type Stripe from 'npm:stripe@17.0.0';
import { captureEdgeError, reportPaymentAnomaly } from '../_shared/sentry.ts';
import { getPeriodEndUnix, unixToIso } from '../_shared/getPeriodEnd.ts';
import { StripeAdapter } from '../_shared/payments/stripeAdapter.ts';
import { stripeEnv, PLAN_TO_PRODUCT, type ProductCode, type PlanType } from '../_shared/payments/catalog.ts';
import { saveProviderCustomerId } from '../_shared/payments/customer.ts';
import { revokeLostProFeaturesForUser, revokeLostProFeaturesForTrip } from '../_shared/revokeLostProFeatures.ts';

const ENTITLING = ['active', 'trialing', 'past_due'];

// Ошибка записи права → Sentry + throw (Stripe ретраит). Только для
// энтайтлмент-критичных записей; best-effort (нотификации, customer id) — нет.
async function ensureWrite(label: string, op: PromiseLike<{ error: unknown }>) {
  const { error } = await op;
  if (error) {
    const msg = (error as { message?: string }).message ?? String(error);
    await captureEdgeError(new Error(`${label}: ${msg}`), 'stripe-webhook');
    throw new Error(`${label} failed`);
  }
}

async function recomputeUser(userId: string | null | undefined) {
  if (!userId) return;
  const { error } = await supabaseAdmin.rpc('recompute_user_entitlement', { p_user_id: userId });
  if (error) {
    await captureEdgeError(new Error(`recompute_user_entitlement (user ${userId}): ${error.message}`), 'stripe-webhook');
    throw new Error('recompute_user_entitlement failed');
  }
  // Кэш осел — откатываем Pro-аддоны трипов, потерявших Pro. Self-gating +
  // best-effort (не бросает, иначе здоровую запись ретраил бы Stripe).
  await revokeLostProFeaturesForUser(supabaseAdmin, userId);
}

async function recomputeTrip(tripId: string | null | undefined) {
  if (!tripId) return;
  const { error } = await supabaseAdmin.rpc('recompute_trip_entitlement', { p_trip_id: tripId });
  if (error) {
    await captureEdgeError(new Error(`recompute_trip_entitlement (trip ${tripId}): ${error.message}`), 'stripe-webhook');
    throw new Error('recompute_trip_entitlement failed');
  }
}

// Платёжная идентичность — provider_customer (канон; колонка users.stripe_customer_id
// дропнута). Best-effort, идемпотентно.
function saveCustomer(userId: string | null | undefined, customerId: unknown) {
  return saveProviderCustomerId(supabaseAdmin, userId, customerId);
}

// invoice.subscription переехал под parent.subscription_details на новых версиях API.
function invoiceSubId(invoice: Stripe.Invoice): string | null {
  const top = (invoice as unknown as { subscription?: unknown }).subscription;
  if (typeof top === 'string') return top;
  const nested = (invoice as unknown as { parent?: { subscription_details?: { subscription?: unknown } } })
    .parent?.subscription_details?.subscription;
  return typeof nested === 'string' ? nested : null;
}

async function findSubRow(subId: string) {
  const { data } = await supabaseAdmin
    .from('subscription')
    .select('id, user_id, product_code, status')
    .eq('provider_subscription_id', subId)
    .limit(1);
  return data && data.length > 0 ? data[0] : null;
}

// Есть ли у юзера ДРУГАЯ энтайтлинг-подписка (для детекта дубля).
async function hasOtherEntitlingSub(userId: string, exceptSubId: string | null): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('subscription').select('provider_subscription_id').eq('user_id', userId).in('status', ENTITLING);
  return (data ?? []).some((r) => r.provider_subscription_id !== exceptSubId);
}

// { userId, productCode } для подписки: из существующей строки, иначе из metadata.
async function resolveRecurringUser(
  adapter: StripeAdapter,
  subId: string,
  existing: { user_id?: string; product_code?: string } | null,
  ctx: string,
): Promise<{ userId: string; productCode: ProductCode } | null> {
  let userId = existing?.user_id ?? null;
  let productCode = (existing?.product_code as ProductCode | undefined) ?? null;
  if (!userId || !productCode) {
    const sub = await adapter.fetchSubscription(subId);
    userId = userId ?? ((sub.metadata?.user_id as string) || null);
    const planType = (sub.metadata?.plan_type as PlanType | undefined) ?? null;
    productCode = productCode ?? (planType ? PLAN_TO_PRODUCT[planType] : null);
  }
  if (!userId || (productCode !== 'account_pro_monthly' && productCode !== 'account_pro_yearly')) {
    await reportPaymentAnomaly('sub_unresolved_user', { ctx, sub_id: subId }, 'error');
    return null;
  }
  return { userId, productCode };
}

Deno.serve(async (req) => {
  let eventId: string | null = null;
  try {
    const body = await req.text();
    const signature = req.headers.get('stripe-signature');
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')!;
    const adapter = new StripeAdapter(stripeKey, stripeEnv(stripeKey));

    // ---------- Проверка подписи ----------
    let event: Stripe.Event;
    try {
      event = await adapter.verifyWebhook(body, signature!, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', (err as Error).message);
      await captureEdgeError(err, 'stripe-webhook:signature');
      return Response.json({ error: 'Invalid signature' }, { status: 400 });
    }

    eventId = event.id;
    console.log('Stripe webhook received:', event.type, event.id);

    // ---------- Идемпотентность входа (webhook_event) ----------
    // Вставляем строку received; нарушение уникальности (provider, event_id) = дубль
    // доставки → не реобрабатываем, 200.
    const { error: insertEventErr } = await supabaseAdmin
      .from('webhook_event')
      .insert({ provider: 'stripe', provider_event_id: event.id, type: event.type, status: 'processing', signature_valid: true });
    if (insertEventErr) {
      const code = (insertEventErr as { code?: string }).code;
      if (code === '23505') {
        // Строка уже есть. Скипаем ТОЛЬКО если прошлая попытка ДОшла до processed;
        // если осталась processing/failed (краш на полпути) — переобрабатываем, иначе
        // апдейт потеряется навсегда.
        const { data: ex } = await supabaseAdmin
          .from('webhook_event').select('status')
          .eq('provider', 'stripe').eq('provider_event_id', event.id).limit(1);
        if (ex && ex[0]?.status === 'processed') {
          console.log('Duplicate (already processed) skipped:', event.id);
          return Response.json({ received: true, duplicate: true });
        }
        console.log('Reprocessing previously-unfinished event:', event.id);
      } else {
        // Не смогли записать журнал — продолжаем (хендлеры идемпотентны), но логируем.
        console.error('webhook_event insert failed (continuing):', (insertEventErr as { message?: string }).message);
      }
    }

    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const { user_id, trip_id, plan_type } = session.metadata || {};
        const productCode: ProductCode | null = plan_type ? PLAN_TO_PRODUCT[plan_type as PlanType] ?? null : null;
        console.log('Checkout completed:', user_id, plan_type, 'trip:', trip_id);

        if (productCode === 'trip_pro_lifetime' && trip_id && user_id) {
          // Идемпотентность по checkout id (provider_ref): тот же чекаут уже записан → no-op.
          const { data: same } = await supabaseAdmin
            .from('purchase').select('id').eq('provider_ref', session.id).limit(1);
          if (same && same.length > 0) break;

          // Уже есть active покупка трипа → второй РАЗНЫЙ платёж (две вкладки):
          // пишем duplicate + needs_review + Sentry, прав не задваиваем.
          const { data: act } = await supabaseAdmin
            .from('purchase').select('id').eq('trip_id', trip_id)
            .eq('product_code', 'trip_pro_lifetime').eq('status', 'active').limit(1);
          const isDup = !!(act && act.length > 0);
          if (isDup) {
            await reportPaymentAnomaly('pro_trip_double_paid', { trip_id, session_id: session.id, user_id }, 'error');
          }
          await ensureWrite('purchase insert', supabaseAdmin.from('purchase').insert({
            user_id, trip_id, product_code: 'trip_pro_lifetime', provider: 'stripe',
            provider_charge_id: session.payment_intent || null, provider_ref: session.id,
            status: isDup ? 'duplicate' : 'active', needs_review: isDup,
            amount: session.amount_total, currency: session.currency || 'usd',
            purchased_at: new Date().toISOString(),
          }));
          if (!isDup) await recomputeTrip(trip_id);
          await saveCustomer(user_id, session.customer);

        } else if ((productCode === 'account_pro_monthly' || productCode === 'account_pro_yearly') && user_id) {
          const subId = typeof session.subscription === 'string' ? session.subscription : null;
          let status = 'active';
          let periodEndIso: string | null = null;
          let cancelAtPeriodEnd = false;
          if (subId) {
            const sub = await adapter.fetchSubscription(subId);
            status = sub.status;
            periodEndIso = unixToIso(getPeriodEndUnix(sub));
            cancelAtPeriodEnd = sub.cancel_at_period_end === true;
          }
          // Тот же sub уже записан → идемпотентный апдейт.
          const existing = subId ? await findSubRow(subId) : null;
          if (existing) {
            await ensureWrite('subscription update (checkout)', supabaseAdmin.from('subscription').update({
              status, cancel_at_period_end: cancelAtPeriodEnd,
              ...(periodEndIso ? { current_period_end: periodEndIso } : {}),
            }).eq('id', existing.id));
            await recomputeUser(user_id);
          } else {
            // Новая подписка. Есть ли уже энтайтлинг у юзера → дубль.
            const isDup = await hasOtherEntitlingSub(user_id, subId);
            if (isDup) await reportPaymentAnomaly('sub_double_paid', { user_id, sub_id: subId, session_id: session.id }, 'error');
            // upsert по provider_subscription_id — гонко-безопасно: конкурентная
            // доставка invoice.paid для той же подписки станет апдейтом, не 500.
            await ensureWrite('subscription upsert (checkout)', supabaseAdmin.from('subscription').upsert({
              user_id, product_code: productCode, provider: 'stripe',
              provider_subscription_id: subId, provider_ref: session.id,
              status: isDup ? 'duplicate' : status, needs_review: isDup,
              current_period_end: periodEndIso, cancel_at_period_end: cancelAtPeriodEnd,
              amount: session.amount_total, currency: session.currency || 'usd',
              billing_interval: productCode === 'account_pro_monthly' ? 'month' : 'year',
            }, { onConflict: 'provider_subscription_id' }));
            if (!isDup) {
              await saveCustomer(user_id, session.customer);
              await recomputeUser(user_id);
              try {
                await supabaseAdmin.from('notifications').insert({
                  user_id, type: 'system',
                  i18n_title_key: 'notif.tpl_pro_activated_title', i18n_message_key: 'notif.tpl_pro_activated_msg',
                  i18n_params: {}, title: 'Pro subscription activated',
                  message: 'Your payment was successful. Thank you!', action_url: '/settings', read: false,
                });
              } catch (e) { console.error('Pro-activated notification failed (non-fatal):', (e as Error).message); }
            }
          }
        }
        break;
      }

      // ---- Renewal: продление периода ----
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = invoiceSubId(invoice);
        if (!subId) break;
        const existing = await findSubRow(subId);
        const resolved = await resolveRecurringUser(adapter, subId, existing, 'invoice.paid');
        if (!resolved) break;
        await saveCustomer(resolved.userId, invoice.customer);
        const sub = await adapter.fetchSubscription(subId);
        const periodEndIso = unixToIso(getPeriodEndUnix(sub));
        if (existing) {
          await ensureWrite('invoice.paid update', supabaseAdmin.from('subscription').update({
            status: sub.status, cancel_at_period_end: sub.cancel_at_period_end === true, provider_meta: null,
            ...(periodEndIso ? { current_period_end: periodEndIso } : {}),
          }).eq('id', existing.id));
        } else {
          const isDup = await hasOtherEntitlingSub(resolved.userId, subId);
          // upsert: гонка checkout.session.completed ↔ invoice.paid для той же
          // подписки больше не даёт unique-violation/500 (была причина 500 на dev).
          await ensureWrite('invoice.paid upsert', supabaseAdmin.from('subscription').upsert({
            user_id: resolved.userId, product_code: resolved.productCode, provider: 'stripe',
            provider_subscription_id: subId, status: isDup ? 'duplicate' : sub.status, needs_review: isDup,
            current_period_end: periodEndIso, cancel_at_period_end: sub.cancel_at_period_end === true,
            currency: invoice.currency || 'usd',
            billing_interval: resolved.productCode === 'account_pro_monthly' ? 'month' : 'year',
          }, { onConflict: 'provider_subscription_id' }));
          if (isDup) await reportPaymentAnomaly('sub_double_paid', { user_id: resolved.userId, sub_id: subId, ctx: 'invoice.paid' }, 'error');
        }
        await recomputeUser(resolved.userId);
        break;
      }

      // ---- Dunning: оплата не прошла → past_due grace ----
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = invoiceSubId(invoice);
        if (!subId) break;
        const existing = await findSubRow(subId);
        const resolved = await resolveRecurringUser(adapter, subId, existing, 'invoice.payment_failed');
        if (!resolved) break;
        await saveCustomer(resolved.userId, invoice.customer);
        const nextAttemptIso = invoice.next_payment_attempt ? unixToIso(invoice.next_payment_attempt) : null;
        if (existing) {
          await ensureWrite('invoice.payment_failed update', supabaseAdmin.from('subscription').update({
            status: 'past_due', collection_state: 'past_due',
            ...(nextAttemptIso ? { provider_meta: { next_payment_attempt: nextAttemptIso } } : {}),
          }).eq('id', existing.id));
        } else {
          await ensureWrite('invoice.payment_failed upsert', supabaseAdmin.from('subscription').upsert({
            user_id: resolved.userId, product_code: resolved.productCode, provider: 'stripe',
            provider_subscription_id: subId, status: 'past_due', collection_state: 'past_due',
            currency: invoice.currency || 'usd',
            billing_interval: resolved.productCode === 'account_pro_monthly' ? 'month' : 'year',
            ...(nextAttemptIso ? { provider_meta: { next_payment_attempt: nextAttemptIso } } : {}),
          }, { onConflict: 'provider_subscription_id' }));
        }
        await recomputeUser(resolved.userId);
        try {
          await supabaseAdmin.from('notifications').insert({
            user_id: resolved.userId, type: 'system',
            i18n_title_key: 'notif.tpl_pro_payment_failed_title', i18n_message_key: 'notif.tpl_pro_payment_failed_msg',
            i18n_params: {}, title: 'Pro payment failed',
            message: 'We couldn\'t charge your subscription. Update your payment method to keep Pro.',
            action_url: '/settings', read: false,
          });
        } catch (e) { console.error('dunning notification failed (non-fatal):', (e as Error).message); }
        break;
      }

      // ---- Grace-date refresh: next_payment_attempt приходит на invoice.updated ----
      case 'invoice.updated': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = invoiceSubId(invoice);
        if (!subId) break;
        const nextAttemptIso = invoice.next_payment_attempt ? unixToIso(invoice.next_payment_attempt) : null;
        if (!nextAttemptIso) break;
        const existing = await findSubRow(subId);
        const resolved = await resolveRecurringUser(adapter, subId, existing, 'invoice.updated');
        if (!resolved) break;
        await saveCustomer(resolved.userId, invoice.customer);
        if (existing) {
          await ensureWrite('invoice.updated update', supabaseAdmin.from('subscription').update({
            provider_meta: { next_payment_attempt: nextAttemptIso },
          }).eq('id', existing.id));
        } else {
          // ignoreDuplicates: если racer уже создал строку этой подписки — НЕ
          // перетираем её статус (invoice.updated не владеет статусом); grace-дата
          // до-приедет следующим invoice.updated/failed.
          await ensureWrite('invoice.updated upsert', supabaseAdmin.from('subscription').upsert({
            user_id: resolved.userId, product_code: resolved.productCode, provider: 'stripe',
            provider_subscription_id: subId, status: 'past_due', collection_state: 'past_due',
            currency: invoice.currency || 'usd',
            billing_interval: resolved.productCode === 'account_pro_monthly' ? 'month' : 'year',
            provider_meta: { next_payment_attempt: nextAttemptIso },
          }, { onConflict: 'provider_subscription_id', ignoreDuplicates: true }));
        }
        await recomputeUser(resolved.userId);
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const existing = await findSubRow(sub.id);
        if (existing) {
          const periodEndIso = unixToIso(getPeriodEndUnix(sub));
          // Маппим live-price → product_code, чтобы смена плана в портале обновляла тип.
          const price = sub.items?.data?.[0]?.price as Stripe.Price | undefined;
          const productId = typeof price?.product === 'string'
            ? price.product : ((price?.product as { id?: string } | undefined)?.id ?? null);
          const productCode = productId ? await adapter.productCodeForProviderProduct(productId) : null;
          await ensureWrite('subscription.updated', supabaseAdmin.from('subscription').update({
            status: sub.status, cancel_at_period_end: sub.cancel_at_period_end === true,
            ...(productCode ? { product_code: productCode, billing_interval: productCode === 'account_pro_monthly' ? 'month' : 'year' } : {}),
            ...(periodEndIso ? { current_period_end: periodEndIso } : {}),
          }).eq('id', existing.id));
          await recomputeUser(existing.user_id);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const existing = await findSubRow(sub.id);
        if (existing) {
          await ensureWrite('subscription.deleted', supabaseAdmin.from('subscription')
            .update({ status: 'canceled', canceled_at: new Date().toISOString() }).eq('id', existing.id));
          await recomputeUser(existing.user_id);
        }
        break;
      }

      // ---- Refund / chargeback → снять право ----
      case 'charge.refunded':
      case 'charge.dispute.created': {
        const isDispute = event.type === 'charge.dispute.created';
        const newStatus = isDispute ? 'disputed' : 'refunded';

        let charge: Stripe.Charge | null = null;
        let paymentIntentId: string | null = null;
        if (isDispute) {
          const dispute = event.data.object as Stripe.Dispute;
          paymentIntentId = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : null;
          const chargeId = typeof dispute.charge === 'string' ? dispute.charge : null;
          if (chargeId) {
            try { charge = await adapter.fetchCharge(chargeId); }
            catch (e) { console.error('dispute charge lookup failed:', (e as Error).message); }
          }
        } else {
          charge = event.data.object as Stripe.Charge;
          paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
        }

        // Частичный рефанд НЕ снимает Pro; диспут снимает всегда.
        if (!isDispute) {
          const fullyRefunded = charge?.refunded === true
            || (typeof charge?.amount === 'number' && typeof charge?.amount_refunded === 'number'
                && charge.amount > 0 && charge.amount_refunded >= charge.amount);
          if (!fullyRefunded) { console.log('Partial refund — Pro not revoked'); break; }
        }

        // Путь 1: purchase по payment_intent (разовая pro_trip).
        let row: { id: string; user_id: string; trip_id: string | null; kind: 'purchase' | 'subscription' } | null = null;
        if (paymentIntentId) {
          const { data, error } = await supabaseAdmin
            .from('purchase').select('id, user_id, trip_id').eq('provider_charge_id', paymentIntentId).limit(1);
          if (error) { await captureEdgeError(new Error(`refund purchase lookup: ${error.message}`), 'stripe-webhook'); throw new Error('refund purchase lookup failed'); }
          if (data && data.length > 0) row = { ...data[0], kind: 'purchase' };
        }

        // Путь 2: subscription по charge → invoice → subscription.
        if (!row && charge && typeof charge.invoice === 'string' && charge.invoice) {
          let subId: string | null = null;
          try { subId = invoiceSubId(await adapter.fetchInvoice(charge.invoice)); }
          catch (e) { console.error('refund invoice lookup failed:', (e as Error).message); }
          if (subId) {
            const { data, error } = await supabaseAdmin
              .from('subscription').select('id, user_id').eq('provider_subscription_id', subId).limit(1);
            if (error) { await captureEdgeError(new Error(`refund sub lookup: ${error.message}`), 'stripe-webhook'); throw new Error('refund sub lookup failed'); }
            if (data && data.length > 0) row = { id: data[0].id, user_id: data[0].user_id, trip_id: null, kind: 'subscription' };
          }
        }

        if (!row) {
          await reportPaymentAnomaly('refund_no_ledger', { event_type: event.type, payment_intent: paymentIntentId }, 'error');
          break;
        }

        // refunded_at есть только у purchase; subscription такой колонки не имеет.
        const patch: Record<string, unknown> = { status: newStatus };
        if (!isDispute && row.kind === 'purchase') patch.refunded_at = new Date().toISOString();
        await ensureWrite('refund/dispute status', supabaseAdmin.from(row.kind).update(patch).eq('id', row.id));
        if (row.kind === 'purchase' && row.trip_id) {
          await recomputeTrip(row.trip_id);
          await revokeLostProFeaturesForTrip(supabaseAdmin, row.trip_id);
          console.log('Pro-trip revoked after', event.type, '->', row.trip_id);
        } else {
          await recomputeUser(row.user_id);
          console.log('Subscription revoked after', event.type, 'for user', row.user_id);
        }
        break;
      }

      default: {
        await reportPaymentAnomaly('unsupported_event', { event_type: event.type, event_id: event.id }, 'info');
        break;
      }
    }

    // Помечаем событие processed ПОСЛЕ успешной обработки (на ошибке Stripe ретраит).
    try {
      await supabaseAdmin.from('webhook_event')
        .update({ status: 'processed', processed_at: new Date().toISOString() })
        .eq('provider', 'stripe').eq('provider_event_id', event.id);
    } catch (e) {
      console.error('Failed to mark webhook_event processed (non-fatal):', (e as Error).message);
    }

    return Response.json({ received: true });

  } catch (error) {
    await captureEdgeError(error, 'stripe-webhook');
    console.error('Webhook error:', error);
    // Пометить событие failed (наблюдаемость + будущий retry_failed_webhooks, Этап 2).
    if (eventId) {
      try {
        await supabaseAdmin.from('webhook_event')
          .update({ status: 'failed', last_error: error instanceof Error ? error.message : String(error) })
          .eq('provider', 'stripe').eq('provider_event_id', eventId);
      } catch { /* best-effort */ }
    }
    return Response.json({ error: error instanceof Error ? error.message : 'Internal error' }, { status: 500 });
  }
});
