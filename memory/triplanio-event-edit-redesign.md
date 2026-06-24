---
name: triplanio-event-edit-redesign
description: Редизайн EventEditDialog (порт на дизайн-систему) + трансферы с пересадками через waypoint; решения Pavel 2026-06-02
metadata: 
  node_type: memory
  type: project
  originSessionId: 31679c36-2583-4aba-92b5-8485f27c3597
---

Задача: редизайн модалки события (EventEditDialog.jsx, ~1679 строк, hotel/transfer/activity/service=car_rental) + добавление трансферов с пересадками. Мокап: uploads/event-edit.jsx (standalone-прототип, дизайн-система Field/Btn/Dialog/DateTimeField/UrlField).

Текущее состояние: EventEditDialog построен по этому прототипу, НО на shadcn (Dialog/DialogContent, Input/Label/Select/Button, Tailwind) — отсюда «легаси»-вид vs остальное приложение на дизайн-системе (Btn из design/index, .input/.select, Icon). Многосегментность сейчас = хак extraSegments (EventEditDialog:~553): несколько строк transfers с ОДИНАКОВЫМИ from/to_city_visit_id + текст пересадки в адресе. waypoint: kind добавлен миграцией 0016 (start=end, без ночей, в position), узел добавляется в TripStructureEdit, НО НЕ рендерится waypoint-специфично в MapView/TimelineView/CalendarView и НЕ связан с трансферами по модели §11.

Согласованная модель (TRIP_EDIT_MODE_TZ §11–§12): составной перелёт = цепочка ОТДЕЛЬНЫХ строк transfers между соседними узлами через waypoint-узлы (city1→wp1→wp2→city2). Родительского трансфера с массивом сегментов НЕТ (jsonb отвергнут Pavel). Валидации D5/E1/E3 (1 трансфер на соседнюю пару, MAX_TRANSFER_SEGMENTS удаляется) — Edit Mode, отдельно.

РЕШЕНИЯ Pavel (2026-06-02):
1. UI пересадок — как в мокапе (один диалог: N сегментов + waypoint-города, source первого/dest последнего предзаполнены и не редактируются, wp-город пользователь выбирает из справочника). Бэкенд — §11 цепочка waypoints (НЕ jsonb-сегменты).
2. Модалка САМА создаёт waypoint-city_visits + N строк transfers при сохранении.
3. Edit Mode готов; режим пересадок в event-creation-диалоге нужен сейчас. (Рендер waypoint в timeline/map/calendar и валидации D5/E1/E3 — не в фокусе этого захода, т.к. waypoint = city_visit и рендерится дженерик; уточнить если визуал поедет.)
4. Порт модалки — ПОЛНЫЙ на дизайн-систему, с ТРОЙНОЙ сверкой паритета: правила, валидации, корректность записи всех полей.

Паритет-чеклист (что нельзя потерять при порте): payload-билдеры (buildHotel/Transfer/Activity/Service — все колонки), dateOrderError, hotelRangeError, warnings (hotel/transfer/activityWarnings), canSave, timeMissing/anyTimeMissing, AI extract-хендлеры (handleHotelExtract/handleTransferExtract + поля), 6-стейтный EventAiBlock + Pro/locked/isOwner, detectPlatformFromUrl/booking_platform, DocumentsField/AddressAutocomplete/DateTimeInput/TimezoneHint, delete-confirm inline, localToUtc/utcToLocalInput, invalidateTripData.

Waypoint-save алгоритм (новое, риск): из fromVisit(cityA)→toVisit(cityB) создать wp-узлы между ними (city_name/country/cc/lat/lng/tz, start=end=дата стыковки, kind='waypoint', position МЕЖДУ A и B, trip_id, created_by) + строки transfers cityA→wp1, wp1→wp2, wp2→cityB. Позиция между узлами — по системе position (TripStructureEdit). Заменяет extraSegments-хак; legacy-данные мигрировать/варнинг.

AI-парсер (n8n parse-booking, item 4) — РЕАЛИЗОВАНО 2026-06-02 (клиент+Notion; n8n вручную):
- Решение Pavel: город на КАЖДОМ сегменте (не отдельный waypoints[]-массив); парсер не знает контекста трипа → концы берём из fromVisit/toVisit, при расхождении мягкий варнинг (aiEndpointWarn), резолв не нашёл город → toCity пусто (юзер дозаполняет).
- Клиент handleTransferExtract (EventEditDialog): стал async; segments.length>1 && !isEdit → строит layover-форму (hasLayovers + form.segments), резолвит to_city промежуточных через searchCities/getTimezone в toCity-объект; 1 сегмент → прежний flat-fill. extraSegments-хак под мультисегмент больше не используется.
- n8n воркфлоу «AI Trip Parser» (id qPLks2mIKFA4xXlF, вебхук /parse-booking): надо ВРУЧНУЮ в 2 ноды — AI Agent Transfer (system prompt: +from_city/from_country_code/to_city/to_country_code, чистый город + ISO alpha-2, to_city рейса = from_city следующего) и Structured Output Parser1 (jsonSchemaExample: те же 4 поля в сегменте). MCP-апдейт workflow НЕ использовать (теряет credentials Gemini).
- Notion обновлён (AI Features → transfer.data схема).

РЕАЛИЗОВАНО 2026-06-02 (билд зелёный, не задеплоено):
- Инкремент 1: порт примитивов модалки на дизайн-систему через шимы (shadcn Input/Label/Textarea/Checkbox/Select/Button → .input/.field__label/.textarea/нативный select/.btn), логика байт-в-байт не тронута. Также пропортированы общие компоненты: DateTimeInput/AddressAutocomplete/CurrencyCombobox → .input (DocumentsField уже на токенах). ВАЖНО: эти 3 общие — теперь дизайн-система ВЕЗДЕ (бюджет, структура и т.д.), глянуть на dev.
- Инкремент 2: трансферы с пересадками. emptyTransferForm += {hasLayovers, segments[]}. UI: LayoverToggle + SegmentsEditor + SegTransportGrid + CityPicker (поиск города через searchCities+getTimezone). Сегмент: первый from=fromVisit (read-only), последний to=toVisit (read-only), промежуточные toCity = CityPicker. Сейв saveLayoverChain: создаёт N-1 waypoint-city_visits (kind='waypoint', start=end=arr сегмента, position=fromVisit.position — порядок по start_datetime) + N строк transfers между соседними узлами. canSave/dateOrderError учитывают hasLayovers. DateTimeInput: на unmount шлёт onTimeMissingChange(false) (чтобы удалённые сегменты не блокировали Save). localToUtc игнорирует tz (наивное wall-clock).
- ОТКРЫТО/долг: edit-режим цепочки = посегментно (одна строка); AI extraSegments-хак ещё legacy (заменится в инкр.3); рендер waypoint в timeline/map — дженерик (city_visit), waypoint-специфичного нет; позиция waypoint = position fromVisit (порядок держит start_datetime); адреса сегментов без lat/lng (только waypoint-город с координатами).
- ОСТАЛОСЬ: инкремент 3 (n8n parse-booking: segments + города пересадок; Notion-промпт). Визуальная проверка на dev.

РЕДИЗАЙН layover-UI (2026-06-03, ВЕРНО по прототипам uploads/event-edit.jsx + event-view.jsx — ЭТАЛОН). ⚠️ВАЖНО про шрифты: НЕ хардкодить px на глаз по скринам — брать ровно значения прототипа/дизайн-системы (Pavel дважды отчитал за раздутые 16px). Прототип = источник истины.
Плашка «С пересадками»: маленькая карточка `padding 10px 14px, background var(--wash), border 1px var(--line-2), borderRadius 10`; кастомный мини-свитч 32×18 (трек var(--ev-transfer) когда вкл), заголовок `13.5/500`, подзаголовок `.muted 11.5`, справа счётчик `seg_count` `.num 11.5 muted`. (НЕ radius-16, НЕ shadcn Switch, НЕ 16px — это была моя ошибка, исправлено.)
Сегмент-карточка (SegmentsEditor): `border 1px var(--line-2), radius 12, background var(--wash-2), overflow hidden`. Хедер `padding 10px 12px`: кнопка-тоггл (flex1) = иконка типа транспорта 34×34 r9 (--ev-transfer-soft/--ev-transfer, icon w-4) + eyebrow «Сегмент N · {label}» (--ev-transfer) + строка `fromName → toName` `fontSize 14/600` (ArrowRight w-3 --muted) + «развернуть/свернуть» `.muted 11.5` + ChevronDown 16 rotate(180) при open; рядом (вне кнопки) trash при N>2. Тело: `display open?block:none, padding 4px 14px 14px, borderTop 1px --line-2`, спейсер 10; eyebrow «Вид транспорта» (--ev-transfer); SegTransportGrid (6 колонок repeat(6,1fr) gap6, кнопки r10 1.5px --line-2, active --ev-transfer-soft, icon w-4, 11.5); Откуда/Куда — две карты `padding14, background var(--surface), r10, border 1px --line-2` (eyebrow event.from/event.to цветом --ev-transfer), внутри Город(read-only концы / CityPicker промежут.)+Адрес+Дата (gap 10 через cardField); ниже carrier/flight (1fr 1fr) и price/cur (1fr 0.5fr). Дефолт open=true (как в прототипе), force-open при активной field-ошибке (segHasErr) чтобы инлайн не прятался; openMap по seg.id переопределяет.
Коннектор пересадки: вертикальная засечка `1×14 --line marginLeft16` + pill (--ev-transfer-soft, 12/600) с Repeat-иконкой + «Пересадка в » + **город жирным (700)** + дата прибытия + длительность (мои добавления по просьбе Pavel: fmtLocalDate(endLocal) DD.MM.YYYY + layoverMins(endLocal→след.startLocal)→fmtDur «N ч M мин»; ключи event.dur_h/dur_m); + горизонтальная линия.
Валидация (FieldError/data-vfield/inv/AiField/CityPicker) и логика (saveLayoverChain/validateTransferLayover/patchSeg) НЕ тронуты — только презентация. Новые ключи: event.expand/collapse/dur_h/dur_m (ru/en/es). EventModal (view) уже соответствует event-view.jsx. Билд зелёный, 32 теста.

Связано: [[triplanio-edit-mode]] [[triplanio-ai-booking-parse]] [[triplanio-members-roles]] [[triplanio-planner-redesign]]
