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
    // Prevent Vite from also throwing the error we're handling by reloading.
    event.preventDefault();
    window.location.reload();
  });
}
