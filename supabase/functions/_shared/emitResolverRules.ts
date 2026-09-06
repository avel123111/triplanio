/**
 * ЧИСТЫЙ РЕШАТЕЛЬ АУДИТОРИИ резолверов `emit` (TRIP-417). Вынесен из
 * `emitResolvers.ts` (I/O: читает БД) РОВНО чтобы решение «кому адресовано
 * событие» пинилось тестом в env-free `deno test` — тот же раскол, что
 * `memberEffectRules.ts` ↔ `mutateEffects.ts`. Здесь — только сведение id к
 * получателям; сам `select` строк (и ВЫБОР, какие строки грузить под событие)
 * остаётся в I/O-половине.
 *
 * TRIP-517: владелец — обычная активная строка `trip_members` (`role='owner'`),
 * поэтому аудитория целиком приходит строками членства, а не «владелец
 * (`created_by`) ∪ участники». `booking_added` грузит всех активных участников
 * (владелец среди них), `trip_member_left` — активных owner+admin. Отдельной
 * инъекции владельца больше нет, поэтому и двух почти одинаковых решателей
 * (`bookingAddedRecipientIds`/`memberLeftRecipientIds`) больше нет — остался один.
 */

/**
 * Свести id-список к получателям inapp-события: только строки, дедуп, БЕЗ самого
 * актора (автор брони / ушедший участник — слать ему нечего), порядок стабилен
 * (сохраняет порядок входа) — чтобы тест был детерминирован.
 */
export function recipientsExcept(userIds: unknown[], actorId: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of userIds) {
    if (typeof id !== 'string' || !id) continue;
    if (id === actorId || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
