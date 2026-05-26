// Translation dictionaries — thin index over modular per-section files.
// Use t('key') in components. Add new strings in lib/i18n/locales/{lang}/{section}.js

import ru from './locales/ru';
import en from './locales/en';
import es from './locales/es';

export const TRANSLATIONS = { ru, en, es };

export const LANGUAGES = [
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
];

// IETF locale tags used by Intl.* APIs and Luxon
export const LOCALE_TAG = { ru: 'ru-RU', en: 'en-US', es: 'es-ES' };

export function localeTag(lang) {
  return LOCALE_TAG[lang] || LOCALE_TAG.en;
}