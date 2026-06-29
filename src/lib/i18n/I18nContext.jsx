import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import { TRANSLATIONS } from './dictionary';
import { LANGUAGES, localeTag } from './translations';
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
  lang: 'en',
  setLang: () => {},
  units: 'metric',
  setUnits: () => {},
  t: (key) => key,
});

// Resolve a dotted `namespace.key` address against a namespaced locale dict
// ({ namespace: { bareKey: value } }). Splits on the FIRST dot so bare keys may
// themselves contain dots. Returns undefined when absent (caller falls back).
function resolveKey(dict, key) {
  if (!dict) return undefined;
  const i = key.indexOf('.');
  if (i <= 0) return dict[key]; // dotless address — no namespace
  const ns = dict[key.slice(0, i)];
  return ns ? ns[key.slice(i + 1)] : undefined;
}

const STORAGE_KEY = 'travel-planner-lang';
const UNITS_STORAGE_KEY = 'travel-planner-units';
const UNIT_SYSTEMS = ['metric', 'imperial'];

function detectInitialLang(user) {
  if (user?.language && TRANSLATIONS[user.language]) return user.language;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && TRANSLATIONS[stored]) return stored;
  } catch (e) { /* ignore */ }
  const browser = (typeof navigator !== 'undefined' ? navigator.language : 'ru').slice(0, 2);
  return TRANSLATIONS[browser] ? browser : 'en';
}

// Distance unit system. Authoritative source = users.unit_system once signed in,
// else localStorage, else 'metric'. Anonymous public-trip viewers fall back to
// their own localStorage / default — never the trip owner's setting.
function detectInitialUnits(user) {
  if (user?.unit_system && UNIT_SYSTEMS.includes(user.unit_system)) return user.unit_system;
  try {
    const stored = localStorage.getItem(UNITS_STORAGE_KEY);
    if (stored && UNIT_SYSTEMS.includes(stored)) return stored;
  } catch (e) { /* ignore */ }
  return 'metric';
}

export function I18nProvider({ children }) {
  const { user } = useAuth();
  const [lang, setLangState] = useState(() => detectInitialLang(null));
  const [units, setUnitsState] = useState(() => detectInitialUnits(null));

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

  useEffect(() => {
    if (user) setUnitsState(detectInitialUnits(user));
  }, [user?.unit_system]); // eslint-disable-line

  const setLang = useCallback(async (newLang) => {
    if (!TRANSLATIONS[newLang]) return;
    setLangState(newLang);
    try { localStorage.setItem(STORAGE_KEY, newLang); } catch (e) { /* ignore */ }
    // Persist on user if signed in
    if (user) {
      try { await supabase.from('users').update({ language: newLang }).eq('id', user.id); } catch (e) { /* ignore */ }
    }
  }, [user]);

  const setUnits = useCallback(async (newUnits) => {
    if (!UNIT_SYSTEMS.includes(newUnits)) return;
    setUnitsState(newUnits);
    try { localStorage.setItem(UNITS_STORAGE_KEY, newUnits); } catch (e) { /* ignore */ }
    // Persist on user if signed in
    if (user) {
      try { await supabase.from('users').update({ unit_system: newUnits }).eq('id', user.id); } catch (e) { /* ignore */ }
    }
  }, [user]);

  const t = useCallback((key, vars) => {
    const dict = TRANSLATIONS[lang] || TRANSLATIONS.ru;
    // Keys are stored bare inside per-namespace dicts; the call-site address is
    // `namespace.key`. Split on the FIRST dot to resolve. Fallback chain mirrors
    // the previous flat lookup: active locale → ru → the key itself.
    let str = resolveKey(dict, key) || resolveKey(TRANSLATIONS.ru, key) || key;
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
    units,
    setUnits,
    t,
    languages: LANGUAGES,
    locale: localeTag(lang),
  }), [lang, setLang, units, setUnits, t]);

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
  const { lang, units, t } = useI18n();
  return useMemo(() => ({
    lang,
    units,
    locale: localeTag(lang),
    t,
    fmtDate: (value, tz, fmt) => formatDateTime(value, tz, fmt, lang),
    fmtCountry: (code, fallback) => localizeCountry(code, lang, fallback),
    fmtCurrencyName: (code) => localizeCurrencyName(code, lang),
    fmtMoney: (amount, currency, opts) => formatMoney(amount, currency, lang, opts),
    fmtNumber: (value, opts) => formatNumber(value, lang, opts),
    plural: (count, keyPrefix, vars) => pluralize(t, count, keyPrefix, lang, vars),
    // Distance is always stored/computed in km; convert to the user's unit system
    // ONLY at the output layer. Returns { value, unit } — value is a locale-formatted
    // integer string, unit the localized label ('units.km' / 'units.mi').
    fmtDistance: (km) => {
      const n = Number(km);
      if (km == null || isNaN(n)) return { value: '', unit: '' };
      const imperial = units === 'imperial';
      const converted = imperial ? n * 0.621371 : n;
      return {
        value: formatNumber(Math.round(converted), lang),
        unit: t(imperial ? 'units.mi' : 'units.km'),
      };
    },
  }), [lang, units, t]);
}