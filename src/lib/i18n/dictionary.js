// Namespaced translation dictionaries (TRIP-129). Source of truth = JSON files
// under ./locales/<lang>/<namespace>.json with BARE keys; the namespace is the
// file stem. Call-sites use the dotted address `t('namespace.key')` and the
// i18n facade (I18nContext) splits the first dot to resolve here.
//
// Loading uses Vite's import.meta.glob (eager) so the JSON is baked into the
// build — no runtime fetch. This module is Vite-only on purpose and is imported
// ONLY by I18nContext; pure config (LANGUAGES/LOCALE_TAG) lives in translations.js
// so non-Vite consumers (formatters, tests) never touch the glob.

const modules = import.meta.glob('./locales/*/*.json', { eager: true });

// Build { [lang]: { [namespace]: { [bareKey]: value } } }.
const TRANSLATIONS = {};
for (const [path, mod] of Object.entries(modules)) {
  const m = path.match(/\/locales\/([^/]+)\/([^/]+)\.json$/);
  if (!m) continue;
  const [, lang, ns] = m;
  (TRANSLATIONS[lang] ||= {})[ns] = mod.default || mod;
}

export { TRANSLATIONS };
