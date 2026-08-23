---
name: triplanio-site-design-system
description: Сайтовая ДС неавторизованной зоны — public/site.css, токены на html.site, гард 2ac check-site-prefixes, правило namespace
metadata:
  type: project
---

TRIP-446 Ф1 (эпик «неавторизованная зона» [[triplanio-public-trip-redesign]]): фундамент сайтовой дизайн-системы — общего CSS для маркетинга/публичных/юридических страниц вне логина.

**Где живёт.** `public/site.css` (переименован из `landing.css`). Обслуживает восемь маршрутов: лендинг (`LandingPage.jsx`), публичный шаринг (`PublicTrip.jsx`), `/terms`, `/privacy`. Файл НЕ бандлится — грузится рантаймом `<link>`-инъекцией на React-роутах и статическим `<link>` на юр-страницах.

**Токены на `html.site`, а НЕ на голом `:root`.** Класс `site` вешает `useSiteCss()` (`SiteChrome.jsx`) на `document.documentElement` при монтировании и снимает на unmount — один механизм включает/выключает сайтовые токены. Почему класс, а не `:root`:
- Голый `:root` из бандлящегося файла — это прод-инцидент [[triplanio-login-css-token-leak]] в полный рост: действовал бы на всех маршрутах постоянно. `html.site` не может утечь по построению — нет класса, нет токенов.
- Тёмная тема не под ударом: `app.css` объявляет тёмное в `:root[data-theme="dark"]` (специфичность 0,2,0), `html.site` — 0,1,1; более специфичный выигрывает независимо от порядка. Алиасы `--X: var(--Y)` во `html.site` вычисляются НА элементе — см. [[triplanio-css-alias-frozen-at-root]].
- **Проверено в браузере (не рассуждением):** `body { color: var(--ink); background: var(--white) }` наследует токены с `<html class="site">` → рендер байт-в-байт как со старым `:root`. Без класса `--ink` не определён (текст чёрный на прозрачном) — ровно поэтому статические `/terms` и `/privacy` несут `class="site"` прямо в разметке (React на них не исполняется, `useSiteCss` не срабатывает).

**Примитивы (общие, без префикса):** `btn`, `btn--primary`, `btn--white`, `btn--ghost`, `btn--lg`, `header`, `footer`, `container`, `eyebrow`. BEM с ДВОЙНЫМ дефисом (`btn--primary`, не `btn-primary`). Уникальное для страницы — свой namespace: `auth-`, `join-`, `doc-`, `pt-`, `dt-`. `.site` — хост токенов, не семья (аналог `:root`). `cflag` в сайтовую ДС не тащить — это примитив приложения ([[triplanio-country-flag-primitive]], живёт в `app.css`).

**Правило «старый CSS умирает вместе со страницей».** `src/pages/login.css`, `src/pages/PublicTrip.css`, константа `STYLES` в `JoinTrip.jsx` остаются на месте до Ф6: там страницы переписываются с нуля, старый файл удаляется, новые правила пишутся сразу в `site.css` тем же PR. Перенос сейчас — работа на выброс, и он недоказуемо «ни пикселя» (другая позиция в каскаде: бандл vs рантайм-инъекция).

**Гарды, видящие файл:**
- **2ac `check-site-prefixes.mjs`** (`npm run check:site-prefixes`, TRIP-446) — ратчет namespace'ов ТОЛЬКО для `public/site.css` по образцу 2m: префикс класса, которого нет нигде в базовой версии файла, роняет PR; escape `/* prefix-exempt: <prefix> — причина + апрув */`. Ловушки: (1) БАЗА резолвит файл по имени — `public/site.css`, иначе `public/landing.css` (карта переименования, чтобы бутстрап-PR не покраснел на пустой базе); (2) хост-класс `.site` исключён из счёта на ОБЕИХ сторонах — иначе стал бы «известным префиксом» и открыл бы `.site-*` молча. Гард 2m (`check-css-prefixes`) сайтовый файл НЕ видит — он сканирует только `src/`.
- **2k `check-design-tokens.mjs`** — типографику в `site.css` ЕНФОРСИТ, но файл в шести allow-листах (SCAN_EXTRA, COLOR, WEIGHT_LH, LAYERS, BREAKPOINT, SPACING), т.е. выведен из этих ярусов.
- **2n orphans / 2u css-comments** — сканируют `public/`, файл видят.
- 2p `check:semantics`, 2l inline-styles — НЕ видят (собирают только `src`).

Гард 2ac — код, у него есть тест `check-site-prefixes.test.mjs` (шаблон [[triplanio-ci-guard-is-code]]: временный git-репо, гард подпроцессом, был увиден КРАСНЫМ мутацией; отдельный кейс на бутстрап «на базе файл под старым именем»).
