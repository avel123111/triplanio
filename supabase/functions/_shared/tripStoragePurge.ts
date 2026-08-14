/**
 * tripStoragePurge — ЕДИНЫЙ источник очистки Storage трипа (TRIP-416).
 *
 * Все файлы трипа лежат в приватном бакете `trips` под плоским префиксом
 * `<tripId>/<uid>-<file>` (обложка включительно), поэтому один проход по префиксу
 * `<tripId>/` снимает 100% файлов трипа — то, что FK-каскад достать не может.
 * Перенесён из `deleteTrip` (переиспользование, не копия): зовёт `afterWrite`
 * ресурса `trip-owner/delete` после удаления строки трипа.
 *
 * BEST-EFFORT: файл-сирота НИКОГДА не должен блокировать/ронять удаление —
 * ошибки логируются, не бросаются (удаление строки уже совершено, откатывать
 * нечего). `.from(BUCKET)` через ПЕРЕМЕННУЮ (не литерал) — вне счёта табло 2r.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const BUCKET = 'trips';

/** Смести всё под `${tripId}/` в бакете `trips`, постранично (best-effort). */
export async function purgeTripBucket(admin: SupabaseClient, tripId: string): Promise<void> {
  if (!tripId) return;
  const limit = 100;
  let offset = 0;
  for (;;) {
    const { data: files, error } = await admin.storage.from(BUCKET).list(tripId, { limit, offset });
    if (error) { console.error(`purgeTripBucket: list ${BUCKET}/${tripId} failed`, error); return; }
    if (!files?.length) return;
    const toRemove = files.filter((f) => f.name).map((f) => `${tripId}/${f.name}`);
    if (toRemove.length) {
      const { error: rmErr } = await admin.storage.from(BUCKET).remove(toRemove);
      if (rmErr) console.error(`purgeTripBucket: remove ${BUCKET}/${tripId} failed`, rmErr);
    }
    if (files.length < limit) return;
    offset += limit;
  }
}
