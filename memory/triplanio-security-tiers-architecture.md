---
name: triplanio-security-tiers-architecture
description: "Triplanio: ярусная модель доступа к БД (RLS/гранты/EXECUTE) A/B/C/D + манифест-SoT + CI-страж от дрейфа (обе двери: таблицы и secdef-функции)"
metadata:
  node_type: memory
  type: project
---

★АРХИТЕКТУРА безопасности доступа к данным (TRIP-124 + TRIP-190 + TRIP-120, 2026-07-05). Заменяет точечное «затыкание дыр» системной моделью + автозащитой от дрейфа.

## Модель ярусов (единый источник истины)
Каждая `public`-таблица (42), каждая SECURITY DEFINER функция и storage-бакет отнесены к ОДНОМУ ярусу. SoT — файл `scripts/ci/security-tiers.mjs` (экспорт `TABLES`/`TIERS`/`FUNCTIONS`/`BUCKETS`/`DECISIONS`), НЕ docs. Ярусы:
- **A — контент трипа** (activities, hotel_stays, transfers, city_visits, trip_services, trip_budgets, budget_categories, budget_expenses, trip_documents): `SELECT = is_trip_participant`, `WRITE = _can_edit_trip(trip_id, auth.uid())`. Прямые PostgREST-записи разрешены, гейтит роль. trip_documents дополнительно несёт private-модель TRIP-118 (`AND (visibility='shared' OR created_by=self)`).
- **B — авторитетное** (деньги: product/provider_*/purchase/subscription/webhook_event; роли: trip_members; настройки: trips; токены: trip_invite_links/telegram_link_tokens/trip_member_blocks; trip_telegram_integrations): НОЛЬ прямого клиентского DML — пишет только `service_role`/edge. `authenticated` без DML.
- **C — личное** (users, user_custom_visits, notifications, chat_reads, partner_clicks, chat_messages): всё скоупится `auth.uid()`. anon без DML.
- **D — справочник/системное** (cities, fx_rates, chats, geo_*, geocode_*, ai_*, n8n_chat_histories, rate_limit_hits, telegram_reminder_logs): пишет только service_role; клиент максимум SELECT (cities/fx_rates/chats читаются, остальные server-only).

## Две «двери» к данным
1. **Таблицы** — прямой SQL из браузера (`supabase.from()`). Гейт = табличные гранты + RLS. Бежит как вызывающий → RLS применяется.
2. **SECURITY DEFINER функции** — `supabase.rpc()` из браузера (add_city, create_trip, remove_city, reorder_cities, set_city_nights, set_trip_start_date, add_layover_transfer, get_trip_*_profiles, get_user_travel_stats, search_gazetteer). Бегут как супер-юзер → **обходят RLS**. Гейт = EXECUTE-грант (кто вправе позвать) + проверка внутри тела (`if not _can_edit_trip(...) then raise 'forbidden'`). Поэтому каждый мутирующий secdef ОБЯЗАН проверять права сам. Edge-функции (service_role) — тот же принцип (verify_jwt / N8N_SECRET / подпись Stripe + проверка в теле).

## Инварианты (держит CI-страж)
- **I3a** anon НЕ имеет INSERT/UPDATE/DELETE нигде. **I3b** authenticated DML только на A и C. **I2** ярус A: write-политика роль-осведомлённая (`_can_edit_trip`), не голый `is_trip_participant`. **I5** фронт не граница безопасности — viewer заблокирован в БД (RLS/гранты), не только скрытым UI. Функции: **IF2** authExec-функция не исполнима anon; **IF3** нет client-вызываемой secdef вне манифеста (грабля дефолтного PUBLIC EXECUTE); **IF4** client-вызываемая secdef ссылается на авторизацию в теле (кроме authzExempt: search_gazetteer, geocode_enqueue/dequeue/serve_fair, link_pending_invites).

## CI-страж `scripts/ci/check-security-tiers.mjs` (zero-dep)
- **STATIC** — PR-шаг `2e` в `checks.yml` (job guards, на PR в dev): валидирует самосогласованность манифеста (валидный ярус, anonDml=false везде, authDml только A/C, FUNCTIONS-списки не пересекаются). Ловит попытку ослабить правило в PR.
- **LIVE** — post-deploy шаг «Assert security tiers match manifest» в `supabase-deploy.yml` (job `migrate`, через `psql` по `SUPABASE_DB_URL_DEV/_PROD`): сверяет живые `pg_policies` + `relacl` + EXECUTE-гранты с манифестом на dev И prod. Ловит дрейф от только что применённой миграции (новая таблица с `GRANT ALL`, политика без роли, функция с PUBLIC EXECUTE). Модель как у verify_jwt-ассерта.

## Фазы/PR (все на dev к 2026-07-05)
Ф1 TRIP-124 #392 (9 контент-таблиц split + read-only UI бюджета/доков для viewer) · Ф2 TRIP-190 #393 (манифест) · Ф3a/b #394 (least-privilege ревоки anon/authenticated по ярусам C/D/B) · Ф3c #395 (trips+trip_telegram_integrations → Ярус B; обложка ManualPlanner переведена на edge `updateTripSettings`) · Ф4 TRIP-120 #396 (страж таблиц) · Ф4+ #399 (страж функций).

## Как менять правило (гибкость)
Правило живёт в ОДНОМ месте на концерн. Напр. «разрешить viewer грузить доки» = (1) строка в манифесте `trip_documents.write` → participant; (2) одна RLS-политика `trip_documents_insert` на `is_trip_participant`; (3) флаг `canAdd` в DocsLens. Enforcement — сама RLS в БД; страж держит манифест↔реальность синхронными.

## Осознанный тех-долг (НЕ сделано; триггер «перед первыми платящими клиентами»)
- Shadow-DB pre-merge гейт (эфемерная Postgres в CI → настоящий барьер вместо пост-деплой алерта).
- Поведенческие authz-тесты (дёргать secdef/edge от чужака → ждать forbidden) — надёжнее IF4-tripwire.
- Cron-аудит live (out-of-band дрейф из дашборда) + генератор политик из манифеста.
- Предел IF4: проверяет наличие ссылки на авторизацию, не факт правильного гейта — тонкий случай на ревью. Отклонены как переусложнение (решение Pavel 20/80).

Связано: [[triplanio-viewer-write-rls-escalation]] (закрытая дыра), [[triplanio-function-search-path-convention]] (EXECUTE least-privilege TRIP-49/54), [[triplanio-deploy-topology]] (CI-цепочка), [[triplanio-payments-foundation-rebuild]] (ярус B = биллинг).
