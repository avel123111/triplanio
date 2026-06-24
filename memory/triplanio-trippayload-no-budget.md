---
name: triplanio-trippayload-no-budget
description: getTripById/getTripByTelegramChatId больше не возвращают бюджет; задеплоено prod+dev; промпты ботов/n8n с budget* надо обновить
metadata: 
  node_type: memory
  type: project
  originSessionId: 43eea36c-8fa5-48db-ad9f-2a03f1f0002c
---

2026-05-31: из server-to-server читателей трипов (`getTripById`, `getTripByTelegramChatId`, общий `_shared/tripPayload.ts` → buildTripData/fetchTripPayload) **убран бюджет**. Payload теперь = trip, cityVisits, hotels, activities, transfers, services, members. Поля `budget`/`budgetCategories`/`budgetExpenses` НЕ возвращаются (finances не уходят в бот/n8n).

Задеплоено в **оба** Supabase-проекта (prod tizscxrpuopobgcxbekf, dev nydhzevdizkfaxdlikgc) как self-contained build с verify_jwt=false (см. [[triplanio-deploy-verify-jwt]]). Репо-исходник модульный; деплой-артефакт инлайнит хелперы — это их штатная конвенция (в коде деплоя есть пометка про это).

**Решение Pavel:** в исходном ТЗ просил «в documents отдавать только shared», но при уточнении выбрал «только убрать бюджет, documents НЕ добавлять» (в payload их и не было). Если это был промах — добавить shared-документы отдельно.

⚠️ **Незакрытая зависимость:** системные промпты ботов в Notion (TG Chat Bot [SOURCE OF TRUTH], InApp Group Chat [SOURCE OF TRUTH], TG Chatbot Instructions v2) и n8n-ноды ссылаются на budget* — этих полей больше нет, иначе бот галлюцинирует по бюджету. Обновить промпты/n8n. Док API & Integrations Reference (B.7) уже обновлён. См. [[triplanio-telegram-bot]] [[triplanio-stripe-integration]].
