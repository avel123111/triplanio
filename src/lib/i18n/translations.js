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

// Имя query-параметра, которым рекламная ссылка форсит язык кампании. Один
// источник, чтобы читатель (detectLandingLang) и чистильщик адреса
// (clearLangParam) называли его одинаково.
const LANG_PARAM = 'lang';

/**
 * Язык из адреса (`?lang=es`) — верхний источник для рекламных ссылок: sitelinks
 * ES/EN-кампаний (TRIP-511/TRIP-487) обязаны приземлять на своём языке, иначе
 * посетитель с чужим браузером/сохранённым выбором увидит не тот язык.
 * Валидируется против списка языков; неизвестное значение → null (мусор в адресе
 * не переключает язык). @returns {'ru'|'en'|'es'|null}
 */
function langFromUrl() {
  try {
    const v = new URLSearchParams(window.location.search).get(LANG_PARAM);
    return v && LANG_CODES.includes(v) ? v : null;
  } catch { return null; }
}

/**
 * The language of the LANDING — url `?lang=`, else stored choice, else browser,
 * else 'en'. Used at signup (the client is authoritative for the landing
 * language, TRIP-411) and as the anonymous initial locale in the facade. Does
 * NOT read a signed-in user's saved language — that override lives in the
 * facade's detectInitialLang.
 * @returns {'ru'|'en'|'es'}
 */
export function detectLandingLang() {
  // Рекламная ссылка ПОБЕЖДАЕТ сохранённый выбор и ЗАПОМИНАЕТСЯ: клик по
  // ES-объявлению оставляет сайт на ES и после ухода параметра из адреса
  // (решение Pavel, TRIP-511). Персист здесь, а не в UI: тем же значением
  // пользуется язык регистрации в AuthContext, а параметр к тому времени уже
  // стёрт из адреса (clearLangParam).
  const urlLang = langFromUrl();
  if (urlLang) {
    try { localStorage.setItem(LANG_STORAGE_KEY, urlLang); } catch { /* ignore */ }
    return urlLang;
  }
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (stored && LANG_CODES.includes(stored)) return stored;
  } catch { /* SSR / privacy mode: fall through to browser */ }
  const browser = (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2);
  return LANG_CODES.includes(browser) ? browser : 'en';
}

/**
 * Стереть `?lang=` из адреса после того, как язык применён и сохранён. Зачем:
 * иначе ручное переключение языка + перезагрузка молча откатывались бы —
 * detectLandingLang перечитал бы `?lang=` из адреса и снова победил. Путь и хеш
 * (`#together`) сохраняются, поэтому якорный скролл не затрагивается.
 * `history.state` переносим как есть — в нём состояние react-router, и терять
 * его нельзя.
 */
export function clearLangParam() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(LANG_PARAM)) return;
    url.searchParams.delete(LANG_PARAM);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  } catch { /* ignore */ }
}