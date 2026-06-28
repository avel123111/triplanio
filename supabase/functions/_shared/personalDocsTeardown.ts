/**
 * personalDocsTeardown — ЕДИНЫЙ источник правды для зачистки ЛИЧНЫХ документов
 * (`trip_documents.visibility = 'private'`): строки в БД + файлы в Storage.
 *
 * Зовётся из двух мест, чтобы поведение никогда не разъезжалось:
 *   - removeTripMember — участник вышел сам (M2) или его удалил админ (M3):
 *     уходящий теряет доступ и больше не может удалить свои личные доки сам,
 *     поэтому сервер чистит их за него (purgePrivateDocsForMember).
 *   - deleteMyAccount — удаление аккаунта: личные доки чистятся по ВСЕМ трипам.
 *     Строки удаляет RPC anonymize_my_account (у него НЕТ доступа к Storage),
 *     а файлы — edge: collectPrivateDocFiles ДО RPC + purgeCollectedDocFiles ПОСЛЕ.
 *
 * Что НЕ трогаем: shared-документы (общий контент трипа, остаётся со снапшотом
 * created_by_name) и файлы, прикреплённые к сущностям маршрута.
 *
 * Storage-guard (Вариант A): файл удаляется только если на его storage_path не
 * ссылается ни одна ВЫЖИВШАЯ строка trip_documents (в затронутых трипах). При
 * схеме «uuid на каждый аплоад» пересечений почти не бывает, но guard даёт
 * абсолютную гарантию, что мы не осиротим чужую/общую ссылку.
 *
 * Все шаги Storage — best-effort: осиротевший файл НИКОГДА не должен блокировать
 * выход из трипа или удаление аккаунта (подметётся при удалении трипа). Источник
 * истины — удаление строк.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const BUCKET = 'trips';

interface DocRow {
  id: string;
  documents: Array<{ storage_path?: string | null; file_url?: string | null }> | null;
  file_url: string | null;
}

/**
 * Recover a `trips`-bucket object key from a Supabase Storage object URL
 * (signed / public / authenticated). Returns null for non-storage or non-`trips`
 * URLs. Used to best-effort reclaim legacy rows whose only file lives in the
 * top-level `file_url` with no `documents[].storage_path` (risk #3: old base44
 * URLs won't match → such a file is left for the trip-level purge).
 */
function parseTripsPath(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/object\/(?:sign|public|authenticated)\/trips\/([^?]+)/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

/** All `trips`-bucket object keys referenced by one trip_documents row. */
function docStoragePaths(row: DocRow): string[] {
  const out: string[] = [];
  const docs = Array.isArray(row.documents) ? row.documents : [];
  for (const d of docs) {
    if (d && typeof d.storage_path === 'string' && d.storage_path) out.push(d.storage_path);
  }
  const legacy = parseTripsPath(row.file_url);
  if (legacy) out.push(legacy);
  return out;
}

/**
 * Storage-guard: the set of object keys still referenced by trip_documents rows
 * OTHER than the ones being removed (`excludeIds`), scoped to the affected trips.
 */
async function referencedPaths(
  admin: SupabaseClient,
  opts: { tripIds: string[]; excludeIds: string[] },
): Promise<Set<string>> {
  const set = new Set<string>();
  if (!opts.tripIds.length) return set;
  const { data, error } = await admin
    .from('trip_documents')
    .select('id, documents, file_url')
    .in('trip_id', opts.tripIds);
  if (error) { console.error('personalDocsTeardown: referencedPaths failed', error); return set; }
  const exclude = new Set(opts.excludeIds);
  for (const row of (data ?? []) as DocRow[]) {
    if (exclude.has(row.id)) continue;
    for (const p of docStoragePaths(row)) set.add(p);
  }
  return set;
}

/** Best-effort removal of object keys from the `trips` bucket (chunked). */
async function removeFiles(admin: SupabaseClient, paths: string[]): Promise<number> {
  const unique = [...new Set(paths)];
  if (!unique.length) return 0;
  let removed = 0;
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const { error } = await admin.storage.from(BUCKET).remove(chunk);
    if (error) console.error('personalDocsTeardown: remove failed', error);
    else removed += chunk.length;
  }
  return removed;
}

/**
 * removeTripMember path — purge a member's PRIVATE documents in ONE trip:
 * Storage files (guarded, best-effort) first, then the rows (source of truth).
 * Safe to call for both self-leave and admin-remove; no-op for offline members
 * (no user_id → no private docs).
 *
 * @returns counts of removed rows / files.
 */
export async function purgePrivateDocsForMember(
  admin: SupabaseClient,
  opts: { tripId: string; userId: string },
): Promise<{ rows: number; files: number }> {
  const { tripId, userId } = opts;
  if (!tripId || !userId) return { rows: 0, files: 0 };

  const { data, error } = await admin
    .from('trip_documents')
    .select('id, documents, file_url')
    .eq('trip_id', tripId)
    .eq('created_by', userId)
    .eq('visibility', 'private');
  if (error) { console.error('personalDocsTeardown: select (leave) failed', error); return { rows: 0, files: 0 }; }

  const docs = (data ?? []) as DocRow[];
  if (!docs.length) return { rows: 0, files: 0 };

  const docIds = docs.map((d) => d.id);
  const candidatePaths = docs.flatMap(docStoragePaths);

  const survivors = await referencedPaths(admin, { tripIds: [tripId], excludeIds: docIds });
  const toRemove = candidatePaths.filter((p) => !survivors.has(p));

  const files = await removeFiles(admin, toRemove);

  const { error: delErr } = await admin.from('trip_documents').delete().in('id', docIds);
  if (delErr) { console.error('personalDocsTeardown: delete rows (leave) failed', delErr); return { rows: 0, files }; }
  return { rows: docIds.length, files };
}

/**
 * deleteMyAccount — Step 1 (call BEFORE anonymize_my_account): collect the
 * Storage paths of the user's PRIVATE documents across ALL trips, plus the
 * affected trip ids and row ids. The RPC then deletes the rows (no Storage
 * access); the edge removes the files via {@link purgeCollectedDocFiles}.
 */
export async function collectPrivateDocFiles(
  admin: SupabaseClient,
  userId: string,
): Promise<{ paths: string[]; tripIds: string[]; docIds: string[] }> {
  if (!userId) return { paths: [], tripIds: [], docIds: [] };
  const { data, error } = await admin
    .from('trip_documents')
    .select('id, trip_id, documents, file_url')
    .eq('created_by', userId)
    .eq('visibility', 'private');
  if (error) { console.error('personalDocsTeardown: collect (account) failed', error); return { paths: [], tripIds: [], docIds: [] }; }
  const rows = (data ?? []) as Array<DocRow & { trip_id: string }>;
  return {
    paths: rows.flatMap(docStoragePaths),
    tripIds: [...new Set(rows.map((r) => r.trip_id))],
    docIds: rows.map((r) => r.id),
  };
}

/**
 * deleteMyAccount — Step 2 (call AFTER the RPC deleted the rows): best-effort
 * removal of the collected files that no surviving trip_documents row still
 * references (Storage-guard, Вариант A). Never throws — account deletion must
 * not fail over an orphan file.
 *
 * @returns number of removed files.
 */
export async function purgeCollectedDocFiles(
  admin: SupabaseClient,
  collected: { paths: string[]; tripIds: string[]; docIds: string[] },
): Promise<number> {
  if (!collected.paths.length) return 0;
  const survivors = await referencedPaths(admin, { tripIds: collected.tripIds, excludeIds: collected.docIds });
  const toRemove = collected.paths.filter((p) => !survivors.has(p));
  return removeFiles(admin, toRemove);
}
