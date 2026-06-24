---
name: triplanio-bottomnav-header-unification
description: Мобильный боттом-нав (4 варианта) + схлопывание 3 хедеров трипа в 1; интерактивный макет
metadata: 
  node_type: memory
  type: project
  originSessionId: 87d0024b-0313-4058-8ede-f03bf7841767
---

★Инициатива 2026-06-11: добавить мобильный bottom-nav и убрать «3 хедера» внутри трипа.

**Проблема (из кода).** Внутри трипа (TripView.jsx, standalone — НЕ под Layout) три стэкнутых бара: `app-header` (бренд+назад+тема/колокол/аватар), `trip-hero` (TripHeaderBar — градиент-обложка+название+даты+Share/Edit/…), `trip-screenbar` (TripScreenBar — имя лензы + действия лензы). На мобиле ~40% экрана. Боттом-нав есть ТОЛЬКО на не-трип роутах (Layout.jsx), и там тупой: 2 пункта (Трипы+Настройки). Внутри трипа боттом-нава нет — лензы в гамбургер-шторке (TripSidebar/TripSidebarSheet).

**Лензы (src/lib/tripMenu.js).** LENS: overview, timeline, map, calendar(gated), budget(gated), docs, chat(gated). MGMT: members, settings. EDIT: /trip/:id/edit (owner/admin).

**Решения макета (мои, не утверждены Pavel):**
- Контекстный нав: в трипе=лензы, в списке трипов=Трипы/Входящие/➕/Аккаунт.
- В трипе 4 главных лензы наружу (Обзор/Маршрут/Карта/Бюджет) + «Ещё» (sheet) для остального; центр=главное действие (добавить событие/расход/AI).
- 4 варианта боттом-нава: 1 Floating Capsule (плавающая пилюля+FAB), 2 Smart Dock+«Ещё»-sheet, 3 Arc Action Hub (центр раскрывает дугу быстрых действий), 4 Spotlight Rail (минимал+командная палитра).
- 2 варианта хедера: A Collapsing Hero (геро схлопывается в тонкий бар при скролле; реком.), B Unified Slim Bar (всегда 60px). Десктоп: единый app-bar с инлайн-табами лензов (3→1).

**Макеты (2 файла в «design new»):**
- v1 `TRIPLANIO_BOTTOMNAV_HEADERS_LUMO_2026-06-11.html` — 4 концептуальных нав-варианта (Capsule/Dock/Arc/Spotlight) + 2 хедера; 2 телефона + десктоп-превью.
- v2 `TRIPLANIO_NAV_HEADER_LAB_V2_2026-06-11.html` ★(Pavel был недоволен v1 «на объебись» + не верил что юзал скиллы) — полная матрица под скиллы (ui-ux-pro-max nav-rules ≤5/иконка+подпись/adaptive-sidebar, a11y focus-visible/reduced-motion/44px, Emil easing/scale): **6 production нав-вариантов** (N1 стандарт-таб, N2 M3-пилюля, N3 док+FAB, N4 плавающий, N5 расширяющийся актив, N6 верхний-индикатор) + **4 хедера** (H1 схлоп-геро, H2 компакт-бар, H3 крупный-заголовок iOS, H4 центр-заголовок) + **десктоп D1 топ-бар / D2 сайдбар лензов(реком) / D3 верхние табы**; контекст-переключатель трип↔общие. Реком: N1/N2 база, N3 если «добавить» главное; десктоп-трип=D2 сайдбар.
В КОД не перенесено — ждёт выбора Pavel варианта. См. [[triplanio-overlay-pro-unification]] (bottom-sheet канон C1/C2/C3<640px) и [[triplanio-ui-audit]].
