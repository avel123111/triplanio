---
name: triplanio-trips-dates-dropped
description: "trips.start_date/end_date дропнуты (мёртвые колонки) — миграция 0052, prod+dev, copyTrip+FE подчищены"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0ff45a9e-a49c-403e-8000-256ed96cd1e8
---

★ЗАДЕПЛОЕНО prod+dev 2026-06-21 (миграция 0052_drop_trips_dates, lint+58 тестов+build зелёные; БД проверена: 0 колонок, 0 функций-ссылок, anchor-смоук ок). **git dev+main ждут push** (FE через Vercel — Pavel пушит).

`trips.start_date` / `trips.end_date` были мёртвыми: 100% NULL в prod (0/33) и dev (0/15), никто не писал (create_trip вставляет без них; единственный писатель copyTrip лишь пробрасывал NULL). Читались только как последний `coalesce`-фоллбэк. Это НЕ то же, что `city_visits.start_date/end_date` — те живые (ядро датовой модели, recompute, трогать нельзя) [[triplanio-recompute-anchor-dates]].

Что сделано в миграции 0052: переписаны `_trip_anchor_date` и `add_city` (убран `(select start_date from trips...)` фоллбэк → теперь transfer-start → первый город → current_date), затем `ALTER TABLE trips DROP COLUMN start_date, end_date`. Нет вью/индексов/констрейнтов/RLS/триггеров/FK/matview на этих колонках (pg_depend пуст).

Код: copyTrip (edge, redeploy prod v20 + dev v22, verify_jwt=true сохранён) — убраны start_date/end_date из insert; FE-фоллбэки подчищены (TripView empty-state+bounds+nights, CalendarLens baseDate, TripStructureEdit startDate, trip-stats tripDateSpan). Поведение идентично (ветки были мёртвые при NULL).

Долг/флаги: (1) `SVC_OUT_OF_TRIP` валидация в validation.js была латентным мёртвым правилом (опиралась на trip.start_date=NULL, никогда не срабатывала) — удалена; если нужна проверка «услуга вне дат трипа», перевязать на tripDateSpan(city_visits) — это НОВОЕ поведение, требует решения Pavel. (2) Осиротевшие i18n-ключи `trip.start_date`/`trip.end_date` (en/es/ru) и `validation.SVC_OUT_OF_TRIP` — теперь нигде не вызываются, можно удалить. (3) Notion-доку по trips-схеме надо обновить. Корректирует [[triplanio-trip-limit-sources]] (там упоминалась только trips.end_date как мёртвая).
