---
name: triplanio-gettripdetails-verifyjwt
description: getTripDetails fail-open auth дыра (verify_jwt=false + anon-key) — причина и фикс
metadata: 
  node_type: memory
  type: project
  originSessionId: f7c78fad-9a6a-4086-a48c-fec8a2128a6b
---

**Дыра (подтверждена на проде, версия v8 == репо, 2026-05-30):** `getTripDetails` отдавал ВЕСЬ payload трипа любому, кто знает tripId, без логина и членства.

Механизм (fail-OPEN): код был `const user = await getRequestUser(req); ... if (user) { ...creator/member check → 403... }`. `getRequestUser` возвращает null не только при отсутствии заголовка, но и когда токен — **публичный anon-ключ** (`VITE_SUPABASE_ANON_KEY`, лежит открытым в бандле фронта). При `verify_jwt=false` шлюз пускает запрос внутрь, `getUser(anonKey)` → нет юзера → `user=null` → ветка проверки ПРОПУСКАЕТСЯ → возвращается весь трип (города/отели/активности/трансферы/сервисы/участники/документы/бюджет).

**Почему так получилось:** флаг не вводили в миграции email→user_id — его СОХРАНИЛИ как в проде («match the production settings (preserved)»). Это base44-наследие: там `no user ⇒ доверенный api_key-сервер`, и платформа base44 гейтила эндпоинт. На Supabase api_key-гейта нет, anon-ключ публичен → допущение сломалось.

**Фикс (внесён в код 2026-05-30, НЕ задеплоен — Pavel деплоит CLI):** fail-CLOSED.
- `getTripDetails/index.ts`: `if (!user) return 401;` сразу после getRequestUser; creator/member-проверка теперь выполняется ВСЕГДА (убран `if (user)` wrapper).
- `deploy_userid_functions.sh`: getTripDetails перенесён из NO_JWT в JWT (→ verify_jwt=true).
- Безопасно: `/trip/:id` (TripView, единственный вызыватель) рендерится только авторизованным (App.jsx требует isAuthenticated); публичный просмотр — отдельный `/public/trip/:id` → getPublicTrip.

**Команды деплоя:** `supabase functions deploy getTripDetails --project-ref <ref>` (default = verify_jwt true) для dev `nydhzevdizkfaxdlikgc` и prod `tizscxrpuopobgcxbekf`.

**TODO для аудита:** проверить тем же fail-open паттерном getPublicTrip и остальные NO_JWT-функции (triplanioAiReply; `syncTripExpense` удалена в TRIP-45 2026-07-04). Связано с [[triplanio-pro-audit]].
