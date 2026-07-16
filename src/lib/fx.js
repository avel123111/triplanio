import { useQuery } from '@tanstack/react-query';
import { invokeFn } from '@/lib/invokeFn';

/**
 * Hook: fetch FX rates with the given base currency.
 * Cached for 24h client-side; server cache refreshes every 2 days.
 */
export function useFxRates(base = 'EUR') {
  return useQuery({
    queryKey: ['fx-rates', base],
    queryFn: async () => {
      // invokeFn is the single edge-call seam: it reports a network failure to
      // Sentry. Behaviour is unchanged — data is still returned as-is (null on a
      // miss → convert() degrades gracefully).
      const { data } = await invokeFn('getFxRates', { body: { base } });
      return data;
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