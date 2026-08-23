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
 *
 * ★ РОЛЬ ЖИВЁТ В ТРЁХ МЕСТАХ — и все три СЕРВЕРНЫЕ. Меняешь одно — меняй все:
 *   1. CHECK `trip_members_role_check` — какие роли вообще бывают
 *   2. SQL  `_can_edit_trip`           — кого пускает RLS (бюджет, документы, контент)
 *   3. TS   `EDITOR_ROLES` (здесь)     — кого пускает edge (настройки, участники, каналы)
 * Пропустишь половину — половина экрана работает, половина отдаёт 403.
 *
 * Четвёртым местом был ФРОНТ: дословное зеркало этого списка в
 * `src/lib/tripStep.js` решало, кому рисовать кнопку. Зеркала больше нет —
 * ступень вызывающего уезжает клиенту ГОТОВОЙ (`getTripDetails.myStep`), фронт
 * её только сравнивает с планкой (`clearsStep`). Разъехаться с UI правило
 * теперь не может по построению, а не по договорённости.
 *
 * Расхождение (2)↔(3) ловит LIVE-ассерт `checkEditorRoles`
 * (scripts/ci/check-security-tiers.mjs, гард 2e): он сверяет ЖИВОЕ тело
 * `_can_edit_trip` с этим списком на КАЖДОМ выкате. Пары (1) в машине нет.
 * Порядок ЛЕСТНИЦЫ (её фронт ещё держит, чтобы сравнивать) сверяет
 * `src/lib/tripStep.test.js` — читает ЭТОТ файл как текст.
 */
export const EDITOR_ROLES = ['owner', 'admin'];

const LADDER: Record<Exclude<TripStep, null>, number> = { participant: 1, editor: 2, owner: 3 };

/**
 * Ступень по уже добытым фактам.
 *
 * `creatorId` — `trips.created_by`, либо null, если трипа нет.
 * `membership` — АКТИВНАЯ строка `trip_members` вызывающего, либо null, если
 * такой строки нет (pending/declined/offline сюда не попадают).
 *
 * ⚠ Членство передаётся ОБЪЕКТОМ, а не голой ролью, и это не украшательство:
 * `trip_members.role` — колонка БЕЗ `NOT NULL` (CHECK `role = ANY(...)` на NULL
 * не срабатывает, потому что NULL — не FALSE). Голая роль схлопывает два разных
 * факта в одно значение: «строки нет» и «строка есть, роль пустая». А
 * канонический SQL `is_trip_participant` смотрит ТОЛЬКО `status = 'active'` и
 * роль не читает вовсе — то есть активная строка с пустой ролью это участник.
 * Схлопни их — и TS-половина правила станет строже SQL-половины, а разойтись
 * они не имеют права: это одно правило на двух языках.
 */
export function stepFromFacts(
  creatorId: string | null,
  userId: string | null,
  membership: { role?: string | null } | null,
): TripStep {
  if (!creatorId || !userId) return null;
  // Владение — это `trips.created_by` и только оно. Залётная строка членства с
  // ролью 'owner' владением НЕ является: ниже она даёт `editor` (TRIP-143).
  if (creatorId === userId) return 'owner';
  if (!membership) return null;

  const role = membership.role ?? null;
  // Белый список: пустая и незнакомая роль дают участие, но не редактора —
  // ровно так ведёт себя SQL `_can_edit_trip`.
  return role !== null && EDITOR_ROLES.includes(role) ? 'editor' : 'participant';
}

/** Перекрывает ли `step` планку `required`. null не перекрывает ничего. */
export function clearsStep(step: TripStep, required: Exclude<TripStep, null>): boolean {
  return step !== null && LADDER[step] >= LADDER[required];
}
