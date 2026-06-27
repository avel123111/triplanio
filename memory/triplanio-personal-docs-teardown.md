---
name: triplanio-personal-docs-teardown
description: TRIP-44 — зачистка ЛИЧНЫХ документов (visibility=private) при выходе/удалении участника и при удалении аккаунта; единый _shared/personalDocsTeardown
metadata:
  type: project
---

★РЕАЛИЗОВАНО 2026-06-27, PR #216 смёржен в dev. ⚠️ВАЖНО — был баг деплоя миграции, фикс отдельным PR (ветка cyrus1/trip-44-fix-migration-timestamp): см. блок «Баг деплоя» ниже.

**⚠️ Баг деплоя (out-of-order миграция):** исходная миграция называлась `20260627120000`, но TRIP-46 раньше влила `20260627180000` в dev. При мердже #216 CI `db push` счёл нашу миграцию «более ранней, чем последняя на сервере» → ПРОПУСТИЛ её (out-of-order, нужен `--include-all`). Функция в БД осталась старой, а edge `deleteMyAccount` задеплоился → **файлы личных доков удалялись из Storage, а строки `trip_documents` оставались**. Фикс: пересоздать миграцию с таймстампом ПОЗЖЕ всех применённых (`20260627230000`), удалить старый файл `20260627120000` (иначе он вечно ломает `db push`), + идемпотентный бэкфилл `DELETE` уже осиротевших приватных доков удалённых аккаунтов (`u.deleted_at IS NOT NULL`). Урок: таймстамп новой миграции ОБЯЗАН быть строго больше максимума в журналах dev И prod — не брать произвольный «полдень». См. [[triplanio-migration-naming-drift]], [[feedback-no-manual-deploy-cicd-only]]. Грабли усилены тем, что edge-функции и миграции деплоятся РАЗНЫМИ CI-джобами, которые не гейтят друг друга → возможен split-brain (edge новый, RPC старый).

**Проблема (была):** личные документы `trip_documents.visibility='private'` не удалялись ни при выходе/удалении участника, ни при удалении аккаунта — строки оставались в БД, файлы в бакете `trips`; ушедший терял доступ и не мог удалить их сам, а выжившие участники читали их через сырой REST (RLS `trip_documents_all` = `is_trip_participant`, visibility НЕ фильтруется в БД).

**Решение:**
- **`supabase/functions/_shared/personalDocsTeardown.ts`** — единый источник (по образцу [[triplanio-pro-rollback-addons]] telegramTeardown). Извлекает `storage_path` из `documents[]` + best-effort из legacy top-level `file_url` (regex `/object/(sign|public|authenticated)/trips/<path>`; старые base44-URL не парсятся → подметутся при удалении трипа). **Storage-guard «Вариант A»**: файл удаляется только если на его `storage_path` не ссылается ни одна ВЫЖИВШАЯ строка `trip_documents` в затронутых трипах (защита от осиротения кросс-ссылочного/общего файла; при «uuid на аплоад» пересечений почти нет). Удаление файлов best-effort, постранично (chunk 100). Экспорт: `purgePrivateDocsForMember` (строки+файлы для одного трипа), `collectPrivateDocFiles`/`purgeCollectedDocFiles` (для аккаунта).
- **`removeTripMember`** — `purgePrivateDocsForMember(tripId, member.user_id)` после проверки прав, до удаления `trip_members`. Срабатывает в ОБОИХ кейсах: self-leave (M2) и admin-remove (M3) — одна функция различает их по `isSelf`. Best-effort, не блокирует выход; offline-участник (`user_id=null`) → no-op.
- **`anonymize_my_account`** (миграция `20260627120000_anonymize_account_purge_private_docs`) — `DELETE` приватных `trip_documents` юзера по ВСЕМ трипам ПЕРЕД обнулением `created_by_name` (shared-строки сохраняются и обезличиваются как раньше). RPC доступа к Storage НЕ имеет.
- **`deleteMyAccount`** — собирает `storage_path`+`tripIds`+`docIds` приватных доков ДО RPC, после успешного RPC удаляет осиротевшие файлы (guard против выживших строк). Best-effort, не ломает удаление аккаунта.
- **i18n (en/es/ru)** — `settings.leave_desc` и `confirm.leave_trip.body` = предупреждение о безвозвратном удалении. Ключ `confirm.leave_trip.body` БЫЛ МЁРТВЫМ (диалог выхода показывал только `settings.leave_confirm` как title) → подключён как `description` в `SettingsLens.leaveTrip()` confirm().

**Что НЕ трогаем:** shared-документы (общий контент трипа, обезличиваются через `created_by_name`); доки других участников; файлы сущностей маршрута (`hotel_stays`/`activities`/`transfers`). RLS-приватность чтения чужих личных доков через REST = отдельный таск (см. [[triplanio-viewer-write-rls-escalation]] / security-аудит). Нотификацию M3 не дорабатывали.

`account.delete_desc` уже упоминал удаление документов безвозвратно — не правил. `verify_jwt` функций не менялся.

Notion: дописать на странице `removeTripMember` вторую точку входа (admin-remove) + зачистку личных доков; на странице удаления аккаунта — удаление личных доков по всем трипам (строки+файлы).
