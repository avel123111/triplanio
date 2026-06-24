---
name: triplanio-trip-delete-fk
description: "Удаление трипа — поведение FK к trips(id); деньги (partner_clicks/trip_subscriptions) = SET NULL, notifications = CASCADE"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8a389888-6e4f-407e-9d3c-1901f4acd576
---

Удаление трипа идёт напрямую с клиента: `supabase.from('trips').delete().eq('id', tripId)` в `SettingsLens.deleteTrip` (2 window.confirm, никакого Pro-guard). Падало на FK к `trips(id)`.

На prod в `NO ACTION` были ТРИ ключа (не один): `notifications_trip_id_fkey`, `partner_clicks_trip_id_fkey`, `trip_subscriptions_trip_id_fkey`. На dev все были `CASCADE` (дрейф → dev молча удалял денежные строки при удалении трипа).

Решение (2026-06-05, миграции применены на prod+dev, оба окружения выровнены):
- `notifications.trip_id` → **ON DELETE CASCADE** (миграция 0020). Уведомления одноразовые, каскад безопасен. Клиентская дочистка НЕ годится: delete идёт под RLS владельца, чужие notifications он не достанет — фикс должен быть в FK.
- `partner_clicks.trip_id` → **ON DELETE SET NULL** (миграция 0021). Лог партнёрской атрибуции (деньги), нигде не удаляется — должен пережить трип.
- `trip_subscriptions.trip_id` → **ON DELETE SET NULL** (миграция 0021). Stripe-биллинг-record. Вебхуки строку НЕ удаляют — только меняют `status` ('cancelled'/'expired') на cancel/expiry/subscription.deleted; удаляется лишь в `deleteMyAccount` по user_id. Значит переживает и подписку, и трип. SET NULL сохраняет stripe_subscription_id/user_id/суммы/status, теряя лишь указатель на удалённый трип.

ВАЖНО: «блокировать удаление пока подписка активна» — НЕ решение: после отмены строка остаётся (status cancelled), NO ACTION так же блокирует. Связано с [[triplanio-stripe-integration]], [[triplanio-pro-model]].

Открытый момент (не критично для удаления): при удалении трипа с АКТИВНОЙ подпиской сама Stripe-подписка не отменяется автоматически — это отдельная задача (отмена в Stripe + понимание, что делать с подпиской, привязанной к удалённому трипу).
