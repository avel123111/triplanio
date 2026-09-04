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

## Правило имён (сделано механическим)

Переменная шаблона `X` → ключ **`<event>.email_X`**, а если это общая строка — **`common.email_X`**.
Таблицы соответствий нет и заводить не надо. Исключения из правила отсутствуют — проверено сплошным
проходом по всем трём шаблонам.

Не из Tolgee приезжают: URL-переменные (`cta_url`, `trips_url`, `settings_url`, `unsubscribe_url`,
`privacy_url`, `terms_url`) — их собирает n8n из `site_url` таблицы `environments` (`x6Bt3ir59yjKiiap`,
ключ `env`), и данные трипа (`trip_name`, `trip_dates`, `trip_countries`, `trip_days`, `members_count`).

**Имя человека — в ФИКСИРОВАННОЙ позиции, плейсхолдера внутри перевода НЕТ** (правило Pavel: переменная
внутри переменной не читается во флоу). Шапка письма собрана как `{{{greeting}}}<br>{{{heading}}}`, где
`greeting` = `common.email_greeting` + `, Имя` + `!` (склейка в n8n, имя всегда в конце, пустое имя даёт
просто «Привет!»), а `heading` — обычная строка без имени. Так во всех трёх письмах и на всех языках.

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

- Шаблон старого welcome `d1dd5d97-…` **удалён из Resend** (404), а лейн `Send email invite_resent1` всё ещё
  на него ссылается: лейн живой (PG-триггеры `PG Users_main/_dev` активны) и на каждой регистрации падает.
- Тот же лейн шлёт с топиком **Marketing emails**, а не Onboarding.
- `unsubscribe_url` там = `base + '/settings'` — маршрута `/settings` нет (есть `/account`), и это не отписка,
  а страница под логином.
- В макетах-вложениях футер вёл на `/legal/privacy` и `/legal/terms` — таких маршрутов нет, реальные
  `/privacy` и `/terms` (App.jsx). В шаблонах исправлено.
- Логотип в макетах — `triplanio-logo.svg`; **Gmail SVG не рисует**. В шаблонах заменён на `icon-192.png`.
- Стикер топиков в `Communications` перечисляет 4 топика из 5 — Onboarding в нём нет.
- `common.email_footer_settings` и `common.email_footer_rights` осиротели вместе со старым welcome
  (в trip-invite не используются). Не удалены — ждут решения.

## Открытое

- **Множественное число** у плиток `trip_days`/`members_count`: подпись — родительный падеж
  («дней в пути», «участников»), при значении 1 по-русски неверно. ICU-плюрал Tolgee отдать в плоскую
  Data Table нечем, выбор ключа по числу — логика во флоу. Решение за Pavel.
- Тема письма `reminder_has_trip` сделана без имени трипа («Твоя поездка ждёт продолжения») — вставка
  `trip_name` требовала бы либо плейсхолдера в переводе, либо склейки в теме.

См. [[feedback-new-i18n-keys-go-to-tolgee]], [[triplanio-i18n-tolgee-incontext]], [[triplanio-brand-mark-assets]].
