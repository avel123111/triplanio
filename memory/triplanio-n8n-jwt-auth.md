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

**How to apply:** любая функция, которая ДЕЛАЕТ исходящий запрос в n8n, должна слать `Bearer ${await signN8nJwt(n8nSecret)}`, а не сам секрет. Сейчас так в `callTriplanioAi` и `planTripWithAi`. Входящие функции (n8n → нас: `triplanioAiReply`, `getPendingReminders`) наоборот сравнивают входящий bearer с `N8N_SECRET` — их не трогаем. При добавлении новой функции с вызовом n8n — использовать `signN8nJwt`.

См. [[triplanio-userid-migration]].

## База → n8n: Database Webhooks, а не Postgres Trigger (07.09.2026)

Событийные входы из прода в n8n — **Supabase Database Webhooks** (дашборд
Integrations → Database Webhooks; в базе это триггеры `supabase_functions.http_request`
через `pg_net`, в миграциях их НЕТ): `support_tickets` INSERT →
`/webhook/new_ticket` (TG Admin), `users` INSERT → `/webhook/new_user`
(Communications: welcome + TG «New registration»). Заголовок `Authorization`
— статический HS256-JWT под тот же JWT-секрет n8n (пустой payload, без `exp`),
лежит в аргументах триггера. Тело в n8n: `$json.body.record.*`
(`{type,table,schema,record,old_record}`). Повторить событие руками —
`net.http_post` с тем же URL/заголовком из `pg_trigger.tgargs`; ответы
n8n видны в `net._http_response`.

**Почему не Postgres Trigger n8n:** нода держит ДВА соединения Supavisor
в session-режиме (`LISTEN` + pool под DDL), при каждом сохранении /
переактивации воркфлоу заводит новый pool и старый не закрывает никогда, при
сбое реконнекта утекает по одному на попытку (6 за 33 с). Пул session-режима
на проде = 15, три ноды забивали его за два дня → `max clients reached`,
падал в том числе «AI Usage save» (`ai_usage_events` молчала 20 часов) и
терялись тикеты. Мёртвый бэкенд узнаётся по `idle` дольше часа у соединения с
`DROP TRIGGER` в `query` (здоровый pg-pool закрывает клиента через 10 с) или
по `LISTEN` на канал, триггера которого в `pg_trigger` нет; живые
`LISTEN` с существующим триггером не трогать. На проде n8n-триггеров больше
нет; `pg_stat_activity` по `application_name='Supavisor'` — норма 0–2.
