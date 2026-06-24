---
name: triplanio-trip-limit-sources
description: Triplanio Free-лимит трипов — источники подсчёта «активного» и фикс рассинхрона enforcement
metadata: 
  node_type: memory
  type: project
  originSessionId: 13029f86-ea2d-468e-a4c8-085e977fa968
---

★ИСПРАВЛЕНО 2026-06-19 (prod+dev). Free-лимит = 1 активный трип у владельца. Было 2 РАЗНЫХ определения «активного» в 4 местах:

Источники:
1. DB `create_trip()` (RPC, зовётся из ManualPlanner.jsx:1115 на финале создания) — ЕДИНСТВЕННЫЙ enforcement, кидает `TRIP_LIMIT_REACHED` (errcode P0001). Миграция 0009.
2. Edge `getActiveTrips` — read-only, для `TripLimitDialog`. Считает по `city_visits.end_date`.
3. FE `Trips.jsx` `ownedActiveTrips` — баннер + гейт перед диалогом. По `isTripInPast(city_visits)`.
4. FE `ManualPlanner.jsx` `isOverLimit` — свой пересчёт по `isTripInPast(city_visits)`.

БАГ: №1 считал по колонке `trips.end_date`, а №2/3/4 — по `city_visits`. Колонки `trips.start_date`/`trips.end_date` МЁРТВЫЕ — нигде не заполняются (на prod все 11 трипов = NULL; даты живут только в `city_visits`). Поэтому `(end_date is null or end_date >= current_date)` всегда true → любой трип (даже прошлый) считался активным вечно → ЛЮБОЙ free-юзер с ≥1 трипом не мог создать второй. UI пускал (0 активных), БД резала.

ФИКС: миграция `0040_create_trip_limit_by_visits.sql` — `create_trip` теперь считает по `city_visits` как getActiveTrips/isTripInPast: трип активен, если нет датированных визитов ИЛИ `max(city_visits.end_date) >= current_date`. Применено через apply_migration на prod (tizscxrpuopobgcxbekf) + dev (nydhzevdizkfaxdlikgc), проверено (uses_city_visits=true). Файл миграции в репо ждёт git push (dev+main).

Связанная FE-правка 2026-06-19: баннер «На Free доступно 1 активное путешествие» в Trips.jsx показывается только при ownedActiveTrips.length >= 1 (раньше всегда).

ОТКРЫТО/долг: 4 места всё ещё дублируют логику (DB SQL + edge TS + 2× FE). Определение единое по смыслу, но кода 4 копии. Лимит хардкод 1 в create_trip, Trips.jsx, ManualPlanner.jsx, getActiveTrips — при конфигурируемости выносить в один источник. Связано с [[triplanio-pro-model]], [[triplanio-pro-audit]], [[triplanio-city-country-count-unification]].

★РЕЦИДИВ 2026-06-20 (5-й заход) — РАЗОБРАН, фикс НЕ задеплоен. Юзер huyavel.mx@gmail.com (dev, free, 0 активных + 1 прошедший трип) видит TripLimitDialog. Причина: ДЕПЛОЙ-ДРЕЙФ. Задеплоенный `getActiveTrips` (dev v13 + prod v15, sha 43cb831…) читает НЕсуществующую колонку `city_visits.end_datetime` (схема: только start_date/end_date type date; end_datetime переименован 2026-06-04 коммит 581c021). PostgREST→400, supabase-js→{data:null,error}, edge деструктурирует только data (ошибку ГЛОТАЕТ)→visits=null→maxEndByTrip пустой→у каждого трипа maxEnd===undefined→ВСЕ активны→free с ≥1 любым трипом блокируется. В git (dev HEAD) функция УЖЕ читает end_date — починена, но edge-функция НЕ передеплоена ни на dev ни на prod (функции деплоятся вручную, CI нет → git≠runtime).
Аудит правила «1 активный, owner»: (1) getActiveTrips read/диалог — 🔴 рантайм сломан, git ок, не задеплоен; (2) create_trip RPC — 🟢 ок (max(end_date) coalesce current_date); (3) copyTrip edge — 🟠 РАСХОЖДЕНИЕ: FREE_TRIP_LIMIT=3 + count(*) ВСЕХ трипов по created_by без фильтра активности (не 1 активный); (4) isTripInPast Trips/ManualPlanner — 🟢 отображение; (5) TripLimitDialog gate activeCount>=1 — 🟢.
Усугубитель: getActiveTrips игнорирует error → любой сбой запроса fail-ит в «блокировать».
ПЛАН (ждёт апрува Pavel): 1) передеплой getActiveTrips из git на dev+prod (verify_jwt=true, НЕ в canon-10); 2) в функции проверять error + не трактовать null как «все активны» (fail в сторону allow); 3) системно — одна SQL-функция count_active_owned_trips(uid) в миграции, звать из create_trip/getActiveTrips/copyTrip (убирает дрейф колонки/числа/фильтра/деплоя); 4) copyTrip привести к 1-активному (нужно решение по числу). Связано с [[feedback-design-for-scale-not-now]], [[triplanio-deploy-topology]].

★ВЫПОЛНЕНО 2026-06-20 (этот же заход):
- Phase 1 ЗАДЕПЛОЕНО dev (getActiveTrips v14) + prod (v16), sha ce16e76, verify_jwt=true: читает end_date + fail-open на ошибку запроса (трактует сбой как activeCount 0, т.к. create_trip = реальный enforcement). Проверено: affected user active_count=0 (max_end 2026-05-28 < today). Canon-10 verify_jwt не задет (single deploy). Репо-файл обновлён (git=runtime).
- Phase 2 миграция 0045_active_trips_single_source.sql НАПИСАНА + применена ТОЛЬКО на DEV: helper-функции active_owned_trips(uuid)/count_active_owned_trips(uuid) (security definer, revoke from public, grant service_role — против IDOR-утечки чужих трипов), create_trip перенаправлен на count_active_owned_trips. Проверено: helper == inline-правило для ВСЕХ владельцев (mismatched_owners=0).
- Phase 2 ПОЛНОСТЬЮ ВЫПОЛНЕНО 2026-06-20 (Pavel подтвердил: copyTrip = ровно то же правило, 1 активный owner, через ту же функцию):
  • 0045 применена dev+prod. getActiveTrips переписан на rpc active_owned_trips (dev v15/prod v17, sha b7915669). copyTrip переписан на count_active_owned_trips>=1, убран FREE_TRIP_LIMIT=3 (4-файловый бандл с _shared/*, dev v21/prod v19, sha 64cdd5ad). Все 3 (create_trip+getActiveTrips+copyTrip) теперь через ОДИН источник. Проверено: helper==inline для всех владельцев на dev И prod (mismatched=0).
  • БАГ найден при верификации: revoke from public НЕ снимает execute у anon/authenticated (Supabase даёт его напрямую через default privileges) → active_owned_trips(p_uid) SECURITY DEFINER был вызываем любым залогиненным с чужим uid = IDOR-утечка чужих трип-тайтлов. Фикс — миграция 0046_lock_active_trips_helpers (revoke execute from anon,authenticated; grant service_role) применена dev+prod. Перепроверено: anon=false/authd=false/service=true на обоих. create_trip(definer) и edge(service-role) работают.
- Git к пушу (dev+main, коммитит Pavel — Vercel блокит чужие): supabase/functions/getActiveTrips/index.ts, supabase/functions/copyTrip/index.ts, supabase/migrations/0045_active_trips_single_source.sql, supabase/migrations/0046_lock_active_trips_helpers.sql.
- Остаток: живой браузер-смоук (диалог не блокит free с прошедшим трипом; копирование 2-го активного режется) под залогиненным юзером — за Pavel.

★FE-УНИФИКАЦИЯ 2026-06-20 (lint чистый, vite build EXIT=0; НЕ запушено — Pavel пушит dev+main, Vercel деплоит): теперь клиент тоже из ОДНОГО источника. Новый хук src/hooks/useActiveTripsLimit.js дёргает getActiveTrips→active_owned_trips, возвращает {activeCount,isPro,isBlocked,isLoading}. Переведены: ManualPlanner.jsx (убраны свои 2 запроса trips+city_visits select('*') и пересчёт isTripInPast → хук; импорты useQuery/isTripInPast убраны), Trips.jsx баннер (server-count через хук, ownedActiveTrips удалён). КОПИРОВАНИЕ при лимите теперь = та же Pro-МОДАЛКА (TripLimitDialog), не destructive-тост: copyTrip-вызов централизован в CreateTripProvider (новый startCopy(tripId)+doCopy+copying, тот же gate что startCreate), дубль-хендлеры copyTrip удалены из TripView.jsx и TripStructureEdit.jsx (теперь onSelect=()=>startCopy(trip.id), disabled=copying из контекста). Все 5 потребителей правила (create_trip, getActiveTrips, copyTrip, planner-блокер, баннер) идут в одну DB-функцию active_owned_trips(). Git к пушу +: src/hooks/useActiveTripsLimit.js, src/components/create/CreateTripProvider.jsx, src/pages/ManualPlanner.jsx, src/pages/TripView.jsx, src/pages/TripStructureEdit.jsx, src/pages/Trips.jsx.
