import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import { hasLang, loadLocale } from './dictionary';
import { LANGUAGES, localeTag } from './translations';
import { tolgee, ensureTolgeeRunning, addLocaleToTolgee } from './tolgee';
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

  // Lazily-loaded locale dictionaries: { [lang]: { [namespace]: { [bareKey]: value } } }.
  // Only the active locale (+ FALLBACK_LANG) is ever fetched. A ref mirrors the state
  // so concurrent loads dedupe and `ensureLoaded` reads the latest without re-binding.
  const [dicts, setDicts] = useState({});
  const dictsRef = useRef(dicts);
  const loadingRef = useRef({});

  // Fetch a language (and the fallback) once; updates `dicts` when each arrives.
  const ensureLoaded = useCallback((target) => {
    const need = target === FALLBACK_LANG ? [FALLBACK_LANG] : [target, FALLBACK_LANG];
    return Promise.all(need.map((l) => {
      if (dictsRef.current[l]) return null;
      if (!loadingRef.current[l]) {
        loadingRef.current[l] = loadLocale(l).then((d) => {
          // Mirror the loaded locale into Tolgee's static cache so tolgee.t()
          // resolves it synchronously and the in-context observer can wrap it
          // (path-A spike). Our own `dicts` state stays the safety net below.
          addLocaleToTolgee(l, d);
          ensureTolgeeRunning();
          // Functional update so concurrent locale loads merge atomically; the
          // ref mirror is kept current inside so `ensureLoaded` dedupes reads.
          setDicts((prev) => {
            const next = { ...prev, [l]: d };
            dictsRef.current = next;
            return next;
          });
          return d;
        });
      }
      return loadingRef.current[l];
    }));
  }, []);

  // Load the active locale, then make it visible — so a language switch never
  // shows raw keys: the old language stays until the new dictionary is ready.
  const applyLang = useCallback(async (newLang) => {
    await ensureLoaded(newLang);
    setLangState(newLang);
  }, [ensureLoaded]);

  // Load the initial locale on mount (detected browser/stored language). A
  // signed-in user whose language differs triggers a follow-up load below.
  useEffect(() => { ensureLoaded(detectInitialLang(null)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply Luxon default locale on mount and whenever lang changes,
  // so every DateTime.toFormat('LLLL') / .toFormat('ccc') picks up the right names.
  useEffect(() => { applyLuxonLocale(lang); }, [lang]);

  // Keep Tolgee's active language in sync with ours so tolgee.t() resolves the
  // right locale (path-A spike).
  useEffect(() => { tolgee.changeLanguage(lang); }, [lang]);

  // Sync from user once authenticated
  useEffect(() => {
    if (user) applyLang(detectInitialLang(user));
  }, [user?.language]); // eslint-disable-line

  useEffect(() => {
    if (user) setUnitsState(detectInitialUnits(user));
  }, [user?.unit_system]); // eslint-disable-line

  const setLang = useCallback(async (newLang) => {
    if (!hasLang(newLang)) return;
    await ensureLoaded(newLang);
    setLangState(newLang);
    try { localStorage.setItem(STORAGE_KEY, newLang); } catch (e) { /* ignore */ }
    // Persist on user if signed in
    if (user) {
      try { await supabase.from('users').update({ language: newLang }).eq('id', user.id); } catch (e) { /* ignore */ }
    }
  }, [user, ensureLoaded]);

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
    // Path-A spike: resolve THROUGH Tolgee so the output carries in-context
    // markers and interpolation is done by Tolgee's FormatSimple ({var}) — we
    // never .replace() over a wrapped string (that would damage the markers).
    // The Tolgee project is flat, so the full dotted address IS the key.
    const out = tolgee.t({ key, params: vars || {}, defaultValue: undefined });
    // tolgee.t() returns the key itself when it has no record (sync-timing race
    // or a genuinely missing key). In that case fall back to our own dictionaries
    // — identical to the pre-spike behaviour, so there is no functional regression.
    if (out && out !== key) return out;

    const dict = dicts[lang] || dicts[FALLBACK_LANG];
    let str = resolveKey(dict, key) || resolveKey(dicts[FALLBACK_LANG], key) || key;
    if (vars && typeof str === 'string') {
      Object.entries(vars).forEach(([k, v]) => {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      });
    }
    return str;
  }, [dicts, lang]);

  const value = useMemo(() => ({
    lang,
    setLang,
    units,
    setUnits,
    t,
    languages: LANGUAGES,
    locale: localeTag(lang),
  }), [lang, setLang, units, setUnits, t]);

  // Gate the first paint until the active locale is loaded, so no screen ever
  // renders raw keys. Mirrors the app's existing loading splash (reuse). Once
  // loaded, language switches no longer hit this branch (applyLang/setLang flip
  // `lang` only after the new dictionary is in `dicts`).
  if (!dicts[lang]) {
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
