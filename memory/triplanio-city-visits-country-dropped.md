# Triplanio: city_visits.country дропнута — страна из country_code (TRIP-223)

★PR #479 в dev 2026-07-10. Легаси-денормализованная текст-колонка
`city_visits.country` **ДРОПНУТА**. Единственный хранимый источник — `country_code`
(100% строк). Локализованное имя страны выводится из `country_code` нативным
`Intl.DisplayNames` через `fmtCountry`/`localizeCountry` **в точках показа**, не
хранится → ре-локализуется под язык зрителя (раньше — снапшот на языке автора,
из-за чего участник видел чужой язык).

## Что чинил
В edit-mode `CityPanel` флаг+страна гейтились за `node.country` (из легаси-колонки):
у Москвы (легаси-строка `country="Россия"`) блок виден, у новых газеттир-v2 строк
(`country=null`, но `country_code` есть) — скрыт. Фикс: гейт на `country_code`, имя
через `fmtCountry(country_code)`.

## Где показывается страна
Ровно две точки: `CityPanel` (редактор) и `PublicTrip`. `Statistics` и так
локализовал из кодов (его локальный дубль `regionName`, переизобретавший
`Intl.DisplayNames`, свёрнут на канонический `localizeCountry` — правило #6).
`TripView` страну не рендерит (только счётчики).

## Конвенция (важно)
`src/lib/trip-cities.js` НЕ импортирует i18n/`localizeCountry` — остаётся чистой
counting-утилитой без i18n/luxon, иначе ломается `node --test` (luxon-транзитив не
резолвится в тест-рантайме). Локализацию страны делаем в компонентах (там i18n уже
есть), а не в seam `localizeVisits` (там только `city_name` из снапшота — Intl не
нужен). Отклонённый ход: обогащать `country` в `localizeVisits` — тянет i18n+luxon
в чистый util.

## Писатели
Были `add_city`/`add_layover_transfer` (RPC) + FE-инсерты (ManualPlanner,
EventEditDialog, TripStructureEdit) + `copyTrip`. Все выпилены в этом же PR; две
функции пересозданы БЕЗ `country` от живого `pg_get_functiondef` (НЕ от baseline —
baseline устарел, всё ещё содержит уже дропнутую `city_name`). Миграция с маркером
`ddl-guard: allow-destructive`; CHECK `cv_country_len` ушёл каскадом.

Продолжение линии перехода на geonames/country_code (TRIP-146).
