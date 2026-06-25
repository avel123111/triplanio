---
name: triplanio-deploy-topology
description: "Что и как деплоится в Triplanio — фронт Vercel (авто), edge-функции И миграции АВТО через GitHub Actions (TRIP-73 + TRIP-68 Ф3); агент не деплоит сам"
metadata: 
  node_type: memory
  type: project
  originSessionId: b60c8bc6-7010-41d8-834f-63aa0499f7c4
---

Топология деплоя (обновлено 2026-06-25, TRIP-68 Ф3):

- **Агент НЕ деплоит сам и не предлагает ручной деплой** — всё через CI/CD (merge→GitHub Actions). См. [[feedback-no-manual-deploy-cicd-only]].
- **Фронт (Vite-приложение)** — Vercel собирает и катит автоматически на пуш в ветку (dev/main).
- **Supabase edge-функции — АВТО через GitHub Actions** (TRIP-73, с 2026-06-25). Мердж в `dev` → деплой всех функций в Supabase **dev** (`nydhzevdizkfaxdlikgc`); мердж в `main` → в **prod** (`tizscxrpuopobgcxbekf`). `verify_jwt` только из `config.toml` + ассерт через Management API. Подробности: [[triplanio-cicd-github-actions]].
- **Supabase миграции — АВТО через GitHub Actions** (TRIP-68 Ф3, с 2026-06-25, после reconcile истории). Тот же воркфлоу `.github/workflows/supabase-deploy.yml`, job `migrate`: merge→`dev` → `supabase db push` в dev; merge→`main` → в prod; триггер по `supabase/migrations/**`; `detect`-job разводит functions-only vs migrations-only, чтобы не было лишних передеплоев. История = единый baseline `20260625120000_baseline.sql`; репо↔dev↔prod журналы идентичны. **Новые миграции ТОЛЬКО `supabase migration new` (таймстамп); `00NN` запрещены.** Требует секреты `SUPABASE_DB_URL_DEV`/`_PROD`. См. [[triplanio-migration-naming-drift]].
- **Ручной деплой = аварийный фолбэк, только Pavel** (не агент): хотфикс без мерджа. После — `workflow_dispatch`, чтобы runtime == git. ⚠️ Ручной MCP/CLI-деплой функции сбрасывает `verify_jwt=true` — для pinned-false передавать `false` явно.

Связано: [[triplanio-deploy-verify-jwt]], [[triplanio-cicd-github-actions]], [[triplanio-migration-naming-drift]], [[feedback-no-manual-deploy-cicd-only]].
