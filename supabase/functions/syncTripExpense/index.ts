/**
 * syncTripExpense
 *
 * POST body (automation or manual):
 *   { event: { entity_name, entity_id, event_type } }
 *   OR { sourceKind, sourceId, tripId, action }
 *
 * Keeps budget_expenses in sync with source entities.
 *
 * entity_name → source_kind mapping:
 *   HotelStay  → 'hotel_stay'
 *   Activity   → 'activity'
 *   Transfer   → 'transfer'
 *   TripService → 'trip_service'
 *
 * For create/update: upsert budget_expense if source has a price.
 * For delete: remove the budget_expense with matching source_id.
 *
 * Maps source entity to the appropriate system budget category.
 * Falls back to first category if system category is missing.
 */

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';

type SourceKind = 'hotel_stay' | 'activity' | 'transfer' | 'trip_service';

const ENTITY_TO_KIND: Record<string, SourceKind> = {
  HotelStay:   'hotel_stay',
  Activity:    'activity',
  Transfer:    'transfer',
  TripService: 'trip_service',
};

const KIND_TO_SYSTEM_KEY: Record<SourceKind, string> = {
  hotel_stay:   'accommodation',
  activity:     'activities',
  transfer:     'transport',
  trip_service: 'transport',
};

async function resolveSource(sourceKind: SourceKind, sourceId: string) {
  if (sourceKind === 'hotel_stay') {
    const { data } = await supabaseAdmin
      .from('hotel_stays')
      .select('id, trip_id, name, price, currency, city_visit_id')
      .eq('id', sourceId)
      .maybeSingle();
    return data ? { tripId: data.trip_id, title: data.name, price: data.price, currency: data.currency } : null;
  }

  if (sourceKind === 'activity') {
    const { data } = await supabaseAdmin
      .from('activities')
      .select('id, trip_id, title, price, currency')
      .eq('id', sourceId)
      .maybeSingle();
    return data ? { tripId: data.trip_id, title: data.title, price: data.price, currency: data.currency } : null;
  }

  if (sourceKind === 'transfer') {
    const { data } = await supabaseAdmin
      .from('transfers')
      .select('id, trip_id, transport_type, price, currency')
      .eq('id', sourceId)
      .maybeSingle();
    return data ? { tripId: data.trip_id, title: data.transport_type || 'Transfer', price: data.price, currency: data.currency } : null;
  }

  if (sourceKind === 'trip_service') {
    const { data } = await supabaseAdmin
      .from('trip_services')
      .select('id, trip_id, name, kind, price, currency')
      .eq('id', sourceId)
      .maybeSingle();
    return data ? { tripId: data.trip_id, title: data.name, price: data.price, currency: data.currency } : null;
  }

  return null;
}

async function resolveCategoryId(tripId: string, sourceKind: SourceKind): Promise<string | null> {
  const systemKey = KIND_TO_SYSTEM_KEY[sourceKind];

  const { data: cats } = await supabaseAdmin
    .from('budget_categories')
    .select('id, system_key, order_index')
    .eq('trip_id', tripId)
    .order('order_index');

  if (!cats || cats.length === 0) return null;

  const match = cats.find((c) => c.system_key === systemKey);
  return match ? match.id : cats[0].id;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();

    let sourceKind: SourceKind;
    let sourceId: string;
    let action: 'upsert' | 'delete';

    // Automation event payload
    if (body?.event) {
      const { entity_name, entity_id, event_type } = body.event;
      const kind = ENTITY_TO_KIND[entity_name];
      if (!kind) {
        return Response.json({ ok: true, skipped: true }, { headers: corsHeaders });
      }
      sourceKind = kind;
      sourceId = entity_id;
      action = event_type === 'delete' ? 'delete' : 'upsert';
    } else {
      // Manual payload
      sourceKind = body.sourceKind;
      sourceId = body.sourceId;
      action = body.action || 'upsert';
      if (!sourceKind || !sourceId) {
        return Response.json({ error: 'sourceKind and sourceId are required' }, { status: 400, headers: corsHeaders });
      }
    }

    if (action === 'delete') {
      await supabaseAdmin
        .from('budget_expenses')
        .delete()
        .eq('source_id', sourceId);
      return Response.json({ ok: true }, { headers: corsHeaders });
    }

    // Upsert
    const source = await resolveSource(sourceKind, sourceId);
    if (!source || source.price == null || source.price <= 0) {
      // No price → remove any existing expense record
      await supabaseAdmin
        .from('budget_expenses')
        .delete()
        .eq('source_id', sourceId);
      return Response.json({ ok: true, skipped: 'no price' }, { headers: corsHeaders });
    }

    const categoryId = await resolveCategoryId(source.tripId, sourceKind);
    if (!categoryId) {
      return Response.json({ ok: false, error: 'No budget categories found for trip — seed first' }, { status: 400, headers: corsHeaders });
    }

    // Check if expense already exists
    const { data: existing } = await supabaseAdmin
      .from('budget_expenses')
      .select('id')
      .eq('source_id', sourceId)
      .maybeSingle();

    if (existing) {
      await supabaseAdmin
        .from('budget_expenses')
        .update({
          category_id: categoryId,
          title: source.title,
          original_amount: source.price,
          original_currency: source.currency || 'USD',
          source_kind: sourceKind,
        })
        .eq('id', existing.id);
    } else {
      await supabaseAdmin
        .from('budget_expenses')
        .insert({
          trip_id: source.tripId,
          category_id: categoryId,
          title: source.title,
          original_amount: source.price,
          original_currency: source.currency || 'USD',
          source_kind: sourceKind,
          source_id: sourceId,
          created_by: 'system',
        });
    }

    return Response.json({ ok: true }, { headers: corsHeaders });

  } catch (e) {
    console.error('syncTripExpense error:', e);
    return Response.json(
      { error: (e as Error).message },
      { status: 500, headers: corsHeaders },
    );
  }
});
