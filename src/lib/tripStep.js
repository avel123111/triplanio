// ЛЕСТНИЦА ДОСТУПА НА ФРОНТЕ — зеркало серверного правила.
//
// На бэке «кто на какой ступени стоит в трипе» живёт в
// `supabase/functions/_shared/tripStep.ts` (шов TRIP-274). Граница рантаймов не
// даёт импортировать его в `src/` напрямую, поэтому здесь — ДОСЛОВНАЯ копия
// правила, а паритет держит тест (`tripStep.test.js` читает серверный файл как
// ТЕКСТ и сверяет `EDITOR_ROLES` и лестницу). Тот же приём, что у
// `viralLink.js ↔ _shared/viralLink.ts`. Модуль import-free намеренно — как и
// серверный: правило доступа не должно тянуть за собой ничего.
//
// Лестница строго вложена: owner ⊃ editor ⊃ participant.
//   participant — видеть трип, писать в чат, публичная ссылка, копия к себе
//   editor      — эвенты, сервисы, города, бюджет, документы, настройки,
//                 участники (≡ SQL `_can_edit_trip`, ≡ TS `EDITOR_ROLES`)
//   owner       — удалить трип, биллинг (≡ `trips.created_by`)
//
// КАЖДЫЙ affordance на фронте объявляет СВОЮ ступень через `clearsStep`, а не
// выводит право руками (`role !== 'viewer'` / `=== 'admin'` / `=== 'owner'`).
// Это единственный словарь прав, общий с сервером — так UI не разъедется с тем,
// что реально пустит edge (иначе 403 при нарисованной кнопке).
//
// ★ РОЛЬ ЖИВЁТ В ЧЕТЫРЁХ МЕСТАХ (см. шапку серверного `tripStep.ts`):
//   1. CHECK `trip_members_role_check` — какие роли вообще бывают
//   2. SQL  `_can_edit_trip`           — кого пускает RLS/secdef
//   3. TS   `EDITOR_ROLES` (сервер)    — кого пускает edge
//   4. FE   `EDITOR_ROLES` (здесь)     — кому рисуются кнопки
// Меняешь одно — меняй все. Пары (2)↔(3) сверяет LIVE-ассерт `checkEditorRoles`;
// пару (3)↔(4) сверяет `tripStep.test.js` по тексту серверного файла.

/** Роли, дающие ступень `editor`. Белый список: пустая/незнакомая роль → participant. */
export const EDITOR_ROLES = ['owner', 'admin'];

const LADDER = { participant: 1, editor: 2, owner: 3 };

/**
 * Ступень по уже добытым фактам — дословно как серверный `stepFromFacts`.
 *
 * @param {string|null} creatorId  `trips.created_by`, либо null если трипа нет
 * @param {string|null} userId     id текущего пользователя
 * @param {{role?: string|null}|null} membership  АКТИВНАЯ строка членства, либо null
 * @returns {'owner'|'editor'|'participant'|null}
 */
export function stepFromFacts(creatorId, userId, membership) {
  if (!creatorId || !userId) return null;
  // Владение — это `trips.created_by` и только оно. Залётная строка членства с
  // ролью 'owner' владением НЕ является: ниже она даёт `editor` (TRIP-143).
  if (creatorId === userId) return 'owner';
  if (!membership) return null;
  const role = membership.role ?? null;
  return role !== null && EDITOR_ROLES.includes(role) ? 'editor' : 'participant';
}

/**
 * Ступень текущего пользователя на трипе. Единственный резолвер для гейтов UI.
 * Владение — по `trips.created_by`; членство считается ТОЛЬКО активное
 * (`status === 'active'`), как канонический SQL `is_trip_participant` —
 * pending/declined/offline права не дают (fail-closed).
 *
 * @returns {'owner'|'editor'|'participant'|null}
 */
export function resolveMyStep(members = [], trip = null, user = null) {
  const creatorId = trip?.created_by || null;
  const userId = user?.id || null;
  const membership = (members || []).find(
    (m) => m.user_id === userId && m.status === 'active',
  ) || null;
  return stepFromFacts(creatorId, userId, membership);
}

/**
 * Перекрывает ли `step` планку `required`. null не перекрывает ничего
 * (fail-closed). Дословно как серверный `clearsStep`.
 *
 * @param {'owner'|'editor'|'participant'|null} step
 * @param {'owner'|'editor'|'participant'} required
 */
export function clearsStep(step, required) {
  return step != null && LADDER[step] >= LADDER[required];
}
