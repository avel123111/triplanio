// Trip-member helpers shared across the header, budget split, overview, chat
// and the members screen.
//
// sortMembers — the single ordering rule for every people list: owner first,
// then active admins, then other active members, then offline placeholders,
// then pending invites (declined last). The trip owner is now a real
// trip_members row (`role='owner'`, TRIP-516), so no synthesis or dedup is
// needed — the owner arrives in the list like anyone else and this only orders
// it. Stable within a rank (keeps the server's order). Every surface that lists
// members routes through this so the order can't drift between screens.
export function sortMembers(members = []) {
  const rank = (m) => {
    if (m.role === 'owner') return 0;
    if (m.status === 'pending') return 4;
    if (m.status === 'offline') return 3;
    if (m.role === 'admin') return 1;
    return 2; // active viewer / editor
  };
  return (members || [])
    .map((m, i) => ({ m, i }))
    .sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i)
    .map((x) => x.m);
}

// resolveMyRole — the current user's effective role in a trip ('owner' | 'admin'
// | 'viewer'). trips.created_by is the SOLE source of ownership and ALWAYS wins
// over any trip_members row: a stray member row for the creator must never
// demote them (this is what showed the owner as a viewer and blocked /edit with
// "no access"). Single source of role precedence so the trip view and the
// structure editor can't drift (TRIP-143).
export function resolveMyRole(members = [], trip = null, user = null) {
  if (trip?.created_by && user?.id && trip.created_by === user.id) return 'owner';
  const mine = (members || []).find((m) => m.user_id === user?.id);
  return mine?.role || 'viewer';
}

// Право «может редактировать» и «может делиться» больше НЕ живёт здесь: оно
// сведено в единую лестницу доступа `src/lib/tripStep.js` (зеркало сервера) —
// affordance объявляет ступень через `clearsStep(step, 'editor' | 'participant'
// | 'owner')`, а не булевой по роли. `resolveMyRole` выше остаётся только для
// ПОКАЗА имени роли (ярлык, аналитика), правами не рулит. (TRIP-274 Ф2.1)

// countTripMembers — how many people are actually "on" a trip, for the
// "N members" subtitle and the per-person budget split. Counts accepted members
// (status 'active', i.e. the owner + admins + viewers) and offline placeholders
// (status 'offline'); excludes pending and declined invites. The owner is a real
// active trip_members row (TRIP-516), so it is counted here like anyone else.
export function countTripMembers(members = []) {
  return (members || []).filter(
    (m) => m.status === 'active' || m.status === 'offline',
  ).length;
}
