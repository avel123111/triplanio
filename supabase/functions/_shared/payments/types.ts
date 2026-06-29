/**
 * Payment adapter contract — провайдер-нейтральный шов.
 *
 * Ядро (каталог, деривация права, идемпотентность) не знает про Stripe. Вся
 * провайдер-специфика живёт за этим контрактом. Сейчас одна реализация —
 * StripeAdapter; новый провайдер (RevenueCat / Telegram Stars) = новый файл с
 * тем же контрактом, ядро не трогаем.
 *
 * Контракт растёт по фазам эпика «Платёжный фундамент» (всё под TRIP-32):
 *  - Ф2a (сейчас): resolvePriceForProduct, providerProductId — каталог + цена.
 *  - Ф2b: verifyWebhook, fetchSubscription, fetchCharge, createCheckout,
 *         createPortalSession — write-путь и вебхук.
 */

export type ProviderEnv = 'test' | 'live';

export interface ResolvedPrice {
  price_id: string;
  unit_amount: number | null;
  currency: string;
  recurring_interval: string | null;
  product_id: string;
}

export interface PaymentAdapter {
  readonly provider: 'stripe' | 'revenuecat' | 'telegram_stars';
  readonly env: ProviderEnv;
  /** Актуальная цена продукта провайдера (Stripe — через default_price). */
  resolvePriceForProduct(providerProductId: string): Promise<ResolvedPrice>;
  /** product_code (наш каталог) → id продукта у провайдера для текущего env. */
  providerProductId(productCode: string): Promise<string | null>;
}
