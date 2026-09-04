---
name: triplanio-onboarding-emails-pipeline
description: "Triplanio: письма онбординга (welcome + 2 догонялки) — конвейер Tolgee → n8n Data Table → Resend-шаблон, топик Onboarding, лигал-футер и отписка TRIP-513"
metadata:
  type: memory
---

# Онбординг-письма: Tolgee → n8n → Resend

Три письма: `welcome`, `reminder_has_trip`, `reminder_no_trip`. Флоу в n8n НЕ построен —
подготовлены только ключи, шаблоны и контракт (04.09.2026).

## Конвейер (это и есть «специфика n8n с Tolgee»)

Текст в n8n приезжает НЕ живым запросом в Tolgee, а через **n8n Data Table**:

1. Воркфлоу **`Tolgee sync`** (`uZI5SoCmojYavV43`) — `GET /v2/projects/2/translations?languages=en,ru,es&filterNamespace=n8n&size=1000`
   → Code-нода `Flatten` → upsert в Data Table `dGmdnXlqVgfVfrM8` (колонки `event|key|lang|translation`).
2. `Flatten` режет `keyName` **по ПЕРВОЙ точке**: `welcome.email_subject` → `event=welcome`, `key=email_subject`.
   Значит **префикс ключа в Tolgee = имя события = значение фильтра Data Table = путь вебхука `/notify/<event>`**. Одно имя на четыре места.
3. Воркфлоу **`Communications (per-event)`** (`oHzdeXZ1hP67gaRW`): нода `Get texts_<event>` тянет строки
   по `event=<событие>` И `event=common`, нода `Map` сворачивает их в `t[lang][key]`, `Email vars` раскладывает
   по переменным шаблона, Resend-нода шлёт с `useTemplate:true` + `additionalOptions.topicId`.

**Ловушки конвейера:**
- **`Tolgee sync` запускается ТОЛЬКО руками** (manual trigger, воркфлоу неактивен). Правка в Tolgee сама
  до писем НЕ доедет — после любой правки ключей надо открыть воркфлоу и нажать Execute.
- **upsert НИКОГДА не удаляет.** Ключ, снесённый в Tolgee, остаётся в Data Table навсегда и продолжает
  приезжать в `t[lang]`. Удаление ключа = удалить его и в Data Table руками.
- **`common.*` и событие делят ОДНО пространство имён** `t[lang]`: одинаковый хвост у двух событий
  затрёт друг друга (`common.email_subject` убил бы `welcome.email_subject`). Хвосты держать различными.
- `size=1000` — потолок на КЛЮЧИ (сейчас 75), пагинации в ноде нет.
- Фронт этот словарь не читает: `dictionary.js` исключает `locales/*/n8n.json` из бандла. Гард 2x
  (`check-i18n-dynamic-keys`) требует семейство `n8n.<event>.*` под каждый `emit('<event>')` — `emit(` в дереве пока нет.

## Имена ключей

Переменная шаблона `X` в большинстве случаев даёт ключ `<event>.email_X` (общая строка —
`common.email_X`), но это НАБЛЮДЕНИЕ, а не закон: неочевидных четыре — `cta_label` →
`<event>.email_cta`, `trip_days_label` → `reminder_has_trip.email_days_label`, `greeting` →
`common.email_greeting`, `unsubscribe_label` → `common.email_footer_unsubscribe`.

⚠️ Попытка сделать соответствие МЕХАНИЧЕСКИМ (переименовать ключи в форму `email_<var>`) была
ошибкой и откачена: нода `Email vars` перечисляет каждую переменную руками — она и ЕСТЬ таблица
соответствий, автоматического вывода имени в n8n не происходит, так что переименование не давало
ничего. Зато оно ломало конвенцию (`invite_created.email_cta` рядом с `welcome.email_cta_label`) и
оставило 10 осиротевших строк в Data Table, которые пришлось выпиливать отдельно (см. ловушку про
upsert ниже — она сработала ровно на этом).

Не из Tolgee приезжают: URL-переменные (`cta_url`, `trips_url`, `settings_url`, `unsubscribe_url`,
`privacy_url`, `terms_url`) — их собирает n8n из `site_url` таблицы `environments` (`x6Bt3ir59yjKiiap`,
ключ `env`), и данные трипа (`trip_name`, `trip_dates`, `trip_countries`, `trip_days`, `members_count`).

**Имя человека — в ФИКСИРОВАННОЙ позиции, плейсхолдера внутри перевода НЕТ** (правило Pavel: переменная
внутри переменной не читается во флоу). Шапка письма собрана как `{{{greeting}}}<br>{{{heading}}}`, где
`greeting` = `common.email_greeting` + `, Имя` + `!` (склейка в n8n, имя всегда в конце, пустое имя даёт
просто «Привет!»), а `heading` — обычная строка без имени. Так во всех трёх письмах и на всех языках.

**id контакта Resend** для ссылки отписки и заголовка `List-Unsubscribe` берётся нодой Resend
`Contact → Get`: поле подписано «By ID», но принимает и АДРЕС (Resend адресует контакт как
`{id_or_email}`) — на выходе весь контакт вместе с `id`. Для welcome id отдаёт сама нода создания
контакта, поэтому создание контакта обязано стоять во флоу ЛИНЕЙНО перед отправкой, а не параллельно ей.

**Тема** `reminder_has_trip` собирается тем же приёмом: `<trip_name>` + значение
`reminder_has_trip.email_subject` («— поездка ждёт продолжения»), имя трипа В НАЧАЛЕ на всех языках.
`<title>` в HTML темой НЕ является — почтовики его не показывают; тему задаёт поле вызова отправки.

## Resend

Шаблоны (published, `{{{тройные скобки}}}`, весь текст — переменные, своей копии в шаблоне нет):

| событие | шаблон / alias | id | перем. |
|---|---|---|---|
| `welcome` | `onboarding-welcome` | `753c8224-485e-4f26-85ca-ac4749699b59` | 29 |
| `reminder_has_trip` | `onboarding-reminder-has-trip` | `f40c16db-e298-4edd-9c4e-bf0a2eb9d1d1` | 33 |
| `reminder_no_trip` | `onboarding-reminder-no-trip` | `164afe57-98d3-42a9-9a66-4301d206b1a9` | 29 |

**Топик у всех трёх — `Onboarding` (`842c9873-2e0f-434f-8eef-76c79e15ead3`)**, он же пятый переключатель
экрана TRIP-513. Топик — параметр ОТПРАВКИ (`topic_id`), а не свойство шаблона: в шаблоне его не хранят,
его ставит Resend-нода. Гарантия документирована у `/emails`: контакт отписан от топика → письмо не уходит
и помечается `failed`. Почему не «Новости Triplanio» — см. коммит `00d20c0`: один переключатель на две
несвязанные вещи врёт о том, что выключает.

Потолок — **50 переменных на шаблон**; зарезервированы (объявлять нельзя) `FIRST_NAME`, `LAST_NAME`,
`EMAIL`, `UNSUBSCRIBE_URL` — только В ВЕРХНЕМ РЕГИСТРЕ, строчный `unsubscribe_url` принимается.

## Лигал-футер и отписка

`RESEND_UNSUBSCRIBE_URL`, хостовая страница предпочтений и автоматический `List-Unsubscribe` — это про
**Broadcasts и Automations**. Наши письма идут через `/emails`, а там дока прямо говорит: списками
Resend не управляет, заголовок ставит отправитель. Поэтому обе двери — наши, из TRIP-513:

- ссылка «Отписаться» в футере → `<site_url>/email-preferences?c=<resend_contact_id>`;
- заголовки почтовика (RFC 8058, обязательны для Gmail/Yahoo при bulk) →
  `List-Unsubscribe: <https://<edge>/emailPrefs?c=<id>>` и `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
  Resend-нода умеет `additionalOptions.headers`.

Оба пути упираются в **id контакта Resend** — он и есть неподделываемый токен, в приложении не появляется
нигде, поэтому n8n обязан его добыть (создание контакта возвращает id; для догонялок — искать по адресу).
`GET` на `emailPrefs` ничего не меняет и уводит 302 на страницу; одноклик `POST` гасит флаг И все топики.

## Что найдено сломанным (не чинилось — флоу перестраивается)

- Шаблон старого welcome `d1dd5d97-…` **удалён из Resend** (404), а нода `Send email invite_resent1` всё ещё
  на него ссылается. Но она **ВЫКЛЮЧЕНА** (`disabled: true` — единственная выключенная во всём воркфлоу),
  поэтому НИЧЕГО НЕ ПАДАЕТ: в истории ноль ошибок с триггера, welcome просто не отправляется.
  PG-триггеры при этом живые и контакт в Resend на регистрации создаётся.
- Та же нода настроена на топик **Marketing emails**, а не Onboarding.
- `unsubscribe_url` там = `base + '/settings'` — маршрута `/settings` нет (есть `/account`), и это не отписка,
  а страница под логином.
- В макетах-вложениях футер вёл на `/legal/privacy` и `/legal/terms` — таких маршрутов нет, реальные
  `/privacy` и `/terms` (App.jsx). В шаблонах исправлено.
- Логотип в макетах — `triplanio-logo.svg`; **Gmail SVG не рисует**. В шаблонах заменён на `icon-192.png`.
- Стикер топиков в `Communications` перечисляет 4 топика из 5 — Onboarding в нём нет.
- Нода `Create a new contact2` в том же лейне НЕ мёртвая: это единственное место, где юзер заводится
  контактом в Resend, а без контакта не работают ни топики, ни отписка. Лейн нельзя снести целиком —
  его надо перебирать вместе с постройкой флоу.

## Открытое

- **Множественное число** у плиток `trip_days`/`members_count`: решено ВСЕГДА держать множественную
  форму («дней в пути», «участников»), выбора ключа по числу во флоу нет.
- Тема письма `reminder_has_trip` сделана без имени трипа («Твоя поездка ждёт продолжения») — вставка
  `trip_name` требовала бы либо плейсхолдера в переводе, либо склейки в теме.

См. [[feedback-new-i18n-keys-go-to-tolgee]], [[triplanio-i18n-tolgee-incontext]], [[triplanio-brand-mark-assets]].
