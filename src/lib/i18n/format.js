// Localization formatters for dynamic data: countries, currencies, plurals,
// Luxon dates. Lightweight wrappers around Intl.* + Luxon - call from React via
// useI18nFormat() (see I18nContext).
import { localeTag } from './translations';
import { dayMonth } from './dayMonth';

// ---- Active language (module-level) ---------------------------------------
// Mirror of the current UI language so module-level helpers (formatters defined
// outside React, e.g. design/index.jsx `fmt`) can be locale-aware without a hook.
// Kept in sync by I18nProvider via applyLuxonLocale() on every language change.
let _activeLang = 'ru';
export function getActiveLang() { return _activeLang; }
export function getActiveLocale() { return localeTag(_activeLang); }

// ---- Активный язык + глобальная локаль Luxon --------------------------------
// Зовётся из I18nProvider на смену языка. Делает две вещи, и вторая — ЛЕНИВО.
//
// ★ ПОЧЕМУ `import()`, А НЕ СТАТИЧЕСКИЙ ИМПОРТ (TRIP-475 шаг 3). Этот модуль —
// часть СИНХРОННОГО графа лендинга (`main.jsx → App.jsx → I18nContext →`
// сюда), поэтому статический `import { Settings } from 'luxon'` затаскивал
// luxon (24 КБ на проводе) в главный чанк и в `modulepreload` — то есть его
// качал анонимный посетитель, которому дат не показывают вовсе. Сам luxon в
// проекте живой и нужный: на нём арифметика дат редактора, календаря и
// валидации, — но все они приезжают ленивыми чанками.
//
// ⚠️ `Settings.defaultLocale` — ГЛОБАЛ, и на него молча опираются четыре модуля,
// которые форматируют БЕЗ явного `setLocale`: `EventViewBody` (`fmtDT`/`fmtDate`),
// `trip-dates.js`, `time.js`, `naive-time.js` (ветка без локали). Убрать глобал
// правильно — значит проставить локаль явно в каждом из них (её отдаёт
// `getActiveLocale()` ниже, мирроринг для этого и заведён); это отдельная работа,
// она меняет отрисовку дат на экранах трипа и в перф-правку не входит. Пока
// глобал остаётся, но применяется, когда luxon доехал.
//
// Гонки нет по построению: все четыре читателя живут в ленивых чанках экранов
// приложения, а `import('luxon')` стартует на смене языка — то есть на монтаже
// провайдера, задолго до того, как эти чанки будут запрошены.
export function applyLuxonLocale(lang) {
  _activeLang = lang;
  import('luxon')
    .then(({ Settings }) => { Settings.defaultLocale = localeTag(lang); })
    .catch(() => { /* язык дат — не повод ронять приложение */ });
}

// Canonical money/date formatters for module-level (non-hook) call sites.
// Components should prefer useI18nFormat(); these read the active language.
export function fmtMoneyActive(amount, currency, opts) { return formatMoney(amount, currency, _activeLang, opts); }

// «День + короткий месяц» — 5 авг. · 5 Aug · 5 ago (TRIP-475 шаг 3).
//
// Раньше это была общая `formatDateTime(value, tz, fmt, lang)` на luxon-токенах.
// Токен у неё был РОВНО ОДИН на весь репозиторий — `'d MMM'`, у двух вызывающих
// (`PublicTrip`, `RouteMapCard`); обобщение не использовал никто. Поэтому функция
// сузилась до своего единственного смысла и переехала на нативный `Intl` — и
// luxon ушёл из синхронного графа лендинга.
//
// Тело — в `./dayMonth.js` (без импортов, чтобы его брал `node --test`); здесь
// остаётся перевод языка в locale-тег. Ловушки порядка слов и даты без времени
// описаны там же.
export function formatDayMonth(value, timezone, lang) {
  return dayMonth(value, timezone, localeTag(lang));
}

// ---- Countries ------------------------------------------------------------
// Localized country name from ISO-2 code via Intl.DisplayNames (built-in, no dep).
const countryCache = new Map();
function getCountryFmt(lang) {
  const key = lang || 'en';
  if (countryCache.has(key)) return countryCache.get(key);
  try {
    const f = new Intl.DisplayNames([localeTag(key)], { type: 'region' });
    countryCache.set(key, f);
    return f;
  } catch {
    return null;
  }
}
export function localizeCountry(code, lang, fallback = '') {
  if (!code) return fallback;
  const cc = String(code).toUpperCase();
  const f = getCountryFmt(lang);
  if (!f) return fallback || cc;
  try { return f.of(cc) || fallback || cc; } catch { return fallback || cc; }
}

// ---- Currencies -----------------------------------------------------------
// Localized currency name; also a smart amount formatter.
const currencyNameCache = new Map();
function getCurrencyNameFmt(lang) {
  const key = lang || 'en';
  if (currencyNameCache.has(key)) return currencyNameCache.get(key);
  try {
    const f = new Intl.DisplayNames([localeTag(key)], { type: 'currency' });
    currencyNameCache.set(key, f);
    return f;
  } catch {
    return null;
  }
}
export function localizeCurrencyName(code, lang) {
  if (!code) return '';
  const cc = String(code).toUpperCase();
  const f = getCurrencyNameFmt(lang);
  if (!f) return cc;
  try { return f.of(cc) || cc; } catch { return cc; }
}

// Format a money amount in a specific currency, using the active locale's
// number formatting rules and the currency's symbol/grouping.
// opts.compact (default false) switches to locale-aware compact notation
// (252 400 → "252K" / "252 тыс.", 1 490 512 → "1,5M" / "1,5 млн") for tight
// surfaces like map badges. Reusable across screens — pass { compact: true }.
export function formatMoney(amount, currency, lang, opts = {}) {
  if (amount == null || isNaN(amount)) return '';
  const cc = String(currency || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat(localeTag(lang), {
      style: 'currency',
      currency: cc,
      ...(opts.compact
        ? { notation: 'compact', maximumFractionDigits: opts.maxFraction ?? 1 }
        : { maximumFractionDigits: opts.maxFraction ?? 2, minimumFractionDigits: opts.minFraction ?? 0 }),
    }).format(amount);
  } catch {
    return `${amount} ${cc}`;
  }
}

// ---- Relative time --------------------------------------------------------
// "5 минут назад" / "hace 2 días". Built on Intl.RelativeTimeFormat (built-in,
// no dep) — the same tier as Intl.DisplayNames/NumberFormat above, and the
// reason `date-fns` is no longer a dependency.
//
// Largest-fitting unit, rounded to nearest (30-day months, 365-day years), with
// a carry so a rounded value never reaches the next unit's size: 3575s reads
// "1 hour ago", not "60 minutes ago"; 350 days reads "1 year ago".
const RELATIVE_UNITS = [
  ['year', 31536000], ['month', 2592000], ['day', 86400],
  ['hour', 3600], ['minute', 60], ['second', 1],
];
const relativeCache = new Map();
function getRelativeFmt(lang) {
  const key = lang || _activeLang;
  if (relativeCache.has(key)) return relativeCache.get(key);
  try {
    const f = new Intl.RelativeTimeFormat(localeTag(key), { numeric: 'always' });
    relativeCache.set(key, f);
    return f;
  } catch {
    return null;
  }
}

export function formatRelativeTime(value, lang, now = Date.now()) {
  if (!value) return '';
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (isNaN(ms)) return '';
  const f = getRelativeFmt(lang);
  if (!f) return '';

  const seconds = (now - ms) / 1000;
  const abs = Math.abs(seconds);
  // Largest unit that fits; under a second there is none, so fall back to 'second'.
  let i = RELATIVE_UNITS.findIndex(([, size]) => abs >= size);
  if (i < 0) i = RELATIVE_UNITS.length - 1;
  let count = Math.round(abs / RELATIVE_UNITS[i][1]);
  // Rounding can land on the next unit's size (3575s → "60 minutes"), so carry once.
  // A carry always leaves count at 1, so it can never cascade twice.
  if (i > 0 && count >= Math.round(RELATIVE_UNITS[i - 1][1] / RELATIVE_UNITS[i][1])) {
    i -= 1;
    count = Math.round(abs / RELATIVE_UNITS[i][1]);
  }
  return f.format(seconds >= 0 ? -count : count, RELATIVE_UNITS[i][0]);
}

// ---- Plurals --------------------------------------------------------------
// Returns one of three forms based on count and language.
// Use 'one' for singular, 'few' for "2-4 / paucal", 'many' for plural-many.
// EN/ES collapse 'few' and 'many' onto the same form.
export function pluralCategory(count, lang) {
  try {
    const cat = new Intl.PluralRules(localeTag(lang)).select(Math.abs(Number(count) || 0));
    if (cat === 'one') return 'one';
    if (cat === 'few') return 'few';
    return 'many'; // other / many / two - all collapse to many for our 3-form keys
  } catch {
    return Math.abs(count) === 1 ? 'one' : 'many';
  }
}

// Translate {count} {city/cities} style strings using 3-form keys.
// keyPrefix is the dictionary key without the trailing _one/_few/_many.
// `vars` are interpolated into the resolved string (e.g. {count: 5}).
// Example: pluralize(t, 5, 'trip.cities_count', 'ru', { count: 5 }) → "5 городов".
export function pluralize(t, count, keyPrefix, lang, vars) {
  const cat = pluralCategory(count, lang);
  const v = vars || { count };
  return t(`${keyPrefix}_${cat}`, v);
}

// ---- Numbers --------------------------------------------------------------
export function formatNumber(value, lang, opts = {}) {
  if (value == null || isNaN(value)) return '';
  try {
    return new Intl.NumberFormat(localeTag(lang), opts).format(value);
  } catch {
    return String(value);
  }
}