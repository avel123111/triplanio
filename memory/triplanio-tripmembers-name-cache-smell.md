---
name: triplanio-tripmembers-name-cache-smell
description: "TODO тех-долг — денормализованный кеш имени/почты в trip_members (user_full_name/invite_email) выглядит криво, пересмотреть позже"
metadata: 
  node_type: memory
  type: project
  originSessionId: 20321c7b-3c7c-42ca-b380-9e393d2edacc
---

★TODO 2026-06-22 (Pavel: «кажется что это криво, вернуться позже»). `trip_members` хранит ПОСТОЯННЫЕ денормализованные колонки `user_full_name` и `invite_email` — снимок имени/почты на момент добавления/приглашения. Нужны были для оффлайн/приглашённых участников без `user_id`. Проблема: для зарегистрированного участника это дубль `users.full_name/email`, который не синхронизируется (имя поменял в профиле — в trip_members осталось старое) и течёт PII (поэтому при обезличивании [[triplanio-account-deletion-design]] приходится чистить и тут).

Везде на фронте фолбэк `profile?.full_name || m.user_full_name` (MembersLens, SettingsLens, DocsLens, ChatWidget, ChatLens, TripView, MembersSummaryCard) + RPC `get_trip_participant_profiles` (`COALESCE(u.full_name, tm.user_full_name,'')`).

Пересмотреть позже: для юзеров с `user_id` тянуть имя/почту ТОЛЬКО из `users` (live), а `user_full_name`/`invite_email` оставить ИСКЛЮЧИТЕЛЬНО для приглашённых без user_id. Отдельный тех-долговый тикет, НЕ часть TRIP-78.
