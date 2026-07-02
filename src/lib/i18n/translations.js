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