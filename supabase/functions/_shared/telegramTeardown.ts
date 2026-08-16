/**
 * telegramTeardown — ЕДИНЫЙ источник правды для отвязки Telegram у трипа.
 *
 * Используется пользовательским telegramDisconnect (ручная отвязка), системным
 * откатом Pro (revokeLostProFeatures) и afterWrite-эффектами (выход/удаление
 * участника, выключение аддона telegram_assistant). ВСЯ логика teardown живёт
 * здесь — включая ПРОЩАЛЬНЫЙ emit: сняли привязку → по каждому снятому чату шлём
 * external-only `trip_telegram_unlinked` (n8n доставит сообщение в чат). Emit
 * стоит ОДИН раз тут → срабатывает из всех точек входа, вызыватели не
 * разъезжаются.
 *
 * Намеренно НЕ покрывает destroy-кейсы: удаление трипа (FK ON DELETE CASCADE
 * снимает строки на уровне БД — до этого шва по строкам не доходит) и удаление
 * аккаунта (атомарный SQL `anonymize_my_account`). Привязка там тоже уходит, но
 * прощального сообщения нет намеренно — трипа/аккаунта уже не существует.
 *
 * ⚠️ Из-за emit модуль тянет `emit.ts` → `sentry`/`analytics`, читающие `Deno.env`
 * на загрузке. Значит он env-coupled (как `mutateEffects.ts`) и НЕ импортируется
 * из чистых `deno test` без `--allow-env` — юнит-тест скоупинга держать на чистом
 * хелпере, не на этом файле.
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
import { notify } from './emit.ts';

export async function disconnectTripTelegram(
  admin: SupabaseClient,
  opts: { tripId: string; integrationId?: string; userId?: string },
): Promise<number> {
  const { tripId, integrationId, userId } = opts;
  if (!tripId) return 0;

  let q = admin.from('trip_telegram_integrations').delete().eq('trip_id', tripId);
  if (integrationId) q = q.eq('id', integrationId);
  if (userId) q = q.eq('user_id', userId);

  // Забираем telegram_chat_id снятых строк — по нему адресуется прощальный emit.
  const { data, error } = await q.select('telegram_chat_id');
  if (error) throw error;

  const removed = data ?? [];
  const chatIds = removed
    .map((r) => (r as { telegram_chat_id?: unknown }).telegram_chat_id)
    .filter((id): id is string => typeof id === 'string' && !!id);

  if (chatIds.length) {
    // Трип читаем ОДИН раз и отдаём резолверу снимком (иначе каждый notify
    // перечитывал бы ту же строку). external-only trip_telegram_unlinked: notify
    // fail-open (сам ловит сбои) — прощальное сообщение не роняет ни teardown, ни
    // действие вызывателя. Чаты независимы → шлём параллельно.
    const { data: trip } = await admin.from('trips').select('*').eq('id', tripId).maybeSingle();
    await Promise.all(chatIds.map((chatId) =>
      notify('trip_telegram_unlinked', { trip_id: tripId, chat_id: chatId }, { db: admin, snapshot: trip ?? undefined })
    ));
  }
  return removed.length;
}
