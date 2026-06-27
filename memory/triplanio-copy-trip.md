---
name: triplanio-copy-trip
description: "Копирование трипа — copyTrip, доступ всем участникам из «…» меню, Pro НЕ наследуется (вырез pro-аддонов)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0a854c63-33cc-473a-bf42-58a28b043ed6
---

Копирование трипа, состояние 2026-06-04 (задеплоено prod+dev).

- Edge `copyTrip` (POST {tripId}): копия принадлежит вызывающему (created_by), `is_pro_trip:false`, лимит фри-трипов = 3 проверяется. Копируются города/отели/активности/переезды/trip_services. Участники НЕ копируются.
- **Pro НЕ наследуется**: из копируемого `details.addons` вырезаются Pro-only аддоны (`budget`, `chat`, `telegram_assistant`); фри-аддоны (`calendar_view`, `hotels_selection`) сохраняются. Список синхронен с `src/lib/tripAddons.js` PRO_ONLY_ADDONS — менять в обоих местах.
- **Документы/обложка-ФОТО НЕ копируются (TRIP-15 Этап B, решение Pavel 2026-06-24, задеплоено prod v24 + dev v26):** копия рождается без единого следа документов. В `copyTrip`: `trips.cover_image_url → null`; `hotel_stays`/`activities`/`transfers.documents → []` (стрипается из спреда + явный `documents: []`); `trip_services.details` клонируется без ключа `documents` (остальные ключи — provider/booking — сохраняются); `trip_documents` не копируется (как и раньше). Файлы Storage оригинала не трогаются → новые копии файлов с оригиналом НЕ делят (закрыт прежний footgun общих файлов). Документы = Storage-бэкнутые сущности, физического дублирования файлов нет. PR #115.
- **Градиент обложки НАСЛЕДУЕТСЯ (TRIP-107, PR #174):** в отличие от фото (Storage-документ, не копируется), `cover_gradient` — это просто id из нашего набора 16 (`src/lib/trip-gradients.js`), поэтому `copyTrip` теперь ставит `cover_gradient = sourceTrip.cover_gradient || 'gradient_1'`. Раньше не переносил → копия с NULL → UI рисовал legacy-процедурный градиент (баг). Инвариант по всему приложению: `cover_gradient` всегда непустой (DB `DEFAULT 'gradient_1'` + backfill NULL + coalesce в `ManualPlanner`/`SettingsLens` save), фото рендерится поверх. Единый рендер-хелпер `coverGradientCss()` (без процедурных/hsl/`var(--primary)` фоллбэков — те выпилены из `Trips.jsx`/`ManualPlanner`/`VisitPanel` вместе с мёртвыми `strHue`/`coverHue`/`accentHue`).
- UI: пункт «Дублировать» (`trip.copy`) в `MoreMenuDialog` («…» хедера трипа). Кнопка «…» теперь рендерится ВСЕМ (incl. viewer); manage-пункты (Edit Mode/метаданные/Настройки/Участники) гейтятся `canManage`, копирование доступно всем участникам. На успех — тост `trip.copy_done` + nav на `/trip/:newId`.

- **БАГ ИСПРАВЛЕН 2026-06-04 «Could not copy the trip»**: `copyTrip` определял Pro по устаревшим статусам (`'active'/'pro_trip'/'cancelled'`), а реальный канон — `subscription_status === 'pro'` + непросроченный `subscription_end_date` (как `isProActive`/`getUserPlan`/`checkSubscriptionStatus`). Из-за этого ЛЮБОЙ Pro-юзер считался фри → при >3 трипах ловил лимит → 403, который клиент глушил в общий тост. Фикс: проверка Pro в `copyTrip` выровнена под канон; задеплоено copyTrip dev(v14)+prod(v12). Клиент (`TripView` handleCopy) теперь достаёт реальное сообщение из `error.context` и показывает его. ⚠️ На будущее: при добавлении edge-функций с проверкой Pro — использовать канон `'pro'`+end_date, не выдумывать статусы.

Связано: [[triplanio-pro-model]], [[triplanio-members-roles]], [[triplanio-services-widget]].
