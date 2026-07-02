---
name: triplanio-country-flag-primitive
description: Единый компонент CountryFlag (SVG из public/flags) заменил эмодзи-флаги; SiteChrome/ScreenAccount ещё не переведены
metadata:
  type: project
---

★TRIP-177 (PR #353 в dev, 2026-07-02): все эмодзи-флаги стран заменены на SVG из
`public/flags/<iso2>.svg` (433 файла, ISO 3166-1 alpha-2 lowercase) через ЕДИНЫЙ
компонент `src/components/common/CountryFlag.jsx` — `<img src="/flags/<cc>.svg">`,
высота `1em` (класс `.cflag` в app.css), graceful-fallback (пустой/невалидный код
→ `null`; отсутствующий файл → `onError` прячет). `country_code` в БД = alpha-2.

**Подключён** в: `cityOptionRow.jsx` (ряд дропдауна выбора города — общий рендер
CitySearch/ManualPlanner/EventEditDialog), `ScreenMap`, `AddPlaceDialog`,
`ManualPlanner` («твой город»), `CityPanel` (чип страны в редакторе).

**Выпилено:** эмодзи-хелперы `countryFlag()` (`geo.js`) + дубль `flagEmoji()`
(`TripStructureEdit`), мёртвое поле `flag` в `LANGUAGES` (`translations.js`),
нативные `title`-тултипы маркеров карты (`createMarkerEl` в `lib/map/markers.js`
— в native `title` SVG нельзя; убраны целиком + мёртвый `data`/`title`-плюминг
в `MapView`/`FlowMap`).

**Осознанно НЕ переведены (следующий шаг, договорённость Pavel):** языковые флаги
`SiteChrome.jsx` (инлайн-SVG на 3 языка) и `ScreenAccount.jsx` (текст RU/EN/ES) —
формально не эмодзи. `CountryFlag` — единый примитив, их переводим на него позже.
Тогда же решаем флаг для `en`: `gb.svg` (текущий 🇬🇧 / Union Jack в SiteChrome) vs
`us.svg` (пример из тикета). Правило: любые новые флаги — только через
`CountryFlag`, не плодить эмодзи/инлайн-SVG. Компаньон [[feedback-reuse-first-unification]].
