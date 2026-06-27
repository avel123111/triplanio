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

★ПОПРАВКА read-only (TRIP-63 №5, PR #182 → dev, 2026-06-26, решение Pavel): управляющие карточки у viewer БОЛЬШЕ НЕ скрываются — раньше `{!readOnly && (…)}` вырезал половину экрана. Теперь вся управляющая секция завёрнута в `<fieldset disabled={readOnly}>`+opacity/pointer-events (тот же приём, что у identity-карточки), активна только «Выйти». Viewer видит, что аддоны (вкл. бюджет) есть, но переключить не может → модалка budget-замка «Открыть настройки» перестала быть тупиком. См. [[triplanio-pro-visual-qa]]. Серверная защита записи (TRIP-136) — без изменений, всё ещё открыта.

★TRIP-55 (2026-06-26): задача переоткрыта как консолидированный тикет (заменяет старые TRIP-136/137). Аудит вживую переподтвердил: на prod `tizscxrpuopobgcxbekf` И dev `nydhzevdizkfaxdlikgc` все 9 контентных таблиц всё ещё имеют единственную `<t>_all FOR ALL is_trip_participant` (роль не проверяется); `authenticated` имеет DML-гранты через PUBLIC → гейт только RLS; `_can_edit_trip(p_trip,p_uid)` существует, в политиках не используется. Скоуп шире, чем «4 структурные»: viewer пишет напрямую ещё и бюджет (`BudgetLens.jsx:163/165/178/251`) и документы (`DocsLens.jsx:114/331`) — фиксить надо все 9.
- **FE-гард СДЕЛАН** (PR #189 → dev, ветка TRIP-55): `TripStructureEdit.jsx` — ранний возврат `<TripAccessError onBack={/trip/:id}>` при `myRole==='viewer'` сразу после резолва роли (после загрузки content, без мигания). Переиспользован общий стаб `TripAccessError` (тот же, что для shellError/TripView). lint+typecheck+build+70 тестов зелёные.
- **Бэк-защита (RLS split на 9 + read-only UI бюджета/доков) ВЫНЕСЕНА в отдельную задачу TRIP-124** (Urgent, решение Pavel): SELECT по is_trip_participant / WRITE по `_can_edit_trip`, drop `*_all`, деплой ТОЛЬКО через CI (не вручную). Серверная дыра ВСЁ ЕЩЁ ОТКРЫТА до TRIP-124.

Связано: [[triplanio-members-roles]], [[triplanio-gettripbyid-idor]], [[triplanio-pro-audit]], [[triplanio-security-audit-2026-06-21]].
