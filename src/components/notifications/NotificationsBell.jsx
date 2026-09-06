// @ts-check
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotificationList, useUnreadNotificationCount, useNotificationActions, BELL_ROWS } from '@/lib/useNotifications';
import { useT, useI18nFormat } from '@/lib/i18n/I18nContext';
import { useAuth } from '@/lib/AuthContext';
import { Icon } from '@/design/icons';
import { Badge, Btn, EmptyState, IconBtn, NotifRow, Popover, PopoverContent, PopoverTrigger, UnreadBadge } from '@/design/index';
import { buildNotifView } from '@/components/notifications/notifView';

// ★TRIP-344: проп `triggerClassName` удалён. Его единственный вызыватель
// передавал `"icon-btn"` — то есть РОВНО дефолт, — а сам класс теперь несёт
// примитив. Проп, у которого одно значение и оно же дефолт, это не точка
// расширения, а вторая дорога к одному результату.
/**
 * @param {{ confirmLeave?: () => Promise<boolean> }} [p]
 *   confirmLeave — TRIP-520: во флоу создания «Все уведомления» / «Открыть трип»
 *   спрашивают перед уходом; без пропа — прямой переход, как раньше.
 */
export default function NotificationsBell({ confirmLeave } = {}) {
  const t = useT();
  const { fmtRelative } = useI18nFormat();
  const { user } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  // Обернуть переход гейтом ухода, если он передан.
  const guard = (fn) => (confirmLeave ? async () => { if (await confirmLeave()) fn(); } : fn);

  // Shared seam (src/lib/useNotifications.js): closed bell costs one number,
  // and the popover renders the head of the same list the Inbox page shows.
  const { data: rows = [], isLoading } = useNotificationList({ enabled: open });
  const unread = useUnreadNotificationCount();
  const { markAllRead, markOneRead, respondInvite } = useNotificationActions();
  const notifications = rows.slice(0, BELL_ROWS);

  if (!user) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* Метка непрочитанных — РЕБЁНОК кнопки: позиционируется от неё
            ко-селектором `.icon-btn > .badge--unread`. Канон непрочитанного
            (TRIP-354): красный `<UnreadBadge>` С ЧИСЛОМ вместо прежней точки
            `.icon-btn__dot`. Число озвучивается как часть доступного имени
            кнопки. */}
        <IconBtn icon="bell" ariaLabel={t('notif.title')}>
          <UnreadBadge count={unread} />
        </IconBtn>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="bell-dd-pop">
        <div className="bell-dd__head">
          <Icon name="bell" size={16} />
          <div className="t-subheading grow">{t('notif.title')}</div>
          {unread > 0 && (
            <Btn variant="link" onClick={() => markAllRead.mutate()}>
              {t('notif.mark_all_read')}
            </Btn>
          )}
        </div>

        <div className="bell-dd__list scrollbar-thin">
          {isLoading ? (
            <div className="bell-dd__loading">
              <Icon name="refresh" size={16} />
            </div>
          ) : notifications.length === 0 ? (
            <EmptyState icon="bell" title={t('notif.all_read')} body={t('notif.all_read_desc')} />
          ) : (
            notifications.map(n => (
              <PopoverRow
                key={n.id}
                n={n}
                t={t}
                nav={nav}
                fmtRelative={fmtRelative}
                pendingAction={respondInvite.isPending && respondInvite.variables?.memberId === n.trip_member_id ? respondInvite.variables.action : null}
                onRespond={(action) => {
                  if (!n.read) markOneRead.mutate(n.id);
                  respondInvite.mutate({ memberId: n.trip_member_id, tripId: n.trip_id, action });
                }}
                onMarkRead={() => { if (!n.read) markOneRead.mutate(n.id); }}
                onOpenTrip={() => { setOpen(false); }}
                confirmLeave={confirmLeave}
              />
            ))
          )}
        </div>

        <div className="bell-dd__foot">
          {/* «Открыть все» и «Прочитать все» были двумя частными кнопками
              (пилюля с брендовой заливкой и полоса во всю ширину) — обе стали
              текстовой кнопкой системы: тон брендовый, подчёркивание на ховере. */}
          <Btn variant="link" block onClick={guard(() => { setOpen(false); nav('/inbox'); })}>
            {t('notif.open_full_inbox')}
          </Btn>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Поповер-строка = канон `<NotifRow compact>` + слоты действий. Резолв (глиф из
// sender, живое имя, i18n-текст) — общий `buildNotifView`, тот же, что у экрана.
function PopoverRow({ n, t, nav, fmtRelative, pendingAction, onRespond, onMarkRead, onOpenTrip, confirmLeave }) {
  const guard = (fn) => (confirmLeave ? async () => { if (await confirmLeave()) fn(); } : fn);
  // Invite status rides the row now (getInbox joins trip_members) — no per-row
  // `.from('trip_members')` waterfall (TRIP-408).
  const memberStatus = n.member_status;
  const { glyph, isInvite, titleNode, messageText, messageNode, showLink } = buildNotifView(n, t, { deletedLabel: t('common.deleted_user') });
  const showPending = isInvite && memberStatus === 'pending';
  const hasActions = showPending || (isInvite && memberStatus === 'active') || showLink;

  const actions = hasActions ? (
    <>
      {showPending && (
        <>
          <Btn variant="primary" icon="check" loading={pendingAction === 'accept'} disabled={!!pendingAction} onClick={() => onRespond('accept')}>{t('notif.accept')}</Btn>
          <Btn variant="secondary" loading={pendingAction === 'decline'} disabled={!!pendingAction} onClick={() => onRespond('decline')}>{t('notif.decline')}</Btn>
        </>
      )}
      {isInvite && memberStatus === 'active' && (
        <Badge variant="success" icon="check">{t('notif.accepted')}</Badge>
      )}
      {showLink && (
        <Btn variant="link" icon="pin" onClick={guard(() => { onOpenTrip?.(); nav(`/trip/${n.trip_id}`); })}>{t('notif.view_trip')}</Btn>
      )}
    </>
  ) : null;

  return (
    <NotifRow
      compact
      glyph={glyph}
      unread={!n.read}
      title={titleNode}
      message={messageText ? messageNode : null}
      time={fmtRelative(n.created_at)}
      actions={actions}
      onClick={() => { if (!n.read) onMarkRead?.(); }}
    />
  );
}
