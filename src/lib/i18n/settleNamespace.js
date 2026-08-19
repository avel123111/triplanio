// Settle one namespace load into `[ns, record]`, degrading ANY failure
// (reject ИЛИ resolve-в-undefined) в пустой record. Вынесено из dictionary.js
// (там `import.meta.glob` на верхнем уровне — Vite-only — не даёт импортировать
// модуль под `node --test`), тот же приём Vite-free сиблинга, что trace.ts↔sentry.ts
// (TRIP-441). Держит catch-путь, лечащий issue 141555014, тестируемым чистой
// функцией; поведение и лог-строка — байт-в-байт как inline-версия в diff #909.
//
// A lazy JSON chunk can fail to load (a hashed asset 404s after a redeploy
// replaced it under an open tab) or `import()` can resolve to `undefined` — a
// bare `mod.default` there throws and would take down the ENTIRE locale
// activation. Fall back to an empty namespace so the facade renders the bare key
// for those strings (visibly missing, not a white screen) while every other
// namespace still loads.
export async function settleNamespace(lang, ns, load) {
  try {
    const mod = await load();
    return [ns, mod?.default || mod || {}];
  } catch (e) {
    console.warn(`[i18n] locale chunk failed: ${lang}/${ns}`, e);
    return [ns, {}];
  }
}
