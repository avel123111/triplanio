import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/lib/i18n/I18nContext';
import { Icon } from '@/design/icons';
import { Avatar, Badge, Btn, Card, Grow, Sheet, UnreadBadge } from '@/design/index';
import { RailItem, RailUtilities } from '@/components/AppShell';
import { availableSections, isSectionAvailable } from '@/lib/tripMenu';
import { clearsStep } from '@/lib/tripStep';
import { displayName } from '@/lib/displayName';
import { useUnreadChatCount } from '@/lib/chat';
import { useUnreadNotificationCount } from '@/lib/useNotifications';

// Тело УЗКОГО ИКОН-РЕЙЛА — десктоп/планшет-оболочка меню трипа (эксперимент
// «rail shell»). Рейл полновысотный: наверху лого (выход к списку трипов, в
// шапке трипа бренда больше нет), дальше вертикальные плитки «иконка+подпись»,
// внизу компактный PRO-чип апгрейда. Телефонный bottom-sheet (SidebarSheetBody
// ниже) остаётся отдельной раскладкой под палец.
//
// Обе оболочки берут состав пунктов из ОДНОГО реестра секций (tripMenu) —
// набор, ролевые гейты и бейдж чата у них совпадают по построению.
//
// Все пункты — обычные секции из реестра. Отдельного случая под структурный
// редактор тут больше нет: до TRIP-349 он был роутом, поэтому уезжал мимо
// onNavigate прямой навигацией и тащил за собой флаг isEditScreen, который
// гасил подсветку у ВСЕХ остальных пунктов.
function SidebarBody({
  tripId, trip, lens, onNavigate,
  isPro, proResolved = true, isOwner, myStep,
  onUpgrade, onProInfo, onShare,
}) {
  const { t } = useI18n();
  const nav = useNavigate();
  // Состав обеих групп — из реестра секций: и аддон-гейт, и ролевой (наблюдатель
  // видит Настройки, но не Участников — TRIP-137) живут там одним предикатом.
  const lensItems = availableSections(trip, myStep, 'lens');
  const mgmtItems = availableSections(trip, myStep, 'manage');
  const canShare = clearsStep(myStep, 'participant');
  // Only after Pro state is resolved — avoids the banner flashing on pro trips.
  const showUpgrade = proResolved && !isPro;
  // Only subscribe/count when the chat lens exists for this trip (TRIP-208 Ф2-2b):
  // the badge only renders under a visible chat item, so a chat-off trip holds
  // zero realtime subscriptions instead of a live one that can never show.
  const chatUnread = useUnreadChatCount(tripId, { enabled: isSectionAvailable('chat', trip, myStep) });
  // Пункт рейла — общий RailItem (одна реализация плитки у app- и трип-рейла).
  const railItem = (item, active, onClick) => (
    <RailItem
      key={item.id}
      icon={item.icon}
      label={t(item.labelKey)}
      active={active}
      onClick={onClick || (() => onNavigate(item.id))}
      badge={item.id === 'chat' ? chatUnread : 0}
    />
  );
  return (
    <>
      {/* Лого = выход к списку трипов (бренд из шапки трипа переехал сюда). */}
      <button type="button" className="app-side__brand" onClick={() => nav('/trips')} title={t('nav.trips')} aria-label={t('nav.trips')}>
        <img src="/triplanio-logo.svg" alt="" />
      </button>
      <div className="app-side__group">
        {/* TRIP-391 объект 1: .app-side__item — пункт НАВИГАЦИИ шелла (лензы), не кнопка-примитив. */}
        {lensItems.map((item) => railItem(item, lens === item.id))}
      </div>
      {(mgmtItems.length > 0 || canShare) && (
        <div className="app-side__group">
          {/* TRIP-391 объект 1: .app-side__item — пункт НАВИГАЦИИ шелла (управление/шеринг), не кнопка-примитив. */}
          {mgmtItems.map((item) => railItem(item, lens === item.id))}
          {canShare && onShare && railItem({ id: 'share', icon: 'share', labelKey: 'trip.share' }, false, onShare)}
        </div>
      )}
      <Grow />
      {/* Компактный вход апгрейда: полная карточка не влезает в рейл, но точка
          входа Pro обязана остаться видимой (EP-карта Pro-визуала).
          TRIP-391 объект 1: .app-side__item — плитка ШЕЛЛА в общем ряду рейла
          (та же геометрия и хит-зона, что у пунктов), не кнопка-примитив. */}
      {showUpgrade && (
        <button
          type="button"
          className="app-side__item"
          onClick={isOwner ? onUpgrade : onProInfo}
          title={t('trip_menu.upgrade_trip')}
          aria-label={t('trip_menu.upgrade_trip')}
        >
          <Badge variant="pro" icon="pro">PRO</Badge>
        </button>
      )}
      {/* Нижний кластер (тема · уведомления · аккаунт) — общий с app-рейлом;
          шапка трипа utilities больше не несёт. */}
      <RailUtilities />
    </>
  );
}

// "Upgrade this trip to Pro" card — the free-trip upsell of the PHONE SHEET.
// В рейл полная карточка не влезает: там та же точка входа компактным PRO-чипом
// (SidebarBody выше), поэтому карточка осталась одна и только у шита.
function UpgradeCard({ isOwner, onUpgrade, onProInfo }) {
  const { t } = useI18n();
  return (
    <Card tone="brand" radius="md" className="app-side__upgrade pro-up" style={{ margin: '10px 6px 0' }}>
      <div className="ph">
        <Badge variant="pro" icon="pro">PRO</Badge>
      </div>
      <div className="pt">{t('trip_menu.free_trip_title')}</div>
      <p>{t('trip.pro_locked_lenses')}</p>
      {isOwner ? (
        <Btn variant="primary" block iconRight="arrowR" onClick={onUpgrade}>{t('trip_menu.upgrade_trip')}</Btn>
      ) : (
        <Btn variant="secondary" icon="lock" block onClick={onProInfo}>{t('trip.pro_by_owner')}</Btn>
      )}
    </Card>
  );
}

// Левый икон-рейл трипа. Рисуется ОДИН раз — оболочкой TripShell, — а все
// секции, включая структурный редактор, переключаются одним и тем же onNavigate.
export default function TripSidebar({
  tripId, trip, lens, onNavigate,
  isPro, proResolved = true, isOwner, myStep,
  onUpgrade, onProInfo, onShare,
}) {
  const { t } = useI18n();
  return (
    <aside className="app-side" aria-label={t('nav.aria_primary')}>
      <SidebarBody
        tripId={tripId} trip={trip} lens={lens} onNavigate={onNavigate}
        isPro={isPro} proResolved={proResolved} isOwner={isOwner} myStep={myStep}
        onUpgrade={onUpgrade} onProInfo={onProInfo} onShare={onShare}
      />
    </aside>
  );
}

// Phone sheet BODY (TRIP-235). Same items / role-gating / chat-badge as the rail
// (тот же реестр секций), but laid out for touch: lenses in a 3-col grid of tiles
// with the open screen highlighted, management collapsed into one bordered
// container, the full upgrade card (в рейле на её месте PRO-чип) and an account
// row (moved out of the bottom nav) at the foot.
function SidebarSheetBody({
  tripId, trip, lens, onNavigate,
  isPro, proResolved = true, isOwner, myStep,
  onUpgrade, onProInfo, onShare, user, onAccount,
}) {
  const { t } = useI18n();
  const lensItems = availableSections(trip, myStep, 'lens');
  const mgmtItems = availableSections(trip, myStep, 'manage');
  const canShare = clearsStep(myStep, 'participant');
  const showUpgrade = proResolved && !isPro;
  const chatUnread = useUnreadChatCount(tripId, { enabled: isSectionAvailable('chat', trip, myStep) });
  // Плашка «Аккаунт» ведёт во «Входящие» — на ней бейдж непрочитанных inapp-
  // уведомлений (глобальный счётчик, не про этот трип). TRIP-354.
  const inappUnread = useUnreadNotificationCount();
  const accountName = displayName(user?.email, user?.full_name);

  // Ряды управления: секции группы 'manage' + «Поделиться».
  const manageRows = [
    ...mgmtItems.map((item) => ({ id: item.id, icon: item.icon, labelKey: item.labelKey, active: lens === item.id, onClick: () => onNavigate(item.id) })),
    ...(canShare && onShare ? [{ id: 'share', icon: 'share', labelKey: 'trip.share', onClick: onShare }] : []),
  ];

  return (
    <>
      <div className="tm-grid">
        {lensItems.map((item) => (
          <Card
            as="button"
            radius="md"
            key={item.id}
            className={'tm-cell' + (lens === item.id ? ' is-active' : '')}
            onClick={() => onNavigate(item.id)}
            ariaCurrent={lens === item.id ? 'page' : undefined}
          >
            <span className="tm-cell__ico"><Icon name={item.icon} size={18} /></span>
            <span className="tm-cell__lbl t-label">{t(item.labelKey)}</span>
            {item.id === 'chat' && <UnreadBadge count={chatUnread} />}
          </Card>
        ))}
      </div>
      {manageRows.length > 0 && (
        <>
          <div className="app-side__group-label tm-caption">{t('trip_menu.section_manage')}</div>
          <Card pad="none" radius="lg" className="tm-manage">
            {/* TRIP-391 объект 1 → объект 6: .tm-manage__row — РЯД меню управления, не кнопка-примитив. */}
            {manageRows.map((row) => (
              <button key={row.id} className={'tm-manage__row' + (row.active ? ' is-active' : '')} onClick={row.onClick} aria-current={row.active ? 'page' : undefined}>
                <span className="tm-manage__ico"><Icon name={row.icon} size={16} /></span>
                <span className="tm-manage__lbl t-label">{t(row.labelKey)}</span>
                <Icon name="chevron" size={16} className="tm-manage__chev" />
              </button>
            ))}
          </Card>
        </>
      )}
      {showUpgrade && <UpgradeCard isOwner={isOwner} onUpgrade={onUpgrade} onProInfo={onProInfo} />}
      {onAccount && (
        <Card as="button" radius="lg" className="tm-account" onClick={onAccount}>
          <Avatar name={accountName} photo={user?.avatar_url} seed={user?.id} size="sm" />
          <span className="tm-account__txt">
            <span className="tm-account__name t-label">{t('nav.account')}</span>
            <span className="tm-account__sub t-meta">{accountName}</span>
          </span>
          <UnreadBadge count={inappUnread} />
          <Icon name="chevron" size={16} className="tm-manage__chev" />
        </Card>
      )}
    </>
  );
}

// Phone variant: the touch-optimised menu (SidebarSheetBody) inside the canonical
// bottom-sheet (reuses <Sheet> — max-height, swipe-to-close, scrim, focus-trap).
// On phones the rail itself is suppressed via CSS, so this sheet IS the trip menu
// (открывает его кнопка «Ещё» мобильного дока). The parent gates `open` on the
// phone breakpoint and closes it through the onNavigate / onShare / onAccount
// callbacks.
export function TripSidebarSheet({ open, onOpenChange, ...rest }) {
  const { t } = useI18n();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('trip.sections_title')}>
      <SidebarSheetBody {...rest} />
    </Sheet>
  );
}
