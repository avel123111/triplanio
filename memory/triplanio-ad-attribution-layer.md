# Triplanio: слой рекламной атрибуции (TRIP-316)

Как сейчас устроен учёт «откуда пришёл человек» и «когда он зарегистрировался».
Надстройка над продуктовой аналитикой TRIP-213 (см. `src/lib/analytics.js` =
единая точка событий, `supabase/functions/_shared/analytics.ts` = серверная).

## Метка кампании

- Хранится как **персистентные супер-свойства** `camp_source`, `camp_medium`,
  `camp_campaign`, `camp_content`, `camp_gclid` + служебный `camp_ts`.
- Имена **свои, не `utm_*`**: PostHog собирает `utm_*` сам на том заходе, где
  они есть в адресе; персистентное свойство с тем же именем молча перетёрло бы
  его на всех последующих событиях и сломало веб-аналитику.
- Чистая логика в `src/lib/campaign.js` (модуль **без импортов** ради
  `node --test`, как `trip-cities.js`), тесты `campaign.test.js`. Провязка с
  PostHog в `analytics.js`: `setCampaign()` (register/unregister) и
  `attachCampaignToPerson()` (`setPersonProperties`).
- `setCampaign()` вызывается в `main.jsx` **до первого рендера**: `landing_viewed`
  летит из эффекта в `App.jsx`, позже метки уже не будет на самом клике.
- Правила: **last-touch** (новая кампания перетирает старую целиком), **окно 30
  дней** (`camp_ts` старее - метка снимается), значения режутся по 200 символов.
- Триггер захвата - `utm_source` **или** `utm_campaign` **или** `gclid`: Google
  auto-tagging шлёт `gclid` без utm, требование «только при utm_campaign»
  выбросило бы ровно платные клики.

### Грабли, которые нужно помнить

- Метка едет **не в URL, а в хранилище PostHog** - поэтому переживает редирект
  на экран Google и возврат на `/trips`, где query-строки уже нет
  (`postLoginPath()` возвращает голый путь, и это не баг атрибуции).
- Хранилище **пер-хост**: ссылка в кампании обязана вести на тот же хост, где
  живёт приложение. `www` и apex - разные хранилища, метка потеряется.
- Safari режет script-storage раньше 30 дней (ITP), цифры по iOS будут занижены.
- Встроенные `$initial_utm_*` / `$initial_gclid` / `$initial_referring_domain`
  PostHog пишет **сам** и это **first**-touch, наш слой - last-touch. Не путать.
- Метка на person - это то, что делает атрибутируемыми **серверные** события
  (покупка рождается в вебхуке Stripe): в проекте включён person-on-events.
  Ставится только после `identify` - при `person_profiles: 'identified_only'`
  до логина писать некуда.

## События входа и регистрации

- **`user_signed_up` - единственная точка: `AuthContext.jsx`,** ветка создания
  строки `public.users` (ошибка `PGRST116`), после `posthog.identify`. Строка
  создаётся ровно раз и одинаково для Google / Apple / One Tap / email;
  триггера на `auth.users`, который делал бы это за нас, **нет** (проверено на
  проде). По кнопкам логина вешать нельзя - их четыре.
- Подтверждение почты **обязательно** (`mailer_autoconfirm = false` на проде),
  поэтому email-регистрация доходит до этой точки только после клика в письме,
  и `user_signed_up` = **подтверждённая** регистрация.
- `signup_email_sent` (`Login.jsx`) - письмо ушло, человек на экране «проверь
  почту». Это НЕ регистрация; ровно здесь раньше стоял `user_signed_up`.
- `signup_started` - намерение зарегистрироваться (микроконверсия под Google Ads,
  их в 5-10 раз больше, чем регистраций). На провайдерских кнопках
  `trackAuthIntent()` шлёт `signup_started` на форме регистрации и
  `user_logged_in` на форме входа.
- `signup_failed` с `reason`: `weak_password`, `email_exists`, `rate_limited`,
  `retry_soon`, `precheck_failed`, `signup_error`, `oauth_error`.
- `user_logged_in` для OAuth фиксируется **по клику**, а не по успеху (это так
  и было); у Google One Tap - наоборот, по успеху.
- `checkout_redirected` (`Pro.jsx`) - долетел до страницы Stripe.
- `document_uploaded` (`DocsLens.jsx`) со свойствами `visibility` и `file_kind`
  (переиспользует `fileType()`), вместо прежних `document1_/document2_uploaded`,
  где цифры означали «общий/личный». Типа документа (паспорт/страховка) в модели
  **нет**, расширение файла - всё, что мы знаем.

## Осознанные отказы

- **`email_confirmed`** не заводим: после переноса `user_signed_up` он летел бы
  в ту же секунду с тем же смыслом.
- **`is_first` на `trip_created`** не заводим: активация выводится в PostHog из
  первого события человека. Клиентский кэш трипов ненадёжен - может быть не
  загружен и включает трипы, куда человека только пригласили (решение TRIP-213,
  комментарий стоит на месте вызова в `ManualPlanner.jsx`).
- Возврат `capture_pageview`, multi-touch атрибуция, скролл-глубина лендинга -
  вне скоупа (см. TRIP-213 и TRIP-309).

## Гигиена таксономии PostHog

Скрыты как мёртвые (последнее событие 21.07.2026): `page_view`,
`section_opened`, `booking_added`, `service_opened`, `transfer_booking_added`,
`pro_payment_completed`.

**НЕ скрывать, вопреки первому впечатлению:**

- `reminder_sent` - живое, шлёт **n8n** (`$lib=n8n`), в коде репозитория его
  поэтому и не найти;
- `esim_opened` / `car_rental_opened` / `insurance_opened` - живые, шлёт
  `TripView.jsx` **шаблонной строкой** `` `${type}_opened` ``, поэтому грепом по
  имени не находятся.

Мораль: перед скрытием события проверять не только грep по `src/**`, а ещё n8n и
шаблонные имена. Зеркало [[feedback-dead-i18n-key-sweep-must-scan-backend]].

## Проверка после деплоя (обязательна, пока не пройдена - цифры по каналам врут)

1. Приватное окно, `https://triplanio.com/?utm_source=test&utm_medium=test&utm_campaign=smoketest_YYYYMM`
2. `landing_viewed` несёт метку
3. Регистрация **через Google** (полный редирект наружу и обратно)
4. `user_signed_up` несёт **ту же** метку - это и есть проверка, что она пережила OAuth
5. Создать трип - `trip_created` несёт её же
6. Метка видна в свойствах person

Запасной путь (если метка всё-таки теряется на OAuth): класть её в
`sessionStorage` перед `signInWithOAuth` и восстанавливать после возврата.
Заранее не делаем.

## Состояние ключей

`POSTHOG_PROJECT_KEY` стоит и на dev, и на **prod**; серверный шов доказан живым
(`telegram_connected` с `$lib=edge` и `env=prod` доехал в PostHog).
