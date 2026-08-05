---
name: triplanio-ai-pattern-eventaiblock
description: AI parser block (EventAiBlock) приведён к канон-паттерну дизайн-системы A4; .ai-blk единый источник; PanelAi — открытый долг
metadata: 
  node_type: memory
  type: project
  originSessionId: 15234ac1-581c-4207-915f-1e473a663ef4
---

★2026-06-12 (triplanio_new): `EventAiBlock` (парсер броней hotel/transfer) переведён на канонический AI-паттерн дизайн-системы — раздел **A4 «EventAiBlock — 6 состояний»** из `Triplanio design new/LUMO OVERLAYS` (источник истины канона AI/Pro/overlays). Один общий компонент рендерится и в диалоге, и в левой in-place панели редактора через `EventEditDialog` variant=`dialog`|`panel` — правка компонента чинит обе оболочки сразу.

Что сделано: lock-микробейдж на sparkle-иконке (locked), `.ai-blk--pill` hover (available), единый контейнер `.ai-input` (бордерлесс-textarea + разделённый ряд `btn--ghost` PDF/фото · подсказка `ai_drop_idle` · `btn--ai` Распознать), файл-пиллы `.ai-file`, `.ai-spin` бордер-спиннер + `.ai-prog` (parsing), `--success`-тинт + шеврон-сворачивание (parsed). idle/uploaded теперь показывают textarea ОБА (текст+файлы комбинируются). Всё на токенах `--ai*` → light/dark + 4 палитры + мобайл автоматом (проверено скриншотами 3 конфигов). i18n без новых ключей (переиспользован `event.ai_drop_idle`).

Антидубль стилей: было 3 семейства — `.ai-blk*` (живой), `.aiblk` (мёртвый, **удалён**), `.aiblock` (только в design-HTML). Оставлен и обновлён `.ai-blk*` как единственный источник; добавлены `.ai-spin/.ai-file*/.ai-input*/.ai-blk--pill/.ai-blk-hint/.ai-blk-lock`. Файлы: `src/components/common/EventAiBlock.jsx` + `src/design/app.css`. build+eslint зелёные; check:design — только пред-существующие нарушения в CalendarLens.css (не мои).

Все AI-кнопки идут через общий `<Btn variant="ai">` → `.btn--ai` (включая `PanelAi.jsx` create-flow — прежний инлайн-дубль `aiBtnStyle()` не существует). Заполненное ИИ поле имеет ОДНУ реализацию — `<AiField>` → `.ai-filled` (`src/index.css`); близнец `.field--ai` у `<Field>` был мёртв (ноль вызовов из 25) и удалён в TRIP-333. Чат-AI (A5) каноничен. Notion «AI Features» → раздел «UI / состояния (EventAiBlock)» обновлён. Связано: [[triplanio-overlay-pro-unification]] [[triplanio-editor-panels-redesign]]

★TRIP-295 (2026-07-25, PR #589): **токен-слой AI без алиасов — одно значение = одно имя.** Живой набор: `--ai`, `--ai-ink`, `--ai-soft`, `--ai-soft-2`, `--ai-line`, `--ai-gradient`, `--ai-gradient-soft`, `--assistant-grad`. Алиасов-обёрток `--ai-grad`(=`--ai-gradient`) и `--ai-soft-12`(=`--ai-soft-2`) нет — при новой AI-разметке брать канон, не заводить синоним. Стопов `--ai-2`/`--ai-3` тоже нет: `--ai-gradient` держит хексы напрямую (стартовый стоп `#A855F7` ≠ `--ai` `#7C3AED`), поэтому «собрать градиент из токенов» — НЕ эквивалент, так делать нельзя. Утилити-классов `.ai-gradient*`/`.ai-text`/`.badge--ai` не существует (были мёртвыми).

★Грабли, из-за которых у `.btn--ai`/`.btn--pro` была цветная полоса слева и сверху: градиентный фон + `--bd: transparent` = **repeat-утечка**. Плитка градиента меряется от padding-box (`background-origin` по умолчанию), красится до border-box (`background-clip`), и зазор в 1px добирается соседней плиткой — её противоположный краевой стоп (циан `#22D3EE` у AI, розовый `#FF2D78` у Pro) и рисует полосу; в углу максимум, т.к. там диагональная плитка даёт стоп 100%. Держит фикс базовое правило `.btn` строкой `background-origin: border-box` — **не снимать**. Размер `background-size:170%` (ховер-анимация) к утечке отношения не имеет, при `auto` она тоже есть. Правило общее: любой градиент под прозрачным бордером требует `background-origin: border-box`; если бордер непрозрачный (как `1.5px solid var(--surface)` у `.avatar--ai`) — он утечку закрывает сам.
