---
name: triplanio-ai-booking-parse
description: "Triplanio: AI-распознавание брони (hotel/transfer) в event-диалоге переведено с base44 InvokeLLM на свой n8n-pipeline"
metadata: 
  node_type: memory
  type: project
  originSessionId: 358b9e96-d771-480c-8209-c3a00b800ea1
---

# Triplanio: AI-распознавание брони → n8n (вместо base44)

Распознавание файлов брони в event-edit диалоге (`EventAiBlock.jsx`, отель/трансфер) уходит с base44 cloud (`base44.integrations.Core.InvokeLLM` + `UploadFile`) на собственный pipeline.

**Целевой поток:** EventAiBlock грузит файлы в Supabase Storage (bucket `documents`, путь `ai-uploads/...`, signed-URL) → `supabase.functions.invoke('parseBookingWithAi', { kind, fileUrls })` → edge fn подписывает HS256-JWT (`signN8nJwt`, см. [[triplanio-n8n-jwt-auth]]) → POST `https://n8n-production-d1214.up.railway.app/webhook/parse-booking` → Gemini (Files API → generateContent, модель класса `gemini-3.5-flash`) → JSON по схеме.

**Ключевое решение:** промпты и JSON-схемы (hotel/transfer) держим **внутри n8n**, не на фронте — правка промпта не требует передеплоя приложения. Поэтому на входе только `kind`+`fileUrls`, Switch в n8n выбирает ветку. Gemini внешние URL не качает — файлы заливаются в его Files API. Output — `{ kind, data, schema }` либо плоско; фронт принимает оба.

**Why:** убрать зависимость от base44 при миграции; контроль над LLM и стоимостью.

**How to apply:** правки промптов/схем — в n8n-ноде, не в коде. Подсветка AI-полей на фронте уже работает через `aiFields` Set в `EventEditDialog` (`handleHotelExtract`/`handleTransferExtract` → `<AiField active>`), её трогать не нужно.

**Статус 2026-05-30:**
- Сделано: edge fn `supabase/functions/parseBookingWithAi/index.ts`; правка `EventAiBlock.jsx` (base44 убран); build проходит. ТЗ workflow — `N8N_PARSE_BOOKING_TZ_2026-05-30.md` в репо triplanio_new.
- Pavel: задеплоить `parseBookingWithAi`, собрать n8n-workflow `parse-booking` по ТЗ (JWT Auth = N8N_SECRET, Gemini credential, Files API).

**Workflow собран и оптимизирован (2026-05-30, id qPLks2mIKFA4xXlF «AI Trip Parser»):** Webhook /parse-booking → If(файлы?) → [файлы: Split Out → Upload(per file) → Aggregate uploads → ОДИН Analyze document → Aggregate] → If hotel → AI Agent Hotel/Transfer (Gemini 3.1-flash-lite + Structured Output Parser autoFix). Выход `{kind,data}` (клиент принимает). Внесённые правки: (1) дата через TODAY/$now в user-промпте — `{{today}}` в systemMessage не резолвился; (2) вебхук закрыт JWT Auth (был открыт); (3) промпты выровнены под схему {kind,data}; (4) один Analyze на все файлы вместо per-file; (5) модели запинены (были дефолт 2.5-flash); (6) maxOutputTokens 300→2048 (резало длинные брони); добавлен `flight_number` в transfer-сегмент (есть в таблице transfers). Документация: Notion «AI Features». Висит отдельно: IDOR `getTripById` ([[triplanio-gettripbyid-idor]]) — другого парсера не касается.
