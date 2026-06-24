---
name: triplanio-recompute-anchor-dates
description: recompute_trip теперь материализует даты узлов start/end (миграция 0049); фикс ложного варнинга TR_DEP_DAY
metadata: 
  node_type: memory
  type: project
  originSessionId: c03d893b-fbbe-475a-b23e-c7341a3c18f3
---

★РЕАЛИЗОВАНО+ЗАДЕПЛОЕНО prod+dev 2026-06-20 (lint+58 тестов+build зелёные; trip b40704dd пересчитан: старт 11 сент, финиш 3 окт). НЕ запушено в git (dev+main ждут).

**Баг:** `recompute_trip` выводил якорь цепочки из вылета первого перелёта (`_trip_anchor_date`) и раскладывал все non-anchor города, но САМИ строки узлов `kind in ('start','end')` не писал — ветка делала только `set position`. Их `start_date/end_date` оставались тем, что засеял `add_city` = `max(end_date)` по трипу = дальняя дата КОНЦА. Таймлайн/маркер/reorder читают выведенный `anchorDate` и выглядят верно; единственный потребитель хранимой `from.end_date` узла старта — валидатор `validation.js:159` (`TR_DEP_DAY`) → ложное «Вылет слишком далеко…». Воспроизведение: добавить start/end узел, когда в трипе уже есть города с поздними датами (удалить старые start/finish + заново добавить домашний город).

**Фикс (миграция 0049 recompute_materialize_anchor_dates):** в ветке якорей писать даты:
- `start` = `v_cursor` (день вылета, до gap; gap start→city1 двигает city1, не старт);
- `end` = `v_cursor` (чекаут последнего) + `day_change` входящего в финиш перелёта (финиш сам едет на овернайте).
Зеркально на клиенте: `src/lib/tripDates.js` `layoutDates` (ветки start/end пишут дату вместо position-only) + `TripStructureEdit.jsx` `applyAdjacencyGaps` (финишу прокинут gap входящего перелёта). Planner (`ManualPlanner.recomputeDates`) не затронут — мапит всё в `kind:'transit'`, якорей нет. Golden-тест: `src/lib/tripDates.test.js`.

recompute_trip дёргается из add_city/remove_city/reorder_cities/set_city_nights/set_trip_start_date/add_layover_transfer/trg_recompute_on_transfer_* — все наследуют. Только READ transfers → нет рекурсии (на city_visits триггер только set_city_id). Импакт безопасен: `active_owned_trips` (max(end_date)) — финиш остаётся максимумом; `get_user_travel_stats` считает kind='transit', якоря исключены.

**Долг:** существующие трипы с кривыми датами якорей чинятся только при следующем recompute (правке). Массовый backfill по всем трипам НЕ делал (тяжёлая операция, сдвинет даты у нетронутых трипов) — ждёт решения Pavel. Вторичный баг этого же трипа: перелёт Стамбул→Париж вылетает раньше прилёта первого в Стамбул — отдельно. Накат был через execute_sql, не apply_migration (см. [[triplanio-migration-naming-drift]]).
