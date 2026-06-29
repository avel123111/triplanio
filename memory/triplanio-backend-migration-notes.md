---
name: triplanio-backend-migration-notes
description: "Накопительная заметка: что учесть при возможной миграции на другой бэкенд (Supabase-специфика, которую не унести в лоб)"
metadata:
  node_type: memory
  type: project
---

★ **Назначение (заведено TRIP-102, 2026-06-26).** Сюда складываем Supabase-специфичные вещи, которые при гипотетической миграции на другой бэкенд нельзя перенести «как есть» — чтобы не потерять контекст. **Зеркало в Notion СОЗДАНО** (страница «Миграция на другой бэкенд — Supabase-специфика» под разделом «1. Инфраструктура и интеграции»: https://app.notion.com/p/Supabase-38b2c9f1427e81109d34d4d82ebc6236) — Notion доступен через REST (`NOTION_TOKEN`), см. [[triplanio-agent-connectors]]. При обновлении этой заметки синхронизировать и Notion-страницу.

**Storage (Supabase Storage):**
- `storage.buckets` / `storage.objects` — таблицы Supabase-storage-сервиса. На другом бэкенде их нет → бакеты (`avatars` public 5 МБ image-mime; `trips` private 50 МБ) и 12 RLS-политик `storage.objects` придётся перемаппить на S3-аналог (bucket-политики/IAM). В baseline (TRIP-102) они лежат отдельным идемпотентным блоком в конце `20260625120000_baseline.sql`.
- `storage.protect_delete()` + триггеры `protect_*` — **платформенный** механизм Supabase (защита от прямого DELETE мимо Storage API, флаг `storage.allow_delete_query`). НЕ наш код, в baseline не зашит. На другом бэкенде отсутствует как понятие.
- Тех-долг: 6 из 12 политик ссылаются на bucket_id `trip-covers`/`documents`, которых среди бакетов нет (мёртвые).

**Auth (Supabase GoTrue):**
- Схема `auth` целиком платформенная (`auth.users`, `auth.uid()` и т.д.). В baseline НЕ дампим (создаёт стек). RLS-политики public-таблиц массово завязаны на `auth.uid()` — при смене бэкенда это центральная точка переписывания (identity provider + как пробрасывается user_id в RLS/запросы).
- Кастомных триггеров на `auth.users` НЕТ (линковка инвайтов — триггер `trg_link_pending_invites` на `public.users`, не на auth).

**Extensions (в public/extensions/vault):** `pg_net`, `unaccent`, `fuzzystrmatch` (public), `pg_stat_statements`, `pgcrypto`, `uuid-ossp` (extensions), `supabase_vault` (vault). `pg_net` (async HTTP из БД) и `supabase_vault` — Supabase-специфичные, на другом managed-Postgres могут отсутствовать.

**Edge Functions / прочее (не в БД):** деплой функций+миграций = GitHub Actions only (см. [[triplanio-cicd-github-actions]], [[triplanio-deploy-topology]]). RevenueCat/IAP-задел — [[triplanio-revenuecat-assessment]], [[triplanio-native-iap]].

Связано: [[triplanio-migration-naming-drift]] (там TRIP-102 закрыл оговорку про catalog-generated baseline).
