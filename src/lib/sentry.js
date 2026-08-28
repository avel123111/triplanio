/* global __SENTRY_RELEASE__ */
/**
 * Sentry — browser error monitoring, ЗАХВАТ И ОТПРАВКА РАЗДЕЛЕНЫ (TRIP-475 Ф1.4).
 *
 * One Sentry project (org `triplanio`, EU region). Environments are separated by
 * the `environment` tag (production / development), not by separate projects.
 *
 * The DSN is public by design (it only allows event submission, no read access)
 * and ships in the bundle, exactly like the Mapbox token.
 *
 * ★ ПОЧЕМУ SDK НЕ СТАТИЧЕСКИЙ (TRIP-475 Ф1.4). Раньше этот модуль делал
 * `import * as Sentry from '@sentry/react'` СИНХРОННО, а его импортировали
 * `main.jsx` + обе границы + `invokeFn` тоже синхронно — поэтому весь SDK
 * (~443 КБ распакованного, Replay+tracing) тянулся синхронным ребром к первому
 * рендеру, на критический путь лендинга. Теперь модуль верхом синхронного кода
 * НЕ содержит: он отдаёт лёгкий фасад `Sentry.captureException`, а сам
 * `@sentry/react` приезжает динамическим `import()` на `requestIdleCallback`
 * ПОСЛЕ рендера. Форма экспорта (`initSentry`, `{ Sentry }` с `.captureException`)
 * не изменилась — четыре вызывающих файла не тронуты.
 *
 * ★ ЗАХВАТ С НУЛЕВОЙ МИЛЛИСЕКУНДЫ. Между стартом и приездом SDK ошибку терять
 * нельзя (требование «must run before the first render» из `main.jsx`). Поэтому
 * синхронно ставится маленький слой захвата: `window.onerror` +
 * `unhandledrejection` + очередь для `captureException`. Всё накопленное
 * проигрывается в настоящий SDK, как только он инициализирован.
 *
 * Config notes:
 *  - No DSN → the SDK is never loaded and every capture is a safe no-op. This
 *    keeps local dev (and any env without the var) completely silent.
 *  - Tracing ON at 10% (TRIP-219 F5): browser page-loads / navigations with timed
 *    spans for the backend calls they make. Trace headers ARE propagated to the
 *    same-origin `/api/*` edge transport (TRIP-373) — see `tracePropagationTargets`
 *    below — so an edge error is stitched under the same trace as the browser
 *    transaction that triggered it.
 *  - Session Replay ON, privacy-first: only sessions WITH an error are recorded,
 *    and all text / inputs / media are masked — a replay shows structure, never
 *    real content (email / billing / trip data). (Гейт Replay по зоне рассмотрен
 *    и ОТКЛОНЁН в Ф1.4: решение по адресу входа гасило бы его почти во всех
 *    сессиях — они стартуют с `/` или `/login`, — а байты Replay и так в async-
 *    чанке SDK на idle. Гасить по факту «есть сессия» — отдельное решение.)
 *  - `sendDefaultPii: false` + `beforeSend` scrubbing: this app handles user
 *    emails, trip data and Stripe, so nothing PII-bearing is attached
 *    automatically and request bodies / query strings / auth headers are removed
 *    before any event leaves the browser.
 */

// `import.meta.env?.` / `typeof __SENTRY_RELEASE__` — optional/guarded so this
// module loads under `node --test` too (the pure queue below is unit-tested
// there). The heavy `import('@sentry/react')` lives inside a function, never at
// module scope, so importing this file pulls in ZERO SDK bytes.
const DSN = import.meta.env?.VITE_SENTRY_DSN;
const ENVIRONMENT = import.meta.env?.VITE_SENTRY_ENVIRONMENT || import.meta.env?.MODE;
// Injected at build time from VERCEL_GIT_COMMIT_SHA (see vite.config.js `define`).
// Empty string when building outside Vercel — treated as "no release".
const RELEASE = (typeof __SENTRY_RELEASE__ !== 'undefined' ? __SENTRY_RELEASE__ : '') || undefined;

// Pure browser noise — would only burn the shared free-plan quota without ever
// being actionable. `AbortError` is a user navigating away / cancelling mid-request;
// ResizeObserver loops and "Non-Error promise rejection" are framework churn.
//
// The generic fetch failures (`Failed to fetch` / `NetworkError…` / `Load failed`)
// were REMOVED (TRIP-284): they hid real signal — a failed chunk after a deploy, a
// down edge door, a broken Storage upload — behind the same string as an offline
// blip. The client seams already filter the truly-expected cases (invokeFn tags
// network vs 200-error; reportAuthError skips 4xx), so these should surface, not
// be blanket-muted here.
const IGNORE_ERRORS = [
  'ResizeObserver loop limit exceeded',
  'ResizeObserver loop completed with undelivered notifications.',
  'Non-Error promise rejection captured',
  'AbortError',
];

// Strip anything PII-bearing before an event leaves the browser. Used by BOTH
// `beforeSend` (error events) AND `beforeSendTransaction` (tracing events) — a
// trace/transaction envelope carries `request.url` too, and a sampled pageload on
// `/public/trip/:id?t=<share_token>` or an OAuth `?code=` callback would otherwise
// ship that credential despite the error-path scrub. (Session Replay records the
// URL in its OWN envelope, which no SDK hook intercepts — the residual there is
// limited to already-shared share tokens / short-lived expired OAuth codes.)
function scrubPii(event) {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    if (event.request.headers) {
      delete event.request.headers.Authorization;
      delete event.request.headers.authorization;
      delete event.request.headers.Cookie;
    }
    // Query strings can carry tokens / emails — keep the path, drop the rest.
    if (event.request.url) {
      event.request.url = event.request.url.split('?')[0];
    }
  }
  // Keep only a stable user id for grouping; never email / username / ip.
  if (event.user) {
    event.user = event.user.id ? { id: event.user.id } : undefined;
  }
  return event;
}

// ─── Очередь захвата до приезда SDK ──────────────────────────────────────────
// Чистые функции над ПЕРЕДАННЫМ массивом (никакого скрытого состояния модуля),
// поэтому проверяются `node --test` без DOM (приёмка Ф1.4 #2).
export const CAPTURE_QUEUE_MAX = 50;

/**
 * Положить захват в очередь. При переполнении ДРОПАЕМ НОВЫЙ, а не старый:
 * диагностически ценна ПЕРВАЯ ошибка, всё остальное обычно её каскад.
 * ⚠️ НЕ переворачивать на drop-oldest — потеряешь первопричину.
 * @returns {boolean} true если положили, false если очередь полна (дроп)
 */
export function enqueueCapture(queue, item, max = CAPTURE_QUEUE_MAX) {
  if (queue.length >= max) return false;
  queue.push(item);
  return true;
}

/** Проиграть всё накопленное в `sink` (FIFO) и опустошить очередь. */
export function drainCaptureQueue(queue, sink) {
  while (queue.length) sink(queue.shift());
}

// Настоящий SDK-namespace, заполняется после `import('@sentry/react')`.
let sdk = null;
// Захваты, пришедшие до приезда SDK.
const pending = [];

/**
 * Фасад. Форма совместима с прежним re-export'ом namespace: вызывающие делают
 * `Sentry.captureException(err, ctx)` (`ctx` = captureContext — tags/contexts).
 * Синхронный, вызывается прямо из обработчиков границ / invokeFn.
 */
export const Sentry = {
  captureException(error, ctx) {
    if (!DSN) return;                                  // no DSN → no-op, как раньше
    if (sdk) { sdk.captureException(error, ctx); return; }
    enqueueCapture(pending, { error, ctx });           // буфер до idle-приезда SDK
  },
};

// Именованные обработчики (НЕ анонимки) — иначе removeEventListener молча не
// сработает после приезда SDK и uncaught-ошибки полетят в Sentry дважды.
function onGlobalError(event) {
  Sentry.captureException(event.error || event.message || 'window.onerror');
}
function onUnhandledRejection(event) {
  Sentry.captureException(event.reason ?? 'unhandledrejection');
}

async function loadRealSentry() {
  try {
    const S = await import('@sentry/react');
    S.init({
      dsn: DSN,
      environment: ENVIRONMENT,
      release: RELEASE,
      integrations: [
        S.browserTracingIntegration(),
        // Privacy-first replay: mask ALL text + inputs + media so the recording
        // captures layout/interaction structure, never real content.
        S.replayIntegration({ maskAllText: true, maskAllInputs: true, blockAllMedia: true }),
      ],
      // Tracing: sample 10% of transactions (browser + timed backend-call spans).
      // Not 1.0 — protect the shared free-plan quota; raise once stable.
      tracesSampleRate: 0.1,
      // Attach sentry-trace / baggage ONLY to the same-origin `/api/*` edge
      // transport (TRIP-432 façade → api/proxy.js → Supabase). This stitches the
      // browser trace to the edge error it triggered (TRIP-373). The pattern is
      // matched against the request URL, so a PATH regex (not a host) covers both
      // the relative `/api/getMe` and any absolute form. Deliberately narrow: it does
      // NOT match the direct supabase.co doors (Storage/Auth/realtime/gazetteer) —
      // those are cross-origin and would need the CORS allow-list to carry the
      // headers; they can be added here alongside that change when their trace is
      // wanted. `[]` (the old value) would disable propagation for EVERYTHING,
      // including same-origin.
      tracePropagationTargets: [/\/api\//],
      // Session Replay: record ONLY sessions where an error occurred (never healthy
      // traffic), so volume tracks error count, not user traffic.
      replaysOnErrorSampleRate: 1.0,
      replaysSessionSampleRate: 0,
      sendDefaultPii: false,
      ignoreErrors: IGNORE_ERRORS,
      // Vercel Live / Toolbar injects a feedback widget under /_next-live/* on dev &
      // preview deploys (never in production). Its rAF/web-vitals observers throw on
      // detached nodes — e.g. `selectNode ... has no parent` (InvalidNodeTypeError)
      // and `undefined is not iterable` — and our rAF/addEventListener wrappers report
      // them as ours. Third-party bundle, nothing to fix in our code → drop by source.
      denyUrls: [/\/_next-live\//],
      // Error events AND tracing transactions both go through the same PII scrub —
      // the URL (with any ?t= share token / ?code= OAuth) is dropped from both.
      beforeSend: scrubPii,
      beforeSendTransaction: scrubPii,
    });
    sdk = S;
    // Мост снят: дальше глобальные хендлеры ставит сам SDK (его
    // globalHandlersIntegration), наши бы дублировали.
    window.removeEventListener('error', onGlobalError);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
    // Проиграть всё, что накопилось за idle-зазор.
    drainCaptureQueue(pending, ({ error, ctx }) => S.captureException(error, ctx));
  } catch (e) {
    // Мониторинг не должен ронять приложение. SDK не приехал вовсе — ранние
    // слушатели ОСТАВЛЯЕМ (uncaught-ошибки всё ещё копятся в очередь под
    // потолком), но проиграть их некуда. В dev — видимый след.
    if (import.meta.env?.DEV) console.warn('[monitoring] Sentry SDK failed to load', e);
  }
}

export function initSentry() {
  if (!DSN) return;
  // Синхронный слой захвата — ставится ДО первого рендера (вызов из main.jsx
  // раньше рендера), закрывает окно «ошибка до приезда SDK».
  window.addEventListener('error', onGlobalError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  // Полный SDK — на простое, после рендера. `requestIdleCallback` с таймаутом
  // (образец в SiteChrome.jsx), фолбэк на setTimeout для движков без него.
  const schedule = typeof window.requestIdleCallback === 'function'
    ? (cb) => window.requestIdleCallback(cb, { timeout: 2000 })
    : (cb) => setTimeout(cb, 0);
  schedule(loadRealSentry);
}
