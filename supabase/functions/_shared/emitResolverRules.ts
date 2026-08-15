/**
 * ЧИСТЫЕ РЕШАТЕЛИ АУДИТОРИИ резолверов `emit` (TRIP-417). Вынесены из
 * `emitResolvers.ts` (I/O: читает БД) РОВНО чтобы решение «кому адресовано
 * событие» пинилось тестом в env-free `deno test` — тот же раскол, что
 * `memberEffectRules.ts` ↔ `mutateEffects.ts`. Здесь — только выбор id, сам
 * `select` строк остаётся в I/O-половине.
 */

/**
 * `trip_member_left`: аудитория inapp = владелец трипа + активные админы, БЕЗ самого
 * ушедшего (его строка уже удалена, слать некуда), с дедупом и отбросом пустых.
 * Порядок стабилен (владелец первым) — чтобы тест был детерминирован.
 */
export function memberLeftRecipientIds(
  ownerId: unknown,
  adminUserIds: unknown[],
  leaverId: unknown,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [ownerId, ...adminUserIds]) {
    if (typeof id !== 'string' || !id) continue;
    if (id === leaverId || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
