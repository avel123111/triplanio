-- TRIP-70 (Часть 1): выпил мёртвого edit-lock (editing_by / editing_since).
--
-- Edit-mode lock снят при переезде на live-редактор (TRIP-126). Колонки
-- trips.editing_by + trips.editing_since и 5 связанных RPC давно мёртвые:
-- живой фронт пишет структуру напрямую (add_city/remove_city/reorder_cities/
-- set_city_nights/set_trip_start_date/add_layover_transfer) и lock-RPC не зовёт;
-- в src/ и edge-функциях вызовов нет (только устаревшие комментарии). На prod был
-- 1 трип с застрявшим локом — данных к сохранению нет.
--
-- Проверено: единственные объекты БД, ссылающиеся на editing_by/editing_since, —
-- это сами 5 RPC ниже. copy_trip их НЕ трогает, грант на колонки уходит вместе
-- с колонками. Деплой ВРУЧНУЮ на оба проекта (prod tizscxrpuopobgcxbekf +
-- dev nydhzevdizkfaxdlikgc).

-- 1. Снести 5 мёртвых lock-RPC.
drop function if exists public.acquire_trip_lock(uuid);
drop function if exists public.heartbeat_trip_lock(uuid);
drop function if exists public.release_trip_lock(uuid);
drop function if exists public.save_trip_structure(uuid, jsonb);
drop function if exists public.save_trip_edit(uuid, jsonb, jsonb, jsonb, jsonb);

-- 2. Дроп самих колонок (колоночные GRANT'ы authenticated уходят вместе с ними).
alter table public.trips
  drop column if exists editing_by,
  drop column if exists editing_since;
