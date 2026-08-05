/**
 * ПРАВИЛО «кто на какой ступени стоит в трипе» — чистое, без единого импорта.
 *
 * Модуль намеренно держится import-free: `deno test` запускается без
 * `--allow-env`, а `_shared/supabaseAdmin.ts` читает переменные окружения ПРЯМО
 * на загрузке модуля. Правило, лежащее рядом с клиентом БД, невозможно
 * подгрузить из теста — он падает на `NotCapable: Requires env access` ещё до
 * первого ассерта. Та же конвенция, по которой import-free держатся
 * `_shared/profiles.ts` (он и клиент принимает параметром) и `src/lib/trip-cities.js`.
 *
 * I/O-половина живёт в `tripAccess.ts`: она достаёт факты и отдаёт их сюда.
 *
 * Лестница строго вложена: owner ⊃ editor ⊃ participant.
 *   participant — видеть трип, писать в чат, публичная ссылка, копия к себе
 *   editor      — эвенты, сервисы, города, бюджет, документы и байты,
 *                 настройки, участники (≡ SQL `_can_edit_trip`)
 *   owner       — удалить трип, биллинг (≡ `trips.created_by`)
 */

/** Ступень вызывающего, либо null — «не на трипе вовсе». */
export type TripStep = 'owner' | 'editor' | 'participant' | null;

/**
 * Роли, дающие ступень `editor`. БЕЛЫЙ СПИСОК: незнакомая или пустая роль
 * обязана провалиться в «нельзя», а не в «можно». Ровно так ведёт себя SQL
 * `_can_edit_trip` с TRIP-120; расхождение сделало бы две серверные половины
 * одного правила разными, и увидеть это можно было бы только на проде —
 * обе двери молчат, просто пускают разных людей.
 */
export const EDITOR_ROLES = ['owner', 'admin'];

const LADDER: Record<Exclude<TripStep, null>, number> = { participant: 1, editor: 2, owner: 3 };

/**
 * Ступень по уже добытым фактам.
 *
 * `creatorId` — `trips.created_by`, либо null, если трипа нет.
 * `activeRole` — роль АКТИВНОЙ строки `trip_members` вызывающего, либо null,
 * если такой строки нет (статусы pending/declined/offline сюда не попадают).
 */
export function stepFromFacts(
  creatorId: string | null,
  userId: string | null,
  activeRole: string | null,
): TripStep {
  if (!creatorId || !userId) return null;
  // Владение — это `trips.created_by` и только оно. Залётная строка членства с
  // ролью 'owner' владением НЕ является: ниже она даёт `editor` (TRIP-143).
  if (creatorId === userId) return 'owner';
  if (activeRole === null) return null;
  return EDITOR_ROLES.includes(activeRole) ? 'editor' : 'participant';
}

/** Перекрывает ли `step` планку `required`. null не перекрывает ничего. */
export function clearsStep(step: TripStep, required: Exclude<TripStep, null>): boolean {
  return step !== null && LADDER[step] >= LADDER[required];
}
