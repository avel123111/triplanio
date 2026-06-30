---
name: triplanio-bulk-data-migrations-constraints
description: Грабли больших/тяжёлых миграций Supabase через CI — COPY-stdin, лимит git-дифа, журнал упавших, statement_timeout
metadata:
  type: project
---

★TRIP-145 2026-06-28/29 (спайк GeoNames cities500 → поиск). Серия из нескольких разных провалов `db push` — каждый отдельная причина. Чек-лист для любых тяжёлых/больших миграций (`supabase/migrations/**` → CI job `migrate`):

1. **`db push` НЕ умеет `COPY … FROM stdin` с инлайн-данными.** Гоняет миграции через Go/pgx wire-протокол (не psql) → `FATAL: protocol synchronization was lost (08P01)`. Лей данные **батчевыми `INSERT … values (...),(...)`** (~1000–2000 строк/стейтмент), экранируй `'`→`''` (standard_conforming_strings on → бэкслеш литерал).

2. **GitHub не диффит/мёржит PR ~120 МБ.** Зависает `mergeable=null/unknown`, CI `pull_request` не триггерится, кнопка мерджа мёртвая. Рабочий потолок одного файла ≈ **40 МБ**. Больше — режь объём, не дроби на файлы (история git раздувается навсегда ради throwaway). Для «все локали» (1.6M строк / ~120 МБ) — данные грузить ВНЕ git (вручную/loader из дампа GeoNames), не через миграцию.

3. **Out-of-order timestamp.** `db push` применяет миграцию только если версия НОВЕЕ `max(version)` журнала. Перед именованием проверь `select max(version) from supabase_migrations.schema_migrations`.

4. **★Упавшая миграция ВСЁ РАВНО попадает в журнал как применённая** (при нормальной SQL-ошибке, напр. 42P13). Последствия: (а) её файл **нельзя удалять** — `db push` упадёт на «remote migration not found locally»; (б) **правка её содержимого БЕСПОЛЕЗНА** — `db push` пропускает по версии; лечение ТОЛЬКО **новым таймстампом**; (в) последующие деплои зелёные (версия пропущена), но объекты не созданы — легко проглядеть. Перед фиксом всегда сверяй журнал: `select version from supabase_migrations.schema_migrations where version like '2026%'`.

5. **★Тяжёлый `UPDATE`/`CREATE INDEX` упирается в `statement_timeout` Supabase (~120с) → `57014`.** db push гонит файл в ТРАНЗАКЦИИ → таймаут/ошибка откатывают ВСЮ миграцию (частичных применений нет; версия тогда НЕ журналируется → можно править файл на месте). Не лей коррелированные подзапросы на сотни тысяч строк (234k × подзапрос = таймаут) — преднасчёт в **temp-таблицу + set-based join**. Плюс `set statement_timeout = '600s';` в начале миграции как страховка.

NB: пункты 4 и 5 дают разный итог по журналу: нормальная SQL-ошибка (42P13) журналируется и откатывает только частично в некоторых случаях; таймаут (57014) откатывает всё и НЕ журналирует. Всегда проверяй фактическое состояние БД read-only (`pg_get_function_result`, наличие колонок/функций, журнал) перед следующим шагом — не доверяй «deploy success».

Связано: [[triplanio-migration-naming-drift]], [[feedback-no-manual-deploy-cicd-only]], [[triplanio-deploy-topology]], [[feedback-design-for-scale-not-now]]. Контекст геокодинга v2 — [[triplanio-geocode-cache]].
