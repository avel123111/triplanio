---
name: triplanio-cicd-github-actions
description: TRIP-73 CI/CD на GitHub Actions — авто-деплой edge-функций + PR-гейт; статус, устройство, baseline-долг, грабли (нет dev-ветки, Node 22, typecheck ~1200 ошибок)
metadata:
  type: project
---

★ TRIP-73 ГОТОВО (Этапы 1+2+3) 2026-06-25 — **авто-деплой edge-функций работает на dev И prod**. Мердж в `dev` → деплой в Supabase dev; мердж в `main` → deploy в prod (live-проверено: prod-прогон зелёный, все 13 pinned-false = false, версии всех ~47 функций подняты через CI-runner). Source-of-truth для verify_jwt = `supabase/config.toml`. Тех-долг вынесен в подзадачи TRIP-73: TRIP-93 (tsc ~1202), TRIP-94 (deno 14), TRIP-68 (миграции Ф3). Открытый вопрос: энфорс required-чека на мердж не работает на free private GitHub (нужен Team/Enterprise) — деплой при этом защищён `deploy: needs gate`. См. [[triplanio-deploy-topology]].

**ГРАБЛИ деплой-прогона (исправлены в follow-up):**
- Деплой-джоб упал, т.к. `SUPABASE_ACCESS_TOKEN` не был заведён → «Access token not provided». Pavel завёл Repository secret → ре-ран зелёный по деплою. Воркфлоу читает `${{ secrets.SUPABASE_ACCESS_TOKEN }}` без `environment:` → секрет = **Repository**, не Environment.
- Ассерт verify_jwt падал ложно (все 13 = MISSING) — **баг в jq**, НЕ в API: `.verify_jwt // "MISSING"` → в jq оператор `//` считает boolean `false` «пустым», поэтому `false // "MISSING"` = `"MISSING"`; все функции `false` → все «MISSING». Сам деплой был корректен. **Фикс:** `(.verify_jwt|tostring)` + guard по `length` (НЕ `//`); LIST endpoint `GET /v1/projects/{ref}/functions` отдаёт slug+verify_jwt (1 вызов, нормализован к массиву на случай `{functions:[...]}`). (Промежуточная попытка через per-function GET была лишней — корень был в `//`.)
- Non-blocking deno/typecheck давали красные ❌ на PR (job-level continue-on-error). Follow-up → step-level continue-on-error + `::warning` аннотация: джоб GREEN, долг виден аннотацией.
- Деплой-воркфлоу триггерится только на `push dev` с paths `functions/**`+`config.toml` → правки самих воркфлоу его НЕ запускают. Добавлен `workflow_dispatch` для ручного ре-деплоя/ре-проверки assert.

**Что сделано (PR #133):**
- `config.toml`: запиннен `telegramDisconnect verify_jwt=false` → теперь **13** pinned-false, сверено с live prod+dev (canon-10 + signupPrecheck + requestPasswordReset + telegramDisconnect). Первый config-driven деплой = no-op по auth.
- Удалён легаси `supabase/deploy_userid_functions.sh` (конфликтующий 2-й источник истины, его NO_JWT без 5 из canon-10).
- 3 воркфлоу:
  - `.github/workflows/checks.yml` — переиспользуемый гейт (`workflow_call`). BLOCKING job `frontend` = npm ci→lint→test→build на **Node 22**. NON-BLOCKING (`continue-on-error`) jobs `typecheck` и `deno` (есть baseline-долг).
  - `ci.yml` — PR-гейт `pull_request → dev/main`, зовёт checks.yml.
  - `supabase-deploy.yml` (Ф1) — `on push dev` (Этап 3 добавит `main`), paths-фильтр (`functions/**`+`config.toml`), concurrency на ветку, `deploy needs gate`, config-driven `supabase functions deploy --project-ref <ref>` (dev=nydhz…, prod=tizsc…), финальный шаг — **ассерт verify_jwt** через Management API `GET /v1/projects/{ref}/functions`: парсит pinned-false из config.toml, фейлит job при дрейфе false→true.
- Deno-чек в CI: `deno check --no-lock --node-modules-dir=none $(find supabase/functions -name '*.ts')` — `--node-modules-dir=none` обязателен, иначе корневой package.json толкает deno в node_modules-режим и npm:stripe не резолвится.

**Baseline-долг (почему deno+typecheck НЕ блокирующие, проверено в CI run #28187132660):**
- `deno check` = **14 ошибок** (getTripDetails ×10 PostgrestFilterBuilder/QueryBuilder mismatch; getActiveTrips/getFxRates/checkSubscriptionStatus ×3 TS2339 `error?.message`; getUserPlan ×1 `userData` null). Фикс трогает auth/Pro → отдельный follow-up, потом снять `continue-on-error`.
- `npm run typecheck` (tsc checkJs) **глубоко красный: ~1202 ошибки** по всему фронту (EventEditDialog/TripView/ScreenAccount/BudgetLens/…, +~89 в `luxon.mjs`) — чек **никогда не был зелёным**. Озеленение = большая отдельная инициатива (возможно пересмотр jsconfig).

**Грабли окружения (durable, нет в CLAUDE.md):**
- **`npm test` требует Node ≥21**: скрипт `node --test "src/**/*.test.js"` раскрывает glob только в test-runner Node 21+. На Node 20 → «Could not find …». На Node 22 тесты 65/65 зелёные. CI запинен на 22.
- **Ветки `dev` на remote НЕ было** (влита в main через PR #132 и удалена) — пересоздана агентом от main 2026-06-25 по согласованию с Pavel. Если снова исчезнет — пересоздавать от main. См. [[triplanio-deploy-topology]], [[triplanio-deploy-verify-jwt]], [[triplanio-migration-naming-drift]].
- Трио зомби-функций (telegramGetBotInfo/WebhookInfo/sendTripReminders) уже нет ни в репо, ни в рантайме (prod+dev) — config-driven deploy ничего не воскрешает при условии нарезки ветки от свежего main/dev (risk C).

**Не закрыто:** миграции (Ф3=TRIP-68, вручную); deno-гейт non-blocking (TRIP-94), tsc non-blocking (TRIP-93).

**Аудит 2026-06-25 (по запросу Pavel):** ядро (авто-деплой функций dev+prod) подтверждено на ЖИВОМ рантайме обоих проектов — все 45 функций задеплоены раннером GitHub Actions (entrypoint_path=/home/runner/...), 13 pinned-false=false 1:1 с config.toml на проде И dev, орфанов нет, CI-ассерт зелёный на прод-прогоне. **РЕШЕНИЕ Pavel:** «CI-гейт на PR» остаётся **advisory** (branch protection не энфорсится на free private GitHub) — деплой защищён `needs:gate`, мердж красного на доверии; это принято осознанно, НЕ недоделка, TRIP-73 закрывается так. Остаточные риски (приняты для MVP): deno-типчек non-blocking → сломанная по типам функция доедет до прода (TRIP-94); ассерт verify_jwt односторонний (ловит false→true, не true→false); docs-PR #140 на dev, до main доедет следующим dev→main; TRIP-50 (зонтик деплой-дрейфа) — функц. половина закрыта, остаток=миграции TRIP-68.
