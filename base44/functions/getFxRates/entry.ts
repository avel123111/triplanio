import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Free, no-auth FX source. Daily updates.
// API: https://www.frankfurter.app  (ECB rates)
const SOURCE = 'frankfurter';
const MAX_AGE_HOURS = 48; // refresh after 2 days

/**
 * GET fresh-ish FX rates with the given base currency.
 * Body: { base?: 'EUR' }
 * Returns: { base, rates, fetched_at, source, age_hours }
 *
 * Caches rates in FxRates entity per base currency.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const base = ((body?.base || 'EUR') + '').toUpperCase();

    // Check cache
    const existing = await base44.asServiceRole.entities.FxRates.filter({ base });
    const cached = existing?.[0];

    if (cached?.fetched_at) {
      const ageMs = Date.now() - new Date(cached.fetched_at).getTime();
      const ageHours = ageMs / (1000 * 60 * 60);
      if (ageHours < MAX_AGE_HOURS && cached.rates && Object.keys(cached.rates).length > 0) {
        return Response.json({ ...cached, age_hours: Math.round(ageHours * 10) / 10, cached: true });
      }
    }

    // Fetch fresh from Frankfurter (returns EUR-based rates if base unsupported)
    const url = `https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      // If we have stale cache, return it as fallback
      if (cached) return Response.json({ ...cached, stale: true });
      return Response.json({ error: `FX API error ${resp.status}` }, { status: 502 });
    }
    const data = await resp.json();
    const rates = { ...(data.rates || {}), [data.base]: 1 };

    const payload = {
      base: data.base || base,
      rates,
      fetched_at: new Date().toISOString(),
      source: SOURCE,
    };

    if (cached?.id) {
      await base44.asServiceRole.entities.FxRates.update(cached.id, payload);
    } else {
      await base44.asServiceRole.entities.FxRates.create(payload);
    }

    return Response.json({ ...payload, age_hours: 0, cached: false });
  } catch (error) {
    console.error('getFxRates error', error);
    return Response.json({ error: error.message || String(error) }, { status: 500 });
  }
});