// i18n static config — language list + IETF locale tags. PURE config, no
// dictionary import, so non-Vite consumers (formatters, tests) can import it
// without pulling the JSON glob. The dictionaries live in ./dictionary.js
// (Vite-only) and are consumed solely by I18nContext.
// Use t('namespace.key') in components; add strings in
// lib/i18n/locales/{lang}/{namespace}.json (BARE keys, namespace = file stem).

// Локаль маршрута живёт в `routePaths.js` — там же, где список переведённых
// страниц. Импорт односторонний: `routePaths.js` о языках НЕ знает (там литерал
// под тестом), ровно чтобы он не замкнулся в цикл.
import { localeOf } from '../routePaths.js';

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
function langFromUrl(search) {
  try {
    const q = search ?? (typeof window !== 'undefined' ? window.location.search : '');
    const v = new URLSearchParams(q).get(LANG_PARAM);
    return v && LANG_CODES.includes(v) ? v : null;
  } catch { return null; }
}

/**
 * ЗАПОМНИТЬ ЯЗЫК ПОСЕТИТЕЛЯ НА УСТРОЙСТВЕ. Писателей два, и оба законные: явный
 * выбор в переключателе и приезд по языковому адресу (`/ru` — такое же прямое
 * утверждение о языке, как клик по переключателю, и оно обязано доехать до
 * входа, у которого своего языкового адреса нет).
 *
 * Беспрефиксный адрес сюда НЕ приходит: `/` английский по построению файла, а не
 * по выбору человека, и запись его в хранилище стёрла бы настоящий выбор.
 *
 * @template {string} L
 * @param {L} lang
 * @returns {L} он же, для сцепления
 */
export function rememberLang(lang) {
  try { localStorage.setItem(LANG_STORAGE_KEY, lang); } catch { /* приватный режим */ }
  return lang;
}

/**
 * ★★ ЯЗЫК СТРАНИЦЫ = ТРИ СЛОЯ, И КАЖДЫЙ ОТВЕЧАЕТ ЗА СВОЁ (TRIP-520).
 *
 *     язык = локаль маршрута  ??  язык профиля  ??  язык посетителя
 *
 * Слои разные ПО ОБЛАСТИ ДЕЙСТВИЯ, а не по приоритету «на всякий случай»:
 *
 *   1. ЛОКАЛЬ МАРШРУТА (`localeOf`, `routePaths.js`) — действует РОВНО на тех
 *      страницах, у которых есть отдельный адрес на каждый язык: лендинг и демо.
 *      Там адрес — это обещание («по `/ru` лежит русский файл»), и нарушить его
 *      нельзя: поделиться ссылкой станет невозможно.
 *   2. ЯЗЫК ПРОФИЛЯ — везде, где адрес обещания не давал: экраны приложения,
 *      вход, приглашение, юр-документы.
 *   3. ЯЗЫК ПОСЕТИТЕЛЯ (эта функция) — когда профиля нет: явный выбор из адреса
 *      рекламной кампании, потом сохранённый выбор, потом язык браузера.
 *
 * ЧТО СЛОМАЛА ПЛОСКАЯ ЛЕСТНИЦА. В первой редакции адрес спрашивался ПЕРВЫМ и
 * отвечал «английский» на любом беспрефиксном испечённом адресе — включая `/`.
 * Вошедший с русским профилем открывал `triplanio.com`, получал английский
 * лендинг (это верно и задумано) и уходил в приложение — а язык оставался
 * английским НАВСЕГДА: возвращать его к профилю было некому. Слой, который
 * действует только на своих страницах, чинит это по построению: ушёл с адреса —
 * перестал действовать.
 *
 * Здесь — только третий слой. Первые два складывает `I18nContext`.
 *
 * @param {string} [search] строка запроса; по умолчанию текущая
 * @returns {'ru'|'en'|'es'}
 */
export function visitorLang(search) {
  // 1. Рекламная ссылка ПОБЕЖДАЕТ сохранённый выбор и ЗАПОМИНАЕТСЯ: клик по
  //    ES-объявлению оставляет сайт на ES и после ухода параметра из адреса
  //    (решение Pavel, TRIP-511). Персист здесь, а не в UI: тем же значением
  //    пользуется язык регистрации, а параметр к тому времени уже стёрт.
  const urlLang = langFromUrl(search);
  if (urlLang) return rememberLang(urlLang);
  // 2. Сохранённый выбор.
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (stored && LANG_CODES.includes(stored)) return stored;
  } catch { /* приватный режим — падаем на браузер */ }
  // 3. Язык браузера.
  const browser = (typeof navigator !== 'undefined' ? navigator.language : FALLBACK_LANG).slice(0, 2);
  return LANG_CODES.includes(browser) ? browser : FALLBACK_LANG;
}

/**
 * Язык ПЕРВОГО КАДРА: локаль маршрута, иначе язык посетителя.
 *
 * Профиля на этот момент ещё нет ни у кого — сессия приезжает позже. Функция
 * одна на двоих намеренно: её зовёт и прогрев словаря до монтирования
 * (`main.jsx`), и начальное состояние провайдера. Разойдись они, первый кадр
 * рисовался бы одним языком, а словарь грелся бы под другой — то есть ожиданием.
 *
 * @param {string} [pathname] адрес; по умолчанию текущий
 * @returns {'ru'|'en'|'es'}
 */
export function initialLang(pathname) {
  const path = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  return localeOf(path) ?? visitorLang();
}

/**
 * ЯЗЫК, КОТОРЫЙ СЕЙЧАС НА ЭКРАНЕ. Один писатель — `I18nContext` (он этот язык и
 * складывает из трёх слоёв), читатели — код ВНЕ дерева React, которому нужен тот
 * же ответ: язык регистрации в `AuthContext` (TRIP-411).
 *
 * Раньше `AuthContext` считал язык ЗАНОВО своей копией лестницы. Пока лестница
 * была одна на всех, копия совпадала; со слоем маршрута — уже нет, и регистрация
 * уехала бы с языком, которого человек на экране не видел.
 */
let current = null;
/** @param {string} lang */
export function publishLang(lang) { current = lang; }
/** @returns {'ru'|'en'|'es'} */
export function currentLang() { return current ?? initialLang(); }

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