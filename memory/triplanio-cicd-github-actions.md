---
name: triplanio-cicd-github-actions
description: TRIP-73 CI/CD на GitHub Actions — авто-деплой edge-функций + PR-гейт; статус, устройство, грабли (нет dev-ветки, Node 22; все 3 гейта БЛОКИРУЮЩИЕ — frontend + typecheck TRIP-93 + deno TRIP-94)
metadata:
  type: project
---

★ TRIP-73 ГОТОВО (Этапы 1+2+3) 2026-06-25 — **авто-деплой edge-функций работает на dev И prod**. Мердж в `dev` → деплой в Supabase dev; мердж в `main` → deploy в prod (live-проверено: prod-прогон зелёный, все 13 pinned-false = false, версии всех ~47 функций подняты через CI-runner). Source-of-truth для verify_jwt = `supabase/config.toml`. Тех-долг вынесен в подзадачи TRIP-73: TRIP-93 (tsc — **ЗАКРЫТО 2026-06-26: озеленён и БЛОКИРУЮЩИЙ, см. ниже**), TRIP-94 (deno — **ЗАКРЫТО 2026-06-26: 14 type-ошибок исправлены, гейт БЛОКИРУЮЩИЙ, см. ниже**), TRIP-68 (миграции Ф3 — **ЗАКРЫТО 2026-06-26: миграции теперь катятся через тот же CI/CD, job `migrate`**). Открытый вопрос: энфорс required-чека на мердж не работает на free private GitHub (нужен Team/Enterprise) — деплой при этом защищён `deploy: needs gate`. См. [[triplanio-deploy-topology]].

**ГРАБЛИ деплой-прогона (исправлены в follow-up):**
- Деплой-джоб упал, т.к. `SUPABASE_ACCESS_TOKEN` не был заведён → «Access token not provided». Pavel завёл Repository secret → ре-ран зелёный по деплою. Воркфлоу читает `${{ secrets.SUPABASE_ACCESS_TOKEN }}` без `environment:` → секрет = **Repository**, не Environment.
- Ассерт verify_jwt падал ложно (все 13 = MISSING) — **баг в jq**, НЕ в API: `.verify_jwt // "MISSING"` → в jq оператор `//` считает boolean `false` «пустым», поэтому `false // "MISSING"` = `"MISSING"`; все функции `false` → все «MISSING». Сам деплой был корректен. **Фикс:** `(.verify_jwt|tostring)` + guard по `length` (НЕ `//`); LIST endpoint `GET /v1/projects/{ref}/functions` отдаёт slug+verify_jwt (1 вызов, нормализован к массиву на случай `{functions:[...]}`). (Промежуточная попытка через per-function GET была лишней — корень был в `//`.)
- Non-blocking deno/typecheck давали красные ❌ на PR (job-level continue-on-error). Follow-up → step-level continue-on-error + `::warning` аннотация: джоб GREEN, долг виден аннотацией.
- Деплой-воркфлоу триггерится только на `push dev` с paths `functions/**`+`config.toml` → правки самих воркфлоу его НЕ запускают. Добавлен `workflow_dispatch` для ручного ре-деплоя/ре-проверки assert.

**Что сделано (PR #133):**
- `config.toml`: запиннен `telegramDisconnect verify_jwt=false` → теперь **13** pinned-false, сверено с live prod+dev (canon-10 + signupPrecheck + requestPasswordReset + telegramDisconnect). Первый config-driven деплой = no-op по auth.
- Удалён легаси `supabase/deploy_userid_functions.sh` (конфликтующий 2-й источник истины, его NO_JWT без 5 из canon-10).
- 3 воркфлоу:
  - `.github/workflows/checks.yml` — переиспользуемый гейт (`workflow_call`). Все 3 джоба BLOCKING: `frontend` (npm ci→lint→test→build на **Node 22**) + `typecheck` (TRIP-93) + `deno` (TRIP-94) — `continue-on-error` снят у всех.
  - `ci.yml` — PR-гейт `pull_request → dev/main`, зовёт checks.yml.
  - `supabase-deploy.yml` (Ф1) — `on push dev` (Этап 3 добавит `main`), paths-фильтр (`functions/**`+`config.toml`), concurrency на ветку, `deploy needs gate`, config-driven `supabase functions deploy --project-ref <ref>` (dev=nydhz…, prod=tizsc…), финальный шаг — **ассерт verify_jwt** через Management API `GET /v1/projects/{ref}/functions`: парсит pinned-false из config.toml, фейлит job при дрейфе false→true.
- Deno-чек в CI: `deno check --no-lock --node-modules-dir=none $(find supabase/functions -name '*.ts')` — `--node-modules-dir=none` обязателен, иначе корневой package.json толкает deno в node_modules-режим и npm:stripe не резолвится.

**TRIP-94 — deno ОЗЕЛЕНЁН и БЛОКИРУЮЩИЙ (2026-06-26):**
- Были **14 ошибок** (getTripDetails ×10 PostgrestFilterBuilder/QueryBuilder mismatch; getActiveTrips/getFxRates/checkSubscriptionStatus ×3 TS2339 `error?.message`; getUserPlan ×1 `userData` null). Фиксы **только по типам, поведение не менялось**: getTripDetails — параметр хелпера `add(query)` → `PromiseLike<unknown>` (звено PostgREST-цепочки = FilterBuilder, не голый QueryBuilder); ×3 — `error instanceof Error ? error.message : String(error)`; getUserPlan — `userData?.subscription_end_date ?? null`.
- В `checks.yml` у job `deno` снят `continue-on-error` + удалён annotate-step (теперь BLOCKING). Локально проверено deno 2.9.0 идентичной CI-командой: до фиксов `Found 14 errors` exit 1, после — exit 0. Энфорс required на мердж — та же оговорка free private GitHub (advisory), что и у frontend/typecheck.

**TRIP-93 — typecheck ОЗЕЛЕНЁН и БЛОКИРУЮЩИЙ (2026-06-26, Variant A + храповик):**
- Корень baseline (~1202 ошибки, включая ~89 в `luxon.mjs`) = `checkJs:true` в `jsconfig.json` на JS/JSX-проекте: tsc выводил «обязательные» пропсы у `Btn`/`Icon`/`EmptyState` (`src/design/index.jsx`) → 738 из 1202 (TS2739/2740/2741) = ложные «missing prop». Шум, не баги. `skipLibCheck` не глушит luxon (он `.mjs`, не `.d.ts`), `exclude:node_modules` не помогает (checkJs идёт по импортам).
- **Фикс:** `checkJs:false` → 0 ошибок. tsc остаётся проверкой синтаксиса/JSX/импортов на всё дерево.
- **Храповик (incremental opt-in):** при `checkJs:false` пофайловая прагма `// @ts-check` ВСЁ РАВНО включает полную типизацию файла (даже если файл в `exclude:src/lib` — он попадает в программу как импорт включённой страницы/компонента, проверено эмпирически). Стартовый набор = кластер энтайтлментов/Pro (rule #13): `src/lib/{limits,subscription,tripAddons,useTripAccess}.js`. Сломанные типы в любом opt-in файле валят блокирующий гейт. Покрытие растёт файл-за-файлом, без big-bang TS-миграции и без сокрытия долга.
- В `checks.yml` у job `typecheck` снят `continue-on-error` + удалён шаг annotate (теперь BLOCKING). Энфорс required на мердж — та же оговорка free private GitHub (advisory), что и у frontend-гейта.

**Грабли окружения (durable, нет в CLAUDE.md):**
- **`npm test` требует Node ≥21**: скрипт `node --test "src/**/*.test.js"` раскрывает glob только в test-runner Node 21+. На Node 20 → «Could not find …». На Node 22 тесты 65/65 зелёные. CI запинен на 22.
- **Ветки `dev` на remote НЕ было** (влита в main через PR #132 и удалена) — пересоздана агентом от main 2026-06-25 по согласованию с Pavel. Если снова исчезнет — пересоздавать от main. См. [[triplanio-deploy-topology]], [[triplanio-deploy-verify-jwt]], [[triplanio-migration-naming-drift]].
- Трио зомби-функций (telegramGetBotInfo/WebhookInfo/sendTripReminders) уже нет ни в репо, ни в рантайме (prod+dev) — config-driven deploy ничего не воскрешает при условии нарезки ветки от свежего main/dev (risk C).

**Миграции — ТЕПЕРЬ CI/CD** (TRIP-68 Ф3, 2026-06-26): тот же воркфлоу `supabase-deploy.yml`, job `migrate` = `supabase db push` (merge→dev→Supabase dev, merge→main→prod; секреты `SUPABASE_DB_URL_DEV`/`_PROD`; IPv4 Session pooler в db-url); dev-прогон зелёный (no-op на baseline). **И функции, И миграции деплоим ТОЛЬКО через CI/CD — руками не катим и ручной деплой не предлагаем** (см. [[feedback-no-manual-deploy-cicd-only]]). Все 3 гейта (frontend/typecheck/deno) — **блокирующие** (TRIP-93 + TRIP-94 закрыли остаток non-blocking).

**Аудит 2026-06-25 (по запросу Pavel):** ядро (авто-деплой функций dev+prod) подтверждено на ЖИВОМ рантайме обоих проектов — все 45 функций задеплоены раннером GitHub Actions (entrypoint_path=/home/runner/...), 13 pinned-false=false 1:1 с config.toml на проде И dev, орфанов нет, CI-ассерт зелёный на прод-прогоне. **РЕШЕНИЕ Pavel:** «CI-гейт на PR» остаётся **advisory** (branch protection не энфорсится на free private GitHub) — деплой защищён `needs:gate`, мердж красного на доверии; это принято осознанно, НЕ недоделка, TRIP-73 закрывается так. Остаточные риски (приняты для MVP): все 3 гейта blocking (deno = TRIP-94, typecheck = TRIP-93), но required-энфорс на мердж = advisory (free GitHub, как frontend) — красный можно домерджить; ассерт verify_jwt односторонний (ловит false→true, не true→false); docs-PR #140 на dev, до main доедет следующим dev→main; TRIP-50 (зонтик деплой-дрейфа) — **закрыт полностью: и функции, и миграции через CI/CD** (миграции = TRIP-68, готово 2026-06-26).
