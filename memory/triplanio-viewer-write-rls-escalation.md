---
name: triplanio-viewer-write-rls-escalation
description: "★УЯЗВИМОСТЬ: viewer пишет брони/city_visits через REST в обход прав; роут /edit без гарда; задачи TRIP-136/137"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7c614335-4f75-42b1-89cc-99b92f14f719
---

★Broken access control в triplanio_new (проверено на dev `nydhzevdizkfaxdlikgc` 2026-06-11, в repo-миграциях RLS-политики НЕ отражены — дрейф имён, см. [[triplanio-migration-naming-drift]]).

**Симптом:** участник с ролью `viewer` по прямой ссылке `/trip/:tripId/edit` попадает в полный редактор структуры.

**Две причины:**
1. **Фронт:** роут `/trip/:tripId/edit` → `TripStructureEdit.jsx` в `App.jsx` без проверки роли. `myRole` считается (стр.491), но не используется как гард. Защита только косметическая — скрытая кнопка «Редактировать» в `TripView` (стр.1031-1034) + `canEditMode`. URL это обходит.
2. **Бэк (настоящая дыра):** брони (`hotel_stays`,`activities`,`transfers`) и `city_visits` пишутся клиентом ПРЯМО в таблицы (`EventEditDialog.jsx` стр.761/791/840/1241/1245), минуя структурные RPC. RLS-политики `*_all` (cmd=ALL) гейтят запись через `is_trip_participant(trip_id)`, а эта функция РОЛЬ НЕ ПРОВЕРЯЕТ (любой active-участник=true). → viewer может через REST insert/update/delete броней и писать city_visits, в обход `_can_edit_trip`.

**Корректно (не трогать):** структурные RPC `set_city_nights/add_city/remove_city/reorder_cities/set_trip_start_date` гардятся `_can_edit_trip` (исключает viewer ✅). Аддон-гейтинг экранов в `TripView` через `isLensVisible` (fallback на overview) — закрыт ✅. `VIEWER_BLOCKED_LENSES={settings,members}` (TripView стр.967-969) — viewer не видит settings/members.

**Фикс (решения Pavel 2026-06-11):** один общий Баг **TRIP-136** (фронт-гард роута /edit + ужесточение RLS write-политик до роль-зависимого предиката типа `_can_edit_trip(trip_id, auth.uid())` на hotel_stays/activities/transfers/city_visits, SELECT оставить по is_trip_participant; раскатать ВРУЧНУЮ на prod `tizscxrpuopobgcxbekf` + dev; проверить смежные `*_all` таблицы services/budget*/documents). Отдельная Задача **TRIP-137**: открыть Settings для viewer в read-only (всё замьючено + инфо-плашка «только чтение» i18n ru/es/en + единственная кнопка «Выйти из трипа»); убрать `settings` из VIEWER_BLOCKED_LENSES.

**СТАТУС TRIP-137 (2026-06-12): ФРОНТ СДЕЛАН → To Test** (репо triplanio_new, ещё НЕ закоммичено/не запушено на момент записи). Изменения: `VIEWER_BLOCKED_LENSES` → `{members}` (TripView); пункт меню «…» Settings показан всем (members у viewer скрыт); `TripSidebar`/`SidebarBody` mgmt-фильтр прячет у viewer только members; `SettingsLens` флаг `readOnly=myRole==='viewer'` → инфо-плашка `Severity level=info` (ключи `settings.readonly_banner_title/_desc` ru/en/es), identity-карточка в `<fieldset disabled>`+opacity (Save скрыт), управляющие карточки (features/chat/warnings/telegram/approvers) скрыты, Danger zone → активна только «Выйти» (edge `removeTripMember`). build+eslint зелёные. ⚠️ это UI-гард, серверная защита записи — всё ещё за **TRIP-136** (НЕ сделана).

Связано: [[triplanio-members-roles]], [[triplanio-gettripbyid-idor]], [[triplanio-pro-audit]].
