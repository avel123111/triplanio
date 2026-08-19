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
  return audienceMinusActor([ownerId, ...adminUserIds], leaverId);
}

/**
 * `booking_added`: аудитория inapp = владелец трипа + ВСЕ активные участники (с
 * аккаунтом), БЕЗ самого автора брони. Зеркало SQL-триггера `notify_booking_added`
 * (active members ∪ owner − actor). Дедуп, отброс пустых, владелец первым —
 * детерминизм ради теста.
 */
export function bookingAddedRecipientIds(
  ownerId: unknown,
  activeMemberUserIds: unknown[],
  actorId: unknown,
): string[] {
  return audienceMinusActor([ownerId, ...activeMemberUserIds], actorId);
}

/** Свести id-список к получателям: строки, дедуп, порядок стабилен, минус актора. */
function audienceMinusActor(ids: unknown[], actorId: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== 'string' || !id) continue;
    if (id === actorId || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
