/**
 * ЧИСТЫЕ РЕШАТЕЛИ ПОБОЧЕК участников (TRIP-409). Вынесены из `mutateEffects.ts`
 * (I/O: emit/teardown) РОВНО чтобы решение «какое событие / нужен ли North-Star»
 * можно было запинить тестом: `mutateEffects.ts` тянет `emit`→`sentry`/`analytics`,
 * читающие `Deno.env` на загрузке, и в env-free `deno test` не грузится вовсе
 * (тот же раскол, что `mutateRules.ts` ↔ `mutate.ts`). Здесь — только решение,
 * САМ вызов emit/teardown остаётся в I/O-половине.
 */

/** По исходу RPC `respond_trip_invite` — что делает побочка. `markRead` НЕ здесь:
 *  он безусловен (приглашение отвечено → уведомление не висит), в т.ч. owner_stray. */
export function respondEffectPlan(outcome: unknown): {
  /** North-Star `trip_reached_2` — только при принятии (трип стал коллаборативным). */
  reached2: boolean;
  /** Событие пригласившему; null = не уведомлять (owner_stray/неизвестный исход). */
  emit: 'trip_member_joined' | 'trip_invite_declined' | null;
} {
  if (outcome === 'accepted') return { reached2: true, emit: 'trip_member_joined' };
  if (outcome === 'declined') return { reached2: false, emit: 'trip_invite_declined' };
  return { reached2: false, emit: null };
}

/** Уведомлять о смене роли — только при РЕАЛЬНОЙ смене и для юзера с аккаунтом
 *  (offline-участнику некуда слать). Сравнивает старую роль (loadedRow) с новой. */
export function roleChangeNotifies(beforeRole: unknown, afterRole: unknown, userId: unknown): boolean {
  return beforeRole !== afterRole && !!userId;
}
