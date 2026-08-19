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

// The `n8n` namespace (TRIP-404) holds notification/email strings rendered by
// n8n from Tolgee's Content Delivery — the frontend never reads them, so it is
// excluded here to keep those keys out of the client bundle. `tolgee pull` still
// writes locales/<lang>/n8n.json into the repo (Tolgee is the source of truth);
// this glob just declines to import it.
import { settleNamespace } from './settleNamespace.js';

const modules = import.meta.glob(['./locales/*/*.json', '!./locales/*/n8n.json']);

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
  // Degrade per-namespace, never crash the whole language (TRIP-441): a failed /
  // undefined chunk becomes an empty namespace via the Vite-free `settleNamespace`
  // (extracted so the catch-path is testable under `node --test` — this file's
  // top-level `import.meta.glob` is Vite-only).
  const entries = await Promise.all(
    Object.entries(nsLoaders).map(([ns, load]) => settleNamespace(lang, ns, load)),
  );
  return Object.fromEntries(entries);
}
