/**
 * stripeCatalog — single source of truth for Stripe product IDs per plan type.
 *
 * Price IDs and amounts are intentionally NOT stored here: they change over time
 * (e.g. pro_monthly moved $6 → $6.99) and must be resolved dynamically via
 * `product.default_price`. Only the stable product IDs live here.
 *
 * One Stripe mode per Supabase project (live in prod, test in dev). The mode is
 * derived from the secret-key prefix — `sk_test_…` selects the test product map.
 */

export const VALID_PLANS = ['pro_trip', 'pro_monthly', 'pro_yearly'] as const;
export type PlanType = typeof VALID_PLANS[number];

const LIVE_PRODUCTS: Record<PlanType, string> = {
  pro_trip: 'prod_UYfZZsZnknkxDj',
  pro_monthly: 'prod_UYfZf8WvFNE3cI',
  pro_yearly: 'prod_UYfZBYzOWrKiLu',
};

const TEST_PRODUCTS: Record<PlanType, string> = {
  pro_trip: 'prod_UZnCx7GA3YlLJd',
  pro_monthly: 'prod_UZnBPOlJL0xmue',
  pro_yearly: 'prod_UZnBUDGL1PuyEN',
};

/** True when the Stripe secret key is a test-mode key (`sk_test_…`). */
export function isTestStripeKey(key: string): boolean {
  return key.includes('_test_');
}

/** plan_type → product_id map for the active Stripe mode. */
export function productsForEnv(isTestEnv: boolean): Record<PlanType, string> {
  return isTestEnv ? TEST_PRODUCTS : LIVE_PRODUCTS;
}

// Reverse lookup: Stripe product id → our plan type. Used by the webhook to keep
// trip_subscriptions.type in sync after a plan switch in the Billing Portal
// (TRIP-53), now that changeSubscriptionPlan no longer writes type directly.
export function planTypeForProduct(productId: string, isTestEnv: boolean): PlanType | null {
  const map = productsForEnv(isTestEnv);
  return (Object.keys(map) as PlanType[]).find((k) => map[k] === productId) ?? null;
}
