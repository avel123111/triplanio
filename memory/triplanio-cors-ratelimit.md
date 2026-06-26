---
name: triplanio-cors-ratelimit
description: CORS allow-list edge-функций (corsFor) + единый rate-limit примитив (rate_limit_hits) против перебора email — TRIP-67
metadata:
  node_type: memory
  type: project
---

★ **TRIP-67 (реализовано на ветке, PR в dev).** Два харднинга edge-функций.

**CORS allow-list.** Раньше все функции отдавали `Access-Control-Allow-Origin: '*'` (общий `_shared/cors.ts` + 9 инлайн-копий). Теперь единый источник — `_shared/cors.ts`, функция `corsFor(req)`: отражает `Origin` только если он в allow-list, иначе ACAO не отдаётся. Все ~45 функций переведены на shadow-паттерн: первая строка хендлера `const corsHeaders = corsFor(req);` (существующие `headers: corsHeaders` не трогались — минимальный диф). Сервер-серверные хелперы (`n8nAuth.ts`, `tripPayload.ts`) зовут `corsFor()` без аргумента (s2s Origin не шлют → CORS им безразличен; их гейт = Bearer/N8N_SECRET). Allow-list: `triplanio.com`, `www.triplanio.com`, `dev.triplanio.com`, превью `triplanioapp-*-avel123111-5277s-projects.vercel.app`, `localhost:5173/3000`. P3: не в паре с Allow-Credentials (auth=Bearer-хедер, не cookie) → защита-в-глубину от replay украденного токена, не жёсткий гейт. CAPTCHA **сознательно НЕ ставили** (видима юзеру) — резерв на GA.

**Rate-limit примитив.** Единая таблица `public.rate_limit_hits (bucket, key, created_at)` + RPC `rate_limit_check`/`rate_limit_record` (SECURITY DEFINER, только service_role, RLS без политик; миграция `20260626200000_auth_rate_limit.sql`). Хелпер `_shared/rateLimit.ts` (`ipRateLimited`/`underLimit`/`recordHit`, `clientIp` по `x-forwarded-for`, **fail-open** — лимитер не должен запирать живого юзера). Корзины: `signup_precheck_ip`/`pwd_reset_ip` (по IP, 10/мин+60/час, анти-перебор) + `pwd_reset_email` (по email, 5/час, анти-спам инбокса). IP-лимит стоит **до** проверки существования email (раньше кэп reset стоял после → перебор несуществующих не ограничивался). Старая таблица `password_reset_attempts` **дропнута** (её роль = `pwd_reset_email`). `signupPrecheck` раньше не имел лимита вообще.

**Фронт.** `signupPrecheck`/`requestPasswordReset` зовутся через `supabase.functions.invoke` и читают `data.code` → rate-limit ответы отдаются **статусом 200** (не 429, иначе тело уходит в `error`, а `data`=null). Новый i18n-ключ `auth.err_rate_limited` (en/es/ru) + обработка `pre.code==='rate_limited'` в `Login.jsx` (блок signup, иначе rate-limited ответ провалился бы в реальный `auth.signUp`).

`geocode_rate_bucket` НЕ трогали — у него другая задача (token-bucket под лимит внешнего API LocationIQ). Зеркало в Notion: «Миграция на другой бэкенд — Supabase-специфика». Связано: [[triplanio-backend-migration-notes]], [[triplanio-deploy-topology]].
