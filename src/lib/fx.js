import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

/**
 * Hook: fetch FX rates with the given base currency.
 * Cached for 24h client-side; server cache refreshes every 2 days.
 */
export function useFxRates(base = 'EUR') {
  return useQuery({
    queryKey: ['fx-rates', base],
    queryFn: async () => {
      const res = await base44.functions.invoke('getFxRates', { base });
      return res.data;
    },
    staleTime: 24 * 60 * 60 * 1000,
    enabled: !!base,
  });
}

/**
 * Convert `amount` from `from` currency to `to` currency using rates obj.
 * `rates` is the FxRates object: { base, rates: { XXX: rate } } where rate means 1 base = rate XXX.
 *
 * Returns null if conversion not possible.
 */
export function convert(amount, from, to, fx) {
  if (amount == null || isNaN(Number(amount))) return null;
  const num = Number(amount);
  if (!from || !to || from === to) return num;
  if (!fx || !fx.rates) return null;

  const base = fx.base;
  const rFrom = from === base ? 1 : fx.rates[from];
  const rTo = to === base ? 1 : fx.rates[to];
  if (!rFrom || !rTo) return null;

  // amount in `from` -> in base = amount / rFrom; -> in `to` = (amount / rFrom) * rTo
  return (num / rFrom) * rTo;
}