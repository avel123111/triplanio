import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/lib/i18n/I18nContext';
import { Icon } from '@/design/icons';
import { Avatar, Badge, Btn, Sheet } from '@/design/index';
import { LENS_ITEMS, MGMT_ITEMS, isLensVisible, EDIT_ITEM, canEditStructure } from '@/lib/tripMenu';
import { canShareTrip } from '@/lib/members';
import { displayName } from '@/lib/displayName';
import { useUnreadChatCount } from '@/lib/chat';

// Shared menu BODY (groups + upgrade card). Rendered identically by:
//   • TripSidebar      — the desktop/tablet <aside> (and the editor's slide drawer)
//   • TripSidebarSheet — the phone bottom-sheet
// Keeping a single body guarantees the two shells expose the exact same item
// set, role gating, chat badge and "upgrade to Pro" card.
function SidebarBody({
  tripId, trip, lens, onNavigate,
  isPro, proResolved = true, isOwner, myRole,
  onUpgrade, onProInfo, onShare, isEditScreen = false,
}) {
  const { t } = useI18n();
  const navSb = useNavigate();
  const lensItems = LENS_ITEMS.filter((item) => isLensVisible(trip, item.id));
  // Viewers see Settings (read-only, to leave the trip) but not Members. (TRIP-137)
  const mgmtItems = MGMT_ITEMS.filter((item) =>
    !(myRole === 'viewer' && item.id === 'members'));
  const canShare = canShareTrip(myRole);
  // Only after Pro state is resolved — avoids the banner flashing on pro trips.
  const showUpgrade = proResolved && !isPro;
  // Only subscribe/count when the chat lens exists for this trip (TRIP-208 Ф2-2b):
  // the badge only renders under a visible chat item, so a chat-off trip holds
  // zero realtime subscriptions instead of a live one that can never show.
  const chatUnread = useUnreadChatCount(tripId, { enabled: isLensVisible(trip, 'chat') });
  return (
    <>
      <div className="app-side__group">
        <div className="app-side__group-label">{t('trip.sections_title')}</div>
        {lensItems.map((item) => (
          <button
            key={item.id}
            className={'app-side__item' + (!isEditScreen && lens === item.id ? ' active' : '')}
            onClick={() => onNavigate(item.id)}
          >
            <Icon name={item.icon} size={15} />
            <span className="app-side__label">{t(item.labelKey)}</span>
            {item.id === 'chat' && chatUnread > 0 && (
              <span className="app-side__item-badge t-meta" style={{ marginLeft: 'auto', background: 'var(--warm)', color: '#fff', borderRadius: 999, minWidth: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>
                {chatUnread > 99 ? '99+' : chatUnread}
              </span>
            )}
          </button>
        ))}
      </div>
      {(mgmtItems.length > 0 || canShare || canEditStructure(myRole)) && (
        <div className="app-side__group">
          <div className="app-side__group-label">{t('trip_menu.section_manage')}</div>
          {canEditStructure(myRole) && (
            <button
              className={'app-side__item' + (isEditScreen ? ' active' : '')}
              onClick={() => { if (!isEditScreen) navSb(`/trip/${tripId}/edit`); }}
            >
              <Icon name={EDIT_ITEM.icon} size={15} />
              <span className="app-side__label">{t(EDIT_ITEM.labelKey)}</span>
            </button>
          )}
          {mgmtItems.map((item) => (
            <button
              key={item.id}
              className={'app-side__item' + (!isEditScreen && lens === item.id ? ' active' : '')}
              onClick={() => onNavigate(item.id)}
            >
              <Icon name={item.icon} size={15} />
              <span className="app-side__label">{t(item.labelKey)}</span>
            </button>
          ))}
          {canShare && onShare && (
            <button className="app-side__item" onClick={onShare}>
              <Icon name="share" size={15} />
              <span className="app-side__label">{t('trip.share')}</span>
            </button>
          )}
        </div>
      )}
      {showUpgrade && <UpgradeCard isOwner={isOwner} onUpgrade={onUpgrade} onProInfo={onProInfo} />}
    </>
  );
}

// "Upgrade this trip to Pro" card — shown on free trips in both the list sidebar
// and the phone sheet, so it lives in one place.
function UpgradeCard({ isOwner, onUpgrade, onProInfo }) {
  const { t } = useI18n();
  return (
    <div className="app-side__upgrade pro-up" style={{ margin: '10px 6px 0' }}>
      <div className="ph">
        <Badge variant="pro" icon="pro">PRO</Badge>
      </div>
      <div className="pt">{t('trip_menu.free_trip_title')}</div>
      <p>{t('trip.pro_locked_lenses')}</p>
      {isOwner ? (
        <Btn variant="primary" size="sm" block iconRight="arrowR" onClick={onUpgrade}>{t('trip_menu.upgrade_trip')}</Btn>
      ) : (
        <button className="lockmsg" onClick={onProInfo}>
          <Icon name="lock" size={14} />
          {t('trip.pro_by_owner')}
        </button>
      )}
    </div>
  );
}

// Shared left trip menu — used by both the trip screens (TripView) and the
// structure editor (TripStructureEdit) so the two are IDENTICAL: same full
// sidebar, same item set (addon-gated lenses + management), same role gating,
// chat badge and "upgrade to Pro" card. The only difference is navigation:
//   • TripView   passes onNavigate=setLens (in-page lens switch), lens=current.
//   • the editor passes onNavigate=route-nav and isEditScreen so the "Edit
//     structure" item is the active one.
export default function TripSidebar({
  tripId, trip, lens, onNavigate,
  isPro, proResolved = true, isOwner, myRole,
  onUpgrade, onProInfo, onShare, isEditScreen = false,
}) {
  return (
    <aside className="app-side">
      <SidebarBody
        tripId={tripId} trip={trip} lens={lens} onNavigate={onNavigate}
        isPro={isPro} proResolved={proResolved} isOwner={isOwner} myRole={myRole}
        onUpgrade={onUpgrade} onProInfo={onProInfo} onShare={onShare} isEditScreen={isEditScreen}
      />
    </aside>
  );
}

// Phone sheet BODY (TRIP-235). Same items/role-gating/chat-badge/upgrade card as
// the list sidebar, but laid out for touch: lenses in a 3-col grid of tiles with
// the open screen highlighted, management collapsed into one bordered container,
// and an account row (moved out of the bottom nav) at the foot.
function SidebarSheetBody({
  tripId, trip, lens, onNavigate,
  isPro, proResolved = true, isOwner, myRole,
  onUpgrade, onProInfo, onShare, user, onAccount,
}) {
  const { t } = useI18n();
  const navSb = useNavigate();
  const lensItems = LENS_ITEMS.filter((item) => isLensVisible(trip, item.id));
  const mgmtItems = MGMT_ITEMS.filter((item) => !(myRole === 'viewer' && item.id === 'members'));
  const canShare = canShareTrip(myRole);
  const showUpgrade = proResolved && !isPro;
  const chatUnread = useUnreadChatCount(tripId, { enabled: isLensVisible(trip, 'chat') });
  const accountName = displayName(user?.email, user?.full_name);

  // Management rows: edit-structure (owner/admin) + members/settings + share.
  const manageRows = [
    ...(canEditStructure(myRole) ? [{ id: 'edit', icon: EDIT_ITEM.icon, labelKey: EDIT_ITEM.labelKey, onClick: () => navSb(`/trip/${tripId}/edit`) }] : []),
    ...mgmtItems.map((item) => ({ id: item.id, icon: item.icon, labelKey: item.labelKey, onClick: () => onNavigate(item.id) })),
    ...(canShare && onShare ? [{ id: 'share', icon: 'share', labelKey: 'trip.share', onClick: onShare }] : []),
  ];

  return (
    <>
      <div className="tm-grid">
        {lensItems.map((item) => (
          <button
            key={item.id}
            className={'tm-cell' + (lens === item.id ? ' is-active' : '')}
            onClick={() => onNavigate(item.id)}
            aria-current={lens === item.id ? 'page' : undefined}
          >
            <span className="tm-cell__ico"><Icon name={item.icon} size={18} /></span>
            <span className="tm-cell__lbl t-label">{t(item.labelKey)}</span>
            {item.id === 'chat' && chatUnread > 0 && (
              <span className="tm-cell__badge t-meta">{chatUnread > 99 ? '99+' : chatUnread}</span>
            )}
          </button>
        ))}
      </div>
      {manageRows.length > 0 && (
        <>
          <div className="app-side__group-label tm-caption">{t('trip_menu.section_manage')}</div>
          <div className="tm-manage">
            {manageRows.map((row) => (
              <button key={row.id} className="tm-manage__row" onClick={row.onClick}>
                <span className="tm-manage__ico"><Icon name={row.icon} size={16} /></span>
                <span className="tm-manage__lbl t-label">{t(row.labelKey)}</span>
                <Icon name="chevron" size={16} className="tm-manage__chev" />
              </button>
            ))}
          </div>
        </>
      )}
      {showUpgrade && <UpgradeCard isOwner={isOwner} onUpgrade={onUpgrade} onProInfo={onProInfo} />}
      {onAccount && (
        <button className="tm-account" onClick={onAccount}>
          <Avatar name={accountName} photo={user?.avatar_url} size="sm" />
          <span className="tm-account__txt">
            <span className="tm-account__name t-label">{t('nav.account')}</span>
            <span className="tm-account__sub t-meta">{accountName}</span>
          </span>
          <Icon name="chevron" size={16} className="tm-manage__chev" />
        </button>
      )}
    </>
  );
}

// Phone variant: the touch-optimised menu (SidebarSheetBody) inside the canonical
// bottom-sheet (reuses <Sheet> — max-height, swipe-to-close, scrim, focus-trap).
// On phones the slide-in drawer is suppressed via CSS and this is shown instead.
// The parent gates `open` on the phone breakpoint and closes it through the
// onNavigate / onShare / onAccount callbacks.
export function TripSidebarSheet({ open, onOpenChange, ...rest }) {
  const { t } = useI18n();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('trip.sections_title')}>
      <SidebarSheetBody {...rest} />
    </Sheet>
  );
}
