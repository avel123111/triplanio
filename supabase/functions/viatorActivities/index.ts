/**
 * viatorActivities
 *
 * Thin proxy to the Viator Partner API (affiliate, Basic access), used by the trip
 * editor's activity "fork" side-panel to show real bookable tours/experiences for a
 * city — same pattern as stay22Accommodations for hotels.
 *
 * Why a proxy: Viator authenticates with an `exp-api-key` header that must never
 * reach the browser. The client passes the city's Viator destinationId (resolved
 * server-side into cities.viator_dest_id) and we attach the secret here.
 *
 * POST body:
 *   { destinationId, startDate?, endDate?, currency?, lang?, page?, sort? }
 *
 * Calls POST /products/search (summary model). Pins count=50 (Viator's per-page
 * max) and the affiliate campaign tag via the `campaign-value` QUERY param (a body
 * field is ignored). Pricing/links come back attributed already.
 * Nothing is persisted — the panel fetches on open and renders client-side.
 * Merchandising tags are NOT forwarded (Viator display compliance).
 *
 * Returns: { activities: [...], meta: { total, page, hasMore } }.
 */

import { withHandler } from '../_shared/http.ts';
import { getRequestUser } from '../_shared/supabaseAdmin.ts';

const VIATOR_BASE = Deno.env.get('VIATOR_BASE') || 'https://api.viator.com/partner';
const VIATOR_VERSION = 'application/json;version=2.0';
const CAMPAIGN = 'fork_api_search';
// Viator caps /products/search at 50 results per request; we pull the full page
// so one round-trip fills the client pool page (5 pages → up to 250 pooled).
const PAGE_SIZE = 50;

// App locale -> Viator Accept-Language. Viator affiliate does NOT serve ru, so ru
// content falls back to en (our own UI strings stay localised via t()).
const LANG_MAP: Record<string, string> = { en: 'en-US', es: 'es-ES', ru: 'en-US' };

// Pick the image variant closest to ~400px wide for card thumbnails.
function pickImage(images: any[]): string | null {
  const variants = images?.[0]?.variants;
  if (!Array.isArray(variants) || variants.length === 0) return null;
  let best = variants[0];
  let bestDiff = Math.abs((best.width ?? 0) - 400);
  for (const v of variants) {
    const diff = Math.abs((v.width ?? 0) - 400);
    if (diff < bestDiff) { best = v; bestDiff = diff; }
  }
  return best?.url ?? null;
}

Deno.serve(withHandler('viatorActivities', async (req, corsHeaders) => {
    const user = await getRequestUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const apiKey = Deno.env.get('VIATOR_API_KEY');
    if (!apiKey) return Response.json({ error: 'VIATOR_API_KEY not configured' }, { status: 500, headers: corsHeaders });

    const body = await req.json();
    const { destinationId, startDate, endDate, currency, lang, page, sort } = body;

    if (destinationId === undefined || destinationId === null || destinationId === '') {
      return Response.json({ error: 'destinationId is required' }, { status: 400, headers: corsHeaders });
    }

    const pageNum = page && page > 0 ? Number(page) : 1;
    const start = (pageNum - 1) * PAGE_SIZE + 1;

    const filtering: Record<string, unknown> = { destination: String(destinationId) };
    if (startDate) filtering.startDate = String(startDate);
    if (endDate) filtering.endDate = String(endDate);

    const payload: Record<string, unknown> = {
      filtering,
      pagination: { start, count: PAGE_SIZE },
    };
    if (currency) payload.currency = String(currency);
    // Viator: DEFAULT sort must NOT carry an order (returns 400). Only attach
    // sorting for an explicit non-default sort.
    if (sort && sort !== 'DEFAULT') payload.sorting = { sort: String(sort), order: 'DESCENDING' };

    const acceptLang = LANG_MAP[String(lang || 'en')] || 'en-US';

    // campaign-value is a QUERY param on the endpoint (per Viator partner-API docs),
    // NOT a body field — a body field is ignored, so the affiliate attribution only
    // lands when it rides in the URL (TRIP-244).
    const res = await fetch(`${VIATOR_BASE.replace(/\/$/, '')}/products/search?campaign-value=${encodeURIComponent(CAMPAIGN)}`, {
      method: 'POST',
      headers: {
        'exp-api-key': apiKey,
        Accept: VIATOR_VERSION,
        'Accept-Language': acceptLang,
        'Content-Type': 'application/json;version=2.0',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[viatorActivities] upstream error', res.status, text.slice(0, 500));
      return Response.json(
        { error: 'viator_upstream_error', status: res.status },
        { status: 502, headers: corsHeaders },
      );
    }

    const data = await res.json();
    const products: any[] = Array.isArray(data.products) ? data.products : [];
    const total: number | null = typeof data.totalCount === 'number' ? data.totalCount : null;

    const activities = products.map((p) => ({
      code: p.productCode,
      title: p.title ?? null,
      desc: p.description ?? null,
      image: pickImage(p.images),
      rating: p.reviews?.combinedAverageRating ?? null,
      reviewCount: p.reviews?.totalReviews ?? null,
      fromPrice: p.pricing?.summary?.fromPrice ?? null,
      currency: p.pricing?.currency ?? currency ?? null,
      url: p.productUrl ?? null, // attributed link — forward as-is, do not modify
      freeCancellation: Array.isArray(p.flags) && p.flags.includes('FREE_CANCELLATION'),
    }));

    const hasMore = total != null ? start + PAGE_SIZE - 1 < total : products.length === PAGE_SIZE;

    return Response.json(
      { activities, meta: { total, page: pageNum, hasMore } },
      { headers: corsHeaders },
    );
}));
