---
name: triplanio-memberslens-paramname-bug
description: "Известный пре-существующий баг Triplanio: MembersLens шлёт memberId вместо member_id в member-функции"
metadata: 
  node_type: memory
  type: project
  originSessionId: f7c78fad-9a6a-4086-a48c-fec8a2128a6b
---

# Triplanio: баг имён параметров в MembersLens (не из миграции)

В `src/pages/MembersLens.jsx` вызовы edge-функций передают `memberId`, а функции читают `member_id`:
- `updateTripMemberRole` — body `{ tripId, memberId: member.id, role }` → ждёт `{ member_id, role }`
- `resendTripInvite` — `{ tripId, memberId }` → ждёт `{ member_id }`
- `removeTripMember` — `{ tripId, memberId }` → ждёт `{ member_id }`

**Следствие:** удаление участника, повторная отправка инвайта и смена роли молча не работают (функция получает `member_id = undefined` → 400 "Missing member_id").

**Why:** обнаружено при миграции email→user_id (2026-05-29). Это пре-существующий баг на `origin/main`, к миграции отношения не имеет (`member.id` — uuid в любом случае). Не правили, чтобы не расширять scope миграции. Pavel попросил запомнить.

**СТАТУС 2026-05-29: ИСПРАВЛЕНО** в `MembersLens.jsx` (активный экран): `inviteTripMember` → `{ trip_id: tripId, ... }`; `updateTripMemberRole`/`resendTripInvite`/`removeTripMember` → `{ member_id: ... }`. Легаси TripMembersBar/Card/CollabBar с тем же багом удалены как мёртвый код.

**2026-05-31: ВТОРОЙ слой бага удаления.** `removeTripMember` делал `delete()` без проверки error → всегда `ok:true`. На PROD FK `notifications.trip_member_id → trip_members` = ON DELETE NO ACTION (на dev = CASCADE, дрифт), поэтому у приглашённого с invite-нотификацией delete падал, но молча → «удаление/выход не работают». Фикс: removeTripMember чистит notifications перед delete + проверяет error; SettingsLens.leaveTrip и MembersLens.removeMember проверяют ответ; миграция `0011_notifications_trip_member_cascade.sql` (prod FK → CASCADE). Заодно: роли — убрана несуществующая `editor` (только admin/viewer); StatusDot active→пусто, declined→«Отклонил»; declined можно переприглашать (inviteTripMember сбрасывает declined-строку в pending вместо 409); self-invite показывает реальную ошибку через `edgeErrorMessage`. Подробно: [[triplanio-members-roles]].

См. [[triplanio-userid-migration]], [[triplanio-members-roles]].
