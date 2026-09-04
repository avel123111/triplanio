import React, { useMemo } from 'react';
import { Icon } from '@/design/icons';
import { Person, Badge, Btn, Card, CardHeader, IconBtn, RoleBadge, Skeleton } from '@/design/index';
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
// `flex: none` аватару — свойство ЗАГЛУШКИ, классом его не выразить; именованной
// константой, а не литералом в разметке (её считал бы гард инлайнов 2l).
const AVA = { flex: 'none' };

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
        {isLoading ? (
          /* ★ ТОТ ЖЕ РЯД, ЧТО РИСУЕТ `<Person>`: `.mrow` → аватар · `.fl1 > .mn`
             · значок роли. Размеры берутся из ТЕХ ЖЕ классов, а не назначаются
             руками — прежняя стопка ставила аватар 34 вместо 28 и вторую строку,
             которой у обычного участника нет, и ряд выходил на 6 px выше. */
          <div className="col col--g4">
            {[0, 1, 2].map((i) => (
              <div className="mrow" key={i}>
                <Skeleton w={28} h={28} r="50%" style={AVA} />
                <div className="fl1"><div className="mn"><Skeleton w={i === 0 ? '55%' : '40%'} h={18} r={5} /></div></div>
                <Skeleton w={58} h={17} r="var(--r-pill)" />
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

        {!isLoading && canManage && (
          <Btn variant="soft" block className="ov-invite" onClick={onInvite || onOpenMembers}>
            <Icon name="plus" size={15} />
            {t('members.invite')}
          </Btn>
        )}
      </div>
    </Card>
  );
}
