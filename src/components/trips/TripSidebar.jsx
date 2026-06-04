import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/lib/i18n/I18nContext';
import { Icon } from '@/design/icons';
import { Btn } from '@/design/index';
import { LENS_ITEMS, MGMT_ITEMS, isLensVisible, EDIT_ITEM, canEditStructure } from '@/lib/tripMenu';
import { useUnreadChatCount } from '@/lib/chat';

// Shared left trip menu — used by both the trip screens (TripView) and the
// structure editor (TripStructureEdit) so the two are IDENTICAL: same item set
// (addon-gated lenses + management), same role gating, same chat badge and the
// same "upgrade to Pro" card. The only difference is navigation:
//   • TripView   passes onNavigate=setLens (in-page lens switch), lens=current.
//   • the editor passes onNavigate=route-nav and isEditScreen so the "Edit
//     structure" item is the active one.
export default function TripSidebar({
  tripId, trip, lens, onNavigate,
  isPro, proResolved = true, isOwner, myRole,
  onUpgrade, onProInfo, onShare, isEditScreen = false,
}) {
  const { t } = useI18n();
  const navSb = useNavigate();
  const lensItems = LENS_ITEMS.filter((item) => isLensVisible(trip, item.id));
  // Viewers can't open Settings or Members — hide those entirely.
  const mgmtItems = MGMT_ITEMS.filter((item) =>
    !(myRole === 'viewer' && (item.id === 'settings' || item.id === 'members')));
  const canShare = myRole !== 'viewer';
  // Only after Pro state is resolved — avoids the banner flashing on pro trips.
  const showUpgrade = proResolved && !isPro;
  const chatUnread = useUnreadChatCount(tripId);
  return (
    <aside className="app-side">
      <div className="app-side__group">
        <div className="app-side__group-label">{t('trip.sections_title')}</div>
        {lensItems.map((item) => (
          <button
            key={item.id}
            className={'app-side__item' + (!isEditScreen && lens === item.id ? ' active' : '')}
            onClick={() => onNavigate(item.id)}
          >
            <Icon name={item.icon} size={15} />
            {t(item.labelKey)}
            {item.id === 'chat' && chatUnread > 0 && (
              <span className="app-side__item-badge" style={{ marginLeft: 'auto', background: 'var(--warm)', color: '#fff', borderRadius: 999, fontSize: 10.5, fontWeight: 700, minWidth: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>
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
              {t(EDIT_ITEM.labelKey)}
            </button>
          )}
          {mgmtItems.map((item) => (
            <button
              key={item.id}
              className={'app-side__item' + (!isEditScreen && lens === item.id ? ' active' : '')}
              onClick={() => onNavigate(item.id)}
            >
              <Icon name={item.icon} size={15} />
              {t(item.labelKey)}
            </button>
          ))}
          {canShare && onShare && (
            <button className="app-side__item" onClick={onShare}>
              <Icon name="share" size={15} />
              {t('trip.share')}
            </button>
          )}
        </div>
      )}
      {showUpgrade && (
        <div style={{ margin: '10px 6px 0', padding: 12, borderRadius: 10, background: 'var(--warm-tint)' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--warm)', marginBottom: 4 }}>{t('trip_menu.free_trip_title')}</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginBottom: 8, lineHeight: 1.45 }}>
            {t('trip.pro_locked_lenses')}
          </div>
          {isOwner ? (
            <Btn variant="primary" size="sm" block icon="pro" onClick={onUpgrade}>{t('trip_menu.upgrade_trip')}</Btn>
          ) : (
            <Btn variant="ghost" size="sm" block icon="lock" onClick={onProInfo}>{t('trip.pro_by_owner')}</Btn>
          )}
        </div>
      )}
    </aside>
  );
}
