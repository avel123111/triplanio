---
name: triplanio-sandbox-redesign
description: ★ФИНАЛ 2026-06-03 направление модели трипа/таймлайна — полная песочница; заменяет edit-mode-гейт и развивает отклонённый model-redesign
metadata: 
  node_type: memory
  type: project
  originSessionId: ccd2943d-2018-4b8b-9f3d-619e579f5748
---

★РЕШЕНО 2026-06-03 (Pavel, в длинном обсуждении). Полный разворот к **песочнице**: ничего не запрещаем/не двигаем/не каскадим, таймлайн = чистая хронология, максимум мягкие per-entity подсказки. Заменяет жёсткий гейт [[triplanio-edit-mode]] и развивает отклонённый [[triplanio-trip-model-redesign]]. Док: `TRIP_SANDBOX_REDESIGN_2026-06-03.md` (в репо triplanio_new).

Ключевые решения:
- **Две зоны UI:** «Маршрут» = карточки-геро по cityVisit (фото/даты/отели по FK), вне ленты. «Лента» = чистый хронологический поток событий, каждое на своём времени; геро в ленте НЕТ; шапка дня = чип(ы) ВСЕХ активных городов.
- **City Hero нельзя ставить точкой в ленте** (доказано: фейковое время города `hour:12`, 2-3 города/день, waypoint-геро при пересадке). Поэтому вынесен в «Маршрут».
- **Плашка прибытия** в ленте = тупой echo `transfer.to_city` («Прибытие · X»), сразу после трансфера, ни на что не смотрит (Каракас при Москве — показываем Каракас).
- **cityVisit незыблем**, обязателен с датами (CITY_DATES_REQUIRED=error, без дат не сохраняем). **Waypoint без геро** (часть переезда).
- **Переезд** = свободное событие с явными полями «город из/в» (идентичность-снапшот, НЕ FK на строку city_visit). Матч «есть переезд А↔Б» = по идентичности. Уходим от from/to_city_visit_id.
- **Валидации:** error только L1-санити (*_REQUIRED, *_ORDER, CITY_DATES_REQUIRED, +TR_FROM/TO_CITY_REQUIRED). OOB/TR_DEP_DAY/TR_ARR_DAY → warning (per-entity бейдж). Выпил: CITY_OVERLAP, CITY_GAP, TR_NOT_ADJACENT, DUP_TRANSFER. Снять гейт на варнингах в edit mode. Поимённый разбор — в доке §7. Связано с [[triplanio-validation-unification]] (та инициатива поднимала OOB в error — теперь обратно).
- **CASCADE→SET NULL** на hotel_stays/activities.city_visit_id + диалог (иначе удаление города теряет брони — баг).
- **Edit mode остаётся**, но: внутр.таймлайн = read-only (вид timeline/map/calendar), правки в отдельном спокойном экране (не «панель боинга»), recompute(nights,gap) → опциональная кнопка, даты свободные.
- **Ремайндеры** — по собственному времени сущности, план не вычисляем (шлём даже при бессвязном плане).

Открыто: city_ref-фундамент (нестабильный external_city_id vs гео-миграция [[triplanio-mapbox-migration]]) — матч переездов либо берём в работу, либо фаза 2; судьба waypoint в схеме; плашка прибытия при цепочке легов.

Код НЕ тронут — ждём согласования доки. Затронет: TripView TimelineLens/renderArrival/inboundEventIds/dayCity, validation.js, EventEditDialog/saveLayoverChain, TripStructureEdit, схему БД, copyTrip/getTripDetails/публичный ReadOnlyTimelineView. Правило base44-анализа [[feedback_base44_analysis_rule]] действует.
