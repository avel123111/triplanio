---
name: triplanio-ai-usage-logging
description: "Учёт стоимости AI-флоу — таблица ai_usage_events, единственный писатель «AI Usage save» в n8n, шесть вызывающих флоу, колонка env"
metadata: 
  node_type: memory
  type: project
  originSessionId: 03be011e-b890-444c-ba29-8cb4db8e5df5
---

Учёт запусков AI-флоу и их стоимости. Модель **push**: цену считает n8n и кладёт
готовой, БД её не выводит.

**БД (обе среды: prod tizscxrpuopobgcxbekf + dev nydhzevdizkfaxdlikgc).** Осталась
ОДНА таблица `ai_usage_events` — строка на один вызов модели (не на запуск),
группировка по `execution_id`, дедуп `unique (execution_id, node_name, run_index)`.
Ярус D, RLS без публичных политик, пишет только `service_role`. Вьюхи
`ai_cost_by_day/week/process/user/trip/run`. TRIP-248 выпилил всё, что жило старой
моделью: `ai_model_prices`, триггер `trg_ai_usage_cost` + `compute_ai_usage_cost()`
(цена теперь из n8n Data Table), `get_ai_usage_cursor()` (курсор поллера).

**Единственный писатель — n8n-субворкфлоу «AI Usage save» (`QuoIMc7nVJzSV0Zx`),
один на инстанс n8n**, поэтому строки ВСЕХ сред падают в одну таблицу. Отсюда
колонка **`env`** (TRIP-534, домен `short_text`, nullable): без неё dev-прогоны
неотличимы от прода и завышают счёт в отчётах. Перечня значений НЕТ намеренно —
writer внешний, упавший на CHECK insert потерял бы строку учёта.

**Кто зовёт (замер 2026-09-08, шесть нод в шести воркфлоу).** Схема входа
субворкфлоу = `execution / process / channel / user_id / trip_id / tag`:
`AI Trip Planner` (`U9nM2n…`, process `trip_planner`) · `AI Trip Planner v2`
(`mnLYKZ…`, тот же process) · `AI Trip Parser` (`qPLks2…`, `trip_parser`, +trip_id,
tag=kind) · `InApp Group Chat Bot` (`3h6TO4…`, `inapp_group_chat`) · `TG Chat Bot`
(`mJ4QQU…`, `tg_chatbot`) · `TG Reminders` (`hDCVQc…`, `tg_reminders`).

★ ЛОВУШКА, ради которой это записано: **метка окружения доезжает до ВХОДА флоу, но
не до строки учёта**. `planTripWithAi` / `parseBookingWithAi` / `callTriplanioAi`
шлют `env: envTag()` (`production` | `development`, `_shared/envTag.ts`), v2 и InApp
даже резолвят её нодой `Gen env` (data table `environments` → `backend_url`), а
планировщики пишут её в свою n8n-таблицу `ai_planning_requests`. В «AI Usage save»
её не передаёт НИ ОДИН вызов, и поля `env` в схеме входа субворкфлоу нет вовсе —
пока это не поправлено в n8n, колонка стоит NULL при полностью рабочем проводе.
Два TG-пути метки не имеют вовсе: TG Chat Bot зашит на прод-URL, TG Reminders
хардкодит `env: "prod"` только в PostHog-событие — для них окружение константа.

**Смотреть n8n через MCP получается не у всех:** у «AI Usage save» и
«0 Reminders Cron» `availableInMCP: false`, их не прочитать и не поправить, пока
доступ не включён на карточке воркфлоу.

**Модели по флоу:** планировщик — `gemini-3.5-flash` (агент) + `gemini-3.1-flash-lite`
(структурный парсер), парсер — `gemini-3.1-flash-lite` ×4 + Mistral OCR (нода
`Extract text`), чат-боты — `gemini-flash-lite-latest` / `gemini-3.1-flash-lite` с
фоллбеком на `gpt-5-mini`, напоминания — `gemini-flash-lite-latest` / `gpt-4.1-nano`.

Док в Notion: «AI Usage Logging & Cost Accounting» (3762c9f1-427e-811b-9cde-f1a5210bba7b)
под [[triplanio-status]] AI Features. Связано: [[triplanio-ai-booking-parse]],
[[triplanio-telegram-bot]], [[triplanio-deploy-topology]].
