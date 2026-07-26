---
name: feedback-dead-i18n-key-sweep-must-scan-backend
description: «Мёртвые» i18n-ключи нельзя вычислять сканом только src/** — ключи уведомлений эмитит бэкенд (БД + edge), во фронте их литералов нет
metadata:
  type: feedback
---

★TRIP-299 2026-07-26 (Pavel: «Что случилось с ключами переводов на проде?»): во «Входящих» на проде вместо текста стояли сырые `notif.tpl_booking_added_title` / `_msg`. Причина — вычистка мёртвого в `208b142` (TRIP-296): 606 ключей удалены как «не встречающиеся в коде», ссылки искались **только по `src/**`**. Под нож попали 22 живых ключа (21 `notif.tpl_*` + `notif.role_admin`/`role_viewer`) — в проде 104 строки, все 8 семейств уведомлений: приглашения, вступление, удаление из трипа, смена роли, активация Pro и **провал платежа за Pro**.

**Почему скан по фронту их не видит:** ключ уведомления хранится **в БД** — его пишут DB-триггер (booking added) и шесть edge-функций (`inviteTripMember`, `respondTripInvite`, `redeemTripInviteLink`, `removeTripMember`, `updateTripMemberRole`, `stripe-webhook`) в колонки `notifications.i18n_title_key` / `i18n_message_key` (+ `i18n_params.role_key`). Inbox резолвит его в рантайме: `t(n.i18n_title_key)`. Литерала `'notif.tpl_…'` в `src/**` нет **ни одного** — он живёт в `supabase/functions/**` и `supabase/migrations/**`.

Фолбэк не спасает: в `Inbox.jsx` ветка `n.i18n_title_key ? t(…) : n.title` берёт сохранённый в БД текст только когда ключ **NULL**, а не когда перевод не нашёлся. `t()` на отсутствующем ключе возвращает сам ключ (lang → en → `key`, `I18nContext.jsx`).

Усугубило то, что ключи удалили **и из Tolgee**: Tolgee авторитетен (`tolgee_sync` делает `pull` на каждом деплое в dev и перезаписывает JSON), поэтому починка только в репо продержалась бы до следующего деплоя — восстанавливать надо в обоих местах. Это зеркало [[feedback-new-i18n-keys-go-to-tolgee]].

**How to apply:** удаляешь i18n-ключи как «мёртвые» — источников ссылок **три**, не один: `src/**`, `supabase/functions/**`, `supabase/migrations/**`. Плюс шаблонные `t(\`ns.pre${x}\`)` и базы `pluralize`. Считать ключ мёртвым только если он не найден **везде**. Начиная с TRIP-299 это форсит CI: гард 2d `scripts/ci/check-i18n.mjs`, проверка **C** — любой литерал `'<ns>.<key>'` в бэкенде, где `<ns>` — существующий файл локали, обязан резолвиться во всех локалях (падает и называет файл-эмитент и локаль). Привязка к словарю namespace'ов держит её тихой: `public.foo`/`auth.users` в SQL — голые идентификаторы, а не строковые литералы.

Общий урок шире i18n: **«не найдено в `src/**`» ≠ «мёртвое»** — в этом репо ссылка может жить в БД, edge-функции или n8n. Компаньоны: [[feedback-new-i18n-keys-go-to-tolgee]], [[feedback-ask-before-removing-feature-intent]], [[triplanio-i18n-tolgee-incontext]], [[triplanio-i18n-no-hardcode]].
