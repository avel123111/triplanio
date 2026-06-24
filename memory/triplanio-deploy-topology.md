---
name: triplanio-deploy-topology
description: "Что и как деплоится в Triplanio — фронт через Vercel (авто), Supabase-функции/миграции вручную, CI автодеплоя функций НЕТ"
metadata: 
  node_type: memory
  type: project
  originSessionId: b60c8bc6-7010-41d8-834f-63aa0499f7c4
---

Топология деплоя нового приложения (выяснено 2026-06-01):

- **Фронт (Vite-приложение)** — Vercel собирает и катит автоматически на пуш в ветку (dev/main). Это единственное, что уезжает само по пушу в git.
- **Supabase edge-функции и миграции** — деплоятся ТОЛЬКО вручную (`supabase functions deploy` / CLI / MCP). Пуш в main их НЕ трогает.
- **CI автодеплоя функций нет** — папки `.github/workflows` в репо нет.

Следствие: «задеплоить всё на main» = фронт уедет автоматически, а функции/миграции надо катить руками отдельно на оба Supabase-проекта (prod `tizscxrpuopobgcxbekf` = «Triplanio», dev `nydhzevdizkfaxdlikgc` = «Triplanio dev»).

Риск дрейфа: функцию можно задеплоить из локали, не закоммитив в git → GitHub (source of truth) отстаёт от рантайма, и будущий передеплой из git-чекаута молча откатывает живую версию. Пример: `telegramWebhook` (локализация ru/en/es) был задеплоен на dev v8 + prod v11, но месяцами висел незакоммиченным. Перед ручным `functions deploy` всегда сверять git == рантайм.

Связано: [[triplanio-deploy-verify-jwt]] (грабли verify_jwt при деплое webhook-функций), [[triplanio-i18n-no-hardcode]] (бот шлёт message из edge-функции).
