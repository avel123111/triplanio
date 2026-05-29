/**
 * Shared list of common ISO currencies for budget / event / settings pickers.
 *
 * Re-exports the canonical CURRENCIES list (single source of truth lives in
 * src/lib/currencies.js, also consumed by the shadcn CurrencyCombobox) plus a
 * small filtering helper used by the design/index-styled CurrencySelect.
 */
import { CURRENCIES } from '@/lib/currencies';

export { CURRENCIES };

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code);

export function currencySymbol(code) {
  return CURRENCIES.find((c) => c.code === code)?.symbol || '';
}

export function filterCurrencies(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return CURRENCIES;
  return CURRENCIES.filter(
    (c) =>
      c.code.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      (c.symbol || '').toLowerCase().includes(q)
  );
}
