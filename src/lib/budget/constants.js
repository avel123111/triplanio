/**
 * Centralized budget constants.
 *
 * SYSTEM_KEYS - fixed enum of system categories. Each trip gets exactly one
 * BudgetCategory per key (kind='system', system_key=<one of these>). Their
 * `name` field stores a translation key (e.g. 'budget.cat_accommodation') that
 * the UI renders via i18n.
 */

export const SYSTEM_KEYS = ['accommodation', 'transport', 'activities', 'services'];

export const SYSTEM_CATEGORY_NAME_KEY = {
  accommodation: 'budget.cat_accommodation',
  transport: 'budget.cat_transport',
  activities: 'budget.cat_activities',
  services: 'budget.cat_services',
};

// Map source_kind (BudgetExpense.source_kind) → system_key (BudgetCategory.system_key).
export const SOURCE_KIND_TO_SYSTEM_KEY = {
  hotel: 'accommodation',
  transfer: 'transport',
  activity: 'activities',
  service: 'services',
};

// Display order for the budget page (system block first, then custom).
export const SYSTEM_KEY_ORDER = ['accommodation', 'transport', 'activities', 'services'];

/**
 * Default custom categories seeded on every new trip (and backfilled for old
 * trips). Each is stored as a plain BudgetCategory with kind='custom' - the
 * user can rename or delete them freely. The `i18n_key` is used ONLY during
 * seeding to pick the localized name for the trip creator's language; after
 * seeding, the `name` field holds plain text.
 */
export const DEFAULT_CUSTOM_CATEGORIES = [
  { key: 'food',      i18n_key: 'budget.cat_food' },
  { key: 'shopping',  i18n_key: 'budget.cat_shopping' },
  { key: 'souvenirs', i18n_key: 'budget.cat_souvenirs' },
  { key: 'other',     i18n_key: 'budget.cat_other' },
];

// Localized display name for a category row (system → t(key); custom → name).
export function categoryDisplayName(cat, t) {
  return SYSTEM_CATEGORY_NAME_KEY[cat.system_key] ? t(SYSTEM_CATEGORY_NAME_KEY[cat.system_key]) : cat.name;
}

// Canonical order: system categories first (fixed order), then custom by order_index.
export function sortBudgetCategories(list = []) {
  const rank = (cat) => {
    const i = SYSTEM_KEY_ORDER.indexOf(cat.system_key);
    return i === -1 ? SYSTEM_KEY_ORDER.length + (cat.order_index ?? 99) : i;
  };
  return [...list].sort((a, b) => rank(a) - rank(b));
}

// Light option list for category pickers: { ...cat, displayName }, canonical order.
// NOTE: BudgetLens still builds its own enriched `cats` (with spent/items) inline
// and duplicates this name/order logic — consolidate it onto these helpers later.
export function budgetCategoryOptions(list, t) {
  return sortBudgetCategories(list).map((cat) => ({ ...cat, displayName: categoryDisplayName(cat, t) }));
}