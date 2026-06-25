---
name: triplanio-deploy-topology
description: "Что и как деплоится в Triplanio — фронт через Vercel (авто), edge-функции АВТО через GitHub Actions (TRIP-73, с 2026-06-25), миграции пока вручную"
metadata: 
  node_type: memory
  type: project
  originSessionId: b60c8bc6-7010-41d8-834f-63aa0499f7c4
---

Топология деплоя (обновлено 2026-06-25, TRIP-73):

- **Фронт (Vite-приложение)** — Vercel собирает и катит автоматически на пуш в ветку (dev/main).
- **Supabase edge-функции — АВТО через GitHub Actions** (TRIP-73, с 2026-06-25). Мердж в `dev` → деплой всех функций в Supabase **dev** (`nydhzevdizkfaxdlikgc`); мердж в `main` → в **prod** (`tizscxrpuopobgcxbekf`). Воркфлоу `.github/workflows/supabase-deploy.yml` на push в dev/main по paths `supabase/functions/**`+`supabase/config.toml` (+ ручной `workflow_dispatch`). Config-driven (`functions deploy --project-ref`, без слага; `verify_jwt` только из `config.toml`), финальный шаг — ассерт verify_jwt через Management API. **Нормальный способ выкатить функцию = мердж в dev→main, НЕ руками.** Подробности: [[triplanio-cicd-github-actions]].
- **Ручной деплой = фолбэк** (хотфикс без мерджа): MCP `deploy_edge_function` / CLI. После — перегнать через `workflow_dispatch`, чтобы рантайм == git. ⚠️ Ручной MCP/CLI-деплой сбрасывает `verify_jwt=true` — для pinned-false функций передавать `false` явно; CI делает это сам из config.toml.
- **Миграции — пока ВРУЧНУЮ, CI нет** (Ф3 / TRIP-68, заблокировано reconcile истории миграций). Катить через MCP `apply_migration` / CLI на ОБА проекта.

Риск дрейфа (исторический, до TRIP-73): функцию деплоили из локали без коммита → GitHub отставал от рантайма. Теперь для функций дрейф убит авто-деплоем (рантайм следует за git). Для миграций риск остаётся — катить аккуратно на оба проекта.

Связано: [[triplanio-deploy-verify-jwt]] (грабли verify_jwt при деплое webhook-функций), [[triplanio-i18n-no-hardcode]] (бот шлёт message из edge-функции).
