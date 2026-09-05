---
name: feedback-new-i18n-keys-go-to-tolgee
description: Новые i18n-ключи заводить В TOLGEE, не только в repo JSON — иначе pull-on-deploy стирает их на dev/prod (сырой ключ на экране)
metadata:
  type: feedback
---

★TRIP-176 2026-07-03 (Pavel: «так почему ты не создаёшь переводы на новые ключи в tolgee когда их вводишь?»): вводил новые ключи (`fork.tab_find_hotel/activity/transfer`, `fork.tab_have_booking`, `event.dep_arr`, `event.route_direct`, `event.when`, `event.stay_dates`, `event.booking_details*`, `event.docs_notes`) ТОЛЬКО в `src/lib/i18n/locales/<lang>/<ns>.json` → на dev рендерились сырым ключом.

**Почему:** воркфлоу `.github/workflows/i18n-sync.yml` (раз в сутки + кнопка «Run workflow») делает `tolgee pull`, который **перезаписывает** (не мёржит) файлы `locales/<lang>/<ns>.json` полным экспортом из Tolgee (project 2), и приносит результат PR-ом в `dev`. Значит:
- ключа НЕТ в Tolgee → после pull файл заменяется версией без него → **ключ пропадает** (сырой ключ на экране);
- значения разные → **побеждает Tolgee** (правка в JSON откатывается).
Рантайм dev/prod тянет строки из **вшитого в бандл JSON**, а не из Tolgee вживую (Tolgee в рантайме — только для in-context расширения Pavel'а). «Сырой ключ» = ключа нет в JSON, а не «Tolgee не подтянулся».

**Why:** repo JSON сам по себе недолговечен — Tolgee = источник истины при деплое. Правило #4 CLAUDE.md («добавляй строки в locales JSON») НЕполное: оно не говорит про pull-on-deploy. Механизм был записан в [[triplanio-i18n-tolgee-incontext]], но actionable-правила «новые ключи → в Tolgee» там не было — отсюда рецидив.

**How to apply:** вводишь новый ключ или меняешь строку → **заведи/поправь его в Tolgee** (MCP `mcp__tolgee__create_key` / `create_or_update_translations`, project 2, en/es/ru), НЕ только в JSON. JSON-правка в репо ок для локального превью, но переживёт dev/prod только если тот же ключ есть в Tolgee. Проверка: очередной синк перезапишет locales — если ключа нет в Tolgee, он исчезнет, и это будет видно **удалённой строкой в диффе sync-PR** ещё до посадки. ⚠️**Окно 17.07–23.08.2026 синк был мёртв** (пуш бота в защищённый `dev` отбивался, ошибка глушилась) — правки JSON руками в этот период выживали, и привычка успела закрепиться. С возвратом синка она снова означает потерю правок. Компаньоны: [[triplanio-i18n-tolgee-incontext]], [[triplanio-i18n-no-hardcode]], [[triplanio-localization]].

## Как завести ключи, когда MCP Tolgee не поднялся

★★ «MCP не поднялся» — НЕ причина не завести ключи, и это была отговорка на
несколько заходов подряд. Рабочий путь есть всегда и не требует MCP:

* `TOLGEE_API_KEY` лежит В ОКРУЖЕНИИ сессии, инстанс СВОЙ (`.tolgeerc.json` →
  `apiUrl: https://tolgee.triplanio.com`, `projectId: 2`), не `app.tolgee.io`
  (по нему ключ отдаёт 401 — легко принять за «нет доступа» и сдаться);
* проверка доступа: `GET /v2/projects/2` → 200. ⚠️ `GET /v2/api-keys/current`
  отвечает `pat_access_not_allowed` даже при живом ключе — это НЕ отказ доступа;
* что уже есть: `GET /v2/projects/2/translations?filterNamespace=<ns>&size=200&languages=ru,en,es`;
* завести один ключ: `POST /v2/projects/2/keys` телом
  `{"name": "<key>", "namespace": "<ns>", "translations": {"ru": …, "en": …, "es": …}}`
  → 201. Существующий отвечает ошибкой со словом `exists` — то есть цикл по
  списку идемпотентен и безопасен.

Предпочитать точечный POST, а НЕ `tolgee push`: push умеет режим перезаписи и
может затереть чужие переводы, POST только добавляет.

Приёмка — сверкой, а не «отправилось»: тянем namespace обратно и сравниваем со
всеми тремя JSON репозитория по КАЖДОМУ ключу. Та же сверка ловит обратный
случай: ключ, УДАЛЁННЫЙ из репозитория, но оставшийся в Tolgee, — следующий
`pull` вернёт его в JSON (после этого PR так висит `overview.map_title`).
Удаление из общей TMS — действие наружу и делается только с явного согласия.
