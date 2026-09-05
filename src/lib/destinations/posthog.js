// The PostHog destination — the ONE place the client is created and configured.
// CI guard 2j allows `posthog-js` and `posthog.init` HERE (and in analytics.js
// for capture/identify); nowhere else.
//
// СОГЛАСИЕ И ЛИЧНОСТЬ — РОДНЫЕ МЕХАНИЗМЫ SDK (TRIP-502). Своего кода вокруг них
// нет ни строчки: политику целиком объявляют две строки конфига, а переключают
// её два родных вызова.
//
//   opt_out_capturing_by_default  — до ответа не собираем
//   opt_out_persistence_by_default — до ответа не пишем на устройство, а отказ
//                                    стирает записанное (SDK сам зовёт remove())
//
// «Принять всё» → `opt_in_capturing()`: сбор и хранение включаются, и SDK САМ
// досылает начальный `$pageview` — при загрузке он его придержал. Отказ и отзыв
// → `opt_out_capturing()`. Ни один из двух вызовов НЕ сбрасывает клиент: сброс у
// SDK случается только при выходе из безкукового режима, а этот клиент в него не
// входит. Отсюда главное свойство: идентификатор у человека ровно один —
// анонимный, заведённый на согласии, — и `identify(uid)` сшивает его с аккаунтом.
//
// ЧТО ЗДЕСЬ УЖЕ ПРОБОВАЛИ И ПОЧЕМУ НЕ НАДО ВОЗВРАЩАТЬ.
// `persistence:'memory'` + `set_config` (TRIP-407): память умирает вместе с
// документом, поэтому OAuth-редирект рвал личность — приход и регистрация одного
// визита становились двумя людьми (замер прода: склеено 14 регистраций из 36).
// `cookieless_mode:'on_reject'` (TRIP-502, первая попытка): выход из безкукового
// режима SDK сопровождает `reset(true)`, поэтому «Принять всё» рождало лишний
// идентификатор; и главное — безкуковая персона у PostHog ВЫВОДИТСЯ сервером из
// хеша, у неё нет строки в `person_distinct_ids`, поэтому `identify` её ни с чем
// не сшивает (замер превью 05.09: клиент отправил корректный `$identify` с
// `$anon_distinct_id = cookieless_…`, персоны остались раздельными). Безкуковый
// режим сделан для анонимного счёта аудитории, а не для пути человека — так и
// написано в доке PostHog: «не следует идентифицировать пользователей в этом
// режиме».
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
// Registered once, right after init, and that is enough: neither consent call
// resets the client (the SDK only resets when it crosses the cookieless border,
// and this client never enters it), so the super-properties are never wiped.
// While the visitor has not answered, persistence is off and `register` keeps the
// value in memory only — this never touches the device before consent.
function tagEnv() {
  ph.register({ env: isProdHost ? 'prod' : 'dev' });
}

/**
 * Create the client. Idempotent, and a no-op where analytics is disabled (dev /
 * preview without the enable flag) or the token is absent. Called once from
 * main.jsx, BEFORE React mounts, so every `track()` on the first screen sees a
 * live client — silent until the stored answer turns capture on.
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
    // длительность сессии. До согласия он не уходит (сбор выключен), но и не
    // теряется: `opt_in_capturing()` в конце своей работы шлёт начальный
    // просмотр сам, потому что при загрузке флаг «уже слал» не взводился. Значит
    // у принявшего приход в воронке ЕСТЬ, и первая ступень воронки — именно
    // `$pageview`: наши события, выстрелившие до нажатия, отброшены безвозвратно.
    // `capture_pageleave` включается сам (`'if_capture_pageview'`) — без него нет
    // отказов.
    capture_performance: false,
    // Адрес уезжает в событие БЕЗ фрагмента. После OAuth-редиректа Supabase
    // кладёт в `#` пару access/refresh-токенов, и `$current_url` +
    // `$session_entry_url` увозили их в аналитику как обычную строку (замер
    // TRIP-500: живой JWT в свойстве события). Начиная с набора умолчаний
    // '2026-06-25' это дефолт SDK; мы на '2026-05-30', поэтому объявляем явно —
    // поднимать весь набор ради одного пункта значит менять заодно запись
    // canvas и тела запросов.
    disable_capture_url_hashes: true,
    // ВСЯ ПОЛИТИКА СОГЛАСИЯ — ЭТИ ДВЕ СТРОКИ (TRIP-502).
    // Первая: до ответа на баннер клиент считается отказавшимся, поэтому
    // `capture()` ничего не шлёт и никуда не копит — ноль хитов в сеть.
    opt_out_capturing_by_default: true,
    // Вторая обязательна, и её дефолт ОПАСЕН (`false`). Отключение хранилища SDK
    // считает как `disable_persistence || (отказался && opt_out_persistence_by_default)`,
    // то есть без этой строки persistence остаётся ВКЛЮЧЁННОЙ, пока человек не
    // ответил, и SDK пишет в localStorage ДО согласия. Она же делает отзыв
    // настоящим: отключение persistence внутри вызывает `remove()`, то есть SDK
    // сам стирает записанное.
    opt_out_persistence_by_default: true,
    // Replay is CONSENT-GATED, not off. The client boots before the banner is
    // answered, and a recording of the screen is the one thing that must never
    // happen on an unanswered visit; `onConsent` lifts it on a grant. WHICH
    // sessions are then recorded is NOT
    // decided here — that is the project's own ingestion config (trigger groups,
    // sampling), which lives in PostHog and changes without a deploy.
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
 * Hand the visitor's answer to the SDK — two native calls, nothing else.
 *
 * A grant turns capture and storage on, a refusal turns them off AND wipes what
 * was stored: both outcomes fall out of the two config lines in `boot` above,
 * where the mechanics are spelled out.
 *
 * A `null` record (never asked, expired, version moved) leaves the client alone —
 * it is already opted out by config, and there is nothing stored to undo.
 *
 * Only the analytics grant matters here — the Google and OpenAI sides are consent.js.
 *
 * @param {{analytics?: boolean}|null} record
 */
export function onConsent(record) {
  if (!isReady() || !record) return;

  if (record.analytics) {
    // No `$opt_in` event: consent is a state of the client, not an act worth a
    // step in the funnel. The SDK sends the initial `$pageview` here by itself —
    // it withheld it at load, so the arrival is not lost for whoever accepts.
    ph.opt_in_capturing({ captureEventName: false });
    // Lift the replay gate. No argument ON PURPOSE: a bare `startSessionRecording()`
    // OBEYS the project's ingestion controls, so this call says "allowed", never
    // "record this one".
    ph.startSessionRecording?.();
  } else {
    ph.opt_out_capturing();
  }
}
