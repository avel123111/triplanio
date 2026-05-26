import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * External HTTP endpoint: returns full details of every trip bound to a given
 * telegram_chat_id (only integrations with is_active=true are considered).
 *
 * Auth: shared bearer token in `Authorization: Bearer <EXTERNAL_API_TOKEN>`.
 *
 * Request body (POST JSON):
 *   { "telegram_chat_id": "123456789" }
 *
 * Response:
 *   200 { trips: [ { trip, cityVisits, hotels, activities, transfers,
 *                    services, members, documents, budget,
 *                    budgetCategories, budgetExpenses }, ... ] }
 *   400 { error } — missing/invalid input
 *   401 { error } — missing/invalid token
 *   404 { error } — no active integration found for that chat
 *   500 { error } — server error
 *
 * Per-trip payload mirrors `getTripDetails` (all groups: shell+content+budget+documents).
 */
Deno.serve(async (req) => {
  try {
    // 1. Auth check — shared external token.
    const expectedToken = Deno.env.get('EXTERNAL_API_TOKEN');
    if (!expectedToken) {
      console.error('EXTERNAL_API_TOKEN is not set');
      return Response.json({ error: 'Server misconfigured' }, { status: 500 });
    }
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : '';
    if (!token || token !== expectedToken) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Parse input.
    let body = {};
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const chatId = body?.telegram_chat_id;
    if (!chatId) {
      return Response.json({ error: 'telegram_chat_id is required' }, { status: 400 });
    }
    const chatIdStr = String(chatId);

    // 3. Lookup integrations via service role — only active ones.
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole.entities;

    const integrations = await sr.TripTelegramIntegration.filter({
      telegram_chat_id: chatIdStr,
      is_active: true,
    });

    if (!integrations || integrations.length === 0) {
      return Response.json({ error: 'No integration found for this chat_id' }, { status: 404 });
    }

    // Deduplicate trip ids (same chat could in theory be linked under multiple users).
    const tripIds = Array.from(new Set(integrations.map((i) => i.trip_id).filter(Boolean)));

    // 4. Fetch full details for each trip in parallel — mirrors getTripDetails
    //    with the default include set (shell + content + budget + documents).
    const tripPayloads = await Promise.all(tripIds.map(async (tripId) => {
      const trip = await sr.Trip.get(tripId);
      if (!trip) return null;

      const [
        cityVisits,
        hotels,
        activities,
        transfers,
        services,
        members,
        documents,
        budgetArr,
        budgetCategories,
        budgetExpenses,
      ] = await Promise.all([
        sr.CityVisit.filter({ trip_id: tripId }),
        sr.HotelStay.filter({ trip_id: tripId }),
        sr.Activity.filter({ trip_id: tripId }),
        sr.Transfer.filter({ trip_id: tripId }),
        sr.TripService.filter({ trip_id: tripId }),
        sr.TripMember.filter({ trip_id: tripId }),
        sr.TripDocument.filter({ trip_id: tripId }),
        sr.TripBudget.filter({ trip_id: tripId }),
        sr.BudgetCategory.filter({ trip_id: tripId }),
        sr.BudgetExpense.filter({ trip_id: tripId }),
      ]);

      return {
        trip,
        cityVisits,
        hotels,
        activities,
        transfers,
        services,
        members,
        documents,
        budget: budgetArr[0] || null,
        budgetCategories,
        budgetExpenses,
      };
    }));

    const trips = tripPayloads.filter(Boolean);
    return Response.json({ trips });
  } catch (error) {
    console.error('getTripByTelegramChatId error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});