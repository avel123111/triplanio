# Triplanio: адаптив mobile (TRIP-17)

★РЕАЛИЗОВАНО 2026-06-24 (PR #114 → dev, lint+build+65 тестов зелёные; ждёт живой
смоук на устройстве + синк dev→main по правилу #12). FE-only, БД/edge не трогались.

Факты текущего состояния (как работает сейчас):

- **Confirm-диалоги = канонический `<Sheet>` на мобиле.** `ConfirmDialog`
  (единая точка для всех `useConfirm`) на `useIsMobile()` (<768px) рендерит
  `components/ui/Sheet.jsx` (грип/swipe/`useSheetSwipe`), на десктопе — прежний
  центрированный `AlertDialog`. Поэтому будущие правки общего листа `<Sheet>`
  распространяются на ВСЕ confirm'ы автоматически. Прямой `AlertDialog` удаления
  города в `TripStructureEdit` переведён на `useConfirm` — расходящихся
  confirm-примитивов не осталось. (Раньше `AlertDialog` выезжал снизу только
  через CSS `.dlg-modal`, без грипа, и классы `.dlg-*` ≠ `.sheet-*` → правки
  листа на него не распространялись.)

- **Flow создания (manual+AI) на мобиле = фикс-шелл, ОВЕРЛЕЙ visual viewport.**
  (PR #130 → dev 2026-06-25; заменяет прежний `position:fixed; top:0` из PR #126.)
  `.flow-page` на `@media(max-width:960px)` =
  `position:fixed; top:var(--vvt); left:var(--vvl); width:var(--vvw); height:var(--vvh)`
  — шелл оверлеит ВИДИМУЮ область (visual viewport), а не layout viewport.
  Почему: на iOS Safari при фокусе инпута браузер скроллит VISUAL viewport
  (`visualViewport.offsetTop>0`), чтобы показать поле; шелл, прибитый к `top:0`
  layout-вьюпорта (старый фикс #126), оказывался ВЫШЕ видимой области → весь экран
  с футером улетал наверх (повторный фидбэк Pavel). То же при пинч-зуме
  (панорамирование). Фикс: `initKeyboardInset` (lib/keyboardInset.js, из main.jsx)
  публикует на `<html>` `--vvt`/`--vvl`/`--vvw` (offsetTop/offsetLeft/width visual
  viewport) рядом с прежними `--vvh`/`--kb`; шелл следует за ними. Футер `.flow-foot`
  в нормальном потоке внизу шелла → над клавиатурой; скроллит только `.flow-lp-b`.
  Фолбэки `0/100vw/100dvh` = обычный полноэкранный шелл до запуска JS / без
  visualViewport API. Локальный `--kb-inset` effect в ManualPlanner удалён ранее.
  НЕ возвращать `top:0/right:0` — шелл обязан следовать за `--vvt`/`--vvl`.

- **Клавиатура на мобиле = свернуть карту+футер (место под список города).**
  (db6abf5, dev+main 2026-06-25.) Сам по себе viewport-following футер НЕ решал
  боль: шапка+карта(160px)+прогресс+футер съедали всю область над клавиатурой →
  выпадающему списку CityPicker некуда раскрыться (уходил за клавиатуру, город
  не выбрать). Фикс: пока клавиатура открыта, `.flow-page` получает класс `is-kb`
  (хук `useKeyboardOpen` в lib/keyboardInset.js — visualViewport: `kb =
  innerHeight − vv.height − offsetTop > 120`), и на `@media(max-width:960px)`
  `.flow-page.is-kb` ставит `.flow-mapcol{display:none}` + `.flow-foot{display:none}`
  (карта декоративна при вводе, футер всё равно за клавиатурой). Карта паркуется:
  `FlowMap active={!keyboardOpen}` → `useMapSurface` при возврате active=true
  дёргает `map.resize()` (без серой плитки). Дропдаун `.flow-city-dd` капается по
  live `--vvh`: `max-height: min(260px, calc(var(--vvh,100dvh) − 210px))` → список
  не уходит за клавиатуру, не обрезается панелью, скроллится. Всё возвращается на
  blur. iOS-таргет (на Android с `interactive-widget=resizes-content` kb-инсет≈0,
  is-kb не встанет — там layout и так ужимается; если всплывёт — детект по baseline
  max vv.height, а не по innerHeight).

- **Event View dialog (`EventModal`):** «На карте» + «Посмотреть бронирование» —
  верхний ряд чипов `.ev-actions-top` (оба на `.bk-link`); футер только
  Удалить/Редактировать, right-align, на мобиле кнопки делят строку
  (`.ev-dlg-ft:not(.lp-f--edit) .btn{flex:1}`), для read-only футер скрыт.
  Обрезка хедера edit-диалога снизу при скролле починена: `.ev-dlg-hd/.ev-dlg-ft`
  → `flex:none`, скролл в `.ev-dlg-body`.

- **Карточки `.addon-card` (Settings) и `.acct-chan`/`.acct-tgrow` (Account):**
  адаптив до 640px; бейдж «Доступно» вынесен из заголовка в top-right кластер
  `.addon-card__status`.

- **Карта flow:** бейдж «Твой маршрут»/«Маршрут от ИИ» удалён полностью (проп
  `badge` у `FlowMap` + i18n `planner.badge_mine`/`planner.badge_ai` en/es/ru).

- **Chat:** `.trip-screen-body--chat` на мобиле получил нижний clearance
  `calc(88px+safe-area)` (было `0 !important`) → композер не под bottom-nav;
  `.chat-composer__field{min-width:0}`.

Новые классы (одобрены Pavel в плане): `.ev-actions-top`; `.addon-card__status`
(флагнут для финального ack). Связано: [[triplanio-overlay-pro-unification]]
(bottom-sheet канон), [[triplanio-bottomnav-header-unification]].
