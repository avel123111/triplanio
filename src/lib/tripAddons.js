// @ts-check
// Trip-level addons toggle.
// Addons are stored on Trip.details.addons as { budget, hotels_selection, telegram_assistant, chat }.
// All addons default to OFF for both new and existing trips.
// (Calendar is NOT an addon — it's a default always-visible lens, like overview/timeline/map/docs.)

export const ADDON_KEYS = {
  BUDGET: 'budget',
  HOTELS_SELECTION: 'hotels_selection',
  TELEGRAM_ASSISTANT: 'telegram_assistant',
  CHAT: 'chat',
};

// Which addons require Pro (trip-level or owner subscription).
export const PRO_ONLY_ADDONS = new Set([ADDON_KEYS.BUDGET, ADDON_KEYS.TELEGRAM_ASSISTANT, ADDON_KEYS.CHAT]);

export function getAddons(trip) {
  const raw = trip?.details?.addons || {};
  return {
    [ADDON_KEYS.BUDGET]: !!raw[ADDON_KEYS.BUDGET],
    [ADDON_KEYS.HOTELS_SELECTION]: !!raw[ADDON_KEYS.HOTELS_SELECTION],
    [ADDON_KEYS.TELEGRAM_ASSISTANT]: !!raw[ADDON_KEYS.TELEGRAM_ASSISTANT],
    [ADDON_KEYS.CHAT]: !!raw[ADDON_KEYS.CHAT],
  };
}

export function isAddonEnabled(trip, key) {
  return !!getAddons(trip)[key];
}

export function isProAddon(key) {
  return PRO_ONLY_ADDONS.has(key);
}