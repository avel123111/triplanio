---
name: triplanio-editing-by-deadcode-drop
description: TODO тех-долг — дропнуть мёртвый edit-lock (editing_by/editing_since + 5 RPC); вернуться в КОНЦЕ сессии 2026-06-22
metadata: 
  node_type: memory
  type: project
  originSessionId: 20321c7b-3c7c-42ca-b380-9e393d2edacc
---

★ЗАВЕДЕНО В JIRA = TRIP-174 (2026-06-22, статус «К выполнению»). Долг «вернуться в конце сессии» закрыт — теперь это тикет.

★TODO 2026-06-22: edit-mode lock выпилен (переезд на live-редактор TRIP-126), `trips.editing_by` + `trips.editing_since` — мёртвые. Проверено в prod: `editing_by` читают ТОЛЬКО 5 функций `acquire_trip_lock`, `heartbeat_trip_lock`, `release_trip_lock`, `save_trip_structure`, `save_trip_edit`; живой фронт их НЕ вызывает (пишет напрямую `add_city/remove_city/reorder_cities/set_city_nights/set_trip_start_date/add_layover_transfer` — они editing_by не трогают). В prod 1 трип с застрявшим editing_by. В src/ ноль обращений к editing_by (только миграции 0012/0014/0015/0017/0018/0019/0054 + i18n `view.edit_mode_done`).

Дроп = ОТДЕЛЬНЫЙ тикет тех-долга, НЕ часть удаления аккаунта (TRIP-78). Перед дропом колонок/функций: убедиться что `save_trip_structure`/`save_trip_edit` не дёргаются из n8n/edge/др.; снести 5 RPC + 2 колонки миграцией prod+dev; вычистить ссылки в миграции 0054 (copy_trip insert-список). editing_by на trips = SET NULL, удаление аккаунта НЕ блокирует, поэтому к самой TRIP-78 не относится. Связано: [[triplanio-payments-deep-audit]].
