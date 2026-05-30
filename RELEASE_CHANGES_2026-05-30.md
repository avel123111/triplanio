# Изменения в этом коммите (релиз 2026-05-30)

Один общий релиз: Stripe dual→single-mode, Pro-гейтинг, модалки оплаты/лимита, серверные правки, фикс таймлайна.

## Фронтенд (src/)
- **`lib/subscription.js`** — `isProActive`: `subscription_status='pro'` с пустым `end_date` теперь = НЕ Pro (как на сервере).
- **`lib/validation.js`** — `sortVisits`: при равном `start` тай-брейк по `end` (город, который раньше заканчивается, идёт первым).
- **`components/common/TripProInfoDialog.jsx`** (НОВЫЙ) — модалка для участника не-владельца: «Pro подключает владелец», без перехода к оплате (+ «скопировать ссылку»).
- **`pages/TripView.jsx`**:
  - in-trip Pro теперь owner-aware: `tripIsPro`+`isOwner` из `checkSubscriptionStatus({tripId})`; account-Pro только в шапке;
  - сайдбар: владельцу — «Апгрейд трипа», участнику — «Подключает владелец» → инфо-модалка;
  - Settings/Members скрыты у зрителя в меню + guard (deep-link → таймлайн);
  - шевроны виджетов «Бюджет»/«Кто едет» только owner/admin; бюджет-виджет при выкл. аддоне → модалка «включите аддон» → настройки;
  - аддон-гейтинг линз: дефолт OFF (видно только если `addons[key]===true`); чат-виджет по аддону;
  - **таймлайн переписан**: CityHero по дню прибытия, несколько Hero в день, пары трансфер/варнинг из единого `prevCity` (убран рассинхрон с `sortVisits`); `visitForDay` больше не используется;
  - убрана локальная обработка `stripe_status` (теперь в Layout).
- **`pages/SettingsLens.jsx`** — `FEATURES` приведены к `PRO_ONLY_ADDONS` (budget/chat/telegram = Pro; calendar не Pro; hotels = «Скоро»; убраны `ai` и `docs`); дефолт фич OFF; тоггл Pro: владелец → ProLockedDialog, админ → TripProInfoDialog.
- **`pages/EventEditDialog.jsx`** — ИИ-парсер: locked-CTA владельцу ведёт в `/pro`, участнику → TripProInfoDialog (читает `isOwner` из `checkSubscriptionStatus`).
- **`pages/Pro.jsx`** — `pro_trip` скрыт, если посетитель не владелец указанного трипа (подписку купить можно).
- **`components/Layout.jsx`** — единый глобальный показ результата оплаты: PaymentSuccessDialog (с тарифом+ценой из getUserPlan/getStripePrices) и PaymentFailDialog; убран дубль WelcomeToProDialog.
- **`components/common/PaymentSuccessDialog.jsx`**, **`PaymentFailDialog.jsx`** — редизайн по макету (X в шапке, чип тариф+цена в успехе, `card_declined` + подсказка в неуспехе).
- **`components/subscriptions/TripLimitDialog.jsx`** — переписан в дизайн Variant D (hero + Free/Pro колонки + «Посмотреть тарифы»); используется для in-app «Новый трип».
- **`pages/AiTripPlanner.jsx`** — при лимите по прямой ссылке: полноэкранный блокер вместо модалки (как ручной планировщик).
- **`pages/Trips.jsx`** — убрана локальная обработка `stripe_status`/модалки (теперь в Layout).

## Бэкенд (supabase/)
- **`functions/stripe-webhook/index.ts`** — добавлена обработка `charge.refunded` / `charge.dispute.created`: снять `is_pro_trip` (pro_trip) либо перевести юзера во `free` (подписка), статус строки `refunded`/`disputed`. _(Уже задеплоено в dev+prod через коннектор.)_
- **`migrations/0009_create_trip_free_limit.sql`** (НОВЫЙ) — `create_trip` RPC: серверный лимит free = 1 активный трип (`TRIP_LIMIT_REACHED`), Pro безлимитен. _(Уже применено в dev+prod.)_

## Удалён мёртвый код
- `components/subscriptions/AiFeatureLock.jsx`
- `components/subscriptions/WelcomeToProDialog.jsx`
- `pages/Settings.jsx` (shadcn, не в роутинге)

## НЕ входит в коммит
- Доки `*.md` (PRO_*, STRIPE_*, RELEASE_CHANGES, чек-лист) — не стейджатся.
- `ScreenPro.jsx`, `UserMenu.jsx` — оставлены (живые импорты в DesignPreview/AppHeader).

## Требует ручной настройки (вне кода)
- Stripe: default_price для pro_trip/pro_yearly + архив тестовой €0.05; события `charge.refunded`/`charge.dispute.created` в webhook (live+test).
- Edge-функции и миграция 0009 уже применены в обоих Supabase-проектах (пуш их не передеплоит — только Vercel-фронт).

## Отложено (не в релизе)
- `getTripDetails` (`verify_jwt=false` → неавторизованный доступ к трипу).
- Валидация дат города (`end ≥ start`, без перекрытий) + правка данных трипа 49a1de05.
- RLS-бэкстоп на прямой insert в `trips` (единственный путь `create_trip` уже покрыт).
