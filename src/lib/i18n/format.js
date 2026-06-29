// Localization formatters for dynamic data: countries, currencies, plurals,
// Luxon dates. Lightweight wrappers around Intl.* + Luxon - call from React via
// useI18nFormat() (see I18nContext).
import { DateTime, Settings } from 'luxon';
import { localeTag } from './translations';

// ---- Active language (module-level) ---------------------------------------
// Mirror of the current UI language so module-level helpers (formatters defined
// outside React, e.g. design/index.jsx `fmt`) can be locale-aware without a hook.
// Kept in sync by I18nProvider via applyLuxonLocale() on every language change.
let _activeLang = 'ru';
export function getActiveLang() { return _activeLang; }
export function getActiveLocale() { return localeTag(_activeLang); }

// ---- Luxon ----------------------------------------------------------------
// Set the default Luxon locale globally; callers that pass setLocale() on a
// DateTime keep precedence. We re-call this from I18nProvider on language change.
export function applyLuxonLocale(lang) {
  _activeLang = lang;
  Settings.defaultLocale = localeTag(lang);
}

// Canonical money/date formatters for module-level (non-hook) call sites.
// Components should prefer useI18nFormat(); these read the active language.
export function fmtMoneyActive(amount, currency) { return formatMoney(amount, currency, _activeLang); }

// Format a DateTime (or ISO string + timezone) using Luxon's localized tokens.
// Example: formatDateTime(iso, tz, 'd LLL yyyy', 'ru') → "5 авг 2026"
export function formatDateTime(value, timezone, fmt, lang) {
  if (!value) return '';
  const dt = value instanceof DateTime
    ? value
    : DateTime.fromISO(value, { zone: timezone || 'utc' });
  if (!dt.isValid) return '';
  return dt.setLocale(localeTag(lang)).toFormat(fmt);
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