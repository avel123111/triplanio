---
name: triplanio-services-widget
description: "Виджет Сервисы (right-rail TripView) — kind-based (НЕТ колонки status), плейсхолдеры esim/car_rental + «Ещё»"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0a854c63-33cc-473a-bf42-58a28b043ed6
---

ServicesWidget в `ContextSide` (правый рейл TripView.jsx), состояние 2026-06-04.

- `trip_services` имеет поле **`kind`** (`esim`|`car_rental`|`insurance`), **колонки `status` НЕТ**. ⚠️Историч.баг: виджет фильтровал по несуществующему `status` (active/booked/pending) → после добавления любого сервиса плейсхолдеры исчезали, всё уходило в «pending». Переписан на kind-модель (зеркалит base44 `TripServicesCard`).
- Рендер: добавленные сервисы = карточки (иконка по kind, лейбл `service.kind.*`, под ним `name`). Верхние пунктирные плейсхолдеры — только `esim`/`car_rental` и только пока по kind нет записей. Кнопка «Ещё» (`service.more`) разворачивает `insurance` (всегда) + add-more для esim/car_rental, у которых уже есть записи (`service.add_more`).
- Плюс на плейсхолдере — отдельный trailing-элемент справа (был баг: inline-иконка налезала над текст).
- Клик плейсхолдера → `onAddService(kind)` → ForkPartnerModal/ServiceDialog (esim/insurance) или EventEditDialog (car_rental).
- Док Notion: «Таймлайн трипа (Timeline lens)» → раздел «Правый сайдбар — виджет Сервисы».

Связано: [[triplanio-copy-trip]], [[triplanio-frontend-repo]].
