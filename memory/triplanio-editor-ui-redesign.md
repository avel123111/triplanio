---
name: triplanio-editor-ui-redesign
description: "Редизайн UI редактора структуры (сетка городов, DnD, сайдбар, FAB, оптимистичное создание) — 2026-06-04"
metadata: 
  node_type: memory
  type: project
  originSessionId: f8307684-45b2-424d-9297-018ca8ad650d
---

Редизайн левой сетки городов и смежного UI в TripStructureEdit (макеты Pavel: uploads/trip-editor.jsx, trip-editor-panels.jsx). Состояние на 2026-06-04 (dev):

**Сетка (TripStructureEdit + app.css):**
- Без внешней обводки — только hairline-сепараторы между рядами (`.te-seamwrap:not(:first-child) > .te-row/.te-wp/.te-end { border-top }`). `.te-table { background: transparent }`. Строки full-width, левый отступ срезан (te-row padding 12px 4px, scroll 12px).
- Переезды = **seam-чипы** (`SeamTransfer`, `.te-seam` absolute bottom translateY(50%)) сидят НА сепараторе между двумя городами; клик→панель транспорта, «+переезд»→Развилка(pick). Луна в чипе если day_change. Старый GridTransfer/te-conn (full-width коннектор) и DropSlot удалены.
- Ряды редизайн: GridEndpoint (`.te-end` flex, флаг/check-узел + Старт/Финиш + Вылет/Прилёт·дата), waypoint (`.te-wp` flex, пунктирный узел + тег «пересадка» + «транзит·дата» + степпер ночей [вернул после фидбэка] + act-cell если есть). rowStyle() удалён.
- **DnD = FLIP live-reorder** (НЕ placeholder): displayNodes = превью-порядок (перетаскиваемый узел показан уже в целевом слоте), useLayoutEffect делает FLIP (translateY transition .18s) — города плавно переезжают вслед за курсором. rowElRefs/prevRectsRef/captureRects. onRowDragOver(nodeId) ключуется по origIdx (стабильно, без осцилляции), commitDrag пишет порядок в драфт одним editDraft. Старые moveTo/dropAt/te-dropspacer выпилены. Прыжка на dragstart нет (раскладка не меняется до dragover).

**Сайдбар:** общий `src/components/trips/TripSidebar.jsx` (+ `ShareDialog.jsx`) — в TripView полный, в редакторе collapsed-вариант (`app-side--rail`, 56px icon-only, разворачивается оверлеем по hover до 220px). Лейблы обёрнуты в `.app-side__label`. Редактор резолвит pro (checkSubscriptionStatus owner-aware) + роль из content.members.

**Кнопка варнингов:** круглый FAB 56px (как `.dock` чат-виджета), иконка warning + бейдж-счётчик, правый-нижний угол карты. Mapbox-атрибуция уведена в bottom-left (перехватывала клики).

**Оптимистичное создание (EventEditDialog handleSaveClick):** простой CREATE (hotel/activity/single-transfer/service, НЕ layover/extra-segments, НЕ edit) — optimisticContentUpdate в TRIP_CONTENT_KEY + закрытие панели мгновенно, затем фоновый insert + invalidate (qc app-level, переживает unmount), на ошибке rollback prev + toast. Edit и сложные трансферы — прежний awaited saveMut (чтобы не ловить race с useEntitySource во view-панели).

**Превью маршрута:** при создании трансфера EventEditDialog шлёт onPreviewTransfer({from,to,transport_type}) → редактор кладёт синтетический leg в mapTransfers → MapView рисует линию по типу (arc/road/straight) сразу, до сохранения. Чистится на закрытии/смене панели.

**Визуальный полиш-пасс (2026-06-04, dev, по ревью emil-design-eng):** косметика + моторика, логика (draft/recompute/save_trip_edit/MapView) НЕ тронута.
- **Сплит 65/35** (было 50/50): `.ts-grid gridTemplateColumns: minmax(0,65fr) minmax(0,35fr)` — левая таблица primary, карта reference. Мобилка (<1080) по-прежнему 1fr (stack).
- **Новые токены в app.css :root:** `--ease-out: cubic-bezier(.23,1,.32,1)`, `--ease-in-out: cubic-bezier(.77,0,.175,1)`; шкала шрифтов `--fs-title:19 / --fs-strong:14 / --fs-base:13 / --fs-meta:12 / --fs-micro:11` (свернул ~11 ad-hoc размеров к лесенке из DS). ГЛОБАЛЬНЫЕ — влияют на всё приложение.
- **Глобально:** `.btn:active{scale(.97)}` (последним правилом, чтобы бить `.btn--primary:hover translateY`); `.btn` transition на `--ease-out`; новый `.badge--brand` (brand-soft).
- **Шапка:** действия редактора (Undo/Reset/Save) сгруппированы за вертикальным разделителем `borderLeft`; Undo/Reset → `variant="quiet"`; бейдж «несохранённое» warm→**brand** (убрал второй оранжевый, терракота теперь только activity).
- **Кастомный степпер ночей:** `.te-stepper` тихий по умолчанию (transparent, кнопки opacity .45), на hover ряда поднимается в surface+border+shadow сегмент-контрол; `.te-step:active scale(.88)`.
- **Ghost-ячейки отель/актив:** `.te-cellbtn--ghost opacity:0`, раскрытие на `.te-row:hover` / `:focus-visible` / `@media(hover:none)`. Убрало колонку пунктирных боксов.
- **Оранжевый приручён:** «переезды вне плана» блок warning-soft→wash+line-2, амбер только мелкой иконкой.
- **Моторика:** `:active`-scale на seam-pill/actchip/hotelicon/cellbtn/ts-step/ts-fab; FAB hover scale(1.06)/active(.96); confirm-delete модалка вход `tsCardIn` scale(.96)+opacity (origin center) + backdrop fade; `.te-panefade` на ease-out. Везде guard `prefers-reduced-motion`.
- **Плавный дроп DnD:** commitDrag теперь `captureRects()` ДО reorder (убрал ручную чистку transform) → FLIP-эффект доезжает ряды в новый слот после коммита (не только во время dragover); кривая FLIP `.22s cubic-bezier(.23,1,.32,1)`; layout-effect скипает при reduced-motion; `.te-row` получил `transition: opacity` для мягкого оседания поднятого ряда.
- Verify: eslint 0 errors, vite build зелёный (в /tmp, т.к. dist на маунте EPERM на unlink).

**Раунд 2 полиша (2026-06-05, dev, аудит по design-critique + accessibility-review):**
- **DnD переписан с нативного HTML5 на pointer-events** (Pavel одобрил концепт-мокап). Грип = `onPointerDown`→`beginDrag(e,dIdx,id)`; поднятая строка `.te-row.is-dragging` следует за курсором (inline `transform translateY+scale`, исключена из FLIP), на отпускании **пружинит в слот** (`cubic-bezier(0.34,1.3,0.5,1)`), коммит в драфт через `setTimeout(...,230)` ПОСЛЕ оседания (без прыжка). Окна-листенеры через стабильные диспетчеры `stableMove/stableEnd`→`dragHandlersRef.current` (переприсваивается каждый рендер), live-значения в `liveRef`. Хит-тест по серединам строк. Переезды-seam скрыты во время drag (соседство в потоке) и возвращаются стаггером. Убраны: native draggable/onDrag*, `origIdxById`, opacity-0.45.
- **Клавиатурный reorder** (a11y): грип `role=button tabIndex=0`, ArrowUp/Down → `moveNodeById` (тот же applyNodes/recompute).
- **Карта 60/40 + выключатель**: `showMap` стейт, кнопка в шапке (`icon=map`, `.btn.is-on`), грид `60fr/40fr` или `1fr`, правая колонка под `{showMap && …}`. Ключи `tse.hide_map/show_map` (ru/en/es).
- **Мёртвый CSS удалён** (мокап-порт, 0 ссылок в прод): `.te-screen/.te-main/.te-left/.te-right/.te-listwrap/.te-header/.te-tabs/.te-iconbtn/.te-list/.te-drop/.te-hotelplate/.te-adddest/.te-kindtile` + media 980.
- **A11y**: `--warning-ink` (#8a5d12 light, AA на белом) для warn-текста; `te-th` цвет muted-2→muted; focus-visible кольца; 44px hit-area через `::after` на ts-step/te-addmini/te-grip/te-step; `aria-label` на грипе и степперах (ключи `tse.nights_add/remove`); фокус уходит в левую панель при открытии + Esc закрывает (`leftPaneRef`); delete-confirm переведён на `AlertDialog` (фокус-трап).
- **Степпер ночей унифицирован**: `.te-stepper--solid` (always-on) в CityPanel + `te-nights`; одна компонента-вид, два контекста (грид тихий-на-hover, панель сплошной).
- Хардкод проверен: редактор на токенах, единственный осознанный — `PALETTE` (цвет города на карте) + скрим модалки.
- Verify: eslint 0 errors, vite build зелёный. ⚠️ DnD-перезапись НЕ протестирована в браузере — нужен визуальный прогон на dev.

**Выравнивание под DnD-концепт (2026-06-05):** Pavel заметил, что реальный экран сделан НЕ как одобренный концепт-виджет. Переделал список из flush-«Сетки» в **карточки-«путешествие»**: `.te-table .te-row` = карточка (border+radius 12+bg surface), `.te-seamwrap` margin-bottom 16 (зазоры), убраны hairline-сепараторы; **рельс** `.te-table::before` (left 45px = центр колонки номера, виден в зазорах, усиливается `.te-table.is-dragging::before`→line-hover); seam-бейджи left 36 в зазоре, таяние при drag + `teSeamIn` возврат (уже было); список-скролл фон → `--wash` чтобы карточки всплывали. ⚠️ НУЖЕН ВИЗ-ПРОГОН на dev: (1) рельс left:45 выровнен под номер города, но якоря старт/финиш `.te-end` имеют узел на другом x (~23) → рельс может проходить правее их; (2) seam left:36 — пиксельный нюанс; (3) контраст карточка/фон в обеих темах.

**DnD-правки v2 (2026-06-05):** (1) тащим за ВСЮ плашку (мышь) — `armDrag` на `.te-row onPointerDown`, паттерн press-drag-or-click с порогом 5px (тап→openCity, drag→реордер); грип больше не инициирует (только клавиши+aria); гард внутр.контролов (`.te-stepper/.te-step/.te-cellbtn/.te-actchip/.te-hotelicon/.te-addmini`); `justDraggedRef`+60ms подавляет клик после drag (openCity гард); тач — только с грипа (`pointerType!=='mouse' && !closest('.te-grip')` → return, чтобы скролл жил). (2) бейджи переездов ТАЮТ при старте drag: снят гейт `dragIdx===null` (seam всегда mounted), CSS `.te-table.is-dragging .te-seam{opacity:0;scale(.85)}` + transition, возврат на дропе.

Связано: [[triplanio-overnight-transfer-flag]], [[triplanio-editor-panels-redesign]], [[triplanio-frontend-repo]]. Всё на dev, ждёт прогона; прод night transfer (миграция 0018 + main) ещё не промочен.
