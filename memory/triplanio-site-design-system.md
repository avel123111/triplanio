---
name: triplanio-site-design-system
description: Сайтовая ДС неавторизованной зоны — public/site.css, токены на html.site, гард 2ac check-site-prefixes, правило namespace
metadata:
  type: project
---

TRIP-446 Ф1 фундамент сайтовой дизайн-системы — общего CSS для маркетинга/публичных/юридических страниц вне логина. Эпик «неавторизованная зона» = TRIP-445 (handoff в Linear-документе, §3/§13); родственная работа — [[triplanio-public-trip-redesign]].

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

## TRIP-447 Ф2 — общая оболочка (SiteHeader/SiteFooter)

`SiteChrome.jsx` переведён на новый дизайн: ОДНА шапка и ОДИН подвал на всех восьми маршрутах, состав — пропсами, а не шестью похожими копиями. Потребители в том же PR: `LandingPage.jsx` (`src/pages/Landing/`) и `PublicTrip.jsx`.

1. **Контракт темы шапки.** `SiteHeader` с пропом `themed` читает `document.querySelectorAll('[data-hdr]')` на секциях страницы и вешает на `<header>` класс `on-<значение>`. Три и только три значения: `light` / `dark` / `accent` — у каждого свой ПОЛНЫЙ набор правил в `site.css` (7 / 7 / 9 правил; базовый `.header` структурный, ни одного emitted-класса без правил). Значение берётся из `sections[i].dataset.hdr` **без проверки**: опечатка в `data-hdr` даст класс `on-<опечатка>`, под который правил нет, и шапка молча останется без темы. Дефолт при `sections.length === 0` — `light` (безопасный).
2. **Пересчёт `recalc()` — три точки:** скролл (`passive`), монтирование (+ `requestAnimationFrame`), смена маршрута. Открытие страницы и переход между маршрутами скролла НЕ вызывают — без ручного пересчёта тёмная секция получит тёмный текст (ловушка handoff §11.14).
3. **`on-accent` сегодня без производителя** — размечены только `hero` (`data-hdr="light"`) и `.banner` финального CTA (`data-hdr="dark"`, тёмный navy) в `LandingPage.jsx`. Правила `.on-accent` (9 штук) написаны заранее под финальный CTA нового лендинга (в прототипе — закатный градиент). Придёт в Ф6 ([[triplanio-public-trip-redesign]]): либо разметить секцию `data-hdr="accent"`, либо удалить правила.
4. **Состав шапки — проп `variant`** (`SiteHeader`): `full` (меню + CTA + бургер) / `cta` (логотип + язык + CTA) / `minimal` (логотип + язык). Не булевы флаги (`showNav`/`showCta`/`showBurger` выводятся из `variant`). На мобиле `full` прячет CTA в drawer — так в прототипе (`@media (max-width:900px){ .header-cta{display:none} .burger{display:grid} }`). Тема (`themed`) — только лендинг; в демо и авторизации ноль вхождений `on-*`.
5. **Имена классов — репозиторные, не прототипные** (несущее решение Ф2): `header`/`footer`/`container`/`nav`/`hamburger`/`langdd`/`brand`, а НЕ прототипные `site-header`/`wrap`/`main-nav`/`burger`/`lang-btn`/`logo`. Прототип — макет, его имена потребителей в репо не имеют; взять их значило бы положить в один файл шесть пар синонимов и завести шесть новых namespace'ов. Переименование при переносе бесплатно — JSX пишется заново. Единственная новая семья — `on-*` (тема шапки), апрув Pavel 23.08.2026, приезжает с `/* prefix-exempt: on — … */`; проверка `npm run check:site-prefixes`.
6. **Метка кампании.** Правая кнопка шапки гонится через `withVisitCampaign()` (иначе `gclid`/`utm` не переживут клик — `url_passthrough` gtag читает их из адреса), переход через роутер (`nav()`), не `<a href>` — полная перезагрузка убивает снимок `entrySearch`.
7. **Граница двух ДС** — гард `check-ds-boundary.mjs` + тест `check-ds-boundary.test.mjs` (тот же шаблон [[triplanio-ci-guard-is-code]], увиден КРАСНЫМ мутацией). ЗАПРЕЩЕНО в зоне: визуальные компоненты `@/design/*` (`Btn`/`Card`/`Badge`/`Field`/`Checkbox`/`Avatar`/`EmptyState`…) и `src/design/app.css`, включая side-effect-импорт без `from` (`import '@/design/app.css'`). РАЗРЕШЕНО явным списком: `@/design/icons`, `MapView` (один инстанс Mapbox на сессию), `ConsentBanner` (рендерится над роутером), всё из `src/lib/**`. Расширение списка — с апрувом Pavel. **В CI гард включается только в Ф9** — до переписывания страниц (Ф6) он КРАСНЫЙ по построению (публичка ещё тянет `Avatar`), поэтому вне глоба `npm test`.
