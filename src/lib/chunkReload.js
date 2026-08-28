// Stale-chunk reload guard (TRIP-284, 1f).
//
// After a deploy the currently-open page still holds the OLD hashed chunk URLs;
// the next lazy `import()` for a route/component 404s and the view renders blank
// with only a console error. Vite fires a cancelable `vite:preloadError` event for
// exactly this case — reload once to pull a fresh index.html (and with it the new
// chunk URLs).
//
// Guarded against a reload LOOP: a chunk can also fail to load because the network
// is genuinely down, not because it moved. We reload at most once per short window
// (per tab), so a truly-missing chunk surfaces its error instead of reloading
// forever. Sentry still sees it (the preloadError's own error is no longer muted —
// `Failed to fetch` was removed from ignoreErrors in the same task).
//
// ★ СОБЫТИЕ НЕ ГАСИМ, И ЭТО НЕСУЩЕЕ. Здесь стоял `event.preventDefault()` — чтобы
// Vite «не бросал ошибку, которую мы и так лечим перезагрузкой». Но для хелпера
// Vite погашенное событие значит не «мы разберёмся», а «ошибки не было»:
//
//     const o = c => { …dispatchEvent(u); if (!u.defaultPrevented) throw c; };
//     return s.then(c => { …; return t().catch(o) });
//
// Без броска `.catch(o)` завершает промис УСПЕШНО со значением `undefined`.
// `React.lazy` принимает это за загруженный модуль и на следующем кадре читает у
// него `.default` — отсюда `TypeError: Cannot read properties of undefined
// (reading 'default')` вместо честной ошибки загрузки. Перезагрузка к этому
// моменту уже запрошена, но выполняется не мгновенно, и React успевает
// отрисоваться в зазоре.
//
// Тот же `undefined` уже ловили В ДРУГОМ МЕСТЕ и лечили там же: `try/catch` вокруг
// `await load()` в `i18n/dictionary.js` (TRIP-441) заведён ровно под него — см.
// комментарий «or `import()` resolves to `undefined`». Гашение события заставляет
// писать такую заплату на КАЖДОМ месте загрузки; здесь оно снято в источнике.
//
// Что меняется: промис отклоняется, а не резолвится пустотой. Перезагрузка идёт
// как шла (она в строке ниже и от гашения не зависит), пользователь видит тот же
// экран (роуты ловит региональный `ErrorBoundary` с локализованным EmptyState, а
// не сырое сообщение), а в Sentry вместо бессмысленного TypeError приезжает
// «Failed to fetch dynamically imported module» с адресом файла.
//
// `dictionary.js` заплату НЕ снимаем: она закрывает и второй случай — чанк реально
// отсутствует, и тогда `import()` отклоняется по-настоящему. Этот путь остаётся.
const FLAG = 'chunk-reload-at';
const WINDOW_MS = 10_000;

export function installChunkReloadGuard() {
  if (typeof window === 'undefined') return;
  window.addEventListener('vite:preloadError', (event) => {
    let last = 0;
    try { last = Number(sessionStorage.getItem(FLAG)) || 0; } catch { /* storage blocked */ }
    // Already reloaded moments ago → don't loop; let the failure surface.
    if (Date.now() - last < WINDOW_MS) return;
    try { sessionStorage.setItem(FLAG, String(Date.now())); } catch { /* ignore */ }
    // НЕ `event.preventDefault()` — см. блок в шапке файла.
    window.location.reload();
  });
}
