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
// Returns { name, email, photo, deleted } — the exact shape <Avatar> + name
// labels consume across screens. `photo` is null whenever we only have a name,
// so the Avatar component renders initials over a deterministic gradient.
// `email` is the address to print UNDER the name, already blanked when there
// is nothing extra to say (see identity() below).
// Relative, not '@/lib/…': this module is unit-tested and `node --test` does
// not resolve the Vite alias (same convention as geo.js → ./geo-cities.js).
import { displayName } from './displayName.js';

/**
 * Same resolution for a list of PARTICIPANT rows (member list, avatar stacks).
 * Returns rows shaped for <Avatar> / <AvatarStack> with the membership fields
 * kept. Replaces the per-screen `nameFor` helpers, which reimplemented a subset
 * of the order below and so lost authors who had left the trip.
 */
export function resolveMembers(members, { profiles, selfUser, deletedLabel } = {}) {
  return (members || []).map((m) => ({
    id: m.id,
    role: m.role,
    ...resolveAuthor({
      userId: m.user_id,
      nameSnapshot: m.user_full_name,
      member: m,
      profiles,
      selfUser,
      deletedLabel,
    }),
  }));
}

/** ⚠️ Аннотация обязательна: без неё TS выводит форму из ДЕСТРУКТУРИЗАЦИИ и
 *  делает каждое поле без дефолта ОБЯЗАТЕЛЬНЫМ, поэтому законный вызов без
 *  `member` (его передают только поверхности, у которых есть строка членства)
 *  краснел TS2345 на экране под `// @ts-check`. Тот же запечатанный набор, что
 *  у компонентов ДС, только у функции.
 *  @param {{ userId?: any, nameSnapshot?: any, member?: any, profiles?: any,
 *            members?: any, selfUser?: any, deletedLabel?: any, fallback?: string }} a */
export function resolveAuthor({
  userId,
  nameSnapshot,
  member,
  profiles,
  members,
  selfUser,
  deletedLabel,
  fallback = '?',
}) {
  // 1) Live profile — reflects the current name/photo, and the anonymized state.
  //    An anonymized account has no name and no address to show: the scrubbed
  //    columns must NOT fall through to a stale snapshot further down.
  const p = userId ? profiles?.[userId] : null;
  if (p?.is_deleted) return { name: deletedLabel || fallback, email: '', photo: null, deleted: true };

  // Membership row. Callers that ARE a member list hand theirs over directly
  // (`member`): an invite to an address with no account is written with
  // user_id: null, so there is no id to look it up BY, and searching `members`
  // would skip it and drop the row to `fallback`. Content callers (chat, docs)
  // only have an author id, so they still search.
  const m = member || (userId ? members?.find((mm) => mm.user_id === userId) : null);

  // The resolved identity. `email` is the address printed UNDER the name, and
  // it is only ever shown next to a REAL name: with nothing but an address,
  // displayName() has already turned it into the name, and printing it twice is
  // what every member screen used to guard by hand. The invite address wins —
  // it is what was actually invited.
  const identity = (name, hasRealName, photo) => ({
    name: name || fallback,
    email: hasRealName ? String(m?.invite_email || p?.email || '').trim() : '',
    photo: photo || null,
    deleted: false,
  });

  if (p && (p.full_name || p.avatar_url || p.email)) {
    return identity(displayName(p.email, p.full_name), !!p.full_name, p.avatar_url);
  }

  // 2) Name snapshot on the content row — survives the author leaving the trip.
  const snap = nameSnapshot && String(nameSnapshot).trim();
  if (snap) return identity(snap, true, null);

  // 3) Live membership snapshot — invited/offline authors without a users row.
  if (m && (m.user_full_name || m.invite_email)) {
    return identity(displayName(m.invite_email, m.user_full_name), !!m.user_full_name, null);
  }

  // 4) The viewer's own content — safe to attribute to self, never to others.
  if (userId && selfUser?.id && userId === selfUser.id) {
    return identity(displayName(selfUser.email, selfUser.full_name), !!selfUser.full_name, selfUser.avatar_url);
  }

  // 5) Nothing resolvable.
  return { name: fallback, email: '', photo: null, deleted: false };
}
