// Unified author identity for trip CONTENT (chat messages, documents, …).
//
// Why this exists: a trip's content outlives its authors. When a member leaves
// the trip their `trip_members` row is hard-deleted, so the live profile
// resolver (resolveProfiles / get_trip_participant_profiles, both scoped to
// active participants) no longer returns them — their past messages/docs would
// otherwise fall back to "?" with a blank avatar.
//
// The cheap fix, shared by chat and docs: every content row carries a
// denormalized author-name snapshot taken at creation time
// (chat_messages.user_full_name, trip_documents.created_by_name). We resolve in
// the cheapest-correct order:
//   1) live profile       — active member or soft-deleted account (name + avatar)
//   2) name snapshot       — author who has since left the trip (name persists;
//                            avatar gracefully degrades to initials/gradient)
//   3) membership snapshot — invited/offline authors with no users row
//   4) the viewer themselves
//   5) generic fallback
//
// Returns { name, photo, deleted } — the exact shape <Avatar> + name labels
// consume across screens. `photo` is null whenever we only have a name, so the
// Avatar component renders initials over a deterministic gradient.
import { displayName } from '@/lib/displayName';

export function resolveAuthor({
  userId,
  nameSnapshot,
  profiles,
  members,
  selfUser,
  deletedLabel,
  fallback = '?',
}) {
  // 1) Live profile — reflects the current name/photo, and the anonymized state.
  const p = userId ? profiles?.[userId] : null;
  if (p?.is_deleted) return { name: deletedLabel || fallback, photo: null, deleted: true };
  if (p && (p.full_name || p.avatar_url)) {
    return { name: p.full_name || fallback, photo: p.avatar_url || null, deleted: false };
  }

  // 2) Name snapshot on the content row — survives the author leaving the trip.
  const snap = nameSnapshot && String(nameSnapshot).trim();
  if (snap) return { name: snap, photo: null, deleted: false };

  // 3) Live membership snapshot — invited/offline authors without a users row.
  const m = userId ? members?.find((mm) => mm.user_id === userId) : null;
  if (m && (m.user_full_name || m.invite_email)) {
    return { name: displayName(m.invite_email, m.user_full_name), photo: null, deleted: false };
  }

  // 4) The viewer's own content — safe to attribute to self, never to others.
  if (userId && selfUser?.id && userId === selfUser.id) {
    return { name: selfUser.full_name || fallback, photo: selfUser.avatar_url || null, deleted: false };
  }

  // 5) Nothing resolvable.
  return { name: fallback, photo: null, deleted: false };
}
