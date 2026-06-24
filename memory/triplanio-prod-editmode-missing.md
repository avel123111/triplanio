---
name: triplanio-prod-editmode-missing
description: "РЕШЕНО: Edit Mode RPC/миграции на prod есть (re-verified 2026-06-07 через Supabase MCP)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1123d8e1-6ae1-4827-954c-c960f0f67854
---

✅ RE-VERIFIED 2026-06-07 (Supabase MCP): на prod `tizscxrpuopobgcxbekf` присутствуют миграции `trip_edit_lock`, `city_visits_position`, `edit_mode_rpcs`, `save_trip_edit`, `city_visits_waypoint`, `notifications_trip_id_cascade`. Edit Mode на проде рабочий со стороны БД.

⚠️ ИСПРАВЛЕНО 2026-06-03: миграции 0012–0016 накатаны на prod через apply_migration (trip_edit_lock, city_visits_position+бэкфилл, edit_mode_rpcs, save_trip_edit, city_visits_waypoint). Все функции/колонки на месте, лок этого трипа свободен. ВНИМАНИЕ: применено только к рантайму prod-БД — в git history миграций Supabase это не отражается отдельно, проверять дрейф по факту.

Изначально (до фикса) подтверждено: на **prod** (Supabase `tizscxrpuopobgcxbekf`) НЕ было инфраструктуры Edit Mode — отсутствовали функции `acquire_trip_lock`/`release_trip_lock`/`heartbeat_trip_lock`/`save_trip_edit`/`save_trip_structure` и колонки `trips.editing_by`/`editing_since`. История миграций prod заканчивается на `telegram_multilink_m2m` (31 мая). На **dev** (`nydhzevdizkfaxdlikgc`) всё есть.

Фронт TripStructureEdit.jsx (задеплоен на main→Vercel) вызывает `supabase.rpc('acquire_trip_lock')` → PostgREST PGRST202 (функция не найдена) → ветка lock==='error' → юзер видит «Не удалось войти в режим редактирования / Не получилось занять блокировку». Это НЕ занятый лок (та ветка — 'blocked', другой текст).

Недостающие миграции (порядок применения): 0012_trip_edit_lock (колонки) → 0013_city_visits_position → 0014_edit_mode_rpcs (лок-RPC) → 0015_save_trip_edit (save-RPC) → 0016_city_visits_waypoint. Ещё prod пропустил 0011_notifications_trip_member_cascade.

Очередной случай того же дрейфа, что [[triplanio-deploy-topology]] и [[triplanio-prod-maps-broken-getmapsapikey]]: фронт авто-деплоится, миграции/функции Supabase — вручную, prod отстаёт.
