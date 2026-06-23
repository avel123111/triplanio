/**
 * telegramTeardown — ЕДИНЫЙ источник правды для отвязки Telegram у трипа.
 *
 * Используется и пользовательским telegramDisconnect (отвязать одну привязку
 * вручную), и системным путём отката Pro (revokeLostProFeatures). ВСЯ логика
 * teardown живёт здесь — будущие шаги (групповые чаты, вызовы Telegram API,
 * прощальное сообщение, снятие бота из группы) добавляются в одном месте, чтобы
 * вызыватели никогда не разъезжались.
 *
 * Идентичность привязки = (trip_id, telegram_chat_id); user_id — только «кто
 * привязал». Удаление скоупится по trip_id, поэтому общий чат, привязанный к
 * нескольким трипам, сохраняет остальные привязки. Это та же DELETE-семантика,
 * что у telegramDisconnect исторически.
 *
 * Опционально удаление можно сузить:
 *   - integrationId — снять одну конкретную привязку (ручной telegramDisconnect);
 *   - userId — снять только привязки, сделанные этим пользователем в трипе
 *     (выход участника: removeTripMember отзывает доступ только уходящего,
 *     не трогая привязки остальных).
 *
 * @returns число удалённых привязок.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export async function disconnectTripTelegram(
  admin: SupabaseClient,
  opts: { tripId: string; integrationId?: string; userId?: string },
): Promise<number> {
  const { tripId, integrationId, userId } = opts;
  if (!tripId) return 0;

  let q = admin.from('trip_telegram_integrations').delete().eq('trip_id', tripId);
  if (integrationId) q = q.eq('id', integrationId);
  if (userId) q = q.eq('user_id', userId);

  const { data, error } = await q.select('id');
  if (error) throw error;
  return (data ?? []).length;
}
