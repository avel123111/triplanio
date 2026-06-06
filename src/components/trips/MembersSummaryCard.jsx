import React, { useMemo } from 'react';
import { Icon } from '@/design/icons';
import { Avatar } from '@/design/index';
import { useI18n } from '@/lib/i18n/I18nContext';
import { useUserProfiles } from '@/lib/useUserProfiles';
import { displayName } from '@/lib/displayName';

// Members summary widget (Lumo .wdg + .mrow). Shared by the trip Overview and
// the timeline rail. Owns member ordering + profile resolution so the "who's
// going" list is identical everywhere it appears.
//
// Ordering: owner first, then admins, viewers, offline, pending. The owner is
// often tracked via trip.created_by rather than a trip_members row, so it's
// synthesized when missing.
export default function MembersSummaryCard({
  trip,
  members = [],
  user,
  canManage = false,
  isLoading = false,
  onOpenMembers,
  onInvite,
}) {
  const { t } = useI18n();

  const profileIds = useMemo(
    () => [...members.map((m) => m.user_id), trip?.created_by, user?.id].filter(Boolean),
    [members, trip?.created_by, user?.id],
  );
  const profiles = useUserProfiles(profileIds, trip?.id);

  const orderedMembers = useMemo(() => {
    const ownerId = trip?.created_by || user?.id || '';
    const all = members.filter((m) => m.status !== 'declined');
    if (ownerId && !all.some((m) => m.role === 'owner' || m.user_id === ownerId)) {
      const isMeOwner = user?.id && ownerId === user.id;
      all.unshift({
        id: '__owner__',
        user_id: ownerId,
        user_full_name: isMeOwner ? user?.full_name || '' : '',
        role: 'owner',
        status: 'active',
      });
    }
    const rank = (m) => {
      if (m.role === 'owner') return 0;
      if (m.status === 'pending' || m.status === 'invited') return 4;
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
    <div className="wdg ov-wdg">
      <div className="wdg-h">
        <span className="wi wi--activity"><Icon name="users" size={17} /></span>
        <h4>{t('trip.who_goes')}</h4>
        {canManage && (
          <button
            className="wdg-act"
            onClick={onOpenMembers}
            title={t('trip.open_members')}
            aria-label={t('trip.open_members')}
          >
            <Icon name="chev" size={14} />
          </button>
        )}
      </div>

      <div className="wdg-b">
        {isLoading ? (
          <div className="mlist">
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
        <div className="mlist">
          {orderedMembers.map((m, i) => {
            const profile = profiles[m.user_id];
            const resolved =
              profile?.full_name ||
              m.user_full_name ||
              (m.user_id && user?.id && m.user_id === user.id ? user.full_name : '') ||
              '';
            const name = displayName(m.invite_email, resolved);
            const isOffline = m.status === 'offline';
            const isPending = m.status === 'pending' || m.status === 'invited';

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
                  name={name}
                  photo={profile?.avatar_url || ''}
                  kind={isPending ? 'placeholder' : undefined}
                />
                <div className="fl1">
                  <div className="mn">{name}</div>
                  {(() => {
                    const sub = isPending
                      ? t('trip.member_pending')
                      : m.invite_email || profile?.email || '';
                    return sub ? <div className="me">{sub}</div> : null;
                  })()}
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
          <button className="btn btn--soft btn--block ov-invite" onClick={onInvite || onOpenMembers}>
            <Icon name="plus" size={15} />
            {t('members.invite')}
          </button>
        )}
      </div>
    </div>
  );
}
