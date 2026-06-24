---
name: triplanio-mobile-dnd-press-feedback
description: Triplanio мобильный DnD городов — вариант 2 (press-фидбэк + lift) реализован 2026-06-23
metadata: 
  node_type: memory
  type: project
  originSessionId: e5719d2a-695a-4789-9aa8-5fbdffb97722
---

★РЕАЛИЗОВАНО 2026-06-23 (lint чистый, vite build EXIT=0; design-guard падение = давний цветовой репорт по чужим файлам, мои правки цветов не добавляют). FE-only, git dev+main ЖДУТ push.

Проблема: на мобиле DnD списка городов неочевиден — long-press 430мс без обратной связи, увод >9px во время удержания отменял арминг → страница скроллилась («иногда работает, иногда скроллит»). Движок и компонент строки ОБЩИЕ для всех 3 экранов: trip edit (`TripStructureEdit.jsx`) и create manual+AI (`ManualPlanner.jsx`, роуты /new-trip + /plan-trip-ai) → `src/lib/useRouteDnD.js` + `src/components/trip/CityRow.jsx`.

Выбран вариант 2 (Pavel): depress-состояние мгновенно при касании + lift при арминге, убран двойной порог для touch. Грип на мобиле остаётся скрытым (зажатие по всей строке). Десктоп (mouse) не тронут — instant + 5px-порог, клик открывает город. Тайминг long-press: 430→300→**400мс** (правка 2026-06-23 по фидбэку «чуть увеличить»).

Изменения: `useRouteDnD.js` — новое состояние `pressingId` (в возврате); touch-ветка `armDrag` ставит pressingId на pointerdown, на таймере **400мс** `begin(true)` сразу lift (activated:true, setDragIdx) без второго 5px-гейта; move-промоушен остался только для mouse; inline-scale во время drag поднят 1.015→**1.03** (без скачка размера при первом движении). `CityRow.jsx` — новый проп `pressing`→`.is-pressing`. Хосты прокидывают `pressing={pressingId===id}` (ManualPlanner: проп `isPressing`). `app.css` — НОВЫЙ класс `.te-row.is-pressing { transform: scale(.985) }` + prefers-reduced-motion гард. **Усилен общий `.te-row.is-dragging`**: brand-рамка + ring (`box-shadow: var(--shadow-pop), 0 0 0 3px var(--brand-soft)`) + `transform: scale(1.03)` с `transition .18s var(--ease-spring)` → анимированный pop depress(0.985)→lift(1.03); reduced-motion гард убирает scale, ринг/тень остаются.

Reuse audit: переиспользованы общий `.is-dragging` (усилен, не дублирован), токены `--brand`/`--brand-soft`/`--shadow-pop`/`--ease-spring`/`--ease-out`, общий движок/CityRow; новое: класс `.te-row.is-pressing` + проп `pressing` (согласовано вариантом 2).

ИЗВЕСТНОЕ МИНОРНОЕ: последний город в planner внутри `.pl-lastcard` (overflow:hidden, border:none на строке) — ring/тень клипаются шеллом, border-brand не виден → lift у него только scale(1.03), слабее остальных. Структурное ограничение, не правил; флагнул Pavel.

Связано: [[triplanio-create-flow-redesign]] (общий useRouteDnD из PR1), [[feedback-reuse-first-unification]].
ОТКРЫТО: Notion-док не обновлён; живой смоук на мобиле после push; вариант 1 (drag-by-handle) — возможный апгрейд позже.
