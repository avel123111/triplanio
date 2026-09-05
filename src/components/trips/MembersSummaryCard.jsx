import React, { useMemo } from 'react';
import { Icon } from '@/design/icons';
import { Person, Badge, Btn, Card, CardHeader, IconBtn, RoleBadge, Skeleton } from '@/design/index';
import { useI18n } from '@/lib/i18n/I18nContext';
import { resolveAuthor } from '@/lib/resolveAuthor';
import { sortMembers } from '@/lib/members';

// "Who's going" widget on the trip Overview (Lumo .wdg + .mrow). Owns the
// member ordering.
//
// `profiles` (id → { full_name, avatar_url, … }) is passed in rather than
// fetched here: it ships with the trip content so names land together with the
// rows instead of trickling in (TRIP-230, see getTripDetails).
//
// Ordering: owner first, then admins, viewers, offline, pending. The owner is
// a real trip_members row (`role='owner'`, TRIP-516/517), so it arrives in the
// list like anyone else and is only ordered here (see sortMembers).
export default function MembersSummaryCard({
  members = [],
  profiles = {},
  user,
  canManage = false,
  isLoading = false,
  onOpenMembers,
  onInvite,
}) {
  const { t } = useI18n();

  // Owner is a real trip_members row (TRIP-517); order via the shared rule
  // (owner → admin → active → offline → pending), dropping declined invites.
  const orderedMembers = useMemo(
    () => sortMembers(members.filter((m) => m.status !== 'declined')),
    [members],
  );

  if (isLoading) return <MembersSummarySkeleton />;

  return (
    <Card className="col col--g6">
      <CardHeader
        title={t('trip.who_goes')}
        action={canManage && (
          <IconBtn
            icon="chev"
            tone="outline"
            size="sm"
            onClick={onOpenMembers}
            title={t('trip.open_members')}
            ariaLabel={t('trip.open_members')}
          />
        )}
      />

      <div>
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

        {canManage && (
          <Btn variant="soft" block className="ov-invite" onClick={onInvite || onOpenMembers}>
            <Icon name="plus" size={15} />
            {t('members.invite')}
          </Btn>
        )}
      </div>
    </Card>
  );
}

// Тот же ряд, что рисует `<Person>` (`.mrow`: аватар · имя · значок роли), с
// заглушками вместо содержимого. Без хуков данных.
export function MembersSummarySkeleton() {
  const { t } = useI18n();
  return (
    <Card className="col col--g6" aria-busy="true">
      <CardHeader title={t('trip.who_goes')} action={<Skeleton w={32} h={32} r="var(--r-btn)" />} />
      <div className="col col--g4">
        {[0, 1, 2].map((i) => (
          <div className="mrow" key={i}>
            <Skeleton w={28} h={28} r="50%" />
            <div className="fl1"><div className="mn"><Skeleton w={i === 0 ? '55%' : '40%'} h={18} r={5} /></div></div>
            <Skeleton w={58} h={17} r="var(--r-pill)" />
          </div>
        ))}
      </div>
    </Card>
  );
}
