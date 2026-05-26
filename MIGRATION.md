# Triplanio: план миграции с Base44 на Supabase + Vercel

## Статус

| Шаг | Статус |
|-----|--------|
| Репозиторий GitHub | ✅ |
| Vercel: лендинг (triplanio.com) | ✅ |
| Vercel: приложение (triplanio_app) | ✅ |
| Supabase dev + prod: схема БД | ✅ |
| Supabase dev + prod: RLS политики | ✅ |
| Supabase dev + prod: Storage (documents, avatars) | ✅ |
| Env переменные в Vercel | ✅ |
| Секреты в Supabase | ✅ |
| supabaseClient.js в репозитории | ✅ |
| Supabase Auth: Google OAuth настроен | ✅ |
| AuthContext.jsx — переписать под Supabase | ✅ |
| Страница /login (Login.jsx) | ✅ |
| App.jsx — добавить route /login | ✅ |
| Edge Functions — портировать | ⏳ |
| Фронтенд — заменить Base44 SDK | ⏳ |
| Supabase Realtime для чата | ⏳ |
| Тестирование на dev | ⏳ |
| Миграция данных из Base44 | ⏳ |
| Production переключение | ⏳ |

---

## Шаг: Login страница

`AuthContext.jsx` теперь редиректит на `/login` при логауте и ошибке авторизации.
Нужно создать `src/pages/Login.jsx` и добавить route в `App.jsx`.

**Login.jsx должна содержать:**
- Кнопку "Войти через Google" (`supabase.auth.signInWithOAuth({ provider: 'google' })`)
- Опционально: форму email + password (`supabase.auth.signInWithPassword`)
- После успешного входа `onAuthStateChange` в AuthContext сам подхватит сессию и перенаправит на `/`

**App.jsx:**
- Добавить `import Login from '@/pages/Login'`
- Добавить `<Route path="/login" element={<Login />} />` вне `<Layout>` (до auth guard)
- Также добавить проверку: если пользователь не аутентифицирован и путь не `/login` и не `/public/...` — редирект на `/login`

---

## Шаг: Edge Functions

Портировать все функции из `base44/functions/` в `supabase/functions/`.
Заменить `@base44/sdk` на `@supabase/supabase-js`.

**Оптимизировать медленные функции:**
- `getTripDetails` (10-15с) — уже использует Promise.all, ускорится за счёт прямого подключения к БД
- `resolveProfiles` (5-10с) — заменить N запросов на один `WHERE email = ANY([...])`
- `checkSubscriptionStatus` (5с) — заменить 3 последовательных запроса на один SQL JOIN

**planTripWithAi** — вместо `base44.integrations.Core.InvokeLLM()` вызывать n8n webhook (как callTriplanioAi). Настроить позже.

---

## Шаг: Telegram Reminders (расписание)

`sendTripReminders` сейчас запускается каждые 15 минут планировщиком Base44.

После миграции — использовать **n8n** (уже есть):
1. Добавить Schedule trigger → каждые 15 минут
2. HTTP Request → Supabase Edge Function URL `sendTripReminders`
3. Auth: передавать `SUPABASE_SERVICE_ROLE_KEY` в заголовке (или специальный секрет)

Альтернатива: pg_cron внутри Supabase.

Делать в самом конце после деплоя функций.

---

## Шаг: Обновить URLs после деплоя функций

После того как Edge Functions задеплоены на Supabase:

1. **n8n** — найти все HTTP Request ноды которые вызывают Base44 функции, заменить URLs на:
   `https://[project].supabase.co/functions/v1/[function-name]`

2. **Telegram webhook** — обновить webhook бота:
   Старый: `https://app.base44.com/.../telegramWebhook`
   Новый: `https://[project].supabase.co/functions/v1/telegramWebhook`

3. **Stripe webhook** — обновить endpoint в Stripe Dashboard:
   Старый: Base44 URL
   Новый: `https://[project].supabase.co/functions/v1/stripe-webhook`
   Не забыть обновить `STRIPE_WEBHOOK_SECRET` (новый endpoint = новый секрет).

---

## Шаг: Production переключение

1. Добавить домен `app.triplanio.com` в Vercel project `triplanio_app`
2. Обновить DNS: `app.triplanio.com` → Vercel (убрать Base44)
3. Настроить `web.triplanio.com` как staging (опционально)
4. Выключить Base44 приложение

---

## Заметки

- **Storage**: `documents` — приватный, лимит 50MB на файл; `avatars` — публичный, лимит 5MB на файл
- **Stripe**: Live и Test ключи хранятся в одном Supabase проекте, функции переключаются сами
- **Realtime**: только чат (`useChatLiveSubscription` в `src/lib/chat.js`) — заменить на Supabase channel
- **n8n_chat_histories** на prod Supabase — без RLS, проверить нужна ли защита
- **Google OAuth**: Callback URLs зарегистрированы для dev и prod Supabase проектов
