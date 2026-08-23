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

// Сырой мешок аддонов → полный булев набор. Вынесено из `getAddons`, потому что
// источников этого факта ДВА: полный трип (`trip.details.addons`, дверь трипа) и
// карточка главной (`card.addons`, композит getTrips). Нормализация обязана быть
// ОДНА — иначе «включено» считалось бы по-разному в зависимости от того, откуда
// приехали данные, и меню на первом кадре отличалось бы от меню на втором.
// Предикат тот же, что был: аддон включён ТОЛЬКО при строгом `true` (1/'true'/
// 'on' не считаются — гейт белый).
export function normalizeAddons(raw) {
  const bag = raw || {};
  return {
    [ADDON_KEYS.BUDGET]: bag[ADDON_KEYS.BUDGET] === true,
    [ADDON_KEYS.HOTELS_SELECTION]: bag[ADDON_KEYS.HOTELS_SELECTION] === true,
    [ADDON_KEYS.TELEGRAM_ASSISTANT]: bag[ADDON_KEYS.TELEGRAM_ASSISTANT] === true,
    [ADDON_KEYS.CHAT]: bag[ADDON_KEYS.CHAT] === true,
  };
}

export function getAddons(trip) {
  return normalizeAddons(trip?.details?.addons);
}

export function isAddonEnabled(trip, key) {
  return !!getAddons(trip)[key];
}

export function isProAddon(key) {
  return PRO_ONLY_ADDONS.has(key);
}