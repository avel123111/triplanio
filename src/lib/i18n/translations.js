// i18n static config — language list + IETF locale tags. PURE config, no
// dictionary import, so non-Vite consumers (formatters, tests) can import it
// without pulling the JSON glob. The dictionaries live in ./dictionary.js
// (Vite-only) and are consumed solely by I18nContext.
// Use t('namespace.key') in components; add strings in
// lib/i18n/locales/{lang}/{namespace}.json (BARE keys, namespace = file stem).

// Адреса знают про язык (английский без префикса, остальные с ним), поэтому
// «какой язык у этой страницы» начинается с разбора пути. Импорт односторонний:
// `routePaths.js` о языках НЕ знает — там литерал под тестом, ровно чтобы этот
// импорт не замкнулся в цикл.
import { PRERENDERED_PAGES, splitLangPath } from '../routePaths.js';

export const LANGUAGES = [
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
];

/**
 * Язык, на который падает всё: и словарь при отсутствующем ключе, и страница,
 * адрес которой языка не называет. ОДИН источник — раньше та же строка лежала
 * локальной константой в `I18nContext`, и «английский по умолчанию» существовал
 * в двух местах, которые никто не сверял.
 */
export const FALLBACK_LANG = 'en';

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
export const LANG_PARAM = 'lang';

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

/** Запомнить язык на устройстве. Один писатель на оба источника из адреса. */
function rememberLang(lang) {
  try { localStorage.setItem(LANG_STORAGE_KEY, lang); } catch { /* приватный режим */ }
  return lang;
}

/**
 * ★★ ЯЗЫК, КОТОРЫЙ НАЗЫВАЕТ САМ АДРЕС, — ИЛИ `null`, ЕСЛИ АДРЕС ПРО ЯЗЫК МОЛЧИТ.
 *
 * Это НЕСУЩИЙ предикат всей адресной модели, и он отделён от `detectLandingLang`
 * НАМЕРЕННО: «что сказал адрес» и «что мы знаем о посетителе» — разные вопросы,
 * и второй имеет право отвечать только тогда, когда первый промолчал.
 *
 * ЧТО СЛОМАЛОСЬ БЕЗ НЕГО (прод-баг, замечен Pavel). Язык вошедшего берётся из
 * профиля, и `I18nContext` переутверждал его КАЖДЫЙ РАЗ, когда приезжала
 * сессия, — через секунду после загрузки. До адресной модели спорить было не с
 * чем. С ней получилось так: открываешь `/ru`, испечённый русский файл рисуется,
 * приходит сессия с профилем `es` — и экран молча становится испанским под
 * русским адресом. Адрес, файл, `<html lang>`, canonical и hreflang говорят
 * «русский», содержимое — «испанский».
 *
 * Поэтому правило одно и короткое: **префикс — это прямое утверждение о языке, и
 * оно сильнее всего остального**; голый адрес испечённой страницы — утверждение
 * «английский» (под ним лежит английский файл). Там, где ни того ни другого
 * (вход, приглашение, публичная поездка, экраны приложения), адрес молчит —
 * и решает профиль, потом хранилище, потом браузер.
 *
 * @param {string} [pathname] адрес; по умолчанию текущий
 * @returns {'ru'|'en'|'es'|null}
 */
export function langFromAddress(pathname) {
  const path = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  const { lang: fromPath, path: bare } = splitLangPath(path);
  if (fromPath) return fromPath;
  if (PRERENDERED_PAGES.includes(bare)) return FALLBACK_LANG;
  return null;
}

/**
 * Язык страницы. Пять ступеней, и порядок у них НЕ «от удобного к запасному», а
 * «от того, что названо в адресе, к тому, что известно о посетителе» (TRIP-520).
 *
 * ★ ГЛАВНОЕ: У ИСПЕЧЁННОЙ СТРАНИЦЫ ЯЗЫК РЕШАЕТ АДРЕС, И ТОЛЬКО ОН.
 * Четыре публичные страницы отдаются готовыми файлами, по файлу на язык, и файл
 * выбирается адресом. Останься здесь прежняя ступень «язык браузера» — русский
 * посетитель получил бы английский файл (адрес-то бесперфиксный), а через
 * полторы секунды приложение перерисовало бы его по-русски. Это не «мелкое
 * мигание»: это смена ВСЕГО текста на экране после того, как человек начал
 * читать. Поэтому на бесперфиксном адресе испечённой страницы ответ — английский
 * безусловно, как и на самом файле, который туда приехал.
 *
 * Цена решения названа честно: русский посетитель, открывший голый
 * `triplanio.com`, видит английский лендинг, а раньше видел русский. Взамен
 * у русской версии появляется СВОЙ адрес — она наконец существует для поиска, а
 * не только для того, у кого нужный браузер. Так же устроен Wanderlog (замер
 * 06.09.2026: их корень отдаёт английский на любой `Accept-Language`).
 *
 * Ступени 3–5 остаются нетронутыми и обслуживают всё остальное — вход,
 * приглашение, публичную поездку: у этих страниц готового файла нет и быть не
 * может (содержимое зависит от того, кто открыл), поэтому язык там по-прежнему
 * решает посетитель.
 *
 * Используется при регистрации (клиент — источник правды о языке лендинга,
 * TRIP-411) и как начальная локаль анонима. Язык ВОШЕДШЕГО сюда не приезжает:
 * профиль спрашивается в `detectInitialLang` — но ТОЛЬКО там, где адрес про язык
 * молчит (`langFromAddress` выше). Обратный порядок стоил прод-бага: испанский
 * профиль перекрывал русский адрес.
 *
 * @param {string} [pathname] адрес; по умолчанию текущий
 * @returns {'ru'|'en'|'es'}
 */
export function detectLandingLang(pathname) {
  const path = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  const { lang: fromPath } = splitLangPath(path);
  // 1–2. Адрес назвал язык. Префикс ещё и ЗАПОМИНАЕТСЯ — чтобы он доехал до
  //    входа и регистрации, у которых своего адреса на язык нет. Голый адрес
  //    испечённой страницы значит «английский» и не запоминается: это свойство
  //    страницы, а не выбор человека, и запись его в хранилище стёрла бы
  //    настоящий выбор посетителя при первом же заходе на `/`.
  const fromAddress = langFromAddress(path);
  if (fromAddress) return fromPath ? rememberLang(fromPath) : fromAddress;
  // 3. Рекламная ссылка ПОБЕЖДАЕТ сохранённый выбор и ЗАПОМИНАЕТСЯ: клик по
  //    ES-объявлению оставляет сайт на ES и после ухода параметра из адреса
  //    (решение Pavel, TRIP-511). На испечённых страницах этой ступени не
  //    достаётся — туда `?lang=` не доезжает: край переводит такую ссылку на
  //    языковой адрес (`middleware.js`), то есть на ступень 1.
  const urlLang = langFromUrl();
  if (urlLang) return rememberLang(urlLang);
  // 4–5. Про адрес больше ничего не известно — спрашиваем посетителя.
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (stored && LANG_CODES.includes(stored)) return stored;
  } catch { /* SSR / privacy mode: fall through to browser */ }
  const browser = (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2);
  return LANG_CODES.includes(browser) ? browser : FALLBACK_LANG;
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