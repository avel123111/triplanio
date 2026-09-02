// The PostHog destination — the ONE place the client is created and configured.
// CI guard 2j allows `posthog-js` and `posthog.init` HERE (and in ads.js); nowhere
// else.
//
// Identity is the SDK's OWN (TRIP-502). The anonymous `distinct_id` lives in the
// storage posthog-js manages by default, so it survives an OAuth redirect, a hard
// navigation and a second tab on its own, and `identifyUser()` at login stitches
// the anonymous history onto the account. The previous model booted into
// `persistence:'memory'` and upgraded it on consent (TRIP-407 variant B): that id
// died with every document, so `landing_viewed` and `user_signed_up` of the SAME
// visit were two different people — the acquisition funnel, retention and the
// per-person revenue link all broke (measured on prod: 2.5 identities per
// logged-in visitor, 33% of signups carrying a landing view, 63 people identified
// in a month). Carrying the id by hand across each redirect was tried and dropped:
// the border is the SDK's problem and the SDK already solves it.
//
// Storing that id before the banner is answered is declared in the privacy policy
// as first-party audience measurement. What makes that basis honest is the other
// half: a REFUSAL (or a withdrawal) stops capture and wipes what was stored —
// `stopAnalytics()` + `clearAnalyticsStorage()`.
//
// ONE flag, `phReady` — init has run. It gates `track()` and `identifyUser()`, and
// it drops on withdrawal so both stop together. Consent no longer gates identity;
// what it still gates is session REPLAY here and the Google Ads tag in `ads.js`.
// ★ ТОЧКА ВХОДА — `dist/module.slim.js`, А НЕ `posthog-js` (TRIP-475).
// Обычный вход тянет `dist/module.js` — 231 КБ уже собранного кода ОДНИМ куском,
// который сборщик разобрать не может. Внутри лежат РЕАЛИЗАЦИИ автозахвата
// кликов, тепловых карт, rage/dead-кликов, web-vitals, автоперехвата исключений,
// опросов и записи сессий — то есть ровно то, что мы ниже в `init` выключаем
// руками (`autocapture:false`, `enable_heatmaps:false`, `capture_performance:false`,
// `disable_session_recording:true`, `disable_surveys:true`). Мы платили 118 КБ за
// код, которому сами запретили запускаться, и платил их КАЖДЫЙ анонимный
// посетитель лендинга: замер — главный чанк 951 532 → 833 875 байт, brotli
// 260 167 → 230 925 (на прод-сжатии ≈ −36 КБ с критического пути).
// `module.slim.js` — официальная вторая точка входа ТОГО ЖЕ пакета (113 КБ), где
// эти реализации не собраны; ключи конфига остаются и безвредно игнорируются.
// Поведение не меняется ни в одном месте: хранение, `identify`, `camp_*`,
// `before_send` — всё как на полном входе.
// ⚠️ ЧТО СЛИМ НЕ УМЕЕТ: запускать визуальный тулбар PostHog — функции
// `maybeLoadToolbar` в нём НЕТ вовсе (в полной сборке она есть). Понадобится
// тулбар — вернуть полный вход придётся ВМЕСТЕ с ленивой загрузкой SDK, иначе
// 118 КБ снова уедут на критический путь.
// ⚠️ Глубокий путь, а не `posthog-js/slim`: у пакета нет поля `exports`, только
// `main`/`module`, поэтому короткого псевдонима не существует.
import posthog from 'posthog-js/dist/module.slim.js';
// Реплей приезжает ОТДЕЛЬНОЙ посылкой, потому что бандл slim (TRIP-475). Slim —
// это ядро: capture / identify / group. Всё остальное существует, только если
// передать его классы в `__extensionClasses` — и НЕ передать не значит «выключено»,
// значит «расширения нет»: `startSessionRecording()` тогда выставляет флаг, который
// внутри SDK читает `this.sessionRecording?.startIfEnabledOrStop()`, а он undefined.
// Ни ошибки, ни запроса, ни лога — запись просто не начинается (замер TRIP-500).
// Сам рекордер (rrweb, ~200 КБ) в бандл по-прежнему не попадает: он грузится с
// нашего /ingest по требованию, здесь только контроллер, решающий когда его звать.
import { SessionReplayExtensions } from 'posthog-js/dist/extension-bundles';
import { analyticsEnabledHere, isLocalhost, isProdHost } from '@/lib/analyticsEnv';

const POSTHOG_TOKEN = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN;

// The client. The live singleton in the app; swappable in tests, which cannot
// call the real `init` (it needs a DOM). Prod calls `boot()` with no argument, so
// this stays the real posthog everywhere it matters — the same singleton
// analytics.js captures through.
let ph = posthog;

let phReady = false;
// Session replay is the one thing consent still switches on here; the flag keeps
// `onConsent` idempotent (it runs on every start that has a stored grant).
let replaying = false;

/** @returns {boolean} init has run — the `track()` / `identifyUser()` gate */
export function isReady() {
  return phReady;
}

// Same-origin proxy on every DEPLOYED host (prod / www / dev / preview) via the
// vercel.json `/ingest` rewrite → no CORS, no cross-host redirect. Only true local
// `vite dev` lacks the rewrite, so there we post to PostHog EU directly.
function apiHost() {
  return isLocalhost
    ? (import.meta.env.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com')
    : `${window.location.origin}/ingest`;
}

/**
 * Create the client in memory-only mode. Idempotent, and a no-op where analytics
 * is disabled (dev / preview without the enable flag) or the token is absent — so
 * an absent/failed boot cannot leave `phReady` lying. Called once from main.jsx,
 * BEFORE React mounts, so every `track()` on the first screen sees a live client.
 *
 * @param {typeof posthog} [client]  test seam — prod calls `boot()` with no arg
 */
export function boot(client) {
  if (client) ph = client;
  if (phReady || !POSTHOG_TOKEN || !analyticsEnabledHere) return;
  ph.init(POSTHOG_TOKEN, {
    api_host: apiHost(),
    defaults: '2026-05-30',
    autocapture: false,
    capture_pageview: false, // our own page_view via track() replaces it (no dupe)
    capture_performance: false,
    // Адрес уезжает в событие БЕЗ фрагмента. После OAuth-редиректа Supabase
    // кладёт в `#` пару access/refresh-токенов, и `$current_url` +
    // `$session_entry_url` увозили их в аналитику как обычную строку (замер
    // TRIP-500: живой JWT в свойстве события). Начиная с набора умолчаний
    // '2026-06-25' это дефолт SDK; мы на '2026-05-30', поэтому объявляем явно —
    // поднимать весь набор ради одного пункта значит менять заодно запись
    // canvas и тела запросов.
    disable_capture_url_hashes: true,
    // Replay is CONSENT-GATED, not off. The client boots before the banner is
    // answered, and a recording of the screen is the one thing that must never
    // happen on an unanswered visit; `onConsent` lifts this. WHICH sessions are
    // then recorded is NOT decided here — that is the project's own ingestion
    // config (trigger groups, sampling), which lives in PostHog and changes
    // without a deploy.
    disable_session_recording: true,
    disable_surveys: true, // опросами не пользуемся — иначе SDK тянет ~33 КБ с их CDN (TRIP-475)
    // Код — единственный замок на сбор: настройка проекта (heatmaps_opt_in)
    // не должна включать сбор мыше-движений без нашего ведома (TRIP-328).
    enable_heatmaps: false,
    person_profiles: 'identified_only',
    // `persistence` is deliberately NOT set: the SDK default is what carries the
    // anonymous id across an OAuth redirect and a new tab (TRIP-502). Pinning it to
    // 'memory' is what broke the funnel — do not bring it back.
    // The privacy FLOOR of a replay — same reason as `enable_heatmaps` above
    // (TRIP-328): the project's masking settings only move the DEFAULTS of these
    // three, so a click in the PostHog UI can lower them, an explicit value here
    // cannot. WHICH sessions are recorded is policy and lives in the UI; WHAT a
    // recording may contain is safety and lives here.
    // Text is masked whole-sale (`*`) because most of what our screens show
    // belongs to OTHER people — a trip's members, their emails, the chat, file
    // names — who never saw our banner. An unmask-list would be a denylist: the
    // screen that forgets to join it leaks silently. `.avatar` is blocked on top,
    // since text masking does not touch images and a member's photo is their face
    // (it rides in as an inline `background-image`); one selector, because
    // <Avatar> is the single door onto every avatar in the product.
    session_recording: {
      maskTextSelector: '*',
      maskAllInputs: true,
      blockSelector: '.avatar',
    },
    __extensionClasses: { ...SessionReplayExtensions },
  });
  // `env` super-property tags every event → prod dashboards filter env=prod.
  ph.register({ env: isProdHost ? 'prod' : 'dev' });
  phReady = true;
}

/**
 * Apply a consent record to the client. Only the analytics grant matters here (the
 * Google side is consent.js), and since TRIP-502 it switches exactly one thing on:
 * session REPLAY. Capture and identity ride `phReady` and need no grant. Idempotent
 * — this runs on every start that has a stored grant.
 *
 * @param {{analytics?: boolean}|null} record
 */
export function onConsent(record) {
  if (!phReady || replaying || !record?.analytics) return;
  // Lift the replay gate. No argument ON PURPOSE: a bare `startSessionRecording()`
  // OBEYS the project's ingestion controls, so this call says "allowed", never
  // "record this one". Passing the override options would drag the recording
  // policy into the bundle and fork it from the settings in PostHog.
  ph.startSessionRecording?.();
  replaying = true;
}

/**
 * Stop feeding the client. `init()` cannot be undone, so this drops the gate and
 * opts the client out of capturing — the withdrawal path and the cross-tab
 * refusal. No queue to forget any more.
 */
export function stopAnalytics() {
  phReady = false;
  replaying = false;
  // Stopped explicitly rather than left to opt-out's side effects: a recorder
  // still running after a withdrawal is the one failure here nobody would see.
  ph.stopSessionRecording?.();
  ph.opt_out_capturing?.();
}
