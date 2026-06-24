---
name: triplanio-n8n-jwt-auth
description: "Triplanio: исходящие вызовы в n8n-вебхуки требуют HS256-JWT, подписанного N8N_SECRET, а не сырой секрет"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f7c78fad-9a6a-4086-a48c-fec8a2128a6b
---

# Triplanio: n8n-вебхуки требуют HS256-JWT (не сырой секрет)

Исходящие вызовы из edge-функций в n8n-вебхуки (railway: `/webhook/group-chat`, `/webhook/ai-trip-planner`) должны слать `Authorization: Bearer <HS256-JWT>`, где JWT подписан секретом `N8N_SECRET`. Сырой `Bearer ${N8N_SECRET}` → n8n отвечает `403 jwt malformed`.

**Why:** n8n-вебхуки защищены "JWT Auth" (проверяют подпись секретом). Баг всплыл после миграции email→user_id: передеплой функций из репо перезатёр ранее работавшую (но не закоммиченную) версию, которая подписывала JWT. Теперь подпись **в репо**: `supabase/functions/_shared/n8nAuth.ts` → `signN8nJwt(secret)` (HS256, claims iat/exp 5 мин, Web Crypto, без внешних зависимостей).

**How to apply:** любая функция, которая ДЕЛАЕТ исходящий запрос в n8n, должна слать `Bearer ${await signN8nJwt(n8nSecret)}`, а не сам секрет. Сейчас так в `callTriplanioAi` и `planTripWithAi`. Входящие функции (n8n → нас: `triplanioAiReply`, `getPendingReminders`, `getDailyReminders`) наоборот сравнивают входящий bearer с `N8N_SECRET` — их не трогаем. При добавлении новой функции с вызовом n8n — использовать `signN8nJwt`.

См. [[triplanio-userid-migration]].
