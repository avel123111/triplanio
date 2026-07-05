---
name: triplanio-function-search-path-convention
description: Конвенция — у каждой prod-функции БД фиксировать search_path (TRIP-54, advisor lint 0011)
metadata:
  type: project
---

★TRIP-54 (PR #376 в dev 2026-07-04): **ВСЕ** прикладные функции в схеме `public`
имеют `SET search_path = public, pg_temp`. Иначе Supabase advisor светит WARN
`function_search_path_mutable` (lint 0011) и остаётся харднинг-щель (для
`SECURITY DEFINER` — путь к обходу RLS через shadowing объекта).

**Дефолт для НОВОЙ функции:** сразу писать `SET search_path = public, pg_temp`
(в `CREATE FUNCTION`/`ALTER FUNCTION`). `pg_temp` **последним** — критично: если
её не указать явно, Postgres неявно ищет `pg_temp` **первой** (даже раньше
`pg_catalog`), и временный объект может «затенить» public/catalog-объект. Плоский
`search_path = public` эту щель НЕ закрывает — нужен именно `…, pg_temp`. Если
функции нужна ещё схема — дописать её перед `pg_temp` (пример:
`auth_email_status` → `public, auth, pg_temp`).

Миграция TRIP-54 (`20260704223000_trip54_pin_function_search_path.sql`) привела к
целевому состоянию **54 функции**: 16 были вообще без `search_path` (вкл.
`is_trip_participant` [18 RLS-политик], `is_trip_creator`, `get_trip_*_profiles`,
напоминалки `get_trips_*_tomorrow`) + 38 имели плоский `public` → всем добавлен
`pg_temp` последним. Изменение метаданное — поведение/RLS/данные не меняются: все
тела ссылаются только на `public` + встроенку (`pg_catalog` всегда ищется первым),
и НИ ОДНА функция не создаёт temp-таблиц → перенос `pg_temp` в конец нейтрален.

**Вне скоупа (НЕ пиннить):** вендорные функции расширений `pg_trgm`/
`fuzzystrmatch`/`unaccent` (`levenshtein`, `soundex`, `similarity`, `gtrgm_*`,
`unaccent*` и т.д.) — advisor их флагает, но чинить нельзя. После мерджа в advisor
останутся только эти вендорные строки.

Деплой — только через CI/CD (см. [[feedback-no-manual-deploy-cicd-only]]).

## Второй слой: least-privilege EXECUTE у SECURITY DEFINER

★★ВАЖНО (TRIP-49, 2026-07-05): первая попытка (`20260704224000_secdef_revoke_anon_execute.sql`,
в PR #378) была **НЕЭФФЕКТИВНОЙ** — она делала `REVOKE ... FROM anon, authenticated`, но у
этих функций `EXECUTE` висит на роли `PUBLIC` (ACL `=X/postgres`, Postgres-дефолт `GRANT
EXECUTE TO PUBLIC`). `REVOKE FROM <роль>` **не снимает** грант `PUBLIC` → `anon` продолжал
исполнять через `PUBLIC`. Проверено на dev: 13 из 15 целей после той миграции всё ещё
`has_function_privilege('anon', …) = true` (вкл. опасные `ensure_trip_budget` = anon-запись
бюджета и `take_geocode_token` = DoS). **Правильная цель ревока = `PUBLIC`, НЕ `anon`.**
Прежняя запись «REVOKE делать адресно FROM anon/authenticated, НЕ FROM PUBLIC (иначе снесёт
service_role)» была ОШИБОЧНОЙ и есть корень бага: у каждой целевой функции `service_role`
имеет **свой явный** `EXECUTE` (`service_role=X`, проверено на dev И prod), поэтому `REVOKE
FROM PUBLIC` его НЕ трогает. Исправление — `20260705000500_trip49_revoke_public_execute_secdef.sql`:
tier-1 (internal/service_role/триггеры) → `REVOKE FROM public, anon, authenticated` (остаются
только postgres+service_role); tier-2 (фронт под `authenticated`) → `REVOKE FROM public, anon`
+ `GRANT TO authenticated` (идемпотентно, одинаковый end-state на dev где PR#378 частично снёс
явный authenticated, и на prod где PR#378 не катился вовсе). Скоуп — РОВНО 13 функций адресно
по сигнатуре, НЕ «все secdef скопом» (иначе прибьёшь легитимно-публичные `get_ai_usage_cursor`
(зовёт n8n), `is_trip_participant`, `search_gazetteer`). Ноль влияния: фронт=`authenticated`,
edge=`service_role`, n8n (edge Bearer / PostgREST service-role / прямой Postgres) — все держат
явные гранты. Пост-деплой ОБЯЗАТЕЛЬНА проверка `has_function_privilege('anon',…)=false` (PR#378
её пропустил → «зелёный деплой» ≠ дыра закрыта).

Ниже — исходный (частично неверный) разбор первого слоя, оставлен для контекста. Из 18
anon-исполнимых secdef-функций отозвали лишний грант у 15, оставив 3 намеренно:
- **НЕ трогать `is_trip_participant`/`is_trip_creator`** — вшиты в RLS-политики `TO
  public` 12+ таблиц; `EXECUTE` проверяется у ВЫЗЫВАЮЩЕЙ роли, поэтому и `anon`, и
  `authenticated` обязаны иметь право, иначе любой запрос к таблице падает
  `permission denied for function`. Для анона возвращают false (auth.uid()=null).
- **`search_gazetteer`** — публичный read-only поиск городов, грант анону легитимен.

Реально закрытые дыры (были без внутреннего auth-гейта, доступны анону):
`ensure_trip_budget` (анон-запись бюджета на чужой трип; зовётся только внутренне под
postgres → отозвали anon+authenticated), `rate_limit_record`/`take_geocode_token`
(порча rate-limit / DoS токен-бакета; зовутся только из edge под `service_role` →
отозвали anon+authenticated). Guard `auth.uid()` внутрь тел НЕ добавляли —
`ensure_trip_budget` бежит из триггера как postgres (auth.uid()=null), guard сломал бы
легитимный путь; чистый REVOKE безопаснее. `service_role` имеет собственный EXECUTE
(проверено) → отзыв у anon/auth его не задевает; REVOKE делать адресно `FROM anon`/
`authenticated`, НЕ `FROM PUBLIC` (иначе снесёт service_role). Ноль влияния на юзеров
(легитимные вызовы = authenticated-фронт / service_role-edge / внутренние триггеры).
Настоящий тикет этого слоя = **TRIP-49** («Ограничить EXECUTE для SECURITY DEFINER RPC
от роли anon», был Todo) — PR #378 его и реализует. Ссылка «TRIP-115» в описании TRIP-54
битая (TRIP-115 = отменённая тестовая задача). Работа сделана в ветке TRIP-54 по просьбе
Pavel, вынесена в отдельный PR #378.
