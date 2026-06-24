---
name: triplanio-ecc-toolkit
description: "★DAILY/LIBRARY карта ECC-скиллов для Triplanio (target=claude) + как ставить; в Cowork плагин ecc уже загружен (ставить не нужно), физический install в репо — через /ecc:configure-ecc в Claude Code CLI, НЕ сырым node"
metadata: 
  node_type: memory
  type: reference
  originSessionId: fb7f2aeb-1bf3-4011-9d30-a4fe166597ac
---

ECC-плагин (`ecc:*`) подключён к проекту Triplanio. Это карта, какие скиллы хватать по умолчанию в работе по репо `triplanio_new` (см. [[triplanio-repo-location]]). Source: `ecc:project-init` + `ecc:agent-sort` прогон 2026-06-10 против `triplanio_new`.

**Стек репо (детект):** React 18 + Vite 6 + Tailwind 3 + Supabase (edge Deno + migrations) + Stripe + Mapbox + @tanstack/react-query; JS+jsconfig (tsc-чек), ESLint 9, тесты `node --test`. Target-харнес = `claude`. В репо уже есть `CLAUDE.md` (хороший, не перезатирать) и `.claude/settings.local.json` — только merge/append.

**DAILY (брать по умолчанию, бьётся с hard-rules и зонами риска):**
- `ecc:plan` + `ecc:gateguard` — hard-rule «анализ до кода»; gateguard блокирует Edit/Write до проверки зависимостей.
- `ecc:react-review` / `react-build` / `react-test` / `react-patterns` — весь фронт React+Vite.
- `ecc:security-review` + `ecc:security-scan` — Stripe webhook, IDOR на trip-read, fail-open auth, tier-gating (top-priority, см. [[triplanio-stripe-integration]], [[triplanio-gettripbyid-idor]], [[triplanio-pro-model]]).
- `ecc:customer-billing-ops` + `ecc:finance-billing-ops` — Stripe/подписки/reconciliation (см. [[triplanio-entitlement-reconciliation-todo]]).
- `ecc:postgres-patterns` + `ecc:database-migrations` — Supabase + дрейф имён миграций ([[triplanio-migration-naming-drift]]).
- `ecc:code-review` + `ecc:pr` + `ecc:git-workflow` — финал работы + git (hard-rule #5).
- `ecc:vite-patterns` — сборка/конфиг.

**LIBRARY (по требованию):** `deployment-patterns`, `canary-watch` (Vercel-верификация после пуша), `e2e-testing`/`browser-qa` (есть MCP chrome-devtools от ECC), `click-path-audit` (баги состояния таймлайна), `frontend-a11y`, `make-interfaces-feel-better`/`frontend-design-direction`/`motion-*` (дизайн), `performance-optimization`/`react-performance`, `agent-architecture-audit` (AI/Telegram/n8n), `error-handling`, `api-design`, `refactor-clean`, `test-coverage`, `update-docs`/`update-codemaps`, `documentation-lookup`, `continuous-learning-v2`+instincts, `cost-tracking`.

**SKIP (не стек/не домен):** все java/kotlin/swift/rust/go/cpp/php/.net/django/laravel/perl; логистика/healthcare/energy/manufacturing/customs; crypto/defi/trading/ito; homelab/network; blender; scientific-db.

**Как ставить / запускать:**
- В **Cowork** (desktop) — плагин уже загружен на SessionStart, все `ecc:*` скиллы и команды работают сразу. Физическая установка файлов в `.claude/` НЕ нужна.
- Сырые `node scripts/install-apply.js …` руками НЕ запускать — скрипты лежат внутри каталога плагина (в Cowork bash-песочница его не видит; путь относителен к репо ECC).
- Чтобы «вшить» лёгкий набор в репо для CLI/команды — открыть проект в **Claude Code CLI** (`claude` в корне репо) и набрать `/ecc:configure-ecc` (это слэш-команда ВНУТРИ Claude Code, не в zsh). Он сам резолвит пути, делает dry-run и спрашивает подтверждение.

**Битая ссылка:** репо `CLAUDE.md` указывает на `memory/triplanio-ecc-toolkit.md`, но файла в репо нет (папка `memory/` пустая). Авторитетная копия карты — здесь (моя память). Решить с Pavel: либо создать `memory/triplanio-ecc-toolkit.md` в репо (hard-rule #3 разрешает `memory/`), либо поправить строку в `CLAUDE.md`.

---

**★ОБНОВЛЕНО 2026-06-20 (Cowork-сессия): живые коннекторы + расширение карты под все типы задач.**

**Живые MCP-коннекторы (использовать вместо догадок/веба):**
- **Supabase MCP** — `list_tables/execute_sql/apply_migration/list_migrations/list_edge_functions/get_logs/get_advisors/deploy_edge_function`. ИСТОЧНИК ИСТИНЫ по БД/функциям prod (`tizscxrpuopobgcxbekf`) и dev (`nydhzevdizkfaxdlikgc`). Перед анализом схемы/RLS/edge — читать отсюда, не из памяти. `get_advisors` = security/perf линтер БД. ⚠️verify_jwt-trap: после batch-deploy перепроверять canon-10 через `list_edge_functions`.
- **Vercel MCP** — `list_deployments/get_deployment/get_deployment_build_logs/get_runtime_logs`. Верификация деплоя dev+main после пуша (ловить блок «автор≠владелец», [[triplanio-vercel-hobby-blocks-collaborator-commits]]).
- **Notion MCP** — `notion-search/fetch/create-pages/update-page`. База знаний (hard-rule #3): документировать фактическое состояние фич, держать иерархию.
- **Figma MCP** — `get_design_context/get_screenshot/get_variable_defs/get_metadata`. Дизайн-токены/макеты Lumo напрямую (дополняет HTML-макеты в «Triplanio design new»).
- **n8n MCP** — `search_workflows/get_workflow_details/execute_workflow/get_execution`. Боты/напоминания/parse-booking ([[triplanio-ai-booking-parse]], [[triplanio-telegram-multilink]]).
- **Sentry MCP** — `search_issues/search_events/analyze_issue_with_seer`. Рантайм-ошибки prod (если подключён) — для debug до гадания.
- **GitHub** — через `gh` CLI в bash (репо `avel123111/triplanio`, dev+main).
- Stripe-MCP НЕТ → оплату вести через `ecc:customer-billing-ops` + Supabase + Stripe dashboard вручную. Slack/Jira/ClickUp/Todoist/GCal/Gmail/Canva/Postman — вне контура Triplanio.

**Не-ECC скиллы в DAILY/частые:**
- `superpowers:brainstorming` — ПЕРЕД любой новой фичей (бьётся с hard-rule «анализ→план→аппрув→код»).
- `superpowers:systematic-debugging` + `superpowers:verification-before-completion` — root-cause до фикса; «готово» только с доказательством ([[feedback-design-for-scale-not-now]]).
- `agent-skills:doubt-driven-development` / `ecc:gateguard` — адверсариал-ревью на высокорисковых зонах (Stripe/RLS/tier-gating).
- `superpowers:writing-plans` — многошаговые эпики (TRIP-126 live-edit).
- `deep-research` — внешний ресёрч (Viator/Stay22/LocationIQ, цены, конкуренты).
- Хендоффы: `docx`/`xlsx`/`pptx`/`pdf` (anthropic) → отчёты/ТЗ в «Triplanio docs».
- Дизайн: `design:design-critique`/`design-handoff`/`design-system`/`accessibility-review` + `ecc:make-interfaces-feel-better`/`frontend-design-direction`/`motion-*` — редизайн Lumo.
- `web-quality-skills:*` — аудит публичных страниц (PublicTrip, landing, privacy/terms).

**Итог по «найти скиллы»:** ставить новое НЕ нужно — стек и все типы задач покрыты установленными плагинами + живыми MCP. Дефолт-цикл: brainstorming/plan → анализ через Supabase/Vercel/Figma/Notion MCP → react/security/postgres-ревью → verification → code-review/pr → документирование в Notion.
