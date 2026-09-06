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

/** Имена всех словарей языка — нужны, чтобы посчитать «остальные». */
export function namespacesOf(lang) {
  return Object.keys(LOADERS[lang] || {});
}

/**
 * Собрать { [namespace]: { [bareKey]: value } } для одного языка.
 *
 * `only` — ПОДМНОЖЕСТВО имён словарей. Без него грузится всё, как и раньше;
 * с ним — ровно перечисленное. Так первый кадр неавторизованной зоны перестаёт
 * ждать 48 чанков ради шести (`zoneNamespaces.js`), а остальные догружаются
 * тем же вызовом следом и МЕРДЖАТСЯ в тот же словарь.
 *
 * Возвращает пустой объект для неизвестного языка (вызыватель падает на фолбэк).
 */
/**
 * Что УЖЕ загружено — синхронно (TRIP-520).
 *
 * ЗАЧЕМ. Провайдер кладёт словарь в состояние ЭФФЕКТОМ, то есть первый кадр он
 * рисует ожидание — всегда, даже когда словарь уже в модульном кэше. На
 * оболочке это незаметно (там и показывать нечего), а на ИСПЕЧЁННОЙ странице
 * это провал: замер 06.09.2026 — готовый текст исчезал на 156 мс и сменялся
 * спиннером, потом возвращался. Для человека это мигающий баг, а не загрузка.
 *
 * Поэтому загруженное записывается сюда, а провайдер читает это в НАЧАЛЬНОМ
 * состоянии — и кадра с ожиданием не возникает вовсе.
 */
const LOADED = {};
const ZONE_DONE = new Set();

/** Словарь языка, если он уже загружен. @returns {object|undefined} */
export function loadedLocale(lang) {
  return LOADED[lang];
}

/** Загружены ли словари ЗОНЫ для языка — то есть можно ли рисовать сразу. */
export function zoneLoaded(lang) {
  return ZONE_DONE.has(lang);
}

export async function loadLocale(lang, only) {
  const nsLoaders = LOADERS[lang];
  if (!nsLoaders) return {};
  const wanted = only
    ? Object.entries(nsLoaders).filter(([ns]) => only.includes(ns))
    : Object.entries(nsLoaders);
  const entries = await Promise.all(
    wanted.map(async ([ns, load]) => {
      // Degrade per-namespace, never crash the whole language (TRIP-441). A lazy
      // JSON chunk can fail to load — a hashed asset 404s after a redeploy replaced
      // it under an open tab, or `import()` resolves to `undefined` — and a bare
      // `mod.default` there threw an unhandled rejection that took down the ENTIRE
      // locale activation. Fall back to an empty namespace: the facade renders the
      // bare key for those strings (visibly missing, not a white screen) while
      // every other namespace still loads.
      try {
        const mod = await load();
        return [ns, mod?.default || mod || {}];
      } catch (e) {
        console.warn(`[i18n] locale chunk failed: ${lang}/${ns}`, e);
        return [ns, {}];
      }
    }),
  );
  const dict = Object.fromEntries(entries);
  // Мержим, а не заменяем: фаза зоны и полная фаза дополняют друг друга.
  LOADED[lang] = { ...LOADED[lang], ...dict };
  if (only) ZONE_DONE.add(lang);
  return dict;
}
