// Trip-level addons toggle.
// Addons are stored on Trip.details.addons as { calendar_view, budget, hotels_selection, telegram_assistant }.
// All addons default to OFF for both new and existing trips.
// System admins always see calendar & budget regardless of the toggle (debug view).

export const ADDON_KEYS = {
  CALENDAR_VIEW: 'calendar_view',
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
    [ADDON_KEYS.CALENDAR_VIEW]: !!raw[ADDON_KEYS.CALENDAR_VIEW],
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