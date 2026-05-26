import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Admin-only one-shot migration:
 *   1. For every Trip that has no BudgetCategory yet — seed system + custom
 *      categories AND a TripBudget row (EUR).
 *   2. For every existing HotelStay/Transfer/Activity/TripService — create a
 *      BudgetExpense if one doesn't already exist for (source_kind, source_id).
 *
 * Optional payload:
 *   { tripId?: string, dryRun?: boolean }
 *   - tripId: limit migration to a single trip (smoke test).
 *   - dryRun: count what WOULD change, write nothing.
 *
 * Returns counters per phase. Safe to re-run — every step is idempotent.
 */

const SYSTEM_CATEGORIES = [
  { system_key: 'accommodation', name_key: 'budget.cat_accommodation', order_index: 0 },
  { system_key: 'transport',     name_key: 'budget.cat_transport',     order_index: 1 },
  { system_key: 'activities',    name_key: 'budget.cat_activities',    order_index: 2 },
  { system_key: 'services',      name_key: 'budget.cat_services',      order_index: 3 },
];

const DEFAULT_CUSTOM_CATEGORIES = [
  { i18n_key: 'budget.cat_food',      order_index: 100 },
  { i18n_key: 'budget.cat_shopping',  order_index: 101 },
  { i18n_key: 'budget.cat_souvenirs', order_index: 102 },
  { i18n_key: 'budget.cat_other',     order_index: 103 },
];

const CUSTOM_TRANSLATIONS = {
  ru: { 'budget.cat_food': 'Еда',    'budget.cat_shopping': 'Шопинг',   'budget.cat_souvenirs': 'Сувениры',  'budget.cat_other': 'Прочее' },
  en: { 'budget.cat_food': 'Food',   'budget.cat_shopping': 'Shopping', 'budget.cat_souvenirs': 'Souvenirs', 'budget.cat_other': 'Other'  },
  es: { 'budget.cat_food': 'Comida', 'budget.cat_shopping': 'Compras',  'budget.cat_souvenirs': 'Recuerdos', 'budget.cat_other': 'Otros'  },
};

const SOURCE_KIND_TO_SYSTEM_KEY = {
  hotel: 'accommodation', transfer: 'transport', activity: 'activities', service: 'services',
};

function translateCustom(i18nKey, language) {
  const lang = CUSTOM_TRANSLATIONS[language] ? language : 'en';
  return CUSTOM_TRANSLATIONS[lang][i18nKey] || CUSTOM_TRANSLATIONS.en[i18nKey];
}

function buildTitle(source_kind, src, ctx) {
  if (source_kind === 'hotel')    return src.name || 'Hotel';
  if (source_kind === 'activity') return src.title || 'Activity';
  if (source_kind === 'service')  return src.name || 'Service';
  if (source_kind === 'transfer') {
    const head = src.carrier || src.transport_type || 'Transfer';
    const from = ctx?.fromCity || ''; const to = ctx?.toCity || '';
    return (from && to) ? `${head}: ${from} → ${to}` : head;
  }
  return 'Expense';
}

function buildSpentOn(source_kind, src) {
  const iso = source_kind === 'hotel'   ? src.check_in_datetime
            : source_kind === 'service' ? (src.details?.start_datetime || src.details?.pickup_datetime)
            : src.start_datetime;
  if (!iso) return undefined;
  try { return new Date(iso).toISOString().slice(0, 10); } catch { return undefined; }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const { tripId: onlyTripId, dryRun = false } = await req.json().catch(() => ({}));
    const sr = base44.asServiceRole.entities;

    // Resolve target trip set
    const trips = onlyTripId
      ? [await sr.Trip.get(onlyTripId)].filter(Boolean)
      : await sr.Trip.list();

    // Cache user language by email to avoid re-fetching for trips by same user.
    const langCache = new Map();
    async function getLang(email) {
      if (!email) return 'en';
      if (langCache.has(email)) return langCache.get(email);
      const users = await sr.User.filter({ email }).catch(() => []);
      const lang = users[0]?.language || 'en';
      langCache.set(email, lang);
      return lang;
    }

    const counters = {
      trips_total: trips.length,
      trips_seeded: 0,
      trips_already_seeded: 0,
      budgets_created: 0,
      categories_created: 0,
      expenses_created: 0,
      expenses_already_exist: 0,
      errors: [],
    };

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    let idx = 0;
    for (const trip of trips) {
      if (idx > 0) await sleep(800); // ease the API rate limit between trips
      idx += 1;
      // One automatic retry on 429 — handle the occasional spike without losing a trip.
      let attempt = 0;
      let lastErr = null;
      while (attempt < 2) {
        attempt += 1;
        try {
        // Local per-attempt counters — committed only when the trip finishes
        // without throwing, so a retry never double-counts.
        const local = { trips_seeded: 0, trips_already_seeded: 0, budgets_created: 0,
                        categories_created: 0, expenses_created: 0, expenses_already_exist: 0 };

        // ── Phase 1: ensure categories + TripBudget ────────────────────────
        const existingCats = await sr.BudgetCategory.filter({ trip_id: trip.id });
        if (existingCats.length === 0) {
          const lang = await getLang(trip.created_by);
          const systemRows = SYSTEM_CATEGORIES.map(c => ({
            trip_id: trip.id, name: c.name_key, kind: 'system',
            system_key: c.system_key, order_index: c.order_index,
          }));
          const customRows = DEFAULT_CUSTOM_CATEGORIES.map(c => ({
            trip_id: trip.id, name: translateCustom(c.i18n_key, lang),
            kind: 'custom', order_index: c.order_index,
          }));
          if (!dryRun) {
            await sr.BudgetCategory.bulkCreate([...systemRows, ...customRows]);
          }
          local.categories_created += systemRows.length + customRows.length;
          local.trips_seeded += 1;
        } else {
          local.trips_already_seeded += 1;
        }

        await sleep(150);
        const existingBudget = await sr.TripBudget.filter({ trip_id: trip.id });
        if (existingBudget.length === 0) {
          if (!dryRun) await sr.TripBudget.create({ trip_id: trip.id, currency: 'EUR', fx_overrides: {} });
          local.budgets_created += 1;
        }

        await sleep(150);
        // ── Phase 2: backfill expenses from sources ────────────────────────
        // Re-read categories (in case we just created them or dryRun → empty).
        const cats = dryRun && existingCats.length === 0
          ? SYSTEM_CATEGORIES.map((c, i) => ({ id: `dry-${i}`, system_key: c.system_key, trip_id: trip.id }))
          : await sr.BudgetCategory.filter({ trip_id: trip.id, kind: 'system' });
        const catByKey = new Map(cats.map(c => [c.system_key, c]));

        // Sequential fetch (was parallel) — parallel bursts trigger the API rate limit
        // on trips with many sources. The 150ms gap between calls keeps us under it.
        const hotels     = await sr.HotelStay.filter({ trip_id: trip.id });   await sleep(150);
        const transfers  = await sr.Transfer.filter({ trip_id: trip.id });    await sleep(150);
        const activities = await sr.Activity.filter({ trip_id: trip.id });    await sleep(150);
        const services   = await sr.TripService.filter({ trip_id: trip.id }); await sleep(150);

        // Pre-fetch CityVisits once for transfer titles (sequential, see above)
        const cityIds = new Set();
        transfers.forEach(t => { if (t.from_city_visit_id) cityIds.add(t.from_city_visit_id); if (t.to_city_visit_id) cityIds.add(t.to_city_visit_id); });
        const cityMap = new Map();
        for (const id of cityIds) {
          const cv = await sr.CityVisit.get(id).catch(() => null);
          if (cv) cityMap.set(id, cv);
          await sleep(100);
        }

        const allSources = [
          ...hotels.map(s => ({ source_kind: 'hotel', src: s })),
          ...transfers.map(s => ({ source_kind: 'transfer', src: s })),
          ...activities.map(s => ({ source_kind: 'activity', src: s })),
          ...services.map(s => ({ source_kind: 'service', src: s })),
        ];

        // Existing expense set for fast lookup
        const existingExp = await sr.BudgetExpense.filter({ trip_id: trip.id });
        const expKey = (k, id) => `${k}::${id}`;
        const existingExpSet = new Set(existingExp.map(e => expKey(e.source_kind, e.source_id)));

        const toCreate = [];
        for (const { source_kind, src } of allSources) {
          if (existingExpSet.has(expKey(source_kind, src.id))) {
            local.expenses_already_exist += 1;
            continue;
          }
          const category = catByKey.get(SOURCE_KIND_TO_SYSTEM_KEY[source_kind]);
          if (!category) continue; // shouldn't happen
          let titleCtx = null;
          if (source_kind === 'transfer') {
            titleCtx = {
              fromCity: cityMap.get(src.from_city_visit_id)?.city_name,
              toCity:   cityMap.get(src.to_city_visit_id)?.city_name,
            };
          }
          const row = {
            trip_id: trip.id,
            category_id: category.id,
            title: buildTitle(source_kind, src, titleCtx),
            original_amount: Number(src.price) || 0,
            original_currency: src.currency || 'EUR',
            source_kind,
            source_id: src.id,
          };
          const spentOn = buildSpentOn(source_kind, src);
          if (spentOn) row.spent_on = spentOn;
          toCreate.push(row);
        }
        if (toCreate.length > 0) {
          if (!dryRun) await sr.BudgetExpense.bulkCreate(toCreate);
          local.expenses_created += toCreate.length;
        }

        // Commit local counters only on full success
        counters.trips_seeded         += local.trips_seeded;
        counters.trips_already_seeded += local.trips_already_seeded;
        counters.budgets_created      += local.budgets_created;
        counters.categories_created   += local.categories_created;
        counters.expenses_created     += local.expenses_created;
        counters.expenses_already_exist += local.expenses_already_exist;
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          if (attempt < 2 && /rate limit|429/i.test(e.message || '')) {
            await sleep(5000);
            continue;
          }
          console.error(`backfillTripBudget: trip ${trip.id} failed:`, e.message);
          counters.errors.push({ trip_id: trip.id, error: e.message });
          break;
        }
      }
    }

    return Response.json({ ok: true, dryRun, ...counters });
  } catch (error) {
    console.error('backfillTripBudget error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});