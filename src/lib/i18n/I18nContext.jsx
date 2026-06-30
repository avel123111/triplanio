import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import { hasLang, loadLocale } from './dictionary';
import { LANGUAGES, localeTag } from './translations';
import { tolgee, ensureTolgeeRunning, addLocaleToTolgee, IN_CONTEXT } from './tolgee';
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

// Active locale falls back to this one (then to the raw key) for missing strings,
// so it is always loaded alongside whatever language is active.
const FALLBACK_LANG = 'ru';

// Resolve a dotted address `namespace.bareKey` against a nested locale dict
// ({ namespace: { bareKey: value } }). Split on the FIRST dot only: the namespace
// is the file stem (dot-free), while a bare key may itself contain dots
// (e.g. 'admin.home.title' → ns 'admin', key 'home.title'). Every real address is
// dotted; a dotless/leading-dot key has no namespace and no value here, so we
// return undefined (→ fallback → raw key) rather than the namespace object.
function lookup(nsDict, key) {
  if (!nsDict) return undefined;
  const dot = key.indexOf('.');
  if (dot <= 0) return undefined;
  const rec = nsDict[key.slice(0, dot)];
  return rec ? rec[key.slice(dot + 1)] : undefined;
}

const STORAGE_KEY = 'travel-planner-lang';
const UNITS_STORAGE_KEY = 'travel-planner-units';
const UNIT_SYSTEMS = ['metric', 'imperial'];

function detectInitialLang(user) {
  if (user?.language && hasLang(user.language)) return user.language;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && hasLang(stored)) return stored;
  } catch (e) { /* ignore */ }
  const browser = (typeof navigator !== 'undefined' ? navigator.language : 'ru').slice(0, 2);
  return hasLang(browser) ? browser : 'en';
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

  // Our baked dictionaries are the authoritative reader for NORMAL users:
  // { [lang]: { [namespace]: { [bareKey]: value } } }, kept in a ref so t() reads
  // the latest without being re-created. `ready` tracks WHICH locales are loaded
  // (to gate the first paint) and the active language. `loadingRef` holds the
  // in-flight load promise per locale so each is fetched at most once.
  const [ready, setReady] = useState(() => new Set());
  const dictsRef = useRef({});
  const loadingRef = useRef({});

  // Load a language (and the fallback) exactly once into our dictionary. Only in
  // an in-context editing session do we ALSO mirror it into Tolgee (so the observer
  // can wrap these strings) — normal users never put anything in Tolgee.
  const ensureLoaded = useCallback((target) => {
    const need = target === FALLBACK_LANG ? [FALLBACK_LANG] : [target, FALLBACK_LANG];
    return Promise.all(need.map((l) => {
      if (!loadingRef.current[l]) {
        loadingRef.current[l] = loadLocale(l).then((d) => {
          dictsRef.current[l] = d;
          if (IN_CONTEXT) addLocaleToTolgee(l, d); // BEFORE ensureTolgeeRunning()
          return d;
        });
      }
      return loadingRef.current[l];
    }));
  }, []);

  // Make a language usable, then expose it. Tolgee is started either way so the
  // browser extension can detect the page and offer in-context editing. In an
  // editing session we also switch Tolgee to the active language BEFORE exposing it
  // (so tolgee.t() resolves the right language with no wrong-language frame); normal
  // users never call tolgee.t(), so no language switch is needed for them.
  const activate = useCallback(async (target) => {
    await ensureLoaded(target);
    ensureTolgeeRunning();
    if (IN_CONTEXT) await tolgee.changeLanguage(target);
    setReady((prev) => (prev.has(target) ? prev : new Set(prev).add(target)));
  }, [ensureLoaded]);

  // Load+activate the active locale, then make it visible — a language switch
  // keeps the old language on screen until the new one is fully loaded.
  const applyLang = useCallback(async (newLang) => {
    await activate(newLang);
    setLangState(newLang);
  }, [activate]);

  // Activate the initial locale on mount (detected browser/stored language). A
  // signed-in user whose language differs triggers a follow-up load below.
  useEffect(() => { activate(detectInitialLang(null)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply Luxon default locale on mount and whenever lang changes,
  // so every DateTime.toFormat('LLLL') / .toFormat('ccc') picks up the right names.
  useEffect(() => { applyLuxonLocale(lang); }, [lang]);

  // Sync from user once authenticated
  useEffect(() => {
    if (user) applyLang(detectInitialLang(user));
  }, [user?.language]); // eslint-disable-line

  useEffect(() => {
    if (user) setUnitsState(detectInitialUnits(user));
  }, [user?.unit_system]); // eslint-disable-line

  const setLang = useCallback(async (newLang) => {
    if (!hasLang(newLang)) return;
    await activate(newLang);
    setLangState(newLang);
    try { localStorage.setItem(STORAGE_KEY, newLang); } catch (e) { /* ignore */ }
    // Persist on user if signed in
    if (user) {
      try { await supabase.from('users').update({ language: newLang }).eq('id', user.id); } catch (e) { /* ignore */ }
    }
  }, [user, activate]);

  const setUnits = useCallback(async (newUnits) => {
    if (!UNIT_SYSTEMS.includes(newUnits)) return;
    setUnitsState(newUnits);
    try { localStorage.setItem(UNITS_STORAGE_KEY, newUnits); } catch (e) { /* ignore */ }
    // Persist on user if signed in
    if (user) {
      try { await supabase.from('users').update({ unit_system: newUnits }).eq('id', user.id); } catch (e) { /* ignore */ }
    }
  }, [user]);

  // Conditional resolution:
  //  - In-context editing session (only you, locally): route through Tolgee so the
  //    observer marker-wraps the string for editing.
  //  - Everyone else: resolve straight from the baked dictionary (active lang →
  //    ru fallback → raw key) and do the {var} interpolation ourselves — zero
  //    Tolgee overhead on the hot path. Mirrors the pre-Tolgee behaviour exactly.
  // Re-created on `lang` change so consumers re-render with the new language.
  const t = useCallback((key, vars) => {
    if (IN_CONTEXT) return tolgee.t({ key, params: vars });
    const dicts = dictsRef.current;
    let str = lookup(dicts[lang], key) || lookup(dicts[FALLBACK_LANG], key) || key;
    if (vars && typeof str === 'string') {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
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

  // Gate the first paint until the active locale is ready in Tolgee, so no screen
  // ever renders raw keys. Mirrors the app's existing loading splash (reuse). Once
  // ready, language switches no longer hit this branch (applyLang/setLang flip
  // `lang` only after `activate` has loaded + switched Tolgee to the new locale).
  if (!ready.has(lang)) {
    return (
      <div className="app-loading">
        <div className="app-spinner"></div>
      </div>
    );
  }

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
