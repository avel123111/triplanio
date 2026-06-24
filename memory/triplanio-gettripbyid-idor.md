---
name: triplanio-gettripbyid-idor
description: IDOR/broken-access-control в getTripById и getTripByTelegramChatId — verify_jwt=false + ноль внутренней проверки
metadata: 
  node_type: memory
  type: project
  originSessionId: 61af1256-8c8f-4a3b-9346-aa5d8fd30528
---

🔴 ПОДТВЕРЖДЕНО (2026-05-30) на коде + рантайме. Edge-функции `getTripById` и `getTripByTelegramChatId` (prod project tizscxrpuopobgcxbekf):
- Развёрнуты с `verify_jwt=false` (подтверждено через Supabase list_edge_functions).
- В теле функции НЕТ никакой проверки авторизации (ни Bearer N8N_SECRET, ни user-JWT). Читают `id`/`telegram_chat_id` из body и через service_role (в обход RLS) отдают ВЕСЬ payload: trip (включая `share_token` и `created_by` — `select('*')`!), members, budget, expenses, activities и т.д.
- Любой, кто знает trip UUID, читает весь трип. Хуже [[triplanio-gettripdetails-verifyjwt]]: getTripDetails теперь fail-closed (verify_jwt=true). Хуже getPublicTrip: тот требует tripId+share_token (122-битный токен) и вырезает created_by/share_token из ответа. getTripById не требует токена И сам отдаёт share_token → утечка ещё и разблокирует getPublicTrip.

Нюанс severity: UUIDv4 (122 бита) не брутфорсится. Реальный вектор — утечка известного trip id (URL /trips/:id, история браузера, логи, Referer), а не перебор.

ФИКС (согласован паттерн): оставить `verify_jwt=false` (n8n/Telegram-бот зовёт без user-токена, flip на true сломает их) и добавить ВНУТРИ функции проверку `Bearer === N8N_SECRET`, как в getPendingReminders/getDailyReminders. Фронтенд эти функции НЕ зовёт (проверено grep) → правка безопасна для SPA. НЕ путать с [[triplanio-n8n-jwt-auth]] (тот про ИСХОДЯЩИЕ вызовы Supabase→n8n, HS256 JWT; здесь входящий — сырой секрет).
Статус (2026-05-30): ЗАДЕПЛОЕНО в ОБА проекта через Supabase MCP. prod tizscxrpuopobgcxbekf: getTripById v5, getTripByTelegramChatId v5. dev nydhzevdizkfaxdlikgc: обе v4. verify_jwt=false везде, гейт requireN8nSecret активен. Pavel подтвердил, что n8n-ноды уже шлют `Authorization: Bearer <N8N_SECRET>` (свой секрет на проект). Деплой-артефакт — SELF-CONTAINED single index.ts (helpers заинлайнены), т.к. деплоил через MCP; в РЕПО версия МОДУЛЬНАЯ (импортит _shared). Поведение идентично; следующий `supabase functions deploy` из репо перезальёт модульной версией — ОК.
⚠️ РЕПО-КОММИТ НЕ СДЕЛАН: песочница не может писать в .git примонтированного репо (Operation not permitted на lock-файлах) + остались stale-локи. Pavel коммитит сам (origin/main == origin/dev). Файлы в рабочем дереве: _shared/n8nAuth.ts (+requireN8nSecret), _shared/tripPayload.ts (новый), getTripById/index.ts, getTripByTelegramChatId/index.ts.
Док обновления: docs/API_INTEGRATIONS.md §B.7 / V-API-1 и §3 таблицу надо перевести из «no auth ⚠️» в «Bearer N8N_SECRET» (НЕ сделано).
Добавлен общий `requireN8nSecret(req)` в `_shared/n8nAuth.ts`; дублирующийся `fetchTripPayload` вынесен в `_shared/tripPayload.ts`.
Опц. оптимизация (не сделано): getPendingReminders/getDailyReminders дублируют ту же проверку инлайн — можно перевести на requireN8nSecret.
