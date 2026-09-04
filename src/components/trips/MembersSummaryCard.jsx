import React, { useMemo } from 'react';
import { Icon } from '@/design/icons';
import { Person, Badge, Btn, IconBtn, RoleBadge, Skeleton } from '@/design/index';
import { useI18n } from '@/lib/i18n/I18nContext';
import { resolveAuthor } from '@/lib/resolveAuthor';
import { withOwnerRow } from '@/lib/members';

// "Who's going" widget on the trip Overview (Lumo .wdg + .mrow). Owns the
// member ordering.
//
// `profiles` (id → { full_name, avatar_url, … }) is passed in rather than
// fetched here: it ships with the trip content so names land together with the
// rows instead of trickling in (TRIP-230, see getTripDetails).
//
// Ordering: owner first, then admins, viewers, offline, pending. The owner is
// often tracked via trip.created_by rather than a trip_members row, so it's
// synthesized when missing.
export default function MembersSummaryCard({
  trip,
  members = [],
  profiles = {},
  user,
  canManage = false,
  isLoading = false,
  onOpenMembers,
  onInvite,
}) {
  const { t } = useI18n();

  const orderedMembers = useMemo(() => {
    const ownerId = trip?.created_by || user?.id || '';
    const isMeOwner = !!user?.id && ownerId === user.id;
    // Shared owner rule: drop any stray creator row and prepend one owner so the
    // creator is never shown as a viewer in this widget (TRIP-143).
    const all = withOwnerRow(
      members.filter((m) => m.status !== 'declined'),
      ownerId,
      { user_full_name: isMeOwner ? user?.full_name || '' : '' },
    );
    const rank = (m) => {
      if (m.role === 'owner') return 0;
      // 'invited' is not a status: trip_members_status_check allows exactly
      // pending / active / declined / offline.
      if (m.status === 'pending') return 4;
      if (m.status === 'offline') return 3;
      if (m.role === 'admin') return 1;
      return 2; // viewer / editor
    };
    return all
      .map((m, i) => ({ m, i }))
      .sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i)
      .map((x) => x.m);
  }, [members, trip?.created_by, user?.id, user?.full_name]);

  return (
    <section className="ovsec">
      <div className="ovsec__h">
        <h3 className="t-heading">{t('trip.who_goes')}</h3>
        {canManage && (
          <IconBtn
            icon="chev"
            tone="outline"
            size="sm"
            onClick={onOpenMembers}
            title={t('trip.open_members')}
            ariaLabel={t('trip.open_members')}
          />
        )}
      </div>

      <div>
        {isLoading ? (
          <div className="col col--g4">
            {[0, 1, 2].map((i) => (
              <div className="mrow" key={i}>
                <Skeleton w={34} h={34} r="50%" style={{ flex: 'none' }} />
                <div className="fl1">
                  <Skeleton w="55%" h={13} r={5} />
                  <Skeleton w="40%" h={11} r={5} style={{ marginTop: 6 }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
        <div className="col col--g4">
          {orderedMembers.map((m, i) => {
            // Same SHARED resolver as the members screen and chat: its own copy
            // of the ladder reproduced the bare "-" for an invited member who
            // had deleted their account (TRIP-334).
            const who = resolveAuthor({
              userId: m.user_id,
              nameSnapshot: m.user_full_name,
              member: m,
              profiles,
              selfUser: user,
              deletedLabel: t('common.deleted_user'),
              fallback: t('common.deleted_user'),
            });
            const isOffline = m.status === 'offline';
            const isPending = m.status === 'pending';

            return (
              <Person
                key={m.id || i}
                // Pending invites keep the initials placeholder (no gradient); the
                // identity is otherwise the shared resolver's, colour seed and all.
                who={isPending ? { ...who, kind: 'placeholder' } : who}
                // Line under the name: the invite state when pending; otherwise
                // Person falls back to who.email (the address the resolver already
                // decided is worth showing) — the sub decision lives in one place.
                sub={isPending ? t('trip.member_pending') : undefined}
                style={{ opacity: isPending || isOffline ? 0.7 : 1 }}
                // Invite STATE (pending/offline) is not a role — it keeps the quiet
                // status chip; an actual role goes through the shared RoleBadge.
                trailing={isPending || isOffline
                  ? <Badge variant="quiet" size="tiny">{isPending ? t('trip.member_pending') : t('trip.member_offline')}</Badge>
                  : <RoleBadge role={m.role} />}
              />
            );
          })}
        </div>
        )}

        {/* Не залитая плашка: «Пригласить» — не главное предложение экрана, а одно
            из действий раздела, и в ряду трёх сводок залитый блок был самым
            тяжёлым пятном нижней половины. */}
        {!isLoading && canManage && (
          <Btn variant="secondary" block className="ov-invite" onClick={onInvite || onOpenMembers}>
            <Icon name="plus" size={15} />
            {t('members.invite')}
          </Btn>
        )}
      </div>
    </section>
  );
}
