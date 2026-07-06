// Trip-member helpers shared across the header, budget split, overview, chat
// and the members screen.
//
// withOwnerRow — the single source of the "owner" rule. The trip creator is the
// owner via trips.created_by and is NEVER a real trip_members row (create_trip
// writes none). A stray member row for the creator (e.g. invited + accepted
// before the server guard existed) must NOT shadow the owner: drop it, then
// prepend ONE synthetic owner row. Every surface that lists members routes
// through this so the owner can't be shown as a viewer and the rule can't drift
// between surfaces (TRIP-143).
export function withOwnerRow(members = [], ownerId = '', owner = {}) {
  const rest = (members || []).filter((m) => !ownerId || m.user_id !== ownerId);
  if (ownerId && !rest.some((m) => m.role === 'owner')) {
    rest.unshift({
      id: '__owner__',
      user_id: ownerId,
      role: 'owner',
      status: 'active',
      ...owner,
    });
  }
  return rest;
}

// resolveMyRole — the current user's effective role in a trip ('owner' | 'admin'
// | 'viewer'). trips.created_by is the SOLE source of ownership and ALWAYS wins
// over any trip_members row: a stray member row for the creator must never
// demote them (this is what showed the owner as a viewer and blocked /edit with
// "no access"). Mirrors the precedence in useTripAccess.js. Single source so the
// trip view and the structure editor can't drift (TRIP-143).
export function resolveMyRole(members = [], trip = null, user = null) {
  if (trip?.created_by && user?.id && trip.created_by === user.id) return 'owner';
  const mine = (members || []).find((m) => m.user_id === user?.id);
  return mine?.role || 'viewer';
}

// roleCanEdit — the SINGLE frontend edit-permission rule, mirroring the backend
// whitelist `_can_edit_trip` (owner via trips.created_by, OR a member whose role
// is not 'viewer'). Takes an already-resolved role (see resolveMyRole). EVERY
// surface that gates create/edit/delete of trip content (event view/edit,
// budget system-expense edit, structure editor, header edit/share/members
// affordances) MUST route through this instead of re-deriving `role !== 'viewer'`
// / `role === 'admin'` / hardcoding `true`, so the UI can't drift from the server
// (which returns 403 on mismatch). (TRIP-195)
export function roleCanEdit(role) {
  return !!role && role !== 'viewer';
}

// countTripMembers — how many people are actually "on" a trip, for the
// "N members" subtitle and the per-person budget split. It counts:
//   • the trip OWNER (always, even when they have no trip_members row —
//     ownership is tracked on trips.created_by),
//   • accepted members (status 'active', i.e. admins + viewers),
//   • offline placeholders (status 'offline').
// It excludes pending and declined invites (they aren't on the trip yet).
//
// Routes through withOwnerRow so the count and the people lists never disagree.
export function countTripMembers(members = [], ownerId = '') {
  const counted = (members || []).filter(
    (m) => m.status === 'active' || m.status === 'offline',
  );
  return withOwnerRow(counted, ownerId).length;
}
