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
// hashed person into the account). A refusal is `opt_out_capturing()`, applied
// at once: the SDK resets, wipes what it stored and goes back to cookieless.
//
// A GRANT IS NOT APPLIED AT THE BANNER — it waits for the account. Leaving
// cookieless mode makes the SDK reset itself (by design: no state is allowed to
// bleed between cookieless and stored events), so switching on the click orphans
// the arrival that came before it. Storage therefore starts in `onIdentified`,
// once `identify()` has glued the visit onto the account and there is nothing
// left to lose. The ordering rule — glue, switch, glue again, carrying the
// super-properties across the reset — lives in `consentSwitch.js`, where a fake
// SDK proves it; here we only supply the client and the answer.
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
import { CAMPAIGN_KEYS } from '@/lib/campaign';
import { identifyUnderConsent, preservingOwnProps } from '@/lib/consentSwitch';

const POSTHOG_TOKEN = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN;

// Супер-свойства, которыми владеет приложение. Один список, потому что переход
// через границу согласия сбрасывает клиент и сносит их ВСЕ разом — а восстановимы
// они по-разному: `camp_*` перечитает `setCampaign()` из адреса, `env` поставит
// `tagEnv()`, а `ref_trip_id` ставят экраны приглашения и публичного трипа, то
// есть ДО входа, и в момент переключения взять его неоткуда. Поэтому переносим
// весь набор одним механизмом: забыть строку здесь — единственный способ снова
// потерять свойство молча.
const OWNED_SUPER_PROPS = [...CAMPAIGN_KEYS, 'camp_synced_ts', 'ref_trip_id', 'env'];

// Разрешил ли посетитель хранение на устройстве. Ответ приезжает в `onConsent`,
// а применяется в `onIdentified` — см. докблок `consentSwitch.js`: включение
// хранения обнуляет личность, поэтому оно ждёт момента, когда личность уже
// приклеена к аккаунту.
let storageGranted = false;

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
    // `$pageview` — РОДНОЙ и включён (значение по умолчанию для нашего набора
    // `defaults` — `'history_change'`, то есть переходы внутри приложения ловятся
    // сами). Он был выключен явной строкой, а верх воронки собирался из своих
    // `landing_viewed` / `*_opened` — из-за чего в проекте пустовали ВСЕ отчёты,
    // которым нужен `$pageview`: источники трафика, страницы входа, отказы,
    // длительность сессии. В безкуковом режиме он тоже уходит (SDK шлёт первый
    // просмотр, если посетитель opted-in ИЛИ в безкуковом), поэтому приход
    // считается у всех, а не только у согласившихся. `capture_pageleave` при
    // этом включается сам (`'if_capture_pageview'`) — без него нет отказов.
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
 * Hand the visitor's answer to the SDK. Safe on every start and idempotent.
 *
 * A GRANT IS REMEMBERED, NOT APPLIED HERE (TRIP-502). Turning storage on takes
 * the client out of cookieless mode, and the SDK resets itself on that crossing
 * — deliberately, so cookieless and stored state never bleed into each other.
 * Doing that on the banner click orphans everything the visit did before it: the
 * arrival stays on a person nobody will ever claim, and the signup funnel loses
 * exactly the people who agreed to be measured. So the grant waits for the
 * moment the visit HAS an owner — `onIdentified`, right after the account is
 * known. Until then the client stays cookieless, which stores nothing anyway,
 * so nobody is measured beyond what they allowed.
 *
 * - grant   → remembered; storage (and session replay with it) starts at the
 *             next `onIdentified`.
 * - refusal → `opt_out_capturing()` now: the SDK resets, wipes what it stored,
 *             stops the recorder and goes cookieless — in every tab on its next
 *             load. A withdrawal must not wait for anything.
 * - null    → no usable answer. The SDK is already cookieless by config; the only
 *             thing to do is undo a grant it still remembers from an answer that
 *             has since expired or moved version.
 *
 * Only the analytics grant matters here — the Google side is consent.js.
 *
 * @param {{analytics?: boolean}|null} record
 */
export function onConsent(record) {
  if (!isReady()) return;
  storageGranted = record?.analytics === true;
  if (storageGranted) return;

  if (record || ph.has_opted_in_capturing()) {
    // The refusal resets the client too when it was opted in — carry the app's
    // super-properties across, or every later event loses its env tag and its
    // campaign.
    preservingOwnProps(ph, OWNED_SUPER_PROPS, () => ph.opt_out_capturing());
  }
}

/**
 * The account is known — glue this visit onto it, and start storing if the
 * visitor allowed it.
 *
 * THE ONE DOOR ONTO `$identify`, and the only place the client ever changes
 * storage mode. The order inside is the whole point and lives in
 * `consentSwitch.js`, where a fake SDK proves it: glue first, switch second,
 * glue again. Called by `analytics.identifyUser` — the app's single identify
 * seam (CI guard 2j).
 *
 * @param {string} uid  the Supabase user id — no PII ever goes to analytics
 */
export function onIdentified(uid) {
  if (!isReady()) return;
  identifyUnderConsent(ph, uid, { granted: storageGranted, ownedKeys: OWNED_SUPER_PROPS });
}
