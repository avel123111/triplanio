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

import { corsFor } from '../_shared/cors.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';
import { captureEdgeError } from '../_shared/sentry.ts';
import { isNotFound } from '../_shared/classifyDbError.ts';

Deno.serve(async (req) => {
  const corsHeaders = corsFor(req);
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

    // Distinguish a genuine "no such trip" from a transient downstream failure.
    // not_found = zero rows (PGRST116) OR an unusable id (22P02 bad uuid, etc.) → 404;
    // any other error (timeout/deadlock/connection) → 5xx "retry". A DB blip must NOT
    // masquerade as "Trip not found", and a broken id must NOT masquerade as a blip.
    // TRIP-208 (taxonomy: _shared/classifyDbError.ts).
    if (tripError && !isNotFound(tripError)) {
      throw tripError;
    }
    if (!trip) {
      return Response.json({ error: 'Trip not found' }, { status: 404, headers: corsHeaders });
    }

    // Access check — ALWAYS runs (user is guaranteed non-null above).
    // Caller must be the trip creator or an active member.
    const isCreator = trip.created_by === user.id;
    if (!isCreator) {
      const { data: memberRows, error: memberError } = await supabaseAdmin
        .from('trip_members')
        .select('id')
        .eq('trip_id', tripId)
        .eq('user_id', user.id)
        .eq('status', 'active')
        .limit(1);

      // A failed membership query must NOT read as "not a member" (false 403).
      // Fail LOUD → 5xx so the client retries instead of showing "No access". TRIP-208.
      if (memberError) throw memberError;

      const isMember = (memberRows ?? []).length > 0;

      if (!isMember) {
        return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
      }
    }

    // Build parallel fetch list — only what was requested
    const tasks: Promise<{ data: unknown[] | null; error: unknown }>[] = [];
    const slots: Record<string, number> = {};

    // query is any builder link in the PostgREST chain (.select().eq()… →
    // PostgrestFilterBuilder), all of which are thenable. Typed as PromiseLike
    // so every call site (a FilterBuilder, not the bare QueryBuilder) is accepted.
    const add = (key: string, query: PromiseLike<unknown>) => {
      slots[key] = tasks.length;
      tasks.push(query as unknown as Promise<{ data: unknown[] | null; error: unknown }>);
    };

    if (wantShell) {
      add('cityVisits', supabaseAdmin.from('city_visits').select('*').eq('trip_id', tripId).order('position'));
    }
    if (wantContent) {
      add('hotels',     supabaseAdmin.from('hotel_stays').select('*').eq('trip_id', tripId));
      add('activities', supabaseAdmin.from('activities').select('*').eq('trip_id', tripId));
      add('transfers',  supabaseAdmin.from('transfers').select('*').eq('trip_id', tripId));
      add('services',   supabaseAdmin.from('trip_services').select('*').eq('trip_id', tripId));
      add('members',    supabaseAdmin.from('trip_members').select('*').eq('trip_id', tripId));
    }
    if (wantDocuments) {
      // Private-document guard (TRIP-118). supabaseAdmin bypasses RLS, so the
      // trip_documents RLS policy does NOT protect this read — we must filter
      // here. Caller sees shared docs + only their OWN private docs. user.id
      // comes from the verified JWT (getRequestUser), never the request body,
      // so it cannot be spoofed to read someone else's private docs.
      add('documents',  supabaseAdmin.from('trip_documents').select('*').eq('trip_id', tripId)
        .or(`visibility.eq.shared,created_by.eq.${user.id}`));
    }
    if (wantBudget) {
      add('budget',           supabaseAdmin.from('trip_budgets').select('*').eq('trip_id', tripId));
      add('budgetCategories', supabaseAdmin.from('budget_categories').select('*').eq('trip_id', tripId).order('order_index'));
      add('budgetExpenses',   supabaseAdmin.from('budget_expenses').select('*').eq('trip_id', tripId));
    }

    const results = await Promise.all(tasks);
    const pick = (key: string) => slots[key] != null ? (results[slots[key]] as { data: unknown[] | null }).data ?? [] : undefined;

    // Assemble response
    const response: Record<string, unknown> = { trip };

    if (wantShell) {
      const cv = (pick('cityVisits') as any[]) ?? [];
      // Affiliate fields are LATE-BOUND by GeoNames identity (visit.geonameid →
      // cities.geonameid, TRIP-146), not the city_id FK: `cities` is a sparse
      // affiliate directory, so a city added to it later is picked up by existing
      // visits with no backfill. We fetch the directory rows for this trip's
      // geonameids and attach them as `v.cities` (shape unchanged for consumers),
      // plus derive iata_city_code so the Aviasales deep-link keeps working.
      const gids = [...new Set(cv.map((v) => v?.geonameid).filter((g) => g != null))];
      const dir: Record<string, any> = {};
      if (gids.length) {
        const { data: crows } = await supabaseAdmin
          .from('cities')
          .select('geonameid, iata_code, viator_dest_id, getyourguide_id, name_en')
          .in('geonameid', gids as number[]);
        for (const r of (crows ?? []) as any[]) dir[String(r.geonameid)] = r;
      }
      response.cityVisits = cv.map((v) => {
        const c = v?.geonameid != null ? dir[String(v.geonameid)] ?? null : null;
        return { ...v, cities: c, iata_city_code: c?.iata_code ?? null };
      });
    }
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
    await captureEdgeError(error, 'getTripDetails');
    console.error('getTripDetails error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500, headers: corsHeaders },
    );
  }
});
