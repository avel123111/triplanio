/**
 * Centralized budget constants.
 */

/**
 * system_key → translation key. Covers BOTH the four system categories and the
 * four seeded custom ones (Food / Shopping / Souvenirs / Other): ensure_trip_budget
 * cannot know the creator's language, so it writes a stable key and an English
 * `name` as a bare fallback, and the label is resolved HERE (TRIP-230).
 *
 * A category the user renamed has its system_key cleared, so it stops being
 * translated and shows their text — that is the line between "ours" and "theirs".
 */
export const CATEGORY_NAME_KEY = {
  accommodation: 'budget.cat_accommodation',
  transport: 'budget.cat_transport',
  activities: 'budget.cat_activities',
  services: 'budget.cat_services',
  food: 'budget.cat_food',
  shopping: 'budget.cat_shopping',
  souvenirs: 'budget.cat_souvenirs',
  other: 'budget.cat_other',
};

// The four kind='system' categories, in display order. Every trip gets exactly
// one category per key; everything else is custom and sorts after them.
export const SYSTEM_KEY_ORDER = ['accommodation', 'transport', 'activities', 'services'];

// Localized display name for a category row (seeded → t(key); renamed / hand-made → name).
export function categoryDisplayName(cat, t) {
  return CATEGORY_NAME_KEY[cat.system_key] ? t(CATEGORY_NAME_KEY[cat.system_key]) : cat.name;
}

// Canonical order: system categories first (fixed order), then custom by order_index.
export function sortBudgetCategories(list = []) {
  const rank = (cat) => {
    const i = SYSTEM_KEY_ORDER.indexOf(cat.system_key);
    return i === -1 ? SYSTEM_KEY_ORDER.length + (cat.order_index ?? 99) : i;
  };
  return [...list].sort((a, b) => rank(a) - rank(b));
}

// Single source for "the trip's categories, ready to render": { ...cat, displayName }
// in canonical order. BudgetLens layers spend/items on top of this list.
export function budgetCategoryOptions(list, t) {
  return sortBudgetCategories(list).map((cat) => ({ ...cat, displayName: categoryDisplayName(cat, t) }));
}