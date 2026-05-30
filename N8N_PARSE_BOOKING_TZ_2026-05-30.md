# ТЗ: n8n workflow «parse-booking» (AI-распознавание брони) — финальная версия

Дата: 2026-05-30

## Архитектура

```
EventAiBlock (фронт)
  → грузит файлы в Supabase Storage (bucket `documents`, signed-URL)
  → supabase.functions.invoke('parseBookingWithAi', { kind, fileUrls })
    → edge fn parseBookingWithAi  (подписывает HS256-JWT, проксирует)   ← ГОТОВО
      → POST https://n8n-production-d1214.up.railway.app/webhook/parse-booking   ← ЭТО ТЗ
        → Gemini (Files API → generateContent)
      ← JSON по схеме
```

Фронт и edge-функция уже сделаны. Осталось собрать n8n-workflow.

**Решения:** промпты и схемы живут **внутри n8n** (правка промпта = правка ноды, не передеплой приложения). Поэтому на входе только `kind` + `fileUrls`, а Switch по `kind` выбирает нужный промпт/схему.

---

## Контракт

### Вход (что шлёт edge-функция)

`POST /webhook/parse-booking`, заголовок `Authorization: Bearer <HS256-JWT>` (подпись секретом `N8N_SECRET`, как у остальных вебхуков):

```json
{
  "kind": "hotel",        // 'hotel' | 'transfer'
  "fileUrls": [           // 1..3 Supabase signed-URL (PDF / картинки)
    "https://<proj>.supabase.co/storage/v1/object/sign/documents/ai-uploads/.../ticket.pdf?token=..."
  ],
  "text": ""              // опционально: вставленный юзером текст
}
```

### Выход (что вернуть приложению)

Можно отдавать **плоско** (данные прямо по схеме) **или в конверте** `{ kind, data, schema }` — фронт принимает оба варианта (распаковывает `data`, если он есть). Рекомендую конверт:

```json
{ "kind": "hotel", "data": { ...поля по схеме... }, "schema": { ... } }
```

Незаполненные поля — пустые/отсутствуют (или `null`). Поле `documents` приложение проставляет само (у него уже есть Supabase-ссылки), n8n его не возвращает.

---

## Узлы workflow

### 1. Webhook — вход
- Method `POST`, Path `parse-booking`
- Authentication: **JWT Auth** credential → Secret = `N8N_SECRET`, Algorithm `HS256`
- Response Mode: **Using 'Respond to Webhook' node**

### 2. Switch — по `kind`
- Выражение: `{{ $json.body.kind }}`
- Ветка `hotel` → узлы с HOTEL-промптом/схемой
- Ветка `transfer` → узлы с TRANSFER-промптом/схемой

### 3. (на каждую ветку) Подготовка файлов в Gemini Files API
Файлы Gemini по внешней ссылке не берёт — их надо залить в его Files API:
- `Split Out` по `fileUrls` → `HTTP Request` (GET, скачать как binary) → нода **Gemini Upload File** → вернёт `{ fileUri, mimeType }` на каждый файл → `Aggregate` собрать массив.

### 4. (на каждую ветку) Вызов Gemini — HTTP Request
- POST `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent`
  (модель — актуальная Flash из твоего AI Studio; `gemini-3.5-flash` — текущая на 2026-05)
- Query Auth: `key` = Gemini API key
- Body (JSON) — system-промпт ветки + user-промпт + по одному `file_data` на файл + responseSchema:

```json
{
  "systemInstruction": { "parts": [{ "text": "<SYSTEM PROMPT ветки>" }] },
  "contents": [{
    "role": "user",
    "parts": [
      { "text": "Extract the booking data from the attached file(s) and return it as JSON per the schema." },
      { "file_data": { "mime_type": "application/pdf", "file_uri": "{{ fileUri #1 }}" } },
      { "file_data": { "mime_type": "application/pdf", "file_uri": "{{ fileUri #2 }}" } }
    ]
  }],
  "generationConfig": {
    "responseMimeType": "application/json",
    "responseSchema": { "<схема ветки c UPPERCASE-типами>" }
  }
}
```

> Если юзер прислал `text` — добавь его в user-промпт отдельной строкой «Additional details pasted by the user: …».

### 5. Respond to Webhook — выход
- Respond With: **JSON**
- Response Body: `={{ { "kind": $('Webhook').item.json.body.kind, "data": JSON.parse($json.candidates[0].content.parts[0].text) } }}`
  (распаковываем текст Gemini в JSON; при желании добавь `schema`)

---

## System-промпты (держим в n8n)

Дата подставляется на момент запроса (сегодня 2026-05-30 → год 2026, прошлое → 2027).

### HOTEL
```
You are a precise booking-data extraction engine for a travel-planner app. You receive one or more files (PDF / image) that are a hotel / accommodation booking confirmation, plus optionally some user-pasted text. All files belong to the SAME single booking — merge any extra info you find across them.

Return a single JSON object matching the provided schema.

Rules:
- Return ONLY fields you can confidently read from the source. Leave unknown fields empty/absent — never invent values.
- Detect the booking platform from logos, headers, footers or URLs (booking, airbnb, hotels, expedia, agoda, trivago, vrbo, otherwise "other").
- Times in 24-hour HH:mm. Currency as ISO 4217 (EUR, USD, …). Dates as YYYY-MM-DD.
- Output ONLY the JSON — no markdown, no commentary.

DATE/YEAR RULES:
- Today is 2026-05-30 (current year 2026). Use this to resolve ambiguous dates.
- If a date has no year, assume 2026. If that makes it earlier than today, use 2027 — bookings are in the future.
- If a year IS explicitly written, honor it as-is.
```

### TRANSFER
```
You are a precise booking-data extraction engine for a travel-planner app. You receive one or more files (PDF / image) that are a transport booking — flight / train / bus / ferry ticket, boarding pass or e-ticket — plus optionally user-pasted text. All files belong to the SAME single booking — merge info across them.

Return a single JSON object matching the provided schema.

CRITICAL — MULTI-SEGMENT (layovers / connections):
A booking may contain MULTIPLE legs with intermediate stops. Return EACH physical leg as a SEPARATE item in "segments", in chronological order, each with its OWN from_address, to_address, departure and arrival date/time.
VERIFICATION: for every consecutive pair, segments[i+1].from_address MUST equal segments[i].to_address. If it doesn't, you misread — re-read it.
If the booking is direct / non-stop, return exactly ONE segment.

Common fields (booking_url, booking_platform) go at the top level. carrier may differ per leg (codeshare) → fill carrier per segment. If only a grand total price is shown, put it on the FIRST segment only.

Rules:
- Return ONLY fields you can confidently read. Leave unknown fields empty — never invent.
- Detect the platform from logos / headers / footers / URLs.
- Times in 24-hour HH:mm. Currency as ISO 4217. Dates as YYYY-MM-DD. For airports/stations include the IATA/station code + city, e.g. "Madrid (MAD) Terminal 1".
- Output ONLY the JSON — no markdown, no commentary.

DATE/YEAR RULES:
- Today is 2026-05-30 (current year 2026). Missing year → assume 2026; if past, use 2027. Explicit year → honor it.
```

---

## Схемы (responseSchema — типы в UPPERCASE для Gemini)

### HOTEL
```json
{
  "type": "OBJECT",
  "properties": {
    "name": { "type": "STRING" },
    "address": { "type": "STRING" },
    "check_in_date": { "type": "STRING" },
    "check_in_time": { "type": "STRING" },
    "check_out_date": { "type": "STRING" },
    "check_out_time": { "type": "STRING" },
    "booking_reference": { "type": "STRING" },
    "payment_status": { "type": "STRING", "enum": ["paid", "partial", "pay_on_arrival"] },
    "price": { "type": "NUMBER" },
    "currency": { "type": "STRING" },
    "free_cancellation": { "type": "BOOLEAN" },
    "free_cancellation_until": { "type": "STRING" },
    "phone": { "type": "STRING" },
    "email": { "type": "STRING" },
    "booking_url": { "type": "STRING" },
    "booking_platform": { "type": "STRING", "enum": ["booking","airbnb","hotels","expedia","agoda","trivago","vrbo","other"] }
  }
}
```

### TRANSFER
```json
{
  "type": "OBJECT",
  "properties": {
    "booking_url": { "type": "STRING" },
    "booking_platform": { "type": "STRING" },
    "segments": {
      "type": "ARRAY",
      "items": {
        "type": "OBJECT",
        "properties": {
          "transport_type": { "type": "STRING", "enum": ["plane","train","bus","car","taxi","ferry","other"] },
          "departure_date": { "type": "STRING" },
          "departure_time": { "type": "STRING" },
          "arrival_date": { "type": "STRING" },
          "arrival_time": { "type": "STRING" },
          "carrier": { "type": "STRING" },
          "booking_reference": { "type": "STRING" },
          "from_address": { "type": "STRING" },
          "to_address": { "type": "STRING" },
          "price": { "type": "NUMBER" },
          "currency": { "type": "STRING" }
        }
      }
    }
  }
}
```

> Наружу (в поле `schema` ответа, если отдаёшь конверт) можно вернуть те же схемы в обычном нижнем регистре — это косметика для фронта.

---

## Что подготовить в n8n
1. **JWT Auth credential** — Secret = `N8N_SECRET`, HS256 (для Webhook).
2. **Gemini API key** — Query Auth credential (`key`).
3. Проверить актуальное имя Flash-модели.

## Проверка (curl)
```bash
curl -X POST https://n8n-production-d1214.up.railway.app/webhook/parse-booking \
  -H "Authorization: Bearer <JWT, подписан N8N_SECRET, HS256>" \
  -H "Content-Type: application/json" \
  -d '{ "kind": "hotel", "fileUrls": ["<signed-url-на-pdf>"], "text": "" }'
```
Ожидаемо вернётся `{ kind, data, schema }` с заполненными полями.

---

## Сделано на нашей стороне (для справки)
- `supabase/functions/parseBookingWithAi/index.ts` — edge fn: валидация юзера → `signN8nJwt(N8N_SECRET)` → POST на webhook → проксирует ответ. **Нужно задеплоить:** `supabase functions deploy parseBookingWithAi`.
- `src/components/common/EventAiBlock.jsx` — грузит файлы в Storage (`documents/ai-uploads/...`), зовёт `parseBookingWithAi` с `{ kind, fileUrls }`, мапит ответ в форму; распознанные поля подсвечиваются (`aiFields`).
