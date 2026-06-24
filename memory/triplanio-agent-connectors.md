---
name: triplanio-agent-connectors
description: "Коннекторы агента к внешним сервисам в Cyrus-сессии — Supabase через MCP, Vercel через CLI, Linear через MCP; как авторизуются и какие грабли (без значений секретов)"
metadata:
  node_type: memory
  type: reference
  originSessionId: TRIP-11
---

Чем агент (Cyrus = Claude Code в git-воркгри) реально дотягивается до внешних сервисов в сессии (выяснено 2026-06-24, TRIP-11). Значения токенов/ключей агенту НЕ видны и сюда НЕ пишутся — только канал и грабли.

- **Supabase — MCP-сервер** (`mcp__supabase__*`). Полный доступ: `list_projects`, `execute_sql`, `apply_migration`, `deploy_edge_function` + `list/get_edge_function`, `get_logs`, `get_advisors`, ветки, `generate_typescript_types`. Авторизация предсконфигурирована на стороне Cyrus (токен агенту не виден). Проекты и топология деплоя — см. [[triplanio-deploy-topology]] (prod `tizscxrpuopobgcxbekf`, dev `nydhzevdizkfaxdlikgc`, оба ACTIVE_HEALTHY, Postgres 17, org `ewufsvuiisddsiduyjwv`). Грабли: verify_jwt-капкан при batch-деплое — см. [[triplanio-deploy-verify-jwt]]; функции и миграции катятся ВРУЧНУЮ, CI нет.

- **Vercel — НЕ MCP, а CLI.** `/usr/local/bin/vercel` (v54.16.0), уже залогинен: `vercel whoami` → `avel123111`, scope/team `avel123111-5277s-projects`, проект `triplanio_app`. Доступно: `vercel ls / inspect / logs / env ls / deploy / rollback`. Токен лежит в окружении, агенту значение не видно; отдельного Vercel-MCP в сессии НЕТ. Обычно ручной CLI-деплой не нужен — фронт (Vite) Vercel катит автоматически на push в ветку (см. [[triplanio-deploy-topology]]); CLI полезен для инспекции деплоев/логов/env.

- **Linear — MCP-сервер** (`mcp__linear__*`). Создание/правка задач (`save_issue`), комментарии, проекты, лейблы, статусы. Команда воркспейса — «Pavel» (UUID `6035454e-b654-4639-890c-eb0e26588f37`), префикс задач **TRIP**. При создании задачи `team` требует UUID, не имя.

- **Sentry — MCP-сервер** (`mcp__sentry__*`), подключён TRIP-20 (2026-06-24). Объявлен файлом **`.mcp.json` в корне репо** (`npx @sentry/mcp-server@latest --host=de.sentry.io`, токен из env `SENTRY_ACCESS_TOKEN`); секрет лежит в Railway (self-hosted runtime Cyrus), allow-list `mcp__sentry` включён в Cyrus webapp `/settings/tools` (вкладка Linear). Орга `triplanio` на **EU-регионе** (`de.sentry.io`) — `--host` обязателен, иначе сервер уходит на US и оргу не видит. Read-набор: `find_organizations/projects/teams`, `search_issues`, `search_events`, `get_sentry_resource`, `analyze_issue_with_seer` (Seer-разбор), + write `update_issue` (резолв/назначение). Авторизация = User Auth Token Pavel (read-скоупы), агенту значение не видно. Подробности самого мониторинга Sentry (фронт/edge/DSN) — [[triplanio-sentry-monitoring]]. OAuth-ремоут `mcp.sentry.dev` для облачного Cyrus НЕ поддерживается → только токен. Каталог `~/.cyrus/` (runtime-конфиг хоста) для агента закрыт наглухо — коннекторы добавляются через repo `.mcp.json` или дашборд `/integrations`, не правкой `~/.cyrus/mcp.json`.

- **n8n — MCP-сервер** (`mcp__n8n__*`), подключён TRIP-20 (2026-06-24, self-hosted инстанс Pavel). Объявлен в корневом **`.mcp.json`** (`npx -y n8n-mcp` — community-сервер czlonkowski, stdio-режим: `MCP_MODE=stdio`, `LOG_LEVEL=error`, `DISABLE_CONSOLE_OUTPUT=true`). Объём — **полное управление**: и база, и ключ через env-плейсхолдеры `N8N_API_URL` + `N8N_API_KEY` (URL НЕ в репо по решению Pavel). С API-ключом сервер даёт управление воркфлоу (list/get/create/update/execute) + справку/валидацию нод; без ключа — только справка. Чтобы заработало, нужно (вне репо, делает Pavel): (1) задать `N8N_API_URL`+`N8N_API_KEY` в Railway (runtime Cyrus), (2) включить `mcp__n8n` в allow-list Cyrus webapp `/settings/tools`, (3) рестарт сессии + смоук. PR #118 → dev (затем main). Значения секретов агенту не видны. Это исходящий канал АГЕНТА к n8n; рантайм-авторизация самих вызовов приложения в n8n (HS256-JWT) — отдельно, см. [[triplanio-n8n-jwt-auth]].

- **Прочие MCP в сессии:** `cyrus-docs` (дока Cyrus — поиск/чтение), `cyrus-tools` (служебные: self-report фейлов, агент-сессии Linear).

Память агента грузится так: корневой `CLAUDE.md` авто-инлайнит `@memory/MEMORY.md` (индекс) в каждую сессию → этот файл агент открывает по указателю из индекса. Подробнее о механизме — блок «Memory» в `CLAUDE.md`.
