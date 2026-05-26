import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Seeds budget structure for a single trip:
 *   - 1 TripBudget row (currency='EUR', fx_overrides={})
 *   - 4 system BudgetCategory rows (accommodation/transport/activities/services)
 *   - 4 custom BudgetCategory rows (food/shopping/souvenirs/other) localized
 *     for the trip creator's UI language
 *
 * Idempotent: if any BudgetCategory already exists for this trip, the function
 * is a no-op (returns { skipped: true }). This makes it safe to call from a
 * Trip.create automation AND from `backfillTripBudget`.
 *
 * Invocation modes:
 *   A) Automation (Trip.create) — payload: { event: { type:'create', entity_id }, data: {...} }
 *   B) Manual — payload: { tripId: string }
 */

// ───────────────────────────────────────────────────────────────────────────
// Inlined constants (no local imports allowed in backend functions)
// ───────────────────────────────────────────────────────────────────────────
const SYSTEM_CATEGORIES = [
  { system_key: 'accommodation', name_key: 'budget.cat_accommodation', order_index: 0 },
  { system_key: 'transport',     name_key: 'budget.cat_transport',     order_index: 1 },
  { system_key: 'activities',    name_key: 'budget.cat_activities',    order_index: 2 },
  { system_key: 'services',      name_key: 'budget.cat_services',      order_index: 3 },
];

const DEFAULT_CUSTOM_CATEGORIES = [
  { key: 'food',      i18n_key: 'budget.cat_food',      order_index: 100 },
  { key: 'shopping',  i18n_key: 'budget.cat_shopping',  order_index: 101 },
  { key: 'souvenirs', i18n_key: 'budget.cat_souvenirs', order_index: 102 },
  { key: 'other',     i18n_key: 'budget.cat_other',     order_index: 103 },
];

// Translation table for the 4 default custom category names. Kept tiny on
// purpose — we only translate seed names, everything else is in the frontend.
const CUSTOM_TRANSLATIONS = {
  ru: { 'budget.cat_food': 'Еда',    'budget.cat_shopping': 'Шопинг',   'budget.cat_souvenirs': 'Сувениры',  'budget.cat_other': 'Прочее' },
  en: { 'budget.cat_food': 'Food',   'budget.cat_shopping': 'Shopping', 'budget.cat_souvenirs': 'Souvenirs', 'budget.cat_other': 'Other'  },
  es: { 'budget.cat_food': 'Comida', 'budget.cat_shopping': 'Compras',  'budget.cat_souvenirs': 'Recuerdos', 'budget.cat_other': 'Otros'  },
};

function translateCustom(i18nKey, language) {
  const lang = CUSTOM_TRANSLATIONS[language] ? language : 'en';
  return CUSTOM_TRANSLATIONS[lang][i18nKey] || CUSTOM_TRANSLATIONS.en[i18nKey];
}

// ───────────────────────────────────────────────────────────────────────────
// Core seeding logic — reused by backfillTripBudget too (via direct call)
// ───────────────────────────────────────────────────────────────────────────
async function seedBudgetForTrip(sr, tripId, creatorEmail) {
  // Idempotency guard
  const existingCats = await sr.BudgetCategory.filter({ trip_id: tripId });
  if (existingCats.length > 0) {
    return { skipped: true, reason: 'already_seeded', tripId };
  }

  // Resolve creator's language for the custom category names. Falls back to EN.
  let language = 'en';
  if (creatorEmail) {
    try {
      const users = await sr.User.filter({ email: creatorEmail });
      if (users.length > 0 && users[0].language) language = users[0].language;
    } catch (e) {
      console.warn('seedTripBudget: failed to read creator language', e.message);
    }
  }

  // Build category payloads
  const systemRows = SYSTEM_CATEGORIES.map(c => ({
    trip_id: tripId,
    name: c.name_key,        // system categories store the i18n KEY
    kind: 'system',
    system_key: c.system_key,
    order_index: c.order_index,
  }));
  const customRows = DEFAULT_CUSTOM_CATEGORIES.map(c => ({
    trip_id: tripId,
    name: translateCustom(c.i18n_key, language),   // custom: plain text
    kind: 'custom',
    order_index: c.order_index,
  }));

  // Ensure TripBudget exists exactly once
  const existingBudget = await sr.TripBudget.filter({ trip_id: tripId });
  const budgetPromise = existingBudget.length > 0
    ? Promise.resolve(existingBudget[0])
    : sr.TripBudget.create({ trip_id: tripId, currency: 'EUR', fx_overrides: {} });

  const [budget, createdCats] = await Promise.all([
    budgetPromise,
    sr.BudgetCategory.bulkCreate([...systemRows, ...customRows]),
  ]);

  return {
    skipped: false,
    tripId,
    language,
    budget_id: budget.id,
    categories_created: createdCats.length,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// HTTP handler
// ───────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole.entities;
    const payload = await req.json().catch(() => ({}));

    // Detect mode: automation payload has `event.entity_id` and `event.entity_name === 'Trip'`
    let tripId;
    let creatorEmail = null;
    if (payload?.event?.entity_name === 'Trip' && payload?.event?.entity_id) {
      tripId = payload.event.entity_id;
      creatorEmail = payload?.data?.created_by || null;
    } else if (payload?.tripId) {
      tripId = payload.tripId;
    } else {
      return Response.json({ error: 'tripId is required' }, { status: 400 });
    }

    // If creatorEmail still unknown — fetch from Trip
    if (!creatorEmail) {
      const trip = await sr.Trip.get(tripId);
      if (!trip) return Response.json({ error: 'Trip not found' }, { status: 404 });
      creatorEmail = trip.created_by;
    }

    const result = await seedBudgetForTrip(sr, tripId, creatorEmail);
    return Response.json(result);
  } catch (error) {
    console.error('seedTripBudget error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});