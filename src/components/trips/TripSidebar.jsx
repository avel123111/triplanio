import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/lib/i18n/I18nContext';
import { Icon } from '@/design/icons';
import { Btn, Sheet } from '@/design/index';
import { LENS_ITEMS, MGMT_ITEMS, isLensVisible, EDIT_ITEM, canEditStructure } from '@/lib/tripMenu';
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
  const canShare = myRole !== 'viewer';
  // Only after Pro state is resolved — avoids the banner flashing on pro trips.
  const showUpgrade = proResolved && !isPro;
  const chatUnread = useUnreadChatCount(tripId);
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
      {showUpgrade && (
        <div className="app-side__upgrade pro-up" style={{ margin: '10px 6px 0' }}>
          <div className="ph">
            <div className="pi">
              <Icon name="crown" size={17} />
            </div>
            <div className="pt">{t('trip_menu.free_trip_title')}</div>
          </div>
          <p>{t('trip.pro_locked_lenses')}</p>
          {isOwner ? (
            <Btn variant="pro" size="sm" block icon="pro" onClick={onUpgrade}>{t('trip_menu.upgrade_trip')}</Btn>
          ) : (
            <button className="lockmsg" onClick={onProInfo}>
              <Icon name="lock" size={14} />
              {t('trip.pro_by_owner')}
            </button>
          )}
        </div>
      )}
    </>
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

// Phone variant: the exact same menu rendered inside the canonical bottom-sheet
// (reuses <Sheet> — max-height, swipe-to-close, scrim, focus-trap). On phones the
// slide-in drawer is suppressed via CSS and this is shown instead. The parent
// gates `open` on the phone breakpoint and closes it through onNavigate/onShare.
export function TripSidebarSheet({ open, onOpenChange, ...rest }) {
  const { t } = useI18n();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('trip.sections_title')}>
      <SidebarBody {...rest} />
    </Sheet>
  );
}
