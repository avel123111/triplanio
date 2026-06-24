---
name: triplanio-userid-migration
description: "Решения по рефакторингу Triplanio: переход идентификатора пользователя с email на user_id (uuid) во всём приложении"
metadata: 
  node_type: memory
  type: project
  originSessionId: f7c78fad-9a6a-4086-a48c-fec8a2128a6b
---

# Triplanio: миграция email → user_id

**СТАТУС 2026-05-29: ВЫКАЧЕНО на dev+prod.** БД (created_by→uuid, user_email удалён, RLS на auth.uid()) применена на обоих окружениях; 24 edge-функции передеплоены (dev+prod) из актуального кода; фронт замёржен в `origin/main` (Vercel автодеплой). Pavel подтвердил: «всё норм». Остался смоук-тест по факту использования.

**ВАЖНО про базу кода:** правильный источник кода — `origin/main` на GitHub (НЕ локальная папка). В первый заход миграция случайно легла на устаревшую локальную копию (отставала на 72 коммита); пришлось `git reset --hard origin/main` и накладывать заново. Перед любыми правками — работать от свежего `origin/main`.

Большой рефакторинг (решено 2026-05-29): убрать email как идентификатор/связь пользователя везде. Канонический id = `users.id` (= `auth.users.id` = `auth.uid()`).

**Why:** Pavel считает связку по email некорректной; правильный ключ — uuid. Сейчас на email завязаны связи в БД (`created_by`, `user_email`), вся RLS (`auth.jwt()->>'email'`), edge-функции и фронт.

**How to apply:** при любых правках в этих областях использовать `user.id`, не email. Источник истины — два файла в репо `triplanio_new`:
- `TZ_USERID_MIGRATION.md` — аудит/масштаб (15 таблиц с `created_by`-email, 8 с `user_email`, RLS-функции `is_trip_participant`/`is_trip_creator`, ~28 edge-функций, ~18 файлов фронта).
- `TZ_USERID_FOR_CLAUDE_CODE.md` — исполняемое ТЗ (7 фаз, DDL/SQL, критерии Done).

## Зафиксированные решения
1. **Имя `created_by` сохраняем**, но меняем тип text(email)→uuid (FK→users.id) во всех таблицах. Владелец трипа = `trips.created_by`. Новый `owner_id` НЕ вводим.
2. **email удаляем** из контентных таблиц. Остаётся только: `users.email`, `trip_members.invite_email` (адрес инвайта незарегистрированных), тексты писем.
3. **AI-бот** определяется по `user_id`, не email. uid бота: prod `a3e7c28b-31b1-4ecf-bbbd-8c6695ba9c98`, dev `daa64967-27ef-4a98-8eec-e74c0670b9e2`. Бот есть в `auth.users`, но строки в `public.users` нет — её создаёт фаза 1. Env: `TRIPLANIO_BOT_USER_ID` / `VITE_TRIPLANIO_BOT_USER_ID`.
4. **Делаем сейчас**, до наполнения прода (новый app ещё не обслуживает реальных юзеров; живой прод — base44). На Supabase dev-branch → merge в prod. Код — отдельная git-ветка, в main не пушить до зелёного билда.

## Инварианты
- Offline-участники и pending-инвайты: `user_id` = NULL (аккаунта нет), идентификация инвайта по `invite_email`.
- `partner_clicks`/`trip_telegram_integrations`/`telegram_reminder_logs`: `user_id text` УЖЕ хранит настоящий auth uid — нужен только тип uuid + FK.
- `chat_messages.user_id`/`chat_reads.user_id` (uuid, FK уже есть) — все NULL, нужен только backfill из `user_email`.

См. также [[triplanio-status]], [[triplanio-code-analysis-rule]], [[feedback_base44_analysis_rule]].
