---
name: triplanio-done-criteria
description: Критерии «готово» для миграции Triplanio — визуал нового дизайна + полная логика base44
metadata:
  node_type: memory
  type: feedback
  originSessionId: current
---

## Definition of Done (Triplanio, решение Pavel 2026-05-27)
Фича готова ТОЛЬКО при выполнении ОБОИХ условий:
1. **Визуал** — элемент/экран/диалог/попап взят из нового дизайна (`Triplanio App 2` или дизайн-система `triplanio_new/src/design/index.jsx`: ModalHost, Dialog, Btn, Badge, Card, Avatar, EmptyState, Field…). НИ ОДНОГО элемента из старого base44/shadcn-дизайна (`@/components/ui/dialog` и т.п.) не должно остаться.
2. **Функционал** — полностью повторяет логику той же фичи в base44 (валидации, правила, side-effects).

**Why:** Pavel явно задал эти критерии; перевод только данных (Supabase) при старом визуале НЕ считается готовым. Пример: Hotel/Transfer/Activity/City-диалоги переведены на Supabase, но визуально на shadcn → НЕ done, пока не перерисованы в новом дизайне (EventModal / форм-экраны / Dialog).

**How to apply:** при оценке/отметке готовности проверять обе оси. Edge Functions — это ПОРТЫ base44-функций (не параллельные); не выдумывать функции, которых нет в base44, без явной причины (исключение: addOfflineTripMember — серверно-защищённый аналог base44-клиентского `TripMember.create({status:'offline'})`).

См. [[triplanio-status]], план `triplanio_new/MIGRATION_PLAN_2026-05-27.md` (рев.2), чеклист `triplanio_new/CHECKLIST_STATUS_2026-05-27.md` (рев.2).
