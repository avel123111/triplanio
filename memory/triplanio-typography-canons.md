---
name: triplanio-typography-canons
description: Единая система типографики — 10 канонов .t-*, Golos Text+JetBrains Mono, co-selector, BLOCKING-гард (TRIP-165)
metadata:
  type: project
---

★РЕАЛИЗОВАНО на ветке (PR #331 в dev) 2026-07-02 — TRIP-165 «унификация токенов». Весь текст приложения сведён к **10 каноническим текст-стилям**; правка одного канона меняет стиль везде, хвостов нет (гард BLOCKING).

**Гарнитуры — единая суперсемья, self-host:** `Golos Text` (текст И заголовки, заменил Rubik+Nunito) + `JetBrains Mono` (коды/идентификаторы). Оба OFL, лежат в `public/fonts/{golos,jetbrains}/*.woff2` (woff2 по unicode-range latin/latin-ext/cyrillic/cyrillic-ext), `@font-face` в `src/design/fonts.css` (импортится из `index.css`). 4 старых загрузчика Google Fonts удалены; `index.html` preload'ит основные веса Golos. Токены `--font-display`/`--font-ui`/`--font-sans`/`--font-body` → Golos, `--font-mono` → JetBrains Mono. Ре-вендоринг шрифтов — заново из Google css2 с Chrome-UA, не руками.

**10 канонов** (определены в `src/design/app.css`, блок «ТИПОГРАФИКА»): `.t-display` 54/700, `.t-title` 40/700, `.t-heading` 26/600, `.t-subheading` 19/600, `.t-label` 16/600 (всё Golos-display); `.t-body` 14/400/lh1.5 (читаемый текст), `.t-ui` 14/600 (лейблы/значения/эмфаза), `.t-meta` 12.5/600 (даты/вторичное/хинты), `.t-micro` 11/700/UPPERCASE/трекинг (теги/бейджи/эйбрау); `.t-mono` 12.5 JetBrains (коды). Каждый класс ФИКСИРУЕТ гарнитуру+размер+вес+интерлиньяж+трекинг. **Цвет в каноны НЕ входит** — отдельная ось (цвет-токены/`.muted`). Веса схлопнуты к 3 (400/600/700), интерлиньяж/трекинг — к канонам.

**Механизм привязки — co-selector (единый источник, без правок JSX):** общие CSS-классы вписаны прямо в правило канона как доп-селекторы, напр. `.t-ui, .btn, .field__label, .mbrow__name, … { … }`; локальная типографика из класса удалена (остались раскладка+цвет). Так правка одного правила канона меняет утилиту, компонент И все «сырые» использования разом (`.btn` ×53, `.field__label` ×18 и т.п.). Инлайновые элементы без класса получают `.t-*` прямо на элементе. Глобальные `h1–h4` и `.eyebrow` тоже co-selector'ены в каноны. ~320 компонентных классов app.css + page-CSS (Budget/Docs/Calendar/…) + острова (login/public/join/terms/privacy) + лендинг — все на канонах. Маркетинговые бесповые шрифты лендинга (Inter Tight/Instrument Serif/Space Grotesk) убраны → Golos; clamp-герои → канон-токены `var(--fs-*)` с адаптивом ступеньками по `@media` (без сырого clamp/px).

**Гард (`scripts/check-design-tokens.mjs`): `TYPO_COMP_ENFORCED=true` (BLOCKING).** Раздел «TYPOGRAPHY COMPOSITION» валит CI на любом сыром `fontSize/fontWeight/lineHeight/letterSpacing/fontFamily` в компоненте (инлайн) и off-token `font-size:Npx`. Размерная шкала `--fs-*` по-прежнему enforced. Escape-hatch: аннотация `design-token-exempt` в строке. Exempt по природе: краш-экран `AppErrorBoundary` (без токенов намеренно), аватар-инициалы (глиф от размера контейнера), inline-эмфаза чата/`@mention` (`emphasize()`/`mentionStyle` — ось `<strong>`: наследует Golos+размер, свой только вес). `@media` anti-iOS-zoom (16px инпуты) и адаптивные ступеньки на токенах — не нарушения.

Компаньоны: [[feedback-reuse-first-unification]] (главный двигатель), [[triplanio-lumo-gap]] (Lumo-редизайн), [[triplanio-horizon-design-system]] (устаревший заход на Unbounded+Onest — отвергнут в пользу одной суперсемьи). HTML-специмен аудита/предложения — вложением в задачу TRIP-165 (не в репо, правило #11).
