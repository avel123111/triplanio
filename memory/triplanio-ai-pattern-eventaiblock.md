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

ОТКРЫТО (не входило в скоуп, только отчёт): `PanelAi.jsx` (AI Trip Planner create-flow) переопределяет AI-кнопку инлайн-стилем `aiBtnStyle()` вместо общего `.btn--ai` — мелкий дубль, стоит заменить. `AiField`/`.field--ai` и чат-AI (A5) каноничны. Notion «AI Features» → раздел «UI / состояния (EventAiBlock)» обновлён. Связано: [[triplanio-overlay-pro-unification]] [[triplanio-editor-panels-redesign]]
