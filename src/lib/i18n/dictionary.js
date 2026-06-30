// Namespaced translation dictionaries (TRIP-129). Source of truth = JSON files
// under ./locales/<lang>/<namespace>.json with BARE keys; the namespace is the
// file stem. Call-sites use the dotted address `t('namespace.key')` and the
// i18n facade (I18nContext) splits the first dot to resolve.
//
// Loading is PER-LOCALE LAZY: `import.meta.glob` (non-eager) gives one async
// importer per JSON file, so Vite/Rollup split every locale into its own chunk.
// Only the active locale (+ the `ru` fallback) is fetched at runtime instead of
// baking all three into the startup bundle — ~2/3 less dictionary parsed on the
// first paint. This module is Vite-only on purpose and is imported ONLY by
// I18nContext; pure config (LANGUAGES/LOCALE_TAG) lives in translations.js so
// non-Vite consumers (formatters, tests) never touch the glob.

const modules = import.meta.glob('./locales/*/*.json');

// Group the per-file importers by language: { [lang]: { [namespace]: () => import() } }.
const LOADERS = {};
for (const [path, load] of Object.entries(modules)) {
  const m = path.match(/\/locales\/([^/]+)\/([^/]+)\.json$/);
  if (!m) continue;
  const [, lang, ns] = m;
  (LOADERS[lang] ||= {})[ns] = load;
}

// True if a language has locale files on disk (used by the facade's lang detection).
export function hasLang(lang) {
  return Boolean(LOADERS[lang]);
}

// Load every namespace of one locale and assemble { [namespace]: { [bareKey]: value } }.
// Returns an empty object for an unknown language (caller falls back).
export async function loadLocale(lang) {
  const nsLoaders = LOADERS[lang];
  if (!nsLoaders) return {};
  const entries = await Promise.all(
    Object.entries(nsLoaders).map(async ([ns, load]) => {
      const mod = await load();
      return [ns, mod.default || mod];
    }),
  );
  return Object.fromEntries(entries);
}
