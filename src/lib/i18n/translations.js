// i18n static config — language list + IETF locale tags. PURE config, no
// dictionary import, so non-Vite consumers (formatters, tests) can import it
// without pulling the JSON glob. The dictionaries live in ./dictionary.js
// (Vite-only) and are consumed solely by I18nContext.
// Use t('namespace.key') in components; add strings in
// lib/i18n/locales/{lang}/{namespace}.json (BARE keys, namespace = file stem).

export const LANGUAGES = [
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
];

// IETF locale tags used by Intl.* APIs and Luxon
export const LOCALE_TAG = { ru: 'ru-RU', en: 'en-US', es: 'es-ES' };

export function localeTag(lang) {
  return LOCALE_TAG[lang] || LOCALE_TAG.en;
}

// The localStorage key the app persists the chosen UI language under. ONE source
// so the i18n facade (initial anonymous locale) and AuthContext (the language
// sent to account/register at signup, TRIP-411) read the SAME value.
export const LANG_STORAGE_KEY = 'travel-planner-lang';

const LANG_CODES = LANGUAGES.map((l) => l.code);

/**
 * The language of the LANDING — stored choice, else browser, else 'en'. Used at
 * signup (the client is authoritative for the landing language, TRIP-411) and as
 * the anonymous initial locale in the facade. Does NOT read a signed-in user's
 * saved language — that override lives in the facade's detectInitialLang.
 * @returns {'ru'|'en'|'es'}
 */
export function detectLandingLang() {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (stored && LANG_CODES.includes(stored)) return stored;
  } catch { /* SSR / privacy mode: fall through to browser */ }
  const browser = (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2);
  return LANG_CODES.includes(browser) ? browser : 'en';
}