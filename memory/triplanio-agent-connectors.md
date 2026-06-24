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

- **Прочие MCP в сессии:** `cyrus-docs` (дока Cyrus — поиск/чтение), `cyrus-tools` (служебные: self-report фейлов, агент-сессии Linear).

Память агента грузится так: корневой `CLAUDE.md` авто-инлайнит `@memory/MEMORY.md` (индекс) в каждую сессию → этот файл агент открывает по указателю из индекса. Подробнее о механизме — блок «Memory» в `CLAUDE.md`.
