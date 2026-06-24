---
name: triplanio-ai-usage-logging
description: "Учёт стоимости AI-флоу — таблицы ai_model_prices/ai_usage_events, БД-триггер, воркфлоу-поллер AI Usage Logger, прайс-бук, что осталось"
metadata: 
  node_type: memory
  type: project
  originSessionId: 03be011e-b890-444c-ba29-8cb4db8e5df5
---

Система учёта запусков AI-флоу и стоимости (Gemini-токены, Mistral-страницы). Создано 2026-06-05.

**БД (обе среды: prod tizscxrpuopobgcxbekf + dev nydhzevdizkfaxdlikgc):**
- `ai_model_prices` — версионированный прайс-бук (provider, model, unit, unit_price_usd, effective_from/to). Цена за 1 единицу.
- `ai_usage_events` — лог, ОДНА строка на один вызов модели (не на запуск); группировка по execution_id. Дедуп: unique (execution_id, node_name, run_index).
- Триггер `compute_ai_usage_cost`/`trg_ai_usage_cost` — снапшотит cost_usd + cost_breakdown по цене на occurred_at; нормализует `models/`→bare; флаг pricing_complete.
- Вьюхи: ai_cost_by_day/week/process/user/trip/run.
- Миграции в репо: `0022_ai_usage_logging.sql`, `0023_ai_usage_events_dedup_key.sql` (применены напрямую через MCP в оба проекта; в git добавлены, нужно закоммитить в dev+main).
- RLS включён без публичных политик → запись только service_role.

**Прайс-бук (подтверждено Pavel):** mistral-ocr-latest page $0.002 ($2/1k); gemini-3.1-flash-lite in $0.25/out $1.50 за 1M; gemini-3-flash-preview in $0.50/out $3.00 за 1M.

**Модели по флоу (факт из логов):** Parser+Planner запинены на gemini-3.1-flash-lite; Reminders/TG Chat Bot/InApp — модель НЕ задана в ноде → дефолт **gemini-3-flash-preview** (preview, рекомендовано запинить). Parser ещё использует Mistral OCR (нода Extract text), а старые Gemini Upload/Analyze отключены.

**Механизм записи = поллер, НЕ ноды в каждом флоу.** Воркфлоу n8n `AI Usage Logger` (id BAHdKa77RpeB5D3O): каждые 15 мин читает n8n executions API → парсит runData (Gemini tokenUsage из саб-ноды модели + Mistral usage_info.pages_processed) → POST в Supabase с on_conflict ignore. Девиация от выбора Pavel «ноды в каждом флоу» оправдана: (1) Parser/Planner responseMode=lastNode — доп. ноды сломали бы ответ; (2) tokenUsage в саб-ноде недоступен из основного потока, агенты делают мульти-вызовы + autofix. Поллер пишет в PROD Supabase (все 5 флоу ходят в prod).

**Осталось Pavel:** поставить 2 креда в n8n (Header Auth X-N8N-API-KEY; Custom Auth Supabase с apikey+Authorization=service_role), активировать поллер, протестировать (особенно что n8n public API отдаёт runData в той же форме). Доводка атрибуции: пробросить user_id/trip_id в payload parseBookingWithAi/planTripWithAi; резолв chat_id→trip/user для TG-бота (там сейчас заглушки user_id=123/trip_id=132). Запинить модель в 3 чат-флоу.

Док в Notion: «AI Usage Logging & Cost Accounting» (3762c9f1-427e-811b-9cde-f1a5210bba7b) под [[triplanio-status]] AI Features. Связано: [[triplanio-ai-booking-parse]], [[triplanio-telegram-bot]], [[triplanio-deploy-topology]].
