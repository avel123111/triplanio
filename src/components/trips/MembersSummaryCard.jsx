import React, { useMemo } from 'react';
import { Icon } from '@/design/icons';
import { Avatar, Btn, Card, IconBtn } from '@/design/index';
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
    <Card radius="lg" pad="none" className="ov-wdg">
      <div className="wdg-h">
        <span className="wi wi--activity"><Icon name="users" size={17} /></span>
        <h4>{t('trip.who_goes')}</h4>
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

      <div className="wdg-b">
        {isLoading ? (
          <div className="col col--g4">
            {[0, 1, 2].map((i) => (
              <div className="mrow" key={i}>
                <span className="ov-bar" style={{ width: 34, height: 34, borderRadius: '50%', flex: 'none' }} />
                <div className="fl1">
                  <div className="ov-bar" style={{ width: '55%', height: 13, borderRadius: 5 }} />
                  <div className="ov-bar" style={{ width: '40%', height: 11, borderRadius: 5, marginTop: 6 }} />
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
            // Line under the name: the invite state when there is one, else the
            // address the resolver decided is worth showing.
            const sub = isPending ? t('trip.member_pending') : who.email;

            const badgeClass = isPending || isOffline
              ? 'badge--quiet'
              : m.role === 'owner'
                ? 'badge--warning'
                : m.role === 'admin'
                  ? 'badge--brand'
                  : 'badge--outline';
            const roleLabel = isPending
              ? t('trip.member_pending')
              : isOffline
                ? t('trip.member_offline')
                : m.role === 'owner'
                  ? t('members.role_owner')
                  : m.role === 'admin'
                    ? t('trips.role_admin')
                    : t('trips.role_viewer');

            return (
              <div className="mrow" key={m.id || i} style={{ opacity: isPending || isOffline ? 0.7 : 1 }}>
                <Avatar
                  name={who.name}
                  photo={who.photo || ''}
                  deleted={who.deleted}
                  kind={isPending ? 'placeholder' : undefined}
                />
                <div className="fl1">
                  <div className="mn trunc">{who.name}</div>
                  {sub && <div className="me trunc">{sub}</div>}
                </div>
                <span className={`badge ${badgeClass}`}>
                  {isPending && <span className="dot" style={{ background: 'var(--warning)' }} />}
                  {roleLabel}
                </span>
              </div>
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
