---
name: triplanio-members-roles
description: "Участники трипа — роли (нет editor), статусы, приглашения/переприглашение, removeTripMember FK-фикс, шеринг в сайдбаре"
metadata: 
  node_type: memory
  type: project
  originSessionId: 71f48150-f34f-405f-b915-c43f152841ea
---

Управление участниками (MembersLens, lens=members) + edge-функции, состояние 2026-05-31 (dev).

- Роли реальные: owner / admin / viewer. `editor` НЕ существует (бэк принимает только viewer/admin). owner только из trips.created_by, не выбирается/не меняется/не удаляется. Убрал фантомную «Редактор» из ROLES.
- Статусы (trip_members.status): pending→«Ожидает», active→БЕЗ текста, declined→«Отклонил» (красн.), offline→бейдж «Офлайн» в колонке роли (статус-колонка пуста). getTripDetails отдаёт все статусы.
- Переприглашение declined: inviteTripMember на существующей declined-строке сбрасывает её в pending (новая роль, accepted_at=null) + шлёт нотиф/email, НЕ 409. Та же строка → FK нотификаций цел. UI: кнопка «Пригласить ещё раз». ⚠️2026-06-04: эта логика была в git но НЕ задеплоена (prod крутил старую v10 → «This user is already invited or a member»). Задеплоено inviteTripMember на prod (v11) + dev (v8). Урок: deploy-drift Supabase-функций — проверяй get_edge_function, не только git.
- Кнопка выхода из трипа в SettingsLens: ключ `settings.leave_btn` («Выйти»/«Salir»/«Leave»), НЕ `auth.logout` (в ES было «Cerrar sesión» = выход из аккаунта, неверно).
- removeTripMember (единая точка для «исключить» и «выйти»): чистит notifications по trip_member_id ПЕРЕД delete + проверяет error (раньше глотал → ok:true но не удалял). Миграция 0011 выровняла prod FK notifications→trip_members на ON DELETE CASCADE (dev уже был). leaveTrip/removeMember на фронте проверяют ответ.
- edgeErrorMessage(error,data) в MembersLens читает error.context.json() — иначе supabase-js прячет реальную ошибку за «non-2xx status code» (self-invite, 409 already-invited).
- «Поделиться» теперь и в хедере, и в левом меню (группа «Управление»), общий ShareDialog; обе скрыты от viewer (ensureShareToken owner/admin-only). Иконка settings в icons.jsx заменена на чистый cog (lucide-style).
- Док Notion: «Участники трипа — роли, приглашения, статусы» (id 3712c9f1-427e-8189-8654-fb91b2c11594).

Связано: [[triplanio-memberslens-paramname-bug]], [[triplanio-trip-settings-display]], [[triplanio-dev-parallel-env]] (дрифт prod/dev схем).
