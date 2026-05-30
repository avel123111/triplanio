/**
 * getTripDetails
 *
 * Returns the full trip payload: the trip itself + every related collection
 * (cities, hotels, activities, transfers, services, documents, members, budget).
 *
 * POST body: { tripId: string, include?: string[] }
 *
 * include groups (defaults to all):
 *   'shell'     — cityVisits only (lightest; trip is always returned)
 *   'content'   — hotels + activities + transfers + services + members
 *   'core'      — alias for shell + content (backward compat)
 *   'budget'    — budget + categories + expenses
 *   'documents' — documents
 *
 * Access: authentication is REQUIRED. The caller must be the trip creator
 * (created_by == user.id) or an active TripMember. There is NO trusted
 * no-JWT path — the SPA always sends a user token, and public read-only
 * viewing goes through getPublicTrip. Fails CLOSED: any request we can't tie
 * to an authorized user is rejected, never served data.
 */

import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Identify caller — REQUIRED. getRequestUser returns null when there is no
    // Authorization header OR when the token is not a real user token (e.g. the
    // public anon key shipped in the frontend bundle). Either way: deny.
    const user = await getRequestUser(req);
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const { tripId, include } = await req.json();
    if (!tripId) {
      return Response.json({ error: 'tripId is required' }, { status: 400, headers: corsHeaders });
    }

    // Resolve which groups to fetch
    const includeSet = Array.isArray(include) && include.length > 0
      ? new Set(include)
      : new Set(['core', 'budget', 'documents']);

    // 'core' expands into shell + content (backward compat)
    if (includeSet.has('core')) {
      includeSet.add('shell');
      includeSet.add('content');
    }

    const wantShell     = includeSet.has('shell');
    const wantContent   = includeSet.has('content');
    const wantBudget    = includeSet.has('budget');
    const wantDocuments = includeSet.has('documents');

    // Fetch the trip (service role — no RLS)
    const { data: trip, error: tripError } = await supabaseAdmin
      .from('trips')
      .select('*')
      .eq('id', tripId)
      .single();

    if (tripError || !trip) {
      return Response.json({ error: 'Trip not found' }, { status: 404, headers: corsHeaders });
    }

    // Access check — ALWAYS runs (user is guaranteed non-null above).
    // Caller must be the trip creator or an active member.
    const isCreator = trip.created_by === user.id;
    if (!isCreator) {
      const { data: memberRows } = await supabaseAdmin
        .from('trip_members')
        .select('id')
        .eq('trip_id', tripId)
        .eq('user_id', user.id)
        .eq('status', 'active')
        .limit(1);

      const isMember = (memberRows ?? []).length > 0;

      if (!isMember) {
        return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
      }
    }

    // Build parallel fetch list — only what was requested
    const tasks: Promise<{ data: unknown[] | null; error: unknown }>[] = [];
    const slots: Record<string, number> = {};

    const add = (key: string, query: ReturnType<typeof supabaseAdmin.from>) => {
      slots[key] = tasks.length;
      tasks.push(query as unknown as Promise<{ data: unknown[] | null; error: unknown }>);
    };

    if (wantShell) {
      add('cityVisits', supabaseAdmin.from('city_visits').select('*').eq('trip_id', tripId));
    }
    if (wantContent) {
      add('hotels',     supabaseAdmin.from('hotel_stays').select('*').eq('trip_id', tripId));
      add('activities', supabaseAdmin.from('activities').select('*').eq('trip_id', tripId));
      add('transfers',  supabaseAdmin.from('transfers').select('*').eq('trip_id', tripId));
      add('services',   supabaseAdmin.from('trip_services').select('*').eq('trip_id', tripId));
      add('members',    supabaseAdmin.from('trip_members').select('*').eq('trip_id', tripId));
    }
    if (wantDocuments) {
      add('documents',  supabaseAdmin.from('trip_documents').select('*').eq('trip_id', tripId));
    }
    if (wantBudget) {
      add('budget',           supabaseAdmin.from('trip_budgets').select('*').eq('trip_id', tripId));
      add('budgetCategories', supabaseAdmin.from('budget_categories').select('*').eq('trip_id', tripId).order('order_index'));
      add('budgetExpenses',   supabaseAdmin.from('budget_expenses').select('*').eq('trip_id', tripId));
    }

    const results = await Promise.all(tasks);
    const pick = (key: string) => slots[key] != null ? (results[slots[key]] as { data: unknown[] | null }).data ?? [] : undefined;

    // Assemble response — same shape as base44 version
    const response: Record<string, unknown> = { trip };

    if (wantShell)     response.cityVisits        = pick('cityVisits');
    if (wantContent) {
                       response.hotels             = pick('hotels');
                       response.activities         = pick('activities');
                       response.transfers          = pick('transfers');
                       response.services           = pick('services');
                       response.members            = pick('members');
    }
    if (wantDocuments) response.documents          = pick('documents');
    if (wantBudget) {
      const budgetArr  = (pick('budget') as unknown[]) ?? [];
                       response.budget             = budgetArr[0] ?? null;
                       response.budgetCategories   = pick('budgetCategories');
                       response.budgetExpenses     = pick('budgetExpenses');
    }

    return Response.json(response, { headers: corsHeaders });

  } catch (error) {
    console.error('getTripDetails error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500, headers: corsHeaders },
    );
  }
});
