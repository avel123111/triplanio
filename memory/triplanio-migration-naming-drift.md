---
name: triplanio-migration-naming-drift
description: "TRIP-68 РЕШЕНО — история миграций схлопнута в единый baseline; репо↔dev↔prod журналы идентичны (1 запись)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 13ceacbf-eaf1-4586-b618-942e91f86e4f
---

★ **TRIP-68 РЕШЕНО 2026-06-25 (Вариант A+ baseline + reset журнала).** Дрейф «имена файлов репо `00NN` ↔ таймстамп-версии БД» устранён схлопыванием истории в единый baseline. Теперь репо, dev и prod несут ОДНУ запись истории `20260625120000_baseline` → Supabase Git-интеграция/`db push` больше не падают «Remote migration versions not found locally».

**Что было (симптом до фикса):** Git-интеграция падала КАЖДЫЙ ран на обоих проектах (`Remote migration versions not found in local migrations directory`). Корень: репо `supabase/migrations/` = 72 файла `00NN_*.sql` (0003…0068, +дубли 0006/0020/0027/0028/0040/0052); БД хранят историю таймстампами; пересечение версий = 0. Вдобавок репо был НЕПОЛНЫМ срезом (нет initial_schema/rls) и prod(108)≠dev(92) различались и по таймстампам, и по составу → «переименовать файлы под таймстампы» было невыполнимо для обоих сразу.

**Что сделано (сессия 2026-06-25):**
1. **Сверка БД (ранее НИКЕМ не проверялась фактически).** prod vs dev по всем осям. Расхождения: 2 таблицы только в prod (`n8n_chat_histories` живая, `n8n_chat_messages` мёртвая) + 4 индекса + 1 unique-индекс под разными именами. Функции(67)/политики(42)/триггеры(15)/расширения(8)/колонки — идентичны.
2. **Ф0.5 выравнивание dev↔prod** (Management API, т.к. Supabase MCP = read-only): на dev добавлены 6 индексов по датам + переименован reminder-индекс в `idx_reminder_logs_dedup` + создана `n8n_chat_histories` (1:1, VARCHAR(255)); на prod добавлены 2 индекса `city_visit_id` + дропнута мёртвая `n8n_chat_messages` (бэкап 191 строки). Итог: схемы prod==dev байт-в-байт (хеши совпали: cols `4f44ca35`, fn `c5ef5c10`, pol `732926d7`, idx `9249a904`, trg `d9e21b43`, ext `42ee2e7e`).
3. **Ф1 baseline.** Снимок схемы public сгенерирован из живого каталога через `pg_get_*def` (pg_dump был недоступен: db dump требует Docker, его не было) → `supabase/migrations/20260625120000_baseline.sql` (~3190 строк, `SET check_function_bodies=false`). 72 старых файла → `supabase/migrations_legacy/`.
4. **Ф2 reset журналов.** `schema_migrations` обоих проектов очищен и заполнен одной записью `20260625120000_baseline` (только bookkeeping, схема/данные не тронуты).

**ВАЖНЫЕ оговорки / остаток:**
- Доступ к записи в БД у агента = **Management API** (`POST /v1/projects/<ref>/database/query`, токен `SUPABASE_ACCESS_TOKEN` в окружении). Supabase **MCP — read-only**, DDL/миграции через него НЕ идут.
- baseline = **catalog-generated**, НЕ канонический pg_dump: покрывает только `public` (нет storage-бакетов/auth); порядок вью — алфавитный (риск, если вью зависят друг от друга). Помечен applied (на живых БД не выполнялся), поэтому для prod/dev безопасен; слабее лишь для «поднять окружение с нуля». Можно подложить настоящий `supabase db dump` позже без последствий (версия та же).
- **Деплой миграций теперь CI/CD** (TRIP-68 Ф3, PR после reconcile): job `migrate` в `supabase-deploy.yml` (`supabase db push --db-url`, merge→dev→dev, merge→main→prod; секреты `SUPABASE_DB_URL_DEV`/`_PROD`). Агент НЕ катит руками — см. [[feedback-no-manual-deploy-cicd-only]]. Новые миграции ТОЛЬКО `supabase migration new` (таймстамп); `00NN` запрещены.
- **Реконсиляция №2 (с учётом 0069):** сразу после первого reconcile в репо/журналы занесли `0069_drop_booking_platform_column` + `0069_users_unit_system` (старый формат, дубль номера) — дрейф вернулся. Свёрнуты в baseline (схема их уже содержала, оба накатаны на оба проекта), файлы 0069 удалены, журналы снова обнулены до единственного baseline. Это и подтвердило: без смены конвенции на таймстампы дрейф возвращается → закреплено в CLAUDE.md правило 12.
- **Остаток:** выключить native Supabase↔GitHub Git-интеграцию в дашборде (дашборд-тумблер, API нет), чтобы она не катила миграции параллельно с GitHub Actions (двойной накат).
- Бэкапы (журналы обоих + 191 строка n8n_chat_messages) лежат вне репо: `/data/.cyrus/trip68-backups/`.
- Связано: [[triplanio-deploy-topology]], [[triplanio-cicd-github-actions]] (Ф3/TRIP-68 был последним хвостом TRIP-73).
