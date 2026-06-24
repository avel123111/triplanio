---
name: triplanio-stay22-hotel-fork
description: "Stay22 живые отели в hotel fork-панели редактора (edge-прокси + FE-список), как работает сейчас"
metadata: 
  node_type: memory
  type: project
  originSessionId: 4fd830e9-bacd-4318-9c08-f5442f219631
---

★РЕАЛИЗОВАНО 2026-06-12 (код написан, build+lint+6 тестов зелёные; ЖДЁТ деплой+секрет от Pavel). При открытии left-side fork/hotel панели (`leftPanel.type==='pick'`, kind hotel в `TripStructureEdit.jsx`) под партнёрскими плашками рендерится секция живых отелей Stay22.

Поток: `ForkPartnerModal` (только `type==='hotel' && variant==='panel'`) → `Stay22HotelList.jsx` → хук `useStay22Accommodations` (`src/lib/stay22.js`, React Query, enabled при открытии, keepPreviousData для пагинации, staleTime 5м) → edge `supabase.functions.invoke('stay22Accommodations')`. Чистый маппинг/params в `src/lib/stay22-normalize.js` (тестируемо, без react/supabase), тест `stay22-normalize.test.js`.

Edge-функция `supabase/functions/stay22Accommodations/index.ts`: тонкий прокси к `https://api.stay22.com/v2/accommodations`, секрет `STAY22_API_KEY` через `Deno.env` (паттерн placesAutocomplete), auth через `getRequestUser`, **verify_jwt=true** (в config.toml НЕ вносим — дефолт true, не из canon-10). Пинит `provider=booking, aid=triplanio, campaign=fork_api_sidepanel, pageSize=10, cluster=false, adults=2, children=0`. Возвращает `{meta,_links,results}` пасс-тру, в БД ничего не пишет.

Решения Pavel (ТЗ-сессия): поиск по **lat/lng** (visit.latitude/longitude), НЕ address; `rooms` не шлём; цена — `suppliers.booking.price.total` если есть, иначе скрыть (beta даёт цену только с checkin/checkout); `type` ('Accommodation') не показываем; верхняя общая плашка Booking — НЕ трогаем (текущий deeplink), `_links.self.href` вести НЕЛЬЗЯ (это JSON API-эндпоинт); кнопка карточки → `results[].url` (roam, с aid); список только в панели (не в модалке добавления); FE-only, без кеша в БД.

Карточка (дизайн-система Lumo, компактная под узкую панель): thumbnail + booking logoSquare (бейдж), name, hotelStars, rating.value/10 + count (скрыто при count/value=0), address, цена total+валюта (`fmtMoney`), даты+nights в шапке секции (1 раз, не на каждой карточке). Скелетоны при загрузке, пагинатор (windowed, meta.total/hasMore), EmptyState error/empty. i18n ключи `fork.stay22_*` в `locales/{en,es,ru}/view.js`. trip currency = `trip.details.main_currency`, lang из useI18nFormat.

Клики: каждый клик карточки → `usePartnerLogger` → `partner_clicks` (existing колонки только: partner='booking', type='hotel', link=roam-url; user_id, trip_id). Схему НЕ расширяли (Pavel: пока пишем только что есть). [[triplanio-services-widget]] [[triplanio-trip-delete-fk]] partner_clicks: id,user_id,trip_id,partner,type,link,created_at; RLS on, 2 policy, FE insert fire-and-forget.

ОТКРЫТО: предложено добавить nullable `source`/`item_id` в partner_clicks для атрибуции (Pavel отложил). radius в прокси поддержан, но не шлётся (Stay22 дефолт).
