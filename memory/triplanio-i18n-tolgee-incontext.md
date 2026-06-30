---
name: triplanio-i18n-tolgee-incontext
description: TRIP-129 — Tolgee SDK за фасадом i18n (path A, Config X), in-context на проде через расширение, UI-only
metadata:
  type: project
---

★КОД НА ВЕТКЕ (PR #298 в dev, не мёржён) 2026-06-30: i18n получил **Tolgee SDK за фасадом** (`src/lib/i18n/`), чтобы браузерное расширение Tolgee Tools правило строки **in-context на живом сайте**, при этом все ~1837 call-sites `t('namespace.key')` **не тронуты** (path A).

**Как работает (path A):** новый `src/lib/i18n/tolgee.js` — один module-level инстанс `@tolgee/web`. `t()` в `I18nContext.jsx` теперь: наш JSON-словарь = **авторитет присутствия и языка**, а Tolgee = оверлей, используется ТОЛЬКО когда `tolgee.getLanguage() === lang` (иначе уходим в свой словарь — это закрывает language-tearing и не полагается на хрупкое `out !== key`). Интерполяцию `{var}` делает Tolgee FormatSimple. Локали зеркалятся в Tolgee `addStaticData` плоскими ключами (полный адрес `ns.bareKey`, т.к. project 2 `useNamespaces=false`).

**Config X (выбран Pavel'ом, прод-безопасный):** в бандл идёт ТОЛЬКО ядро SDK + FormatSimple + `BrowserExtensionPlugin`. **`InContextTools` НЕ вшит** — проверено фактически: он оборачивает строки невидимыми маркерами у ВСЕХ юзеров даже без ключа (`isDev=false`). Расширение подгружает observer+редактор по требованию только в авторизованную сессию. **Ключа в бандле нет** (`apiKey: import.meta.env.VITE_TOLGEE_API_KEY || undefined` → static-режим, ноль сети). Обычные юзеры = те же вшитые строки, что и сейчас (в бандле нет ни ObserverPlugin, ни ключа, ни маркеров). Цена для юзеров — ~ядро SDK (~15–25КБ gz).

**Грабли (исправлены, нашёл ecc-react-reviewer, оба воспроизведены):**
1. `tolgee.run()` бросает `specify 'defaultLanguage' or 'language'` если язык не задан → load-промис падает → сплэш-гейт не снимается → **белый экран**. Фикс: `defaultLanguage:'en'` в init.
2. miss-детект через `out !== key` ломается при активном observer'е — он оборачивает маркерами и промах тоже. Фикс: гейт на свой словарь, а не на равенство ключу.
Также: `structureDelimiter: null` (плоские ключи с точками не ре-нестить); `ensureTolgeeRunning()` гейтит на `tolgee.isRunning()`.

**Tolgee project 2 (`tolgee.triplanio.com`):** 184 тестовых ключа снесены, импортированы **2302 ключа × en/es/ru** (плоские имена). Round-trip байт-в-байт (апострофы/`{var}` целы, ICU-mangling нет — `icuPlaceholders` флипать не понадобилось). Импорт делал REST'ом (`X-API-Key: $TOLGEE_API_KEY` из env) bulk-POST на `/v2/projects/2/keys/import`.

**Осталось (вне PR #298):** CI-синк Tolgee→репо (`tolgee pull`→JSON→коммит→bake, нужен Tolgee-ключ в GitHub Secrets) — следующий PR. **Вне скоупа:** бэкенд-текст (UI-only решено), ICU, CDN live (Этап 2). Обратимость: не мёржить + почистить ключи в Tolgee. Контекст развилки (X vs Z, почему bake-only, A vs B) — в треде Linear TRIP-129. Компаньон [[triplanio-localization]], [[triplanio-i18n-no-hardcode]].
