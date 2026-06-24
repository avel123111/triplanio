---
name: triplanio-booked-flag-plan-fact
description: "Флаг \"забронировано\" на hotel/transfer/activity → переключает поведение при структурных правках; задел под план-vs-факт бюджет"
metadata: 
  node_type: memory
  type: project
  originSessionId: 471f29b4-13b8-47c7-babc-2b626735a61a
---

★Анализ 2026-06-12 (код НЕ начат). Идея Pavel: добавить на hotel_stays/activities/transfers флаг "забронировано" (true/false, default false), который меняет поведение события при структурных правках плана. Развивается в сторону план-vs-факт бюджета.

**Концептуальная рамка (моя, принята как направление):**
- booked = «факт» → событие держит СОБСТВЕННЫЕ абсолютные даты (timestamptz); независимо от города: расхождение дат → warning, удаление города → city_visit_id=null → «вне плана» (orphan).
- unbooked = «план» → у события НЕТ собственной даты-истины, оно ВЫВОДИТСЯ из окна города; при структурной правке даты пересчитываются из city_visits молча, при удалении/несоседстве исчезает вместе с городом.

**Критичная поправка к вводной Pavel:** его «как сейчас» НЕ совпадает с деплоем. Сейчас `remove_city` (мигр. 0027/0030) ЖЁСТКО каскадно УДАЛЯЕТ детей (нет SET NULL, нет orphan). «Вне плана» есть ТОЛЬКО для трансферов и ТОЛЬКО в редакторе (TripStructureEdit.jsx:682), вычисляется из несоседства пары from→to после reorder (не из null FK). recompute_trip двигает только city_visits — даты событий (timestamptz) НЕ трогает, только validation.js даёт warning. Значит вся ветка unbooked (молча двигать/удалять) — NET-NEW; booked-удаление→orphan инвертирует текущий каскад.

**Модель данных:** `is_booked boolean not null default false` РЕАЛЬНОЙ колонкой на 3 таблицах (не в details jsonb — флаг ветвит серверные RPC). Поля деталей брони УЖЕ колонки (booking_reference/url/platform, price, voucher_*, free_cancellation, payment_status) → «booked → показать детали» = прогрессивное раскрытие в EventEditDialog.jsx, новых полей данных нет. Backfill: is_booked=true по эвристике (есть booking_reference|price>0|voucher), иначе false — иначе все существующие станут «тихо удаляемыми».

**Триггеры — расширять recompute на детей БЕЗОПАСНО (проверено):** sync_budget_expense ключуется на price/currency/title/city_name (НЕ на дату события) и пишет только budget_expenses → сдвиг даты = холостой повтор, рекурсии нет. notify_booking_added — только INSERT → UPDATE-сдвиг не нотифицирует. trg_recompute_on_transfer_upd — только при day_change/from/to → сдвиг времени не зацикливает. Вывод: «тихий сдвиг» делать на СЕРВЕРЕ (расширить recompute_trip), не на клиенте — покрывает UI/AI/бот разом. SET-NULL orphan обнулит city_name в бюджете (приемлемо, расход остаётся).

**P2-поправки Pavel (приняты):**
- Ночные трансферы: day_change — СТРУКТУРНЫЙ атрибут, не деталь брони; остаётся в форме и для unbooked, recompute читает его независимо от is_booked. unbooked-трансфер = строка ЖИВЁТ (поставляет gap), но его start/end выводятся из окон (depart=from.end, arrive=to.start). На reorder тихо удаляется → gap пропадает.
- Activity unbooked: хранить как offset_от_начала_города + длительность; recompute: start=city.start+min(offset, nights−1), end=start+duration клампим к city.end (сжатие города подтягивает активность к последнему дню).

**P1 — план vs факт (направление Pavel «не забывать план»):** сейчас бюджет = только факт. Хочет план 1000 vs факт 1200. ВЫВОД: P1 НЕ ломает движок дат P2 — надстраивается, т.к. это БЮДЖЕТНАЯ ось (суммы), не структурная.
- P1a (дешёвый шаг): колонки planned_price/planned_currency рядом с price; is_booked рулит датами; бюджет двухосевой (Σplanned vs Σprice). Не трогает даты. Ограничение: один ряд не держит план-даты(ездят) и факт-даты(фикс) одновременно.
- P1b (позже): план и факт = ДВЕ связанные строки через group_id, каждая со своим is_booked → per-row движок P2 их уже обрабатывает, переписывать не надо. Добавляет: group_id связку, пэйринг/дедуп в таймлайне, двухосевой бюджет (kind=plan|actual, факт замещает план в потраченном), UI «добавить реальную бронь к плановому пункту».
- Стоимость P1 — в БЮДЖЕТЕ (sync_budget_expense, защищённая зона денег → ревью), не в датах.
- ★Упреждающее решение: заложить `group_id uuid null` на 3 таблицы вместе с is_booked на старте P2 (пустым) — страхует от двойной миграции под P1b.

**Последовательность:** P2 (движок дат, самодостаточен) → P1a (две суммы) → P1b (расхождение дат + связка).

**Зависимости/риски:** recompute_trip, remove_city (0027/0030), save_trip_edit (0018), reorder; новый UI-бакет «вне плана» для отелей/активностей (сейчас нет нигде кроме transfers-редактора) — нужен в редакторе + таймлайн + PublicTrip + MapView; validation.js (warning только для booked); EventAiBlock→n8n распознанная бронь ставит is_booked=true; RLS/viewer [[triplanio-viewer-write-rls-escalation]]; i18n ru/en/es; base44-паритет; prod+dev синхронно [[triplanio-migration-naming-drift]]; обе ветки Vercel. Связано с [[triplanio-live-edit-server-recompute]], [[triplanio-sandbox-redesign]], [[triplanio-pro-model]].
