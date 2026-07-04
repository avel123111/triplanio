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

Связано: TRIP-115 (anon EXECUTE для SECURITY DEFINER) — те же функции.
Деплой — только через CI/CD (см. [[feedback-no-manual-deploy-cicd-only]]).
