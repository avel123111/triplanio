---
name: triplanio-fork-panel-hotels-lumo
description: "Triplanio — Lumo-макет левой fork-панели «Отели» (manual-CTA + партнёрки + список Booking), все состояния; в код НЕ перенесено"
metadata: 
  node_type: memory
  type: project
  originSessionId: 731683a7-2e84-4b09-b2e1-5d3a384e0781
---

★МАКЕТ 2026-06-13 (в код НЕ перенесено): редизайн левой fork-панели редактора для отелей с нуля в дизайн-системе Lumo. Контент 1:1 с текущим кодом (`ForkPartnerModal.jsx` variant='panel' + `Stay22HotelList.jsx`), визуал новый.

Файл: `Triplanio design new/FORK_PANEL_HOTELS_LUMO_2026-06-13.html` (standalone, light+dark+палитры azure/rose/teal, адаптив под мобайл = bottom-sheet).

Содержит: (1) основной сценарий целиком — manual-CTA «Добавить вручную» (карта на --ev-hotel) + плашки партнёров + инфо-нота + список Stay22 + пагинация; (2) состояния партнёрок 0/1/2/3/4 (0=пунктирная заглушка, 1=solo крупнее, 2=Booking+Expedia из ТЗ, 3=+Airbnb, 4=+Agoda); (3) состояния списка: loading-скелетоны / empty / error+Повторить; (4) мобайл 390px.

Карточка отеля (форма из `stay22-normalize.js`): фото · бейдж Booking · название · ★stars + score-плашка 0–10 (стиль Booking, скруг 6/6/6/2) + label + кол-во отзывов · адрес с пином · цена + «за N ночей» · кнопка «Забронировать» (primary pill).

ПУШБЕК Pavel'у: в коде партнёрки отелей = Booking + **Airbnb**, а не Expedia. Pavel выбрал в макете Booking + Expedia → для реальной интеграции later нужно добавить Expedia в `hotelPlatforms()` в `buildBookingPlatforms.jsx` (+ лого в booking-platforms).

Грабли макета (исправлено): `--wash:var(--surface-3)` объявлен на :root(html), а `[data-theme=dark]` висит на body → --wash резолвился в светлый surface-3. Фикс — продублировать `--wash:var(--surface-3)` внутри dark-блока (резолв в scope body).

Связь: [[triplanio-stay22-hotel-fork]] (реализация списка), [[triplanio-overlay-pro-unification]], [[triplanio-lumo-gap]].
