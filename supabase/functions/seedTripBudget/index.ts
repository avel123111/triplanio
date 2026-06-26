/**
 * seedTripBudget
 *
 * POST body: { tripId } OR automation event: { event: { entity_name: 'Trip', entity_id } }
 *
 * Creates trip_budgets row (if missing) + default budget_categories for a trip.
 * Idempotent — if already seeded, returns existing data.
 *
 * Default categories:
 *   System (kind: 'system'): accommodation, transport, food, activities
 *   Custom  (kind: 'custom'): shopping, entertainment, fees, other
 */

import { corsFor } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';

const SYSTEM_CATEGORIES = [
  { name: 'Accommodation', system_key: 'accommodation', icon: '🏨', color: '#6366f1', order_index: 0 },
  { name: 'Transport',     system_key: 'transport',     icon: '✈️',  color: '#0ea5e9', order_index: 1 },
  { name: 'Food',          system_key: 'food',          icon: '🍽️', color: '#f59e0b', order_index: 2 },
  { name: 'Activities',    system_key: 'activities',    icon: '🎭',  color: '#10b981', order_index: 3 },
];

const CUSTOM_CATEGORIES = [
  { name: 'Shopping',      system_key: null, icon: '🛍️', color: '#ec4899', order_index: 4 },
  { name: 'Entertainment', system_key: null, icon: '🎬',  color: '#8b5cf6', order_index: 5 },
  { name: 'Fees & Visa',   system_key: null, icon: '📋',  color: '#64748b', order_index: 6 },
  { name: 'Other',         system_key: null, icon: '💰',  color: '#78716c', order_index: 7 },
];

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Support both user-auth and automation (service-role) calls
    let tripId: string | undefined;
    let callerId: string | null = null;

    const body = await req.json();

    // Automation event payload: { event: { entity_name: 'Trip', entity_id: '...' } }
    if (body?.event?.entity_name === 'Trip' && body?.event?.entity_id) {
      tripId = body.event.entity_id;
      // Automation uses service-role, no user JWT needed
    } else {
      // Manual call — require user auth
      const user = await getRequestUser(req);
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
      callerId = user.id;
      tripId = body.tripId;
    }

    if (!tripId) {
      return Response.json({ error: 'tripId is required' }, { status: 400, headers: corsHeaders });
    }

    // Verify trip exists
    const { data: trip } = await supabaseAdmin
      .from('trips')
      .select('id, created_by, details')
      .eq('id', tripId)
      .single();

    if (!trip) return Response.json({ error: 'Trip not found' }, { status: 404, headers: corsHeaders });

    // created_by must be a uuid — prefer the trip owner, fall back to caller id.
    const ownerId = trip.created_by || callerId;
    // Main currency comes from trip settings (default EUR), not a hardcoded value.
    const mainCurrency = (trip.details && trip.details.main_currency) || 'EUR';

    // --- Ensure trip_budgets row ---
    const { data: existingBudget } = await supabaseAdmin
      .from('trip_budgets')
      .select('id')
      .eq('trip_id', tripId)
      .maybeSingle();

    if (!existingBudget) {
      await supabaseAdmin
        .from('trip_budgets')
        .insert({
          trip_id: tripId,
          currency: mainCurrency,
          fx_overrides: {},
          created_by: ownerId,
        });
    }

    // --- Ensure budget_categories ---
    const { data: existingCats } = await supabaseAdmin
      .from('budget_categories')
      .select('id')
      .eq('trip_id', tripId);

    if (!existingCats || existingCats.length === 0) {
      const categories = [
        ...SYSTEM_CATEGORIES.map((c) => ({
          trip_id: tripId,
          kind: 'system',
          name: c.name,
          system_key: c.system_key,
          icon: c.icon,
          color: c.color,
          order_index: c.order_index,
          created_by: ownerId,
        })),
        ...CUSTOM_CATEGORIES.map((c) => ({
          trip_id: tripId,
          kind: 'custom',
          name: c.name,
          system_key: c.system_key,
          icon: c.icon,
          color: c.color,
          order_index: c.order_index,
          created_by: ownerId,
        })),
      ];

      const { error } = await supabaseAdmin.from('budget_categories').insert(categories);
      if (error) throw error;
    }

    return Response.json({ ok: true }, { headers: corsHeaders });

  } catch (e) {
    console.error('seedTripBudget error:', e);
    return Response.json(
      { error: (e as Error).message },
      { status: 500, headers: corsHeaders },
    );
  }
});
