// getFxRates
// Returns fresh-ish FX rates for the given base currency, cached in the
// fx_rates table. Source: frankfurter.app (ECB), refreshed after 48h.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// open.er-api.com (free, no key) — unlike ECB/frankfurter it INCLUDES RUB and
// most world currencies, which a RUB-centric app needs.
const SOURCE = 'er-api';
const MAX_AGE_HOURS = 48;

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

async function getUser(req: Request) {
  const a = req.headers.get('Authorization');
  if (!a) return null;
  const { data: { user } } = await admin.auth.getUser(a.replace('Bearer ', ''));
  return user ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const user = await getUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const body = await req.json().catch(() => ({}));
    const base = String(body?.base || 'EUR').toUpperCase();

    const { data: existingRows } = await admin
      .from('fx_rates').select('*').eq('base', base).limit(1);
    const cached = existingRows?.[0];

    // Only trust cache from the current source (old ECB rows lacked RUB).
    if (cached?.fetched_at && cached.source === SOURCE) {
      const ageHours = (Date.now() - new Date(cached.fetched_at).getTime()) / 36e5;
      if (ageHours < MAX_AGE_HOURS && cached.rates && Object.keys(cached.rates).length > 0) {
        return Response.json({ ...cached, age_hours: Math.round(ageHours * 10) / 10, cached: true }, { headers: corsHeaders });
      }
    }

    const resp = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`);
    if (!resp.ok) {
      if (cached) return Response.json({ ...cached, stale: true }, { headers: corsHeaders });
      return Response.json({ error: `FX API error ${resp.status}` }, { status: 502, headers: corsHeaders });
    }
    const data = await resp.json();
    if (data.result !== 'success' || !data.rates) {
      if (cached) return Response.json({ ...cached, stale: true }, { headers: corsHeaders });
      return Response.json({ error: 'FX API returned no rates' }, { status: 502, headers: corsHeaders });
    }
    const rates = { ...data.rates, [data.base_code || base]: 1 };
    const payload = {
      base: data.base_code || base,
      rates,
      fetched_at: new Date().toISOString(),
      source: SOURCE,
    };

    if (cached?.id) {
      await admin.from('fx_rates').update(payload).eq('id', cached.id);
    } else {
      await admin.from('fx_rates').insert(payload);
    }

    return Response.json({ ...payload, age_hours: 0, cached: false }, { headers: corsHeaders });
  } catch (error) {
    console.error('getFxRates error:', error);
    return Response.json({ error: String(error?.message || error) }, { status: 500, headers: corsHeaders });
  }
});
