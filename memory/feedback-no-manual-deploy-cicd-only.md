---
name: feedback-no-manual-deploy-cicd-only
description: "Агент НИКОГДА не деплоит бэкенд сам и не предлагает ручной деплой — всё через CI/CD (merge→GitHub Actions); финальная цель достигнута для функций И миграций"
metadata:
  type: feedback
---

Агент **НИКОГДА не деплоит бэкенд (edge-функции и миграции) самостоятельно** (ни MCP `apply_migration`/`deploy_edge_function`, ни CLI, ни Management API в dev/prod) **и НЕ предлагает Pavel'у «выполнить команду руками»**. Любой деплой идёт ТОЛЬКО через CI/CD: закоммить → PR → мердж в `dev` (затем `dev`→`main`) → GitHub Actions катит сам.

**Why:** Прямое указание Pavel (2026-06-25). Финальная цель — деплой миграций так же, как функций, через единый CI/CD; ручные накаты порождают дрейф (репо↔рантайм) и раздражают. На 2026-06-25 цель достигнута: и функции (TRIP-73), и миграции (TRIP-68 Ф3) деплоятся одним воркфлоу `supabase-deploy.yml` (job `deploy` + job `migrate`).

**How to apply:** изменение бэкенда = только правка файлов в репо + PR. Новые миграции — `supabase migration new <name>` (таймстамп-имя), НЕ `00NN`. Не вызывай деплой-инструменты на dev/prod и не выдавай «ручных» команд наката. Ручной деплой — аварийный фолбэк, его делает ТОЛЬКО человек (Pavel), не агент. Разовый bootstrap-reconcile (TRIP-68: baseline+reset журнала через Management API, т.к. MCP read-only) был осознанным исключением и завершён — это не прецедент для рутины.

Связано: [[triplanio-deploy-topology]], [[triplanio-cicd-github-actions]], [[triplanio-migration-naming-drift]].
