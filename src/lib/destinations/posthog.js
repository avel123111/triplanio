// The PostHog destination — the ONE place the client is created and configured.
// CI guard 2j allows `posthog-js` and `posthog.init` HERE (and in analytics.js
// for capture/identify); nowhere else.
//
// CONSENT AND IDENTITY ARE THE SDK'S OWN (TRIP-502). Two config lines say the
// whole policy, and the SDK carries it across documents by itself:
//
//   cookieless_mode: 'on_reject'      + opt_out_capturing_by_default: true
//
// Before the banner is answered, and after "Necessary only", the client runs in
// PostHog's cookieless mode: nothing is written to the device, the event goes
// out under the `$posthog_cookieless` sentinel, and PostHog's servers derive the
// person from a daily-salted hash of ip + user agent + host (the project runs
// the *stateful* server hash mode, which is what lets `identify()` merge that
// hashed person into the account — measured: landing, OAuth redirect, signup
// and identify land on ONE person). After "Accept all", `opt_in_capturing()`
// switches the SAME client to the SDK's default storage (localStorage+cookie),
// so the id survives redirects, tabs and reloads on its own; a later refusal is
// `opt_out_capturing()`, which resets and wipes what was stored and goes back
// to cookieless. Session replay is the one thing consent still switches on here.
//
// What this replaced, so nobody brings it back: TRIP-407 booted the client into
// `persistence:'memory'` and flipped it with `set_config` on consent — a mode
// PostHog does not have. That id died with every document, so `landing_viewed`
// and `user_signed_up` of ONE visit were two people (measured on prod: 11 of 32
// signups stitched, 2.3 identities per logged-in visitor), and a whole layer of
// our own flags, stashes, wipes and reloads grew around it. The SDK's own consent
// API needs none of that.
//
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

/**
 * Has `init` run — the SDK's own `__loaded`, not a flag of ours. False on every
 * host where analytics is disabled (dev / preview without the enable flag), and
 * the gate `track()` / `identifyUser()` read so those calls stay silent there
 * instead of logging the SDK's "not initialized" warning on every screen.
 * @returns {boolean}
 */
export function isReady() {
  return ph.__loaded === true;
}

// Same-origin proxy on every DEPLOYED host (prod / www / dev / preview) via the
// vercel.json `/ingest` rewrite → no CORS, no cross-host redirect. Only true local
// `vite dev` lacks the rewrite, so there we post to PostHog EU directly.
function apiHost() {
  return isLocalhost
    ? (import.meta.env.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com')
    : `${window.location.origin}/ingest`;
}

// `env` super-property tags every event → prod dashboards filter env=prod.
// Registered after init AND after every consent switch: crossing the cookieless
// ↔ stored border resets the client, and a reset wipes the super-properties.
// In cookieless mode `register` keeps the value in memory only (the SDK skips
// load/save while persistence is disabled), so this never touches the device.
function tagEnv() {
  ph.register({ env: isProdHost ? 'prod' : 'dev' });
}

/**
 * Create the client. Idempotent, and a no-op where analytics is disabled (dev /
 * preview without the enable flag) or the token is absent. Called once from
 * main.jsx, BEFORE React mounts, so every `track()` on the first screen sees a
 * live client — in cookieless mode until the stored answer is applied.
 *
 * @param {typeof posthog} [client]  test seam — prod calls `boot()` with no arg
 */
export function boot(client) {
  if (client) ph = client;
  if (isReady() || !POSTHOG_TOKEN || !analyticsEnabledHere) return;
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
    // The consent policy, in the SDK's own terms (see the module docblock):
    // no answer = cookieless from the first event, "Accept all" = the SDK's
    // default storage, "Necessary only" = cookieless again. Pinned by
    // posthog.test.js — `persistence:'memory'` + `set_config` is what broke the
    // funnel (TRIP-502), do not bring it back.
    cookieless_mode: 'on_reject',
    opt_out_capturing_by_default: true,
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
  tagEnv();
}

/**
 * Hand the visitor's answer to the SDK. Safe on every start and idempotent:
 * both SDK calls are no-ops when the client is already in that state, and the
 * client only resets when it actually crosses the cookieless ↔ stored border.
 *
 * - grant   → `opt_in_capturing()` (the SDK's default storage takes over; coming
 *             out of cookieless mode the SDK resets) + session replay allowed.
 * - refusal → `opt_out_capturing()` (SDK resets + wipes what it stored, stops the
 *             recorder, goes cookieless — in every tab on its next load).
 * - null    → no usable answer. The SDK is already cookieless by config; the only
 *             thing to do is undo a grant the SDK still remembers from an answer
 *             that has since expired or moved version.
 *
 * Only the analytics grant matters here — the Google side is consent.js.
 *
 * @param {{analytics?: boolean}|null} record
 */
export function onConsent(record) {
  if (!isReady()) return;
  if (record?.analytics) {
    ph.opt_in_capturing({ captureEventName: false });
    // Lift the replay gate. No argument ON PURPOSE: a bare `startSessionRecording()`
    // OBEYS the project's ingestion controls, so this call says "allowed", never
    // "record this one". Passing the override options would drag the recording
    // policy into the bundle and fork it from the settings in PostHog.
    ph.startSessionRecording?.();
  } else if (record || ph.has_opted_in_capturing()) {
    ph.opt_out_capturing();
  }
  // Either switch resets the client when it crosses the cookieless ↔ stored
  // border, and a reset wipes the super-properties — put the env tag back.
  tagEnv();
}
