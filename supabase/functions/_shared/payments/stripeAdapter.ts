/**
 * StripeAdapter — реализация PaymentAdapter поверх Stripe. Единственный
 * провайдер сейчас; ядро зовёт контракт, не Stripe напрямую.
 *
 * Ф2a: каталог + резолв цены (default_price). Ф2b добавит verifyWebhook /
 * fetchSubscription / fetchCharge / createCheckout / createPortalSession.
 */

import Stripe from 'npm:stripe@17.0.0';
import type { PaymentAdapter, ProviderEnv, ResolvedPrice } from './types.ts';
import { providerProductIdForCode, productCodeForProviderProductId, type ProductCode } from './catalog.ts';

export class StripeAdapter implements PaymentAdapter {
  readonly provider = 'stripe' as const;
  readonly env: ProviderEnv;
  private readonly stripe: Stripe;

  constructor(stripeKey: string, env: ProviderEnv) {
    this.stripe = new Stripe(stripeKey);
    this.env = env;
  }

  /** Прямой доступ к Stripe SDK для операций, ещё не вынесенных в контракт (Ф2b). */
  get client(): Stripe {
    return this.stripe;
  }

  // Цену не храним — берём актуальную из Stripe через default_price, фолбэк на
  // первую активную цену продукта (правило «не хардкодить цену»).
  async resolvePriceForProduct(providerProductId: string): Promise<ResolvedPrice> {
    const product = await this.stripe.products.retrieve(providerProductId, { expand: ['default_price'] });
    let price = product.default_price;
    if (!price || typeof price === 'string') {
      const list = await this.stripe.prices.list({ product: providerProductId, active: true, limit: 1 });
      price = list.data[0];
    }
    if (!price) throw new Error(`Stripe product ${providerProductId} has no active price`);
    const p = price as Stripe.Price;
    return {
      price_id: p.id,
      unit_amount: p.unit_amount,
      currency: p.currency,
      recurring_interval: p.recurring?.interval ?? null,
      product_id: providerProductId,
    };
  }

  async providerProductId(productCode: string): Promise<string | null> {
    return providerProductIdForCode(this.provider, this.env, productCode as ProductCode);
  }

  /** Stripe product id → наш product_code (для маппинга смены плана в портале). */
  async productCodeForProviderProduct(providerProductId: string): Promise<ProductCode | null> {
    return productCodeForProviderProductId(this.provider, this.env, providerProductId);
  }

  // ---- Ф2b: write-путь и вебхук за контрактом ----

  /** Проверка подписи входящего вебхука → событие провайдера. */
  verifyWebhook(body: string, signature: string, secret: string): Promise<Stripe.Event> {
    return this.stripe.webhooks.constructEventAsync(body, signature, secret);
  }

  fetchSubscription(id: string, opts?: Stripe.SubscriptionRetrieveParams): Promise<Stripe.Subscription> {
    return this.stripe.subscriptions.retrieve(id, opts);
  }

  /** Все подписки клиента (для reconcile stuck-FREE — материализация потерянной активации). */
  async listSubscriptionsByCustomer(customerId: string, limit = 10): Promise<Stripe.Subscription[]> {
    const res = await this.stripe.subscriptions.list({ customer: customerId, status: 'all', limit });
    return res.data;
  }

  fetchCharge(id: string): Promise<Stripe.Charge> {
    return this.stripe.charges.retrieve(id);
  }

  fetchInvoice(id: string): Promise<Stripe.Invoice> {
    return this.stripe.invoices.retrieve(id);
  }

  fetchCheckoutSession(id: string): Promise<Stripe.Checkout.Session> {
    return this.stripe.checkout.sessions.retrieve(id);
  }

  /** Checkout-сессия со СТАБИЛЬНЫМ idempotencyKey (нативный дедуп Stripe). */
  createCheckout(
    params: Stripe.Checkout.SessionCreateParams,
    idempotencyKey: string,
  ): Promise<Stripe.Checkout.Session> {
    return this.stripe.checkout.sessions.create(params, { idempotencyKey });
  }

  /**
   * Создать Customer. idempotencyKey СТАБИЛЬНЫЙ (`customer:<user>`) → две
   * одновременные вкладки получают ОДИН cus_… (детерминизм тела чекаута, нужно
   * для нативной идемпотентности). Тело неизменно (email+metadata).
   */
  async createCustomer(userId: string, email: string | null, idempotencyKey: string): Promise<string> {
    const c = await this.stripe.customers.create(
      { ...(email ? { email } : {}), metadata: { user_id: userId } },
      { idempotencyKey },
    );
    return c.id;
  }

  async createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }> {
    const s = await this.stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
    return { url: s.url };
  }
}
