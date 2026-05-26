import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Single-entry-point syncer that keeps BudgetExpense rows in sync with the
 * 4 source entities (HotelStay, Transfer, Activity, TripService).
 *
 * Invocation modes:
 *   A) Automation (entity.create/update/delete) — payload:
 *      { event: { type, entity_name, entity_id }, data, old_data, payload_too_large }
 *   B) Manual — payload:
 *      { source_kind: 'hotel'|'transfer'|'activity'|'service',
 *        source_id: string,
 *        event_type: 'create'|'update'|'delete' }
 *
 * Behaviour:
 *   - delete  → removes any BudgetExpense with the same (source_kind, source_id)
 *   - create/update → upserts a BudgetExpense pointing at the matching system
 *     category for this trip. If the system category doesn't exist yet,
 *     it is lazily created (this also covers very old trips not yet backfilled).
 */

const ENTITY_TO_SOURCE_KIND = {
  HotelStay: 'hotel',
  Transfer: 'transfer',
  Activity: 'activity',
  TripService: 'service',
};

const SOURCE_KIND_TO_SYSTEM_KEY = {
  hotel: 'accommodation',
  transfer: 'transport',
  activity: 'activities',
  service: 'services',
};

const SYSTEM_CATEGORY_NAME_KEY = {
  accommodation: 'budget.cat_accommodation',
  transport: 'budget.cat_transport',
  activities: 'budget.cat_activities',
  services: 'budget.cat_services',
};

const SOURCE_KIND_TO_ENTITY = {
  hotel: 'HotelStay',
  transfer: 'Transfer',
  activity: 'Activity',
  service: 'TripService',
};

// ───────────────────────────────────────────────────────────────────────────
// Title builders — one per source_kind. Kept minimal and defensive.
// ───────────────────────────────────────────────────────────────────────────
function buildTitle(source_kind, src, ctx) {
  if (!src) return '(deleted)';
  if (source_kind === 'hotel')    return src.name || 'Hotel';
  if (source_kind === 'activity') return src.title || 'Activity';
  if (source_kind === 'service')  return src.name || 'Service';
  if (source_kind === 'transfer') {
    const head = src.carrier || src.transport_type || 'Transfer';
    const from = ctx?.fromCity || '';
    const to = ctx?.toCity || '';
    if (from && to) return `${head}: ${from} → ${to}`;
    return head;
  }
  return 'Expense';
}

// Best-effort date extraction (BudgetExpense.spent_on is optional but useful).
function buildSpentOn(source_kind, src) {
  if (!src) return undefined;
  const iso = source_kind === 'hotel'   ? src.check_in_datetime
            : source_kind === 'service' ? (src.details?.start_datetime || src.details?.pickup_datetime)
            : src.start_datetime;
  if (!iso) return undefined;
  try { return new Date(iso).toISOString().slice(0, 10); } catch { return undefined; }
}

// ───────────────────────────────────────────────────────────────────────────
// Lazy system category — creates it if missing. Returns the category row.
// ───────────────────────────────────────────────────────────────────────────
async function ensureSystemCategory(sr, tripId, systemKey) {
  const found = await sr.BudgetCategory.filter({ trip_id: tripId, system_key: systemKey });
  if (found.length > 0) return found[0];
  const orderIndex = ['accommodation', 'transport', 'activities', 'services'].indexOf(systemKey);
  const created = await sr.BudgetCategory.create({
    trip_id: tripId,
    name: SYSTEM_CATEGORY_NAME_KEY[systemKey],
    kind: 'system',
    system_key: systemKey,
    order_index: orderIndex,
  });
  return created;
}

// ───────────────────────────────────────────────────────────────────────────
// HTTP handler
// ───────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole.entities;
    const payload = await req.json().catch(() => ({}));

    // Normalize input shape
    let source_kind, source_id, event_type, dataFromPayload, oldDataFromPayload;
    if (payload?.event?.entity_name && payload?.event?.entity_id) {
      const ek = ENTITY_TO_SOURCE_KIND[payload.event.entity_name];
      if (!ek) {
        return Response.json({ error: `Unsupported entity: ${payload.event.entity_name}` }, { status: 400 });
      }
      source_kind = ek;
      source_id = payload.event.entity_id;
      event_type = payload.event.type;
      dataFromPayload = payload.data || null;
      oldDataFromPayload = payload.old_data || null;
    } else if (payload?.source_kind && payload?.source_id && payload?.event_type) {
      source_kind = payload.source_kind;
      source_id = payload.source_id;
      event_type = payload.event_type;
    } else {
      return Response.json({ error: 'Invalid payload' }, { status: 400 });
    }

    // ── DELETE ─────────────────────────────────────────────────────────────
    if (event_type === 'delete') {
      const existing = await sr.BudgetExpense.filter({ source_kind, source_id });
      await Promise.all(existing.map(e => sr.BudgetExpense.delete(e.id)));
      return Response.json({ ok: true, action: 'delete', removed: existing.length });
    }

    // ── CREATE / UPDATE ────────────────────────────────────────────────────
    // Fetch the source entity (use payload.data if available, otherwise fetch).
    let src = dataFromPayload;
    if (!src || payload?.payload_too_large) {
      const entityName = SOURCE_KIND_TO_ENTITY[source_kind];
      src = await sr[entityName].get(source_id);
    }
    if (!src) {
      // Source vanished — treat as delete for safety.
      const existing = await sr.BudgetExpense.filter({ source_kind, source_id });
      await Promise.all(existing.map(e => sr.BudgetExpense.delete(e.id)));
      return Response.json({ ok: true, action: 'delete_orphan', removed: existing.length });
    }

    // Resolve trip_id (Activity stores it denormalized; for hotels we may need
    // to read CityVisit. We rely on the denormalized field where present.)
    let tripId = src.trip_id;
    if (!tripId && source_kind === 'hotel' && src.city_visit_id) {
      const cv = await sr.CityVisit.get(src.city_visit_id);
      tripId = cv?.trip_id;
    }
    if (!tripId && source_kind === 'activity' && src.city_visit_id) {
      const cv = await sr.CityVisit.get(src.city_visit_id);
      tripId = cv?.trip_id;
    }
    if (!tripId) {
      return Response.json({ error: 'Could not resolve trip_id for source' }, { status: 400 });
    }

    // For transfer title we need city names
    let titleCtx = null;
    if (source_kind === 'transfer') {
      const [fromCv, toCv] = await Promise.all([
        src.from_city_visit_id ? sr.CityVisit.get(src.from_city_visit_id).catch(() => null) : null,
        src.to_city_visit_id   ? sr.CityVisit.get(src.to_city_visit_id).catch(() => null)   : null,
      ]);
      titleCtx = { fromCity: fromCv?.city_name, toCity: toCv?.city_name };
    }

    const systemKey = SOURCE_KIND_TO_SYSTEM_KEY[source_kind];
    const category = await ensureSystemCategory(sr, tripId, systemKey);

    const expensePayload = {
      trip_id: tripId,
      category_id: category.id,
      title: buildTitle(source_kind, src, titleCtx),
      original_amount: Number(src.price) || 0,
      original_currency: src.currency || 'EUR',
      source_kind,
      source_id,
    };
    const spentOn = buildSpentOn(source_kind, src);
    if (spentOn) expensePayload.spent_on = spentOn;

    const existing = await sr.BudgetExpense.filter({ source_kind, source_id });
    if (existing.length > 0) {
      // Update the first; drop any accidental duplicates.
      const [keep, ...dupes] = existing;
      await Promise.all(dupes.map(d => sr.BudgetExpense.delete(d.id)));
      const updated = await sr.BudgetExpense.update(keep.id, expensePayload);
      return Response.json({ ok: true, action: 'update', id: updated.id });
    } else {
      const created = await sr.BudgetExpense.create(expensePayload);
      return Response.json({ ok: true, action: 'create', id: created.id });
    }
  } catch (error) {
    console.error('syncTripExpense error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});