# Логика построения таймлайна (TripView → TimelineLens)

Файл: `src/pages/TripView.jsx`, компонент `TimelineLens` (рендер «линзы» Хронология).
Это **просмотр** трипа (read+события). Структура города (даты/порядок/добавление/удаление) тут НЕ редактируется — только в `/trip/:id/edit` (редактор структуры). На таймлайне правятся только события (отели/активности/переезды) и они замораживаются, пока трип под редактированием (`trip.editing_by`).

## Входные данные
- `visits` — `city_visits` (узлы: `kind` start/transit/end[/waypoint]).
- `transfers`, `hotels`, `activities` — события (приходят из `getTripDetails`).
- `stream` = `buildEventStream(hotels, activities, transfers, visits)` — плоский список событий с полем `date` (день) и `type` (`hotel-checkin`/`hotel-checkout`/`hotel-deadline`/`activity`/`transfer`/`flight`).

## Шаги построения
1. **Гейты пустоты:** если нет дат/визитов — `EmptyState`.
2. **Границы трипа.** Якоря (start/end) дат не имеют → диапазон берётся из первого/последнего **transit**-визита с датами (`datedTransits` через `sortVisits`); фолбэк — `trip.start_date/end_date`. `tripStart`/`tripEnd`.
3. **Индексы:**
   - `eventsByDate[day]` — события по дню.
   - `hotelsByVisit[visitId]` — отели, привязанные к визиту (по `e.city`/попаданию даты заезда в окно визита); check-out дозаполняется отдельным проходом.
   - `inboundByVisit[toVisitId]` — входящие переезды по `to_city_visit_id`.
   - `inboundEventsFor(visitId)` — события-переезды из стрима, чей `to_city_visit_id == visitId` (рисуются карточкой над «героем» города).
   - `inboundEventIds` — id этих переездов, чтобы не дублировать их в общем списке событий дня.
4. **Порядок:** `ordered = sortVisits(visits)` = `(start anchor) → transit по (start_datetime, position) → (end anchor)`. `transitCities = ordered` без якорей.
5. **Список дней:** `days = buildDayList(tripStart, tripEnd)` — все календарные дни диапазона.

## Сборка строк (`rows`)
- **Старт-якорь:** `StreamAnchor` «Старт · <город> · <дата>».
- **Цикл по каждому дню `day`:**
  - `arrivingToday` = все transit-города, чей **день прибытия** (`start`) == day (по `naiveDayKey`). В один день может прибыть несколько городов (общий день стыковки).
  - `dayCity` (чип в шапке дня) = последний transit-город, чей диапазон **покрывает** этот день.
  - **Шапка дня:** крупная дата + день недели + чип города (`dayCity`) + погода (если есть) + разделитель.
  - **Блоки прибытия:** для каждого города из `arrivingToday` → `renderArrival(city, prevCity)`:
    - если `prevCity` есть, **идентичность отличается** (`cityIdentity(prev) !== cityIdentity(city)`) и **нет** переезда `prev→city` (`hasTransferBetween`) → плашка **«Нет переезда»** (`MissingTransferWarning`, только при `showBookingWarnings` и не для Зрителя);
    - иначе, если есть входящие переезды — карточка(и) переезда над героем;
    - затем сам **`CityHero`** (фото города, даты, ночи, список отелей; в режиме инлайн-edit — только просмотр, городских кнопок нет).
    - `prevCity` протягивается сквозь весь обход → «from» в плашке всегда = город, нарисованный прямо выше.
  - **События дня:** `dayEvents` (= `eventsByDate[day]` минус `inboundEventIds`) рисуются как `StreamEventRow` (клик → `onOpenEvent`). Если событий нет и день не «прибытие» → плашка «На этот день ничего не запланировано».
  - **Инлайн-edit** (`isEditMode`): кнопка «Добавить» (только активность; добавление города убрано — оно в редакторе структуры).
- **Плашка «нет переезда» в финиш:** если последний узел — `end`-якорь, и от `prevCity` до финиша нет переезда и идентичность разная → `MissingTransferWarning`.
- **Финиш-якорь:** `StreamAnchor` «Финиш · <город> · <дата>».

## Ключевые правила
- **Единый источник порядка:** и раскладка по дням (день прибытия), и пары для плашек «нет переезда» идут от одного `ordered` + сквозного `prevCity` (нет рассинхрона «город дня» ↔ «пары варнингов» — фикс старого бага).
- Город рисуется как `CityHero` **в день прибытия** (по `start`); 2 героя в один день допустимы (общий день).
- `hasTransferBetween(prev, city)` — чисто по id (`from_city_visit_id == prev.id`, среди входящих `city`).
- **Идентичность города** — общий `cityIdentity` из `validation.js` (тот же, что E1/E2 редактора): один и тот же город подряд не варнит «нет переезда».
- **Заморозка §3a:** при `trip.editing_by` все мутации событий на таймлайне выключены (добавление → подсказка; просмотр события — read-only). Сам просмотр не ограничен.

## Связанные сущности
- `CityHero` (рендер города), `MissingTransferWarning`/`MissingHotelWarning` (плашки), `StreamEventRow`/`StreamAnchor` (из `design/index`), `SourceViewLoader` (открытие события на просмотр/правку), `useWeatherByDay`.
- Старый таймлайн `components/views/TimelineView.jsx` + его дети — **мёртвый код** (заменён этим `TimelineLens`), помечен на удаление.
