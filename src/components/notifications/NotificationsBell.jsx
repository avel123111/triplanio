// @ts-check
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useNotificationList, useUnreadNotificationCount, useNotificationActions, BELL_ROWS } from '@/lib/useNotifications';
import { useT, useI18nFormat } from '@/lib/i18n/I18nContext';
import { useAuth } from '@/lib/AuthContext';
import { Icon } from '@/design/icons';
import { Btn, EmptyState, IconBtn, Popover, PopoverContent, PopoverTrigger } from '@/design/index';
import { buildNotifView } from '@/components/notifications/notifView';

// ★TRIP-344: проп `triggerClassName` удалён. Его единственный вызыватель
// передавал `"icon-btn"` — то есть РОВНО дефолт, — а сам класс теперь несёт
// примитив. Проп, у которого одно значение и оно же дефолт, это не точка
// расширения, а вторая дорога к одному результату.
export default function NotificationsBell() {
  const t = useT();
  const { fmtRelative } = useI18nFormat();
  const { user } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);

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
        {/* Метка непрочитанных — РЕБЁНОК кнопки: она позиционируется от неё, а
            не от строки. Имя `icon-btn__dot`, а не приклеенное `dot`, — апрув
            Pavel: правило вида `.icon-btn .dot` заводит ключ и на ПРЕДКА (2p,
            решение TRIP-363), поэтому объявления метки становились победителем
            базового ключа `.icon-btn` и ЛЮБОЙ перенос на примитив читался как
            «смена значения» — 44 ложных отказа. Односоставное имя снимает это
            структурно и совпадает с направлением каталога: имя без префикса
            внутри компонента ДС схлопывается в <владелец>__<имя>.
            Класс `relative` тоже ушёл: правила у него нет НИГДЕ (наследство
            Tailwind), а `position: relative` база `.icon-btn` объявляет сама. */}
        <IconBtn icon="bell" ariaLabel={t('notif.title')}>
          {unread > 0 && <span aria-hidden className="icon-btn__dot" />}
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
              <NotifRow
                key={n.id}
                n={n}
                t={t}
                fmtRelative={fmtRelative}
                pending={respondInvite.isPending}
                onRespond={(action) => {
                  if (!n.read) markOneRead.mutate(n.id);
                  respondInvite.mutate({ memberId: n.trip_member_id, tripId: n.trip_id, action });
                }}
                onMarkRead={() => { if (!n.read) markOneRead.mutate(n.id); }}
                onOpenTrip={() => { setOpen(false); }}
              />
            ))
          )}
        </div>

        <div className="bell-dd__foot">
          {/* «Открыть все» и «Прочитать все» были двумя частными кнопками
              (пилюля с брендовой заливкой и полоса во всю ширину) — обе стали
              текстовой кнопкой системы: тон брендовый, подчёркивание на ховере. */}
          <Btn variant="link" block onClick={() => { setOpen(false); nav('/inbox'); }}>
            {t('notif.open_full_inbox')}
          </Btn>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NotifRow({ n, t, fmtRelative, pending, onRespond, onMarkRead, onOpenTrip }) {
  // Invite status rides the row now (getInbox joins trip_members) — no per-row
  // `.from('trip_members')` waterfall (TRIP-408).
  const memberStatus = n.member_status;

  const time = fmtRelative(n.created_at);
  // Единый резолвер строки (общий с экраном инбокса): живое имя автора из sender,
  // локализация текста, узлы заголовка/сообщения.
  const { meta, isInvite, titleNode, messageText, messageNode } = buildNotifView(n, t, { deletedLabel: t('common.deleted_user') });
  const showPending = isInvite && memberStatus === 'pending';

  return (
    <div
      className={`brow${n.read ? '' : ' brow--unread'}`}
      onClick={() => { if (!n.read) onMarkRead?.(); }}
    >
      <div className="n-ic n-ic--sm" style={{ '--ic': meta.color }}>
        <Icon name={meta.icon} size={14} />
      </div>
      <div className="brow__body">
        <div className="brow__title">{titleNode}</div>
        {messageText && <div className="brow__msg">{messageNode}</div>}
        <div className="brow__time">{time}</div>

        {showPending && (
          <div className="brow__acts">
            <Btn variant="primary" icon="check" disabled={pending} onClick={() => onRespond('accept')}>{t('notif.accept')}</Btn>
            <Btn variant="secondary" disabled={pending} onClick={() => onRespond('decline')}>{t('notif.decline')}</Btn>
          </div>
        )}
        {isInvite && memberStatus === 'active' && (
          <div className="brow__ok">✓ {t('notif.accepted')}</div>
        )}

        {n.trip_id && (memberStatus === 'active' || n.type !== 'trip_invite') && (
          <Link to={`/trip/${n.trip_id}`} onClick={onOpenTrip} className="brow__link">
            <Icon name="pin" size={12} />{t('notif.view_trip')}
          </Link>
        )}
      </div>
    </div>
  );
}
