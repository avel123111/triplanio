---
name: triplanio-overnight-transfer-flag
description: "Фича \"ночной трансфер / со сменой дня\" — флаг на transfer, гонит +1 gap на следующие города; решения Pavel 2026-06-04"
metadata: 
  node_type: memory
  type: project
  originSessionId: f8307684-45b2-424d-9297-018ca8ad650d
---

Фича: у трансфера флаг "ночной / со сменой дня". Включён → start_day приёмного города = finish_day предыдущего **+1**, и каскадом +1 на все последующие дни. Базовое правило без флага: start_day города = finish_day предыдущего (gap 0).

**Ключевое открытие:** механика уже почти готова. В `src/pages/TripStructureEdit.jsx` функция `recompute()` считает цепочку по формуле `start = prevEnd + gap; end = start + nights; cursor = end`. У узла-города уже есть поле `gap` (=1 → overnight). Каскад "+1 на все следующие" встроен — переписывать НЕ надо. Чего нет: UI для выставления gap и хранения флага. Валидация уже терпима: `validation.js` разрешает gap ∈ {-1,0,1} (коммент "night transfer"), `TRANSFER_DAY_TOLERANCE=1`.

**Решения Pavel (2026-06-04):**
- Источник правды = **флаг на самом трансфере** (новая колонка `day_change boolean default false`), параллельно с transfer.start/end datetime. Даты трансфера могут вообще не совпадать с границами городов — это **варнинг**, не ошибка.
- `TR_DEP_DAY`/`TR_ARR_DAY` понизить error→**warning** (даты трансфера декуплены от границ городов).
- ИИ-парсинг: **авто-поднимать** флаг — если parseBookingWithAi вернул прилёт на день позже вылета → day_change=true + сдвиг городов.
- Старые трипы: **default false достаточно** (в редакторе gap никогда не создавался → все даты впритык → false репродуцирует те же даты). Бэкфилл не нужен.
- Флаг живёт на трансфере → отметить ночь без созданного трансфера нельзя (для ИИ ок — бронь сама создаёт трансфер).
- Булев флаг = ровно +1 (многосуточные переезды пока вне scope).

**План реализации (порядок):** 1) миграция transfers.day_change (dev→prod вручную); 2) save_trip_edit RPC (миграция 0017) — провести day_change в transfers_new/upd, даты городов по-прежнему запекаются; 3) getTripDetails/content отдаёт day_change; 4) TripStructureEdit recompute берёт gap из day_change входящего трансфера + тумблер в панели; 5) validation severity; 6) AI авто-подъём; 7) copyTrip переносит флаг; 8) Notion; 9) проверка сценариев.

Контекст: cityHero в таймлайне Pavel убирает — на него можно не закладываться. Связано с [[triplanio-editor-panels-redesign]], [[triplanio-sandbox-redesign]], [[triplanio-ai-booking-parse]], [[triplanio-timeline-order]].

**СТАТУС РЕАЛИЗАЦИИ (2026-06-04):**
- Развилка решена: Pavel сказал «брони добавляются ТОЛЬКО в редакторе» → editor-scoped подход покрывает всё, бэкенд-триггеры НЕ нужны.
- Дизайн (минимальный): переиспользован существующий `node.gap` в TripStructureEdit. buildDraft(shell, transfers) сидирует gap из transfer.day_change (keyed by to_city_visit_id); toggleOvernight крутит gap дест-города 0↔1 + recompute (каскад уже готов); onSave выводит day_change обратно в p_edits.transfers_upd. Тумблер — луна-кнопка на плашке GridTransfer (только где есть трансфер И дест≠первый город после старта, т.к. recompute форсит gap=0 первому).
- **СДЕЛАНО на DEV:** миграция 0018 (колонка transfers.day_change bool default false + recreate save_trip_edit с PARTIAL transfers_upd — иначе day_change-only апдейт затёр бы start/end_datetime в NULL; + day_change в transfers_new). Применена на dev (nydhzevdizkfaxdlikgc). Фронт собран, lint чист. copyTrip (spread ...t) и getTripDetails (select *) подхватывают сами — НЕ трогал.
- **НЕ сделано:** ИИ-автоподъём (отложено на след. проход), промоут на PROD (tizscxrpuopobgcxbekf) + push main, Notion. i18n ключ tse.overnight_title (en/es/ru).
- Discard-edge: т.к. day_change едет в драфте (gap) и пишется только на Save — Discard/Reset откатывают, консистентно.
- Проекты Supabase: prod=tizscxrpuopobgcxbekf, dev=nydhzevdizkfaxdlikgc.

**ИЗМЕНЕНИЕ МОДЕЛИ (2026-06-04, 2-я итерация):** Pavel попросил убрать тумблер с плашки сетки и перенести в transfer view+edit панели. Это сделало day_change ЖИВЫМ полем трансфера (а не draft-atomic):
- Тумблер теперь: (1) в edit-форме (EventEditDialog: form.day_change → buildTransferPayload, live insert/update) + АВТО-подъём (effect: если дата прилёта>вылета → day_change=true, raise-only, юзер может снять); (2) в view-панели (EventSourcePanel: live update + invalidate + refreshKey). Грид-тумблер (GridTransfer) УБРАН.
- Per-segment: каждый трансфер свой флаг; layover-цепочка (saveLayoverChain trRows) и extraSegments проставляют day_change из своих дат (прилёт-день>вылет-день).
- Редактор: убран toggleOvernight + onSave transfers_upd. Вместо — effect overnightSig: зеркалит live transfers.day_change в node.gap драфта (первому городу gap форсится 0), recompute → даты сдвигаются → dirty → Save пишет даты (p_nodes). buildDraft сидирует gap из day_change на загрузке.
- save_trip_edit partial transfers_upd (0018) теперь клиентом НЕ используется (day_change пишется live), но безвреден.
- Discard-edge: day_change live → Discard структуры НЕ откатывает флаг (как любая live-правка брони); даты откатятся, но effect их вернёт по флагу. Приемлемо для теста.
- Связанные правки той же итерации: EventEditDialog все error→warn (canSave не блокит валидацией); useEntitySource refreshKey (view обновляется без рефреша); TransferBody дата над временем; MapView attribution → bottom-left (кнопка варнингов в правом-нижнем не открывалась).
**3-я итерация (2026-06-04):** тумблер overnight УБРАН из transfer view (остался только в edit-форме); per-segment — в SegmentsEditor у каждого сегмента свой тумблер day_change (авто-подъём в patchSeg при правке дат, raise-only) + AI-сегменты проставляют day_change из своих дат; saveLayoverChain trRows берёт s.day_change. makeSegment +day_change:false.

**МЕНЮ УНИФИЦИРОВАНО (2026-06-04):** EditorSidebar (te-rail) УДАЛЁН. Создан общий [[triplanio-frontend-repo]] компонент src/components/trips/TripSidebar.jsx (app-side, addon/role-гейтинг, chat-бейдж, upgrade-card) — используется и в TripView, и в редакторе. ShareDialog вынесен в src/components/trips/ShareDialog.jsx (был локальный в TripView, 3 usage). Редактор резолвит pro (checkSubscriptionStatus, owner-aware) + myRole/isOwner из content.members, рендерит TripSidebar с isEditScreen (Edit-пункт active, lens-пункты nav на /trip/:id?lens=), ширина 220px. Мобильный drawer app-side в редакторе не доделан (десктоп-инструмент).

ОТЛОЖЕНО на след. проход: редизайн сетки городов (макеты trip-editor.jsx/panels от Pavel — seam-чипы переездов на сепараторе, редизайн start/finish/waypoint, DnD push-apart без синего плейсхолдера).
