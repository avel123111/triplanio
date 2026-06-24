---
name: triplanio-editor-panels-redesign
description: Редизайн редактора трипа — левые панели вместо модалок event view/edit; решения Pavel + стратегия + ТЗ
metadata: 
  node_type: memory
  type: project
  originSessionId: 19edd711-574b-4f6b-82ff-43d26c68f140
---

Редизайн `TripStructureEdit.jsx`: модалки `EventModal`/`EventEditDialog` заменяются на **левые in-place панели** (FSM `panel.view`: list/city/*View/pick/form). Дизайн-референс — мокапы `trip-editor.jsx`+`trip-editor-panels.jsx` (in-memory `TS`-стор). ТЗ: **TRIP_EDITOR_REDESIGN_TZ_2026-06-04.md** (репо).

Решения Pavel 2026-06-04:
- **★ИТОГ (Q1): edit mode ОСТАЁТСЯ как сейчас** (Pavel сначала решил убрать целиком, потом передумал — «оставим как есть»). Песочница/черновик + lock + save_trip_edit + undo без изменений. **Структура → стейджится, пишется по «Сохранить»; брони → в БД сразу** через панели/модалки. Запись «всё сразу» НЕ делаем. Снова актуально: маркировка в CityPanel «структура→Save vs бронь→сразу».
- Факты по коду (для будущего, если снова всплывёт «убрать edit mode»): save_trip_edit(0015) и save_trip_structure(0014) ОБА требуют лок и снимают его в конце → per-action не годятся; save_trip_structure после 0017 ссылается на start_datetime/end_datetime → СЛОМАН/мёртв. Клиент уже пишет в city_visits напрямую (EventEditDialog waypoints/position, ManualPlanner insert) → RLS разрешает прямые правки без миграции.
- **Q2 Охват — только редактор структуры.** Модалки остаются для TripView/PublicTrip/BudgetLens/ScreenMap → **обязательно: одна логика, две оболочки** (извлечь `EventViewBody` из EventModal, `EventEditBody`+билдеры из EventEditDialog; панель и Dialog — обёртки).
- **Q3 Переезды — модель как сейчас (FK from/to_city_visit_id), сами НЕ удаляем.** Соседство по `position` (orderIndex, to===from+1). Несоседний/висячий → показать в зоне «Переезды вне плана» (предложен трей внизу списка рядом с RemovedTray, место докрутим). `TR_NOT_ADJACENT` понизить error→warn (не блокировать save). Снапшот-модель from_city/to_city из [[triplanio-sandbox-redesign]] — ОТЛОЖЕНА.
- **Q4 Варнинги — пока только инлайн** (бейджи строк + WarnNote в панелях), но `ConflictsPanel` НЕ удалять (оставить под картой).

Новое из дизайна: инлайн ячейки отель+активности в строках городов (сейчас брони видны только в ConflictsPanel). AiParseBlock в мокапе — примитив; реальный AI-парсинг внутри EventEditDialog→n8n, переиспользуем его. «Развилка» = реальный ForkPartnerModal+buildBookingPlatforms.

Тонкость (открытый вопрос): CityPanel правит даты/ночи = структура (песочница, по Save), а правка отеля в той же панели = БД сразу → нужна визуальная маркировка двух режимов записи. Связано: [[triplanio-edit-mode]], [[triplanio-event-edit-redesign]], [[triplanio-sandbox-redesign]].
