/**
 * Centralized budget constants.
 *
 * SYSTEM_KEYS — fixed enum of system categories. Each trip gets exactly one
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
 * trips). Each is stored as a plain BudgetCategory with kind='custom' — the
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