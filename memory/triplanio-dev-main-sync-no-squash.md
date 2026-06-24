---
name: triplanio-dev-main-sync-no-squash
description: dev↔main синхронизировать НЕ squash-мержем (плодит расхождение по SHA при идентичном контенте); унифицировать на один merge-коммит + FF-push обе ветки
metadata:
  type: feedback
---

При синхронизации долгоживущих веток `dev` и `main` (TRIP-18, 2026-06-24) **нельзя
использовать GitHub "Squash and merge"**: squash создаёт новые SHA на каждой
стороне, из-за чего GitHub показывает ветки как взаимно "ahead/behind", **хотя
контент (дерево) побайтно идентичен** (`git diff origin/main origin/dev` пуст).
Это косметика, не потеря изменений, но Pavel на это ругается.

**Why:** squash-мерж предназначен для feature→ветка, а не для sync между двумя
постоянными ветками — он всегда ре-расходит их по истории.

**How to apply:** чтобы свести `dev` и `main` к одному коммиту без force-push:
1. `git branch -f _unify origin/dev && git checkout _unify`
2. `git merge --no-ff origin/main` — дерево идентично → конфликтов нет; merge-коммит
   имеет обе верхушки родителями, значит обе ветки FF-ятся на него.
3. `git push origin _unify:main` и `git push origin _unify:dev` — оба обычный
   fast-forward (не force).
Результат: `origin/dev == origin/main` (один SHA), ahead/behind = 0/0.

Branch protection в репо НЕТ (приватный на free-плане → API 403), поэтому прямой
FF-push в `main`/`dev` разрешён. Vercel Hobby не блокирует, если автор коммита =
владелец `avel123111` (текущая git-identity именно такая).

Связано: [[triplanio-migration-naming-drift]] (аналогичный дрейф, но в именах
Supabase-миграций), [[triplanio-vercel-hobby-blocks-collaborator-commits]].
