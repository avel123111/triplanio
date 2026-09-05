# Triplanio: согласие на cookie — механика SDK, не своя (TRIP-311 → TRIP-502)

Как это устроено сейчас.

## Несущий принцип

Клиент PostHog создаётся **на каждой загрузке**, до первого рендера (`main.jsx` →
`destinations/posthog.js#boot`), а согласие — это **родной consent-режим SDK**,
две строки конфига:

```
cookieless_mode: 'on_reject'
opt_out_capturing_by_default: true
```

- **Нет ответа / «Только необходимые»** → SDK сам в cookieless-режиме: на
  устройство не пишется ничего (persistence выключен, `register()` держит
  супер-свойства в памяти), событие уходит с сентинелом `$posthog_cookieless`,
  персону считает **сервер** PostHog по дневному хешу `ip + UA + host` (проект
  224522 в *stateful* hash-режиме).
- **«Принять всё»** → `opt_in_capturing({ captureEventName: false })`: тот же
  клиент переключается на дефолтное хранилище SDK (localStorage + cookie), id
  переживает редиректы, вкладки и перезагрузки сам.
- **Отзыв** → `opt_out_capturing()`: SDK сбрасывает клиент, стирает записанное,
  глушит рекордер и возвращается в cookieless.
- **`identify(uid)` НЕ гейтится баннером.** В cookieless-режиме он ничего не
  пишет на устройство, а сервер склеивает хеш-персону визита в аккаунт
  (замерено спайком: лендинг → OAuth-редирект → регистрация → identify = одна
  персона). Аккаунт-id — псевдонимный ключ, который мы и так держим по договору;
  баннер решает ХРАНЕНИЕ на устройстве, не связь с аккаунтом. Гейт identify на
  согласии — это то, что рвало воронку регистрации (TRIP-502).

Порядок применения ответа — один, `consent.js#applyConsent(record|null, user)`:
Google Consent Mode (`gtag('consent','update')`, только при записи) → пиксели
(`ads.js`, `openaiAds.js`: грузятся на маркетинговый грант, отзыв уходит в
родной `oaiq('consent', false)`) → PostHog `onConsent` → `setCampaign()` →
`identifyUser(user?.id, user)`. Вызывается **на каждом старте** (`main.jsx`, с
записью или `null`) и **на каждом ответе** (баннер, с профилем вошедшего). Всё
идемпотентно, opt-in событие не шлётся. Вторым аргументом едет ПРОФИЛЬ целиком,
а не uid: персона несёт `email`+`name`, и мэппинг живёт только в `identifyUser`
([[triplanio-analytics-person-identity]]).

Ничего самодельного не осталось: нет `persistence:'memory'` + `set_config`
(вариант B TRIP-407, см. ниже), нет ручного вайпа `ph_*`-ключей и кук, нет
`storage`-листенера межвкладочной тишины, нет перезагрузки на отказе, нет
`isPersisting`/`mayIdentify`. Пины в `destinations/posthog.test.js`
(конфиг без `persistence:`/`set_config`, `on_reject`, `opt_in`/`opt_out` в
`onConsent`), каждый увиден красным мутацией.

## Что где лежит

- `src/lib/destinations/posthog.js` — единственное место `posthog.init`
  (гард 2j, правило B), `isReady()` = `ph.__loaded`, `onConsent(record)`,
  `tagEnv()`. Реплей поднимается только в `onConsent` на грант
  (`disable_session_recording:true` в init), масочный пол — в коде.
- `src/lib/consent.js` — владелец записи: `getConsent` / `setConsent` /
  `applyConsent` / `openConsentBanner` / `subscribeConsentOpen`.
- `src/lib/consent-record.js` — чистый разбор записи (версия, срок 12 мес, битый
  JSON, «truthy != true»), под `node --test`.
- Запись: `localStorage["tp-consent"] = {v, ts, analytics, marketing}`;
  `marketing` всегда равен `analytics` (одна фраза на обе цели, раздельный
  вопрос = TRIP-227 + бамп `CONSENT_VERSION`). **Наша запись — источник истины**,
  а не копии SDK: она переприменяется на каждом старте.
- `src/components/ConsentBanner.jsx` — оба ответа = `setConsent` +
  `applyConsent(record, user)`, без ветвлений.

## Ловушки, за которые заплачено

- **Выход из cookieless на грант — это `reset(true)` внутри SDK**: стираются
  супер-свойства (`env`, `camp_*`). Поэтому `tagEnv()` зовётся после ОБОИХ
  переключений (opt_out тоже сбрасывает), а `setCampaign()` — ПОСЛЕ
  `onConsent`, никогда до.
- **События до «Принять всё» в аккаунт НЕ склеиваются — по построению SDK**
  (комментарий в исходнике: «no leaking of state or data between the cookieless
  and regular events»). У принявшего на лендинге `landing_viewed` остаётся на
  хеш-персоне, `cta_clicked → user_signed_up` уже на аккаунте. Не ответившие и
  отказавшие склеиваются целиком (хеш → identify). Это юридически верное свойство
  cookieless-данных; форма воронки на дашборде — от `cta_clicked`,
  `landing_viewed` как счётчик визитов.
- **`posthog.reset()` на логауте стирает и копию согласия SDK** → клиент в том же
  документе уходит в cookieless. Каждый логаут заканчивается полной загрузкой
  `/login`, где `main.jsx` переприменяет `tp-consent`; в промежутке ничего не
  пишется.
- **Другая вкладка** узнаёт о смене ответа на своей следующей загрузке, живого
  зеркала нет (фоновая вкладка может держать несохранённую работу).
- **Отказ пишет `__ph_opt_in_out_<token>=0`** — это хранение самого выбора,
  необходимое, чтобы его соблюдать (как и `tp-consent`).
- **«Настройки cookie» не отзывают согласие.** Кнопка открывает баннер и не
  трогает запись.
- **Приватный режим.** `localStorage.setItem` бросает — использовать запись,
  которую вернул `setConsent`, а не перечитывать `getConsent()`.
- **`user_metadata` клиентский.** Whitelist меток — на сервере (RPC
  `create_user_profile` берёт ровно 4 колонки `signup_*`), лишние ключи
  игнорируются.

## Отвергнутое (не возвращать)

- **Вариант B (TRIP-407): `persistence:'memory'` + `set_config` на согласии +
  identify за согласием.** Режим, которого у PostHog нет: id умирал с каждым
  документом (OAuth-редирект), одна сессия рождала 2–4 персоны, воронка
  `landing_viewed → cta_clicked → user_signed_up` показывала 1 регистрацию при
  17 в БД (склеено 11 из 32, 2.3 личности на залогиненного). Вокруг выросли свои
  флаги, вайпы, стеши и перезагрузки.
- **«PostHog не существует до ответа»** (исходный TRIP-311) — терял ПЕРВЫЙ экран
  каждого новичка и всех не ответивших.
- Кука `__oppref` руками, стеш `distinct_id` в sessionStorage, bootstrap id —
  всё это подмена механик SDK своими.

## Гард 2j (`scripts/ci/check-analytics-seam.mjs`)

Правила A (`posthog-js` только в `analytics.js` + `destinations/posthog.js`),
B (`init` только в адаптере), C (ключ/хост ингеста только в
`_shared/analytics.ts`), D (единственный `signUp` несёт `signup_attribution`),
F (`postLoginPath()` только на уровне модуля). Правило E (стеш меток перед
провайдером) снято в TRIP-502 вместе со стешем. Тест
`check-analytics-seam.test.mjs`, каждое правило увидено красным.

## Юридический слой

Баннер немодальный: без скрима, крестика, focus-trap и блокировки скролла; обе
кнопки одного размера. `consent default` со всем `denied` — инлайном в `<head>`
вызовом функции. `privacy.en.html`: cookieless = дневной хеш, после входа
активность под номером аккаунта независимо от баннера (законный интерес,
возражение через support@), оба рекламных партнёра получают SHA-256 email.
Принято осознанно: связанное согласие (две кнопки); серверного журнала согласий
нет — серверная фаза (журнал + переключатель в аккаунте) отдельной задачей.

Связано: [[triplanio-ad-attribution-layer]], [[feedback-new-i18n-keys-go-to-tolgee]].
