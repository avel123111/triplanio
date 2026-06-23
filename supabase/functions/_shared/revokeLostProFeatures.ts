/**
 * revokeLostProFeatures — когда трип теряет Pro, гасим его Pro-аддоны и сносим
 * живые Telegram-привязки.
 *
 * Разделение труда:
 *   • флип флагов addons.budget/chat/telegram_assistant → чистая дата-часть в SQL
 *     (revoke_*_pro_addons, 0061), гейт per-trip на NOT is_trip_pro;
 *   • Telegram teardown → единственный side-effect, через единый источник
 *     (disconnectTripTelegram), чтобы будущая логика (групповые чаты, Telegram API)
 *     жила в одном месте.
 *
 * Безопасно звать БЕЗУСЛОВНО после любого recompute: SQL no-op'ит трипы, которые
 * остались Pro (NOT is_trip_pro = false), и возвращает только реально погашенные —
 * по ним и идёт teardown. Teardown идемпотентен (удалит 0 строк, если привязок нет).
 *
 * Best-effort: ошибки логируются, но НЕ бросаются — откат не должен валить
 * энтайтлмент-запись webhook'а (иначе Stripe ретраит) или reconcile-on-read.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { disconnectTripTelegram } from './telegramTeardown.ts';

type TripRow = { trip_id?: string };

async function tearDownTelegram(admin: SupabaseClient, rows: TripRow[] | null) {
  for (const r of rows ?? []) {
    const tripId = r?.trip_id;
    if (!tripId) continue;
    try {
      await disconnectTripTelegram(admin, { tripId });
    } catch (e) {
      console.error('revokeLostProFeatures: tg teardown failed', tripId, (e as Error).message);
    }
  }
}

// Путь потери подписки: одна подписка кроет все «обычные» трипы владельца (fan-out).
export async function revokeLostProFeaturesForUser(
  admin: SupabaseClient,
  userId: string | null | undefined,
): Promise<void> {
  if (!userId) return;
  const { data, error } = await admin.rpc('revoke_user_pro_addons', { p_user_id: userId });
  if (error) {
    console.error('revoke_user_pro_addons failed', userId, error.message);
    return;
  }
  await tearDownTelegram(admin, data as TripRow[] | null);
}

// Путь возврата pro_trip: один трип (is_pro_trip уже снят вызывающим).
export async function revokeLostProFeaturesForTrip(
  admin: SupabaseClient,
  tripId: string | null | undefined,
): Promise<void> {
  if (!tripId) return;
  const { data, error } = await admin.rpc('revoke_trip_pro_addons', { p_trip_id: tripId });
  if (error) {
    console.error('revoke_trip_pro_addons failed', tripId, error.message);
    return;
  }
  await tearDownTelegram(admin, data as TripRow[] | null);
}
