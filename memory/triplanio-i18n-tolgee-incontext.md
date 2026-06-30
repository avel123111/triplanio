---
name: triplanio-i18n-tolgee-incontext
description: TRIP-129 — Tolgee SDK за фасадом i18n (path A, Config X), in-context на проде через расширение, UI-only
metadata:
  type: project
---

★КОД (PR #298 Config X — МЁРЖЕН в dev; ★поверх него PR #300 «conditional routing» в dev, не мёржён) 2026-06-30: i18n получил **Tolgee SDK за фасадом** (`src/lib/i18n/`), чтобы браузерное расширение Tolgee Tools правило строки **in-context на живом сайте**, при этом все ~1837 call-sites `t('namespace.key')` **не тронуты** (path A).

**★Условный роутинг (PR #300, текущее направление — по требованию Pavel в треде):** гонять `t()` ВСЕХ юзеров через Tolgee = перф-налог + муть ради фичи только Pavel'а. Теперь:
- **обычный юзер (все):** `t()` резолвится **напрямую из нашего вшитого JSON-словаря** (`dictsRef`: активный язык → `ru`-фолбэк → сырой ключ), интерполяция `{var}` наша — **ноль Tolgee на горячем пути**, поведение байт-в-байт как до Tolgee;
- **сессия редактирования Pavel'а:** `IN_CONTEXT` (читается ОДИН раз из `sessionStorage` кред расширения `__tolgee_apiKey`/`__tolgee_apiUrl`, расширение их кладёт и перезагружает страницу) → `t()` идёт через `tolgee.t()`, observer оборачивает маркерами;
- Tolgee всё равно `run()` у всех — ТОЛЬКО чтобы расширение задетектило страницу; в обычной сессии пустой и не запрашивается. `addLocaleToTolgee` зеркалит локаль **лениво только под `IN_CONTEXT`** (плоские ключи `ns.bareKey`, project 2 `useNamespaces=false`).
- Снимает претензии Pavel: «Tolgee отдаёт юзерам» (нет, из кода), «два справочника» (у юзера один, копия Tolgee лениво только у Pavel при правке), перф-налог (снят), exit (наш словарь снова авторитетен — дроп = убрать ветку `IN_CONTEXT` в `t()`). `apiKey` **больше НЕ из env** — всегда `undefined`, ключ только из расширения (усиление rule 13).
- Резолвер `lookup()`: split по ПЕРВОЙ точке (namespace=стем файла без точек, bareKey может содержать точки — 690 таких из 6906); бездотовый адрес → `undefined` (не namespace-объект — иначе `[object Object]`; ветка мёртвая, все адреса `ns.key`).

**Config X (база, в dev через #298, прод-безопасный):** в бандл идёт ТОЛЬКО ядро SDK + FormatSimple + `BrowserExtensionPlugin`. **`InContextTools` НЕ вшит** — проверено фактически: он оборачивает строки невидимыми маркерами у ВСЕХ юзеров даже без ключа (`isDev=false`). Расширение подгружает observer+редактор по требованию только в авторизованную сессию. **Ключа в бандле нет** → static-режим, ноль сети. Обычные юзеры = те же вшитые строки. Цена для юзеров — ~ядро SDK (~15–25КБ gz). ⚠️В #298 был language-tearing-гейт `tolgee.getLanguage()===lang` + dual-store — **заменено условным роутингом в #300**.

**Грабли (исправлены, нашёл ecc-react-reviewer, оба воспроизведены):**
1. `tolgee.run()` бросает `specify 'defaultLanguage' or 'language'` если язык не задан → load-промис падает → сплэш-гейт не снимается → **белый экран**. Фикс: `defaultLanguage:'en'` в init.
2. miss-детект через `out !== key` ломается при активном observer'е — он оборачивает маркерами и промах тоже. Фикс: гейт на свой словарь, а не на равенство ключу.
Также: `structureDelimiter: null` (плоские ключи с точками не ре-нестить); `ensureTolgeeRunning()` гейтит на `tolgee.isRunning()`.

**Tolgee project 2 (`tolgee.triplanio.com`):** 184 тестовых ключа снесены, импортированы **2302 ключа × en/es/ru** (плоские имена). Round-trip байт-в-байт (апострофы/`{var}` целы, ICU-mangling нет — `icuPlaceholders` флипать не понадобилось). Импорт делал REST'ом (`X-API-Key: $TOLGEE_API_KEY` из env) bulk-POST на `/v2/projects/2/keys/import`.

**Осталось (вне #298/#300):** CI-синк Tolgee→репо (`tolgee pull`→JSON→коммит→bake, нужен Tolgee-ключ в GitHub Secrets) — следующий PR, **замыкает петлю публикации** (сейчас правки в Tolgee до сайта НЕ доезжают, прод рендерит вшитый JSON); Notion (раздел i18n) после мёржа; приёмка Pavel на preview (Alt+клик с расширением — единственное, что не проверить headless). **Вне скоупа:** бэкенд-текст (UI-only решено), ICU, CDN live (Этап 2 — CDN НЕТ, всё bake). Тестовый round-trip pull сделан: 6906 значений (2302×3) байт-в-байт. Обратимость: дроп Tolgee = убрать ветку `IN_CONTEXT`, JSON в репо нетронут. Контекст развилки (X vs Z, почему bake-only, A vs B, conditional routing) — в треде Linear TRIP-129. Компаньон [[triplanio-localization]], [[triplanio-i18n-no-hardcode]].
