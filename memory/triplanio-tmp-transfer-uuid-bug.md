---
name: triplanio-tmp-transfer-uuid-bug
description: "Баг — создание переезда к несохранённому (tmp-) городу в редакторе падает на uuid; поставлен guard, нужен правильный фикс"
metadata: 
  node_type: memory
  type: project
  originSessionId: f8307684-45b2-424d-9297-018ca8ad650d
---

Баг (репорт Pavel 2026-06-04): в edit-экране при сохранении трансфера ошибка «No se pudo guardar / invalid input syntax for type uuid: "tmp-zrgtc8atbtp"».

**Причина:** трансферы пишутся ВЖИВУЮ (`supabase.from('transfers').insert`, EventEditDialog → buildTransferPayload) с from/to_city_visit_id = fromVisit.id/toVisit.id. Если город новый (добавлен в редакторе, ещё не сохранён) — у него id вида `tmp-…`, и live-вставка падает на типе uuid. Корень: города живут в драфте (сохраняются только на структурный Save через save_trip_edit), а трансферы пишутся сразу.

**Сейчас (стоп-гэп, СДЕЛАНО):** guard в TripStructureEdit — `isTmpId()` блокирует открытие создания переезда, если хоть один конец tmp, с внятным месседжем `tse.save_new_city_first` (en/es/ru) вместо крипто-ошибки. Точки: openTransferRow + CityPanel onAddArrival/onAddDeparture.

**Правильный фикс (НЕ сделано, задача в трекере):** заводить переезды к tmp-городам через draft → `p_edits.transfers_new` в save_trip_edit (там УЖЕ есть ремап tmp→uuid через v_map). Т.е. сделать переезды (хотя бы те, что касаются новых городов) частью драфта, а не live-write. Это рефактор: создание не live-инсертит при tmp, draft хранит pending-переезд, рендер мёржит draft+live, onSave шлёт transfers_new, edit/delete pending. Пересекается с [[triplanio-overnight-transfer-flag]] (та же зона). Ждёт решения Pavel.

UX-регрессия guard'а: нельзя добавить переезд к новому городу до структурного Save (раньше падало с ошибкой — теперь хотя бы понятно). Связано: [[triplanio-editor-panels-redesign]].
