/**
 * StripeAdapter — реализация PaymentAdapter поверх Stripe. Единственный
 * провайдер сейчас; ядро зовёт контракт, не Stripe напрямую.
 *
 * Ф2a: каталог + резолв цены (default_price). Ф2b добавит verifyWebhook /
 * fetchSubscription / fetchCharge / createCheckout / createPortalSession.
 */

import Stripe from 'npm:stripe@17.0.0';
import type { PaymentAdapter, ProviderEnv, ResolvedPrice } from './types.ts';
import { providerProductIdForCode, type ProductCode } from './catalog.ts';

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
}
