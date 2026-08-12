# Triplanio: MCP-серверы «по требованию» (сняты из горячего контекста)

Некоторые MCP-серверы **намеренно убраны из `.mcp.json`**, потому что их
инструкции лились в КАЖДОЕ сообщение (тяжёлый фиксированный контекст), а
нужны они редко. Они НЕ удалены как возможность — их видно здесь и любой
включается обратно копипастом блока в `.mcp.json` → `mcpServers`.

Всегда включённые (репо-уровень, `.mcp.json`): `sentry`, `tolgee`,
`posthog`, `playwright`.
Платформенные (Cyrus/Railway, не в репо): github, Supabase, Linear, Notion,
Vercel, Claude_Code_Remote.

## n8n — воркфлоу-автоматизация (снят 2026-08-11, TRIP-панель памяти)

Инструменты `mcp__n8n__*` (SDK воркфлоу, поиск нод, executions). Самый
тяжёлый по инструкциям сервер, трогаем воркфлоу нечасто → вынесен.
Нужен для работы с n8n — верни блок в `.mcp.json`:

```json
    "n8n": {
      "command": "npx",
      "args": ["-y", "n8n-mcp"],
      "env": {
        "MCP_MODE": "stdio",
        "LOG_LEVEL": "error",
        "DISABLE_CONSOLE_OUTPUT": "true",
        "N8N_API_URL": "${N8N_API_URL}",
        "N8N_API_KEY": "${N8N_API_KEY}"
      }
    },
```

После правки `.mcp.json` сервер поднимется в следующей сессии; секреты
`N8N_API_URL`/`N8N_API_KEY` уже в окружении Cyrus.
