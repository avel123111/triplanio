// Trip-member helpers shared across the header, budget split and overview.
//
// countTripMembers — how many people are actually "on" a trip, for the
// "N members" subtitle and the per-person budget split. It counts:
//   • the trip OWNER (always, even when they have no trip_members row —
//     ownership is tracked on trips.created_by, see lib/chat.js),
//   • accepted members (status 'active', i.e. admins + viewers),
//   • offline placeholders (status 'offline').
// It excludes pending and declined invites (they aren't on the trip yet).
//
// Mirrors the owner-synthesis used by chatParticipants() so the count and the
// people lists never disagree.
export function countTripMembers(members = [], ownerId = '') {
  const counted = (members || []).filter(
    (m) => m.status === 'active' || m.status === 'offline',
  );
  const ownerCounted =
    !!ownerId && counted.some((m) => m.role === 'owner' || m.user_id === ownerId);
  return counted.length + (ownerId && !ownerCounted ? 1 : 0);
}
