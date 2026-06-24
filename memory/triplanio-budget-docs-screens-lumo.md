---
name: triplanio-budget-docs-screens-lumo
description: "Triplanio: Lumo-прототипы экранов Бюджет и Документы (макеты)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 688c9172-bd1c-4ff0-b699-bbb5cb7ac3e6
---

★Прототипы redesign экранов **Бюджет** (BudgetLens) и **Документы** (DocsLens) в дизайн-системе [[triplanio-horizon-design-system]]/Lumo, 2026-06-07. Раскладка спроектирована ЗАНОВО (не порт текущего визуала); из кода triplanio_new взяты только функции/данные. В контексте трип-шелла (левое меню + хедер + lens-табы), адаптив (сайдбар→off-canvas ≤980px), dark + 4 палитры, диалоги интерактивны (JS).

Файлы в «Triplanio design new»:
- TRIPLANIO_BUDGET_LUMO_2026-06-07.html — донат расходов+легенда, 3 стат-карты (всего/на одного поровну/курсы), сегмент По категориям⇄По городам, two-pane drill-down, planned-бары, строки трат (бейджи бронь/ручная/без курса «?»), severity курса, диалоги Трата/Категория(8 цветов×10 иконок)/Курсы валют, Pro-гейт (бюджет=Pro-функция, превью-тумблер).
- TRIPLANIO_DOCS_LUMO_2026-06-07.html — разделы shared/personal, поиск+фильтр (Все/С файлами/Со ссылками), карточки с тип-чипами файлов (PDF/DOC/XLS/IMG+превью), домен ссылки, vischip видимости, владелец+дата; диалоги Добавить(видимость+dropzone до 10МБ)/Детали/Удалить; состояния пусто/загрузка (превью-сегмент).
- DESIGN_SYSTEM_LUMO_ADDENDUM_BudgetDocs_2026-06-07.html — каталог новых компонентов (.donut/.stat/.glist__row/.pmini/.exrow/.tagx/.sev/.doccard/.ftag/.linkrow/.dropzone/.addcard/.mobnav) со специменами+токенами. ★Дополнение к DESIGN_SYSTEM_LUMO_2026-06-06, НЕ влито в основной файл.

Решения Pavel (AskUserQuestion): два отдельных файла; полная оболочка; «смело в рамках данных» (новые паттерны без новых бэкенд-фич). Категории→палитра --cat-1..8; иконки типов событий переиспользованы (жильё/транспорт/активности/сервисы). Pro-гейтинг бюджета взят из сайдбара (data-pro), не из тела лензы.

★ОБНОВЛЕНИЕ 2026-06-07: экран **Бюджет ПЕРЕНЕСЁН В КОД** (branch dev, triplanio_new). Решения Pavel: стили = отдельный page-scoped `src/pages/BudgetLens.css` (классы `.bgt-*` на существующих Lumo-токенах из app.css, inline-стили выпилены); донат+легенда сделаны (SVG, hover-синхрон сегмент⇄строка через state); **весь UI плана убран** (нет `/ план`, мини-полос, planbar «осталось» — planned_amount нигде не редактируется). Шелл/Pro-гейт/preview-тумблер НЕ переносились (их даёт TripView; экшены — через useTripScreenActions, иконка fx→arrowSwap). Модалки Трата/Категория/Курсы остались на общем `Dialog`, переоформлены внутренности (.bgt-amtgrp/.bgt-swatches/.bgt-iconpick/.bgt-fxrow), логика save/edit/delete/валидация/fx-override НЕ тронута. Доб. inline-удаление траты (DeleteExpenseDialog, без window.confirm). Новые i18n-ключи (en/es/ru): by_category_title, donut_total, no_rate_count, fx_tap_edit, fx_rate_unset, booking_badge, manual_badge. Верификация: token-guard типографика PASSED, eslint 0 ошибок, vite build OK. DocsLens — пока ТОЛЬКО макет, в код не перенесён.
