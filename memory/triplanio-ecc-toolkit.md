# Triplanio — ECC toolkit (DAILY / LIBRARY map)

Какие `ecc:*` скиллы брать по умолчанию в работе по этому репозиторию (`triplanio_new`).
Источник: прогон `ecc:project-init` + `ecc:agent-sort` против репо, 2026-06-10. Target-харнес = `claude`.

## Стек (детект)
React 18 + Vite 6 + Tailwind 3 + Supabase (edge Deno-функции + migrations) + Stripe + Mapbox + @tanstack/react-query.
JS + jsconfig (типчек `tsc -p ./jsconfig.json`), ESLint 9, тесты `node --test`.

## DAILY — брать по умолчанию
Совпадает с hard-rules и зонами наивысшего риска.

- `ecc:plan` + `ecc:gateguard` — «анализ до кода» (hard-rule #1); gateguard блокирует Edit/Write, пока не подтверждены зависимости.
- `ecc:react-review` / `ecc:react-build` / `ecc:react-test` / `ecc:react-patterns` — весь фронт на React + Vite.
- `ecc:security-review` + `ecc:security-scan` — Stripe webhook, IDOR на trip-read функциях, fail-open auth, Pro/Premium tier-gating. Top-priority по review.
- `ecc:customer-billing-ops` + `ecc:finance-billing-ops` — Stripe, подписки, reconciliation entitlement'ов.
- `ecc:postgres-patterns` + `ecc:database-migrations` — Supabase + дрейф имён миграций (repo `00NN_*` vs БД-таймстампы).
- `ecc:code-review` + `ecc:pr` + `ecc:git-workflow` — финал работы и git (hard-rule #5).
- `ecc:vite-patterns` — сборка / конфиг.

## LIBRARY — по требованию
`deployment-patterns`, `canary-watch` (Vercel-верификация после пуша), `e2e-testing` / `browser-qa` (есть MCP chrome-devtools от ECC), `click-path-audit` (баги состояния таймлайна), `frontend-a11y`, `make-interfaces-feel-better` / `frontend-design-direction` / `motion-*` (дизайн-работа), `performance-optimization` / `react-performance`, `agent-architecture-audit` (AI / Telegram / n8n флоу), `error-handling`, `api-design`, `refactor-clean`, `test-coverage`, `update-docs` / `update-codemaps`, `documentation-lookup`, `continuous-learning-v2` + instincts, `cost-tracking`.

## SKIP — не стек / не домен
Все java / kotlin / swift / rust / go / cpp / php / .net / django / laravel / perl;
логистика / healthcare / energy / manufacturing / customs; crypto / defi / trading / ito;
homelab / network; blender; scientific-db.

## Как ставить / запускать
- **Cowork (desktop):** плагин загружается на SessionStart, все `ecc:*` скиллы и команды доступны сразу. Физическая установка файлов в `.claude/` не требуется.
- **НЕ запускать руками** `node scripts/install-apply.js …` — скрипты лежат внутри каталога плагина (в Cowork sandbox его не видит; путь относителен к репо ECC).
- **Вшить лёгкий набор в репо для CLI:** открыть проект в Claude Code CLI (`claude` в корне репо) и набрать `/ecc:configure-ecc` — это слэш-команда ВНУТРИ Claude Code (не в zsh). Сам резолвит пути, делает dry-run, спрашивает подтверждение.
