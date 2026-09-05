# Triplanio: слой рекламной атрибуции (TRIP-316 → TRIP-514)

Как сейчас устроен учёт «откуда пришёл человек» и «когда он зарегистрировался».
Надстройка над продуктовой аналитикой TRIP-213 (`src/lib/analytics.js` = единая
точка событий, `supabase/functions/_shared/analytics.ts` = серверная).

## Один словарь меток — `MARKS` в `campaign.js`

Восемь строк: `utm_source/medium/campaign/content`, `gclid`, `gbraid`, `wbraid`
(Google на iOS вместо `gclid`), `oppref` (OpenAI/ChatGPT Ads). Из таблицы
выводятся все проекции: супер-свойства `camp_*`, проброс в исходящий адрес
(`campaignQuery`), whitelist метаданных (`pickSignupMarks`). Новая сеть = одна
строка. Триггер кампании — `utm_source` / `utm_campaign` / любой click-id
(click-id сам по себе = платный клик). Значения режутся по 200 символов
(`oppref` = 120). Колонки `users.signup_*` есть у 4 меток; `gbraid/wbraid/oppref`
колонок пока НЕ имеют (миграция + whitelist RPC — серверная фаза).

**Click-id едут в АДРЕСЕ, и это весь фикс атрибуции OpenAI (TRIP-514).** Сеть
привязывает конверсию к клику только по своему id, а её тег читает id из адреса
той страницы, где инициализирован — страница принятия баннера или регистрации,
не лендинг. Замер прода до строки `oppref`: 39 визитов с ним, 0 регистраций его
донесли.

## Носители: один на границу

- **Адрес.** Каждый выход из визита строится `withVisitCampaign` (CTA, `/login`,
  OAuth `redirectTo`, `postLoginHref` после One Tap) → `/trips?utm_…&oppref=…`;
  снимок `entrySearch` читает его на следующей загрузке. Переживает браузер,
  отказывающий в storage. **Стеша в sessionStorage больше нет** (снят в TRIP-502:
  второй носитель на границу, которую адрес уже переходит, — и тот, что реально
  терял платную регистрацию в приватном режиме).
- **Метаданные Supabase `signup_attribution`** — граница письма подтверждения
  (другое устройство). Читаются в `AuthContext` ТОЛЬКО на ветке создания строки
  `users` (`rememberSignupMarks`), иначе годовалый клик воскрес бы как свежий.
- **`attribution.js`**: `visitMarks` (адрес) || `recoveredMarks` (письмо) =
  `getActiveMarks()` — единственный вход `setCampaign()`.

## Метка кампании в PostHog

- Персистентные супер-свойства `camp_*` + `camp_ts`; имена свои, не `utm_*`
  (PostHog собирает `utm_*` сам, персистентное свойство с тем же именем перетёрло
  бы его). Last-touch, окно 30 дней, «тот же клик = одно касание» (TRIP-493).
- `setCampaign()` зовётся из `applyConsent` (ПОСЛЕ переключения согласия — выход
  из cookieless сбрасывает супер-свойства) и из `identifyUser` (метки, донесённые
  письмом). Работает и в cookieless-режиме (`register` пишет в память).
- `syncCampaignToPerson()` после каждого `identify`: person-свойства делают
  атрибутируемыми серверные события (покупка из вебхука Stripe). Бухгалтерия —
  `camp_synced_ts` в хранилище PostHog (не localStorage: `reset()` сносит метку и
  маркер разом). Остаток: метка, истёкшая после логаута, на person остаётся —
  `camp_ts` едет на person тоже.
- **First-touch (`$initial_*`) отдан родному блоку PostHog** (TRIP-407, решение 2):
  источник регистрации авторитетно — колонки `users.signup_utm_*` (пишутся раз,
  не перезаписываются). Деньги считать по ним, `camp_*` — для поведения и когорт
  (виральная ссылка перетирает last-touch, см. [[triplanio-viral-link-marking]]).
- **`identify` живёт в ОДНОМ месте** — `identifyUser()`; не гейтится баннером
  (см. [[triplanio-cookie-consent]]).

## Рекламные пиксели

- Оба грузятся ТОЛЬКО на маркетинговый грант, prod-only, спят без env
  (`VITE_GADS_TAG_ID`, `VITE_OPENAI_PIXEL_ID`); контракт `boot/onConsent/conversion`.
- **Google Ads** (`destinations/ads.js`): Consent Mode v2, `url_passthrough`,
  enhanced conversions — `gtag('set','user_data',{sha256_email_address})`.
- **OpenAI Ads** (`destinations/openaiAds.js`): `oaiq('init',{pixelId})` на
  грант; отзыв — родной `oaiq('consent', false)`;
  `conversion('registration', { eventId: uid, sha256_email })` = повторный
  `init` с `user.email_sha256` (родной способ задать user после факта; обновляет
  user, перечитывает `oppref` из адреса, второй пиксель не создаёт) +
  `measure('registration_completed', {type:'customer_action'}, {event_id})`.
  `event_id = uid` — ключ дедупа для будущего Conversions API.
- Хеш один на обе сети — `hashEmail.js` (trim + lowercase + SHA-256), сырой email
  наружу не уходит; `privacy.en.html` это декларирует.
- Точка конверсий одна — `AuthContext`, ветка `profileCreated`, после `identify`:
  сбой хеширования роняет только дайджест, конверсии уходят.
- Границы: без маркетингового согласия конверсия не уходит; email-регистрация по
  ссылке из письма идёт без click-id (в адресе его нет), только с хешем.
  Закрывает **серверная фаза** (отдельная задача): колонки `signup_oppref/gbraid/
  wbraid`, OpenAI Conversions API и импорт конверсий Google Ads с сохранённых id.

## События входа и регистрации

- **`user_signed_up` — единственная точка: `AuthContext.jsx`,** ветка создания
  строки `users`, после `identify`. Одинаково для Google / Apple / One Tap /
  email; подтверждение почты обязательно → это подтверждённая регистрация.
- `signup_email_sent` (письмо ушло), `signup_started` (намерение, на провайдерских
  кнопках), `signup_failed` с `reason`, `user_logged_in` (OAuth — по клику, One
  Tap — по успеху), `checkout_redirected`, `document_uploaded`.
- `method` — один словарь (`google`/`apple`/`email`), способ входа отдельным
  свойством (`surface: 'one_tap'`).

## Совместимость и гигиена

- QR шеринг-карточки клеит `utm_*` (`utm_source=share_card`, `utm_medium=viral`)
  — скан ставит метку наравне с рекламой, осознанно.
- `setRefTripId` / `ref_trip_id` (реферальный слой) без окна и без выезда на
  person — долг.
- Не скрывать в PostHog: `reminder_sent` (шлёт n8n), `esim_opened` и др. (шаблонная
  строка `${type}_opened` в `TripView.jsx`) — грепом не находятся.

## Проверка после деплоя

1. Приватное окно, `…/?utm_source=test&utm_campaign=smoke&gclid=x&oppref=y`,
   баннер не трогать → CTA → Google → регистрация: `landing_viewed`,
   `cta_clicked`, `user_signed_up` на ОДНОЙ персоне, все с `camp_*` включая
   `camp_oppref`.
2. То же с «Принять всё»: две персоны (хеш до нажатия + аккаунт) — ожидаемо;
   в OpenAI Ads Manager конверсия атрибутирована к клику (отчёт не realtime).
3. Колонки `users.signup_utm_*`/`signup_gclid` заполнены.

Связано: [[triplanio-cookie-consent]], [[triplanio-viral-link-marking]].
