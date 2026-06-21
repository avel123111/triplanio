import Stripe from 'npm:stripe@17.0.0';

/**
 * Read a subscription's current period end as a unix timestamp, version-tolerant.
 * Stripe API ≥ 2025-03-31.basil moved `current_period_end` off the subscription
 * object and onto each subscription item, so we read the top-level field first and
 * fall back to the first item. This is why we don't need to pin an apiVersion just
 * for the period field — both shapes are handled here.
 */
export function getPeriodEndUnix(sub: Stripe.Subscription): number | null {
  const top = (sub as unknown as Record<string, number | null>)['current_period_end'];
  if (typeof top === 'number') return top;
  const item = (sub.items?.data?.[0] as unknown as Record<string, number | null>)?.['current_period_end'];
  return typeof item === 'number' ? item : null;
}

/** Unix seconds → ISO string, or null for missing/invalid input. */
export function unixToIso(unix: number | null | undefined): string | null {
  if (!unix || typeof unix !== 'number') return null;
  const d = new Date(unix * 1000);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
