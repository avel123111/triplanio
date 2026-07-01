# Triplanio: дорожная карта безопасности (TRIP-164)

★АУДИТ + ПЛАН 2026-07-01 (код НЕ менялся — задача аналитическая). Полный аудит стека
(React18+Vite / Supabase edge-функции Deno / Postgres RLS / Stripe) + приоритезированный
бэклог. Excel/CSV-таблица (15 задач, колонки: Порядок / Задача / Область / От чего /
Что даст / Риск / Статус / Усилие / Актуально для мобилки / Конкретные шаги) приложены
к Linear-задаче TRIP-164. Живые Supabase-advisors(security) сняты по dev-проекту.

## Что подтверждено ОТКРЫТЫМ (верифицировано по коду ветки, не по памяти)
- **КРИТ №1 — viewer-write RLS-эскалация (TRIP-136/137, всё ещё открыто).** 9 таблиц
  (`activities, city_visits, hotel_stays, transfers, budget_categories, budget_expenses,
  trip_budgets, trip_budgets, trip_documents, trip_services`) имеют `*_all`-политики с
  `WITH CHECK (is_trip_participant(trip_id))` — роль НЕ проверяется. RPC (`add_city` и др.)
  корректно зовут `_can_edit_trip`, но прямой PostgREST-PATCH viewer-токеном пишет в обход.
  Фикс: заменить в WITH CHECK `is_trip_participant` → `_can_edit_trip`. См.
  [[triplanio-viewer-write-rls-escalation]] и [[triplanio-security-audit-2026-06-21]].
- **КРИТ №2 — неаутентифицированные внутренние ручки.** `syncTripExpense` (verify_jwt=false,
  БЕЗ проверки секрета вообще) → unauth upsert/delete бюджета; `seedTripBudget` по
  automation-ветке `{event:{entity_name:'Trip'}}` пишет без auth (manual-ветка требует JWT).
  Фикс: `requireN8nSecret()` на обе ветки.
- Заголовков безопасности НЕТ (`vercel.json`/`index.html` без CSP/HSTS/X-Frame-Options) →
  задача «CSP + security headers» (высокий, дёшево).
- Rate-limit только на signup/reset/AI-чат; открыты redeemTripInviteLink (перебор токена),
  invite/resend (спам письмами), createStripeCheckout/Portal, telegram/share-токены.
- Валидация ввода ad-hoc (нет схемы); `copyTrip` разливает произвольный JSON в строки БД.
- Live-advisors: 16 SECURITY DEFINER fn с mutable search_path; anon-EXECUTE на create_trip и
  др.; публичный бакет `avatars` разрешает листинг; leaked-password protection выключен;
  4 расширения в public.

## Что уже СИЛЬНО (не переделывать)
Stripe webhook: подпись + идемпотентность (`webhook_event`) + ordering-guard — ОК;
энтайтлмент-P0 закрыт (клиент не пишет `subscription_*`/`is_pro_trip`/`trips.details` —
гранты сняты, деривация только server-side recompute); CORS = allow-list (`corsFor`), без
credentials; Sentry PII-скраб; хардкод-секретов нет; SQL-инъекций нет (PostgREST/параметры);
XSS практически нет (ReactMarkdown; `dangerouslySetInnerHTML` только в невидимом
composer-оверлее + статические i18n). См. [[triplanio-payments-audit-2026-06-29]].

## Порядок (из таблицы)
1 RLS viewer-write · 2 unauth-ручки · 3 CSP/headers · 4 rate-limit · 5 валидация ·
6 SECURITY DEFINER/гранты · 7 Supabase Auth (leaked-pw/2FA) · 8 Storage-приватность ·
9 AI cost-лимиты · 10 dep/secret-скан в CI · 11 audit-log · 12 полнота reconcile ·
13 CSRF-инвариант (задокументировать) · 14 CAPTCHA/бот · 15 мобилка (Keychain/pinning/
deep-link/IAP-через-RevenueCat).

**Мобилка:** отдельного «мобильного бэкенда» нет — общий Supabase, поэтому п.1-12 закрывают
и мобильный клиент. Профильное для натива вынесено в п.15.
