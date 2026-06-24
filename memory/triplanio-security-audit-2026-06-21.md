---
name: triplanio-security-audit-2026-06-21
description: "Triplanio независимый security-аудит — live-подтверждённые P0/P1 (viewer-write RLS, unauth edge fns, ungated AI, висячие гранты)"
metadata: 
  node_type: memory
  type: project
  originSessionId: b3c1a50e-ec48-4eae-8206-f9ad656665f1
---

★АУДИТ 2026-06-21, отчёт `Triplanio docs/SECURITY_AUDIT_2026-06-21.md`. Код НЕ менялся. Проверено вживую на prod `tizscxrpuopobgcxbekf` + dev (паритет).

**P0 — viewer-write (всё ещё открыт, [[triplanio-viewer-write-rls-escalation]]):** 9 таблиц контента (`hotel_stays`,`activities`,`transfers`,`city_visits`,`budget_expenses`,`budget_categories`,`trip_budgets`,`trip_documents`,`trip_services`) имеют ЕДИНСТВЕННУЮ политику `<t>_all FOR ALL USING/CHECK is_trip_participant(trip_id)` — роль НЕ проверяется. `_can_edit_trip(trip,uid)` (role<>'viewer', SECURITY DEFINER, EXECUTE у authenticated) СУЩЕСТВУЕТ но не используется ни в одной RLS-политике. Viewer пишет/удаляет контент через сырой PostgREST + через негардированный роут `/trip/:id/edit` (App.jsx:111, TripStructureEdit.jsx:512 без редиректа). = Баг TRIP-136/137. Фикс: split SELECT(is_trip_participant)/WRITE(_can_edit_trip) на все 9 + фронт-гард.

**P1 — `syncTripExpense`:** ВООБЩЕ без auth (нет requireN8nSecret/getRequestUser), verify_jwt=false, ACTIVE. Неаутентиф. запись + нескоупленный `budget_expenses.delete().eq('source_id',…)`. Дублирует триггеры 0006. Фикс: requireN8nSecret + скоуп delete, или удалить (спросить Pavel).

**P1 — AI без Pro-гейта:** `planTripWithAi` (только auth, нет Pro/скоупа/лимита) и `callTriplanioAi` (membership есть, но НЕ проверяет Pro и addon `chat`) жгут платный n8n/LLM. Контраст: `parseBookingWithAi` гейтится правильно (membership+is_trip_pro→403) — заметка [[triplanio-payments-deep-audit]] про «parseBookingWithAi без гейта» УСТАРЕЛА. Фикс: применить шаблон parseBookingWithAi.

**P1 — висячие DML-гранты (латентный P0):** `trip_subscriptions` и `stripe_events` дают INSERT/UPDATE/DELETE для anon И authenticated (0054 их не трогал). Сейчас блок только отсутствием write-RLS-политики (default-deny). Одна «удобная» политика → self-grant Pro. Фикс: `REVOKE INSERT,UPDATE,DELETE … FROM anon,authenticated`.

**P2:** seedTripBudget без auth (verify_jwt=false, ветка event) — НЕ исправлено. **Тихие сбои:** EventViewBody.jsx:494/496 (запись доков, try без catch, UI врёт), DocsLens.jsx:324 (delete глотает ошибку) — НЕ исправлено.

★ИСПРАВЛЕНО+ЗАДЕПЛОЕНО 2026-06-22 (prod+dev, смоук на dev зелёный blocked=t):
- Лимит трипов: миграция **0058** — триггер `trips_enforce_limit BEFORE INSERT ON trips` (вызывает is_user_pro+count_active_owned_trips по NEW.created_by, raise TRIP_LIMIT_REACHED/P0001) = единый источник для ВСЕХ путей создания. Убрана инлайн-проверка из `create_trip` (RPC) и из `copyTrip` (edge, ловит P0001→403). `REVOKE INSERT ON trips FROM authenticated,anon` + дроп политики `trips_insert` → сырой PostgREST-путь закрыт. active_owned_trips НЕ трогали (экранный гард ManualPlanner /new-trip+/plan-trip-ai читает тот же счётчик). copyTrip передеплоен (verify_jwt=true) на оба.
- `useTripProStatus` (subscription.js): `retry:false`→`retry:2` (Pro-юзера не роняет во free при разовом сбое; по-прежнему fail-safe).
- Дубль «активный/прошлый» — СНЯТ как находка: isTripInPast (клиент) и active_owned_trips (сервер) дают одинаковый результат, не баг.
Репо-файлы (0058 sql, copyTrip/index.ts, subscription.js) ждут git push dev+main.

**ЧИСТО (подтверждено):** старый free-Pro через PostgREST закрыт (0054, users/trips колонки BLOCKED); webhook идемпотентен+single-writer+рефанды; SECURITY DEFINER RPC перепроверяют авторизацию; IDOR трип-чтения закрыт (getTripById=requireN8nSecret, getPublicTrip санитизирован).
