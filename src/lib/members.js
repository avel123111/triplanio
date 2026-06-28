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
