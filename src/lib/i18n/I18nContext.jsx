import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import { TRANSLATIONS, LANGUAGES, localeTag } from './translations';
import {
  applyLuxonLocale,
  formatDateTime,
  localizeCountry,
  localizeCurrencyName,
  formatMoney,
  formatNumber,
  pluralize,
} from './format';

const I18nContext = createContext({
  lang: 'ru',
  setLang: () => {},
  t: (key) => key,
});

const STORAGE_KEY = 'travel-planner-lang';

function detectInitialLang(user) {
  if (user?.language && TRANSLATIONS[user.language]) return user.language;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && TRANSLATIONS[stored]) return stored;
  } catch (e) { /* ignore */ }
  const browser = (typeof navigator !== 'undefined' ? navigator.language : 'ru').slice(0, 2);
  return TRANSLATIONS[browser] ? browser : 'ru';
}

export function I18nProvider({ children }) {
  const { user } = useAuth();
  const [lang, setLangState] = useState(() => detectInitialLang(null));

  // Apply Luxon default locale on mount and whenever lang changes,
  // so every DateTime.toFormat('LLLL') / .toFormat('ccc') picks up the right names.
  useEffect(() => { applyLuxonLocale(lang); }, [lang]);

  // Sync from user once authenticated
  useEffect(() => {
    if (user) {
      const fromUser = detectInitialLang(user);
      setLangState(fromUser);
    }
  }, [user?.language]); // eslint-disable-line

  const setLang = useCallback(async (newLang) => {
    if (!TRANSLATIONS[newLang]) return;
    setLangState(newLang);
    try { localStorage.setItem(STORAGE_KEY, newLang); } catch (e) { /* ignore */ }
    // Persist on user if signed in
    if (user) {
      try { await base44.auth.updateMe({ language: newLang }); } catch (e) { /* ignore */ }
    }
  }, [user]);

  const t = useCallback((key, vars) => {
    const dict = TRANSLATIONS[lang] || TRANSLATIONS.ru;
    let str = dict[key] || TRANSLATIONS.ru[key] || key;
    if (vars && typeof str === 'string') {
      Object.entries(vars).forEach(([k, v]) => {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      });
    }
    return str;
  }, [lang]);

  const value = useMemo(() => ({
    lang,
    setLang,
    t,
    languages: LANGUAGES,
    locale: localeTag(lang),
  }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export function useT() {
  return useI18n().t;
}

// Convenience hook that bundles t() + locale-aware formatters.
// Usage: const { t, fmtDate, fmtCountry, fmtMoney, plural } = useI18nFormat();
export function useI18nFormat() {
  const { lang, t } = useI18n();
  return useMemo(() => ({
    lang,
    locale: localeTag(lang),
    t,
    fmtDate: (value, tz, fmt) => formatDateTime(value, tz, fmt, lang),
    fmtCountry: (code, fallback) => localizeCountry(code, lang, fallback),
    fmtCurrencyName: (code) => localizeCurrencyName(code, lang),
    fmtMoney: (amount, currency, opts) => formatMoney(amount, currency, lang, opts),
    fmtNumber: (value, opts) => formatNumber(value, lang, opts),
    plural: (count, keyPrefix, vars) => pluralize(t, count, keyPrefix, lang, vars),
  }), [lang, t]);
}