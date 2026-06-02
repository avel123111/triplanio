/**
 * Money / FX helpers for the budget v3 model.
 *
 * Convention: `fx` is the object returned by `useFxRates(mainCurrency)` - i.e.
 * { base: <mainCurrency>, rates: { CURR: rate, ... } } where
 *   1 unit of <mainCurrency> = rate units of CURR.
 *
 * `overrides` is `TripBudget.fx_overrides` - a user-defined map
 *   { CURR: rate } where 1 unit of CURR = rate units of <mainCurrency>.
 * Overrides take precedence over the live FX rates.
 */

/**
 * Convert `amount` from `from` currency into the trip's main currency.
 * Returns { value: number, ok: boolean }. `ok=false` means we could not
 * convert (missing rate) - callers should display a "?" badge in that case
 * instead of silently summing a wrong number.
 */
export function toMain(amount, from, mainCurrency, fx, overrides) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return { value: 0, ok: false };
  if (!from || from === mainCurrency) return { value: n, ok: true };

  // User-defined override wins.
  if (overrides && overrides[from] != null) {
    const rate = Number(overrides[from]);
    if (Number.isFinite(rate) && rate > 0) return { value: n * rate, ok: true };
  }

  // Live rate: 1 main = fx.rates[from] of `from` → 1 `from` = 1 / rate of main.
  const liveRate = fx?.rates?.[from];
  if (liveRate && Number.isFinite(Number(liveRate)) && Number(liveRate) > 0) {
    return { value: n / Number(liveRate), ok: true };
  }

  return { value: 0, ok: false };
}

/**
 * Format a number as money in the given currency using Intl.
 * Falls back to "<rounded> <code>" if Intl chokes on an unknown code.
 */
export function fmtMoney(value, currency, locale) {
  const n = Number(value) || 0;
  try {
    return new Intl.NumberFormat(locale || undefined, {
      style: 'currency',
      currency: currency || 'EUR',
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency || ''}`.trim();
  }
}