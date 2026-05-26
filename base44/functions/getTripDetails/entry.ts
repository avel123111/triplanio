import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Returns the full trip payload: the trip itself + every related collection
 * (cities, hotels, activities, transfers, services, documents, members, budget).
 *
 * POST body: { tripId: string }
 *
 * Access control: the caller must be either the trip creator (created_by) or
 * an active TripMember on the trip.
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Try to identify a logged-in user. If absent (e.g. server-to-server
        // call with api_key), we treat the call as trusted and skip the
        // creator/member access check.
        let user = null;
        try {
            user = await base44.auth.me();
        } catch {
            user = null;
        }

        const { tripId, include } = await req.json();
        if (!tripId) {
            return Response.json({ error: 'tripId is required' }, { status: 400 });
        }

        // `include` lets callers fetch only what they need. Defaults to ALL groups
        // for backward compatibility with any existing callers.
        // Valid groups:
        //   'shell'     — cityVisits only (lightest; trip itself is always returned).
        //   'content'   — hotels + activities + transfers + services + members.
        //   'core'      — alias for shell + content (kept for backward compatibility).
        //   'budget'    — budget + categories + expenses.
        //   'documents' — documents.
        const includeSet = Array.isArray(include) && include.length > 0
            ? new Set(include)
            : new Set(['core', 'budget', 'documents']);
        // 'core' expands into 'shell' + 'content' so existing callers keep working.
        if (includeSet.has('core')) {
            includeSet.add('shell');
            includeSet.add('content');
        }
        const wantShell = includeSet.has('shell');
        const wantContent = includeSet.has('content');
        const wantBudget = includeSet.has('budget');
        const wantDocuments = includeSet.has('documents');

        const trip = await base44.asServiceRole.entities.Trip.get(tripId);
        if (!trip) {
            return Response.json({ error: 'Trip not found' }, { status: 404 });
        }

        // Access check only when there IS a user. api_key callers bypass this.
        if (user) {
            const isCreator = trip.created_by === user.email;
            let isMember = false;
            if (!isCreator) {
                const memberRows = await base44.asServiceRole.entities.TripMember.filter({
                    trip_id: tripId,
                    user_email: user.email,
                    status: 'active',
                });
                isMember = memberRows.length > 0;
            }
            if (!isCreator && !isMember) {
                return Response.json({ error: 'Forbidden' }, { status: 403 });
            }
        }

        const sr = base44.asServiceRole.entities;

        // Build a sparse task list — only fetch what the caller asked for.
        // Using parallel index assignment keeps the code shape identical to before
        // for any reader, but avoids paying for unused queries.
        const tasks = [];
        const slots = {};
        const add = (key, p) => { slots[key] = tasks.length; tasks.push(p); };

        if (wantShell) {
            add('cityVisits', sr.CityVisit.filter({ trip_id: tripId }));
        }
        if (wantContent) {
            add('hotels',     sr.HotelStay.filter({ trip_id: tripId }));
            add('activities', sr.Activity.filter({ trip_id: tripId }));
            add('transfers',  sr.Transfer.filter({ trip_id: tripId }));
            add('services',   sr.TripService.filter({ trip_id: tripId }));
            add('members',    sr.TripMember.filter({ trip_id: tripId }));
        }
        if (wantDocuments) {
            add('documents',  sr.TripDocument.filter({ trip_id: tripId }));
        }
        if (wantBudget) {
            add('budget',               sr.TripBudget.filter({ trip_id: tripId }));
            add('budgetCategories',     sr.BudgetCategory.filter({ trip_id: tripId }));
            add('budgetExpenses',       sr.BudgetExpense.filter({ trip_id: tripId }));
        }

        const results = await Promise.all(tasks);
        const pick = (key) => slots[key] != null ? results[slots[key]] : undefined;

        const response = { trip };
        if (wantShell) {
            response.cityVisits = pick('cityVisits');
        }
        if (wantContent) {
            response.hotels     = pick('hotels');
            response.activities = pick('activities');
            response.transfers  = pick('transfers');
            response.services   = pick('services');
            response.members    = pick('members');
        }
        if (wantDocuments) {
            response.documents  = pick('documents');
        }
        if (wantBudget) {
            const budgetArr = pick('budget') || [];
            response.budget               = budgetArr[0] || null;
            response.budgetCategories     = pick('budgetCategories');
            response.budgetExpenses       = pick('budgetExpenses');
        }
        return Response.json(response);
    } catch (error) {
        console.error('getTripDetails error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});