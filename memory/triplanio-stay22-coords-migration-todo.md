---
name: triplanio-stay22-coords-migration-todo
description: TODO (позже) — выпилить ensureCityNameEn/cityNameEn после перевода Stay22 на координаты; решение Pavel TRIP-103
metadata:
  type: project
---

★РЕШЕНИЕ Pavel 2026-06-28 (TRIP-103 тред), код НЕ начат — «не сейчас, но запомни».

**Что выпилить:** ленивый дозаполнитель `city_name_en` для Stay22:
- `src/lib/stay22.js → ensureCityNameEn(visit)` (форвард-резолв англ-имени + fire-and-forget запись в `city_visits.city_name_en`);
- `src/lib/geo.js → cityNameEn(cityName, countryCode)` (если больше нигде не нужен).

**Почему можно:** Stay22 скоро будет работать **по координатам** (lat/lng визита), а не по адресу `"<city_name_en>, <country>"`. Сейчас `ensureCityNameEn` существует только чтобы Stay22 искал по англ-адресу и не путал город (Cairo IL vs Cairo EG). Когда перейдём на координатный запрос к `stay22Accommodations` — англ-имя для адреса не нужно, ветка лишняя.

**Связь:** это часть более крупного запроса Pavel на **прозрачный унифицированный геокодинг** (TRIP-103): убрать многоуровневость, кривые аэропортные координаты (iata-seed), денормализацию `city_name_en` в `city_visits`. См. [[triplanio-geocode-cache]], [[triplanio-ai-city-resolve-directory-en]], [[triplanio-viator-cities-integration]]. Открытые субтаски: TRIP-58/59/60/65/69 (все Todo на 2026-06-28).

**Не трогать сейчас:** `city_name_en` всё ещё используется в `buildBookingPlatforms` (Booking/Airbnb/Ostrovok/Yandex/Tripster) — выпил только Stay22-ветки, не всей колонки. Удаление `cityNameEn` проверить grep'ом на остальных потребителей.
