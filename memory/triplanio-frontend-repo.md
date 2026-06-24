---
name: triplanio-frontend-repo
description: Где живёт фронт нового Triplanio и какие компоненты чата реальные vs мокапы
metadata: 
  node_type: memory
  type: reference
  originSessionId: d4552c59-390f-4299-922e-e321cc6df1a9
---

**Актуальный фронт-репо = папка `triplanio_new`** (`/Users/pavel.moskovkin/Downloads/triplanio_new`), несмотря на проджект-конфиг «Ignore the triplanio_new repo as it is outdated». Проверено 2026-05-30: remote `github.com/avel123111/triplanio`, рабочее дерево чистое, свежие коммиты. Конфиг устарел — правим triplanio_new. («Triplanio App 2» — без git, не трогать.)

**Чат — реальные компоненты vs мокапы:**
- ПРОД: `src/pages/ChatLens.jsx` (экран чата, рендерится в TripView), `src/components/chat/ChatWidget.jsx` (плавающий виджет).
- МОКАПЫ (хардкод-данные, не трогать как прод): `src/pages/redesign/ScreenChat.jsx`, `src/pages/redesign/ScreenTimeline.jsx`, `src/design/dock.jsx`, `DesignPreview.jsx`.
- ЛЕГАСИ/неиспользуемые: `TripChatTab.jsx`, `ChatComposer.jsx`, `ChatMessageBubble.jsx`, `MentionRenderer.jsx`.

**Долг/грабли чата:**
- Composer (overlay-div за прозрачной textarea + @mention popup) **продублирован** в ChatLens и ChatWidget — кандидат вынести в общий `<ChatTextarea>`.
- `.eyebrow` течёт из `login.css` глобально: `margin-bottom: 18px` + `::before` (оранжевая точка) — перебивает `app.css .eyebrow`. Из-за этого был лишний отступ под «Упомянуть» (чинили инлайн `margin:0`).
- Авто-рост инпута: добавлен useLayoutEffect (height=min(scrollHeight, ~4 строки)) + синк scrollTop оверлея; кнопка/инпут одной высоты, `alignItems:flex-end`.

**Бюджет — системные траты эвентов:** синк бюджета делает SQL-триггер `sync_budget_expense()` (на hotel_stays/transfers/activities/trip_services), НЕ edge `syncTripExpense` (клиент её не зовёт). Баг (пофикшен 2026-05-30, миграция 0010): при price null/0 трата удалялась; теперь удаляется только при удалении эвента (TG_OP=DELETE), иначе апсерт с `coalesce(price,0)`. Применено prod+dev. Уже удалённые ранее траты не возвращаются сами — нужен ре-сейв эвента или бэкфилл. Связано: [[triplanio-ai-booking-parse]].
