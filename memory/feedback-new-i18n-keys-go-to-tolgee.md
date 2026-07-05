---
name: feedback-new-i18n-keys-go-to-tolgee
description: Новые i18n-ключи заводить В TOLGEE, не только в repo JSON — иначе pull-on-deploy стирает их на dev/prod (сырой ключ на экране)
metadata:
  type: feedback
---

★TRIP-176 2026-07-03 (Pavel: «так почему ты не создаёшь переводы на новые ключи в tolgee когда их вводишь?»): вводил новые ключи (`fork.tab_find_hotel/activity/transfer`, `fork.tab_have_booking`, `event.dep_arr`, `event.route_direct`, `event.when`, `event.stay_dates`, `event.booking_details*`, `event.docs_notes`) ТОЛЬКО в `src/lib/i18n/locales/<lang>/<ns>.json` → на dev рендерились сырым ключом.

**Почему:** CI-джоба `tolgee_sync` в `supabase-deploy.yml` на каждый деплой dev делает `tolgee pull`, который **перезаписывает** (не мёржит) файлы `locales/<lang>/<ns>.json` полным экспортом из Tolgee (project 2). Значит:
- ключа НЕТ в Tolgee → после pull файл заменяется версией без него → **ключ пропадает** (сырой ключ на экране);
- значения разные → **побеждает Tolgee** (правка в JSON откатывается).
Rutнайм dev/prod тянет строки из **вшитого в бандл JSON**, а не из Tolgee вживую (Tolgee в рантайме — только для in-context расширения Pavel'а). «Сырой ключ» = ключа нет в JSON, а не «Tolgee не подтянулся».

**Why:** repo JSON сам по себе недолговечен — Tolgee = источник истины при деплое. Правило #4 CLAUDE.md («добавляй строки в locales JSON») НЕполное: оно не говорит про pull-on-deploy. Механизм был записан в [[triplanio-i18n-tolgee-incontext]], но actionable-правила «новые ключи → в Tolgee» там не было — отсюда рецидив.

**How to apply:** вводишь новый ключ или меняешь строку → **заведи/поправь его в Tolgee** (MCP `mcp__tolgee__create_key` / `create_or_update_translations`, project 2, en/es/ru), НЕ только в JSON. JSON-правка в репо ок для локального превью, но переживёт dev/prod только если тот же ключ есть в Tolgee. Проверка: после мерджа в dev джоба `tolgee_sync` перезапишет locales — если ключа нет в Tolgee, он исчезнет. Компаньоны: [[triplanio-i18n-tolgee-incontext]], [[triplanio-i18n-no-hardcode]], [[triplanio-localization]].
