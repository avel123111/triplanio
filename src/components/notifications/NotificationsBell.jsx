// @ts-check
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useNotificationList, useUnreadNotificationCount, useNotificationActions, BELL_ROWS } from '@/lib/useNotifications';
import { useT, useI18nFormat } from '@/lib/i18n/I18nContext';
import { useAuth } from '@/lib/AuthContext';
import { Icon } from '@/design/icons';
import { Btn, EmptyState, IconBtn, Popover, PopoverContent, PopoverTrigger } from '@/design/index';

// Render `text` but wrap occurrences of given values in styled <span>s.
// Used to bold the inviter name and emphasize the trip name in invite rows.
export function emphasize(text, parts = []) {
  if (text == null) return text;
  let nodes = [String(text)];
  parts.filter(p => p && p.value).forEach((p, pi) => {
    nodes = nodes.flatMap((node, ni) => {
      if (typeof node !== 'string') return [node];
      const segs = node.split(p.value);
      const out = [];
      segs.forEach((s, si) => {
        if (s) out.push(s);
        if (si < segs.length - 1) out.push(<span key={`e${pi}-${ni}-${si}`} style={p.style}>{p.value}</span>);
      });
      return out;
    });
  });
  return nodes;
}

// Icon + accent colour for a notification, by type.
export function notifMeta(type = '') {
  const tp = String(type).toLowerCase();
  // Specific member/booking events first — they'd otherwise be swallowed by the
  // broader 'invite' / 'member' substring matches below.
  if (tp.includes('declined')) return { icon: 'user', color: 'var(--muted)' };
  if (tp.includes('removed')) return { icon: 'user', color: 'var(--danger)' };
  if (tp.includes('left')) return { icon: 'user', color: 'var(--warm)' };
  if (tp.includes('role')) return { icon: 'shield', color: 'var(--brand)' };
  if (tp.includes('booking')) return { icon: 'bed', color: 'var(--ai)' };
  if (tp.includes('invite')) return { icon: 'users', color: 'var(--brand)' };
  if (tp.includes('vote') || tp.includes('hotel')) return { icon: 'vote', color: 'var(--ai)' };
  if (tp.includes('pro') || tp.includes('subscription') || tp.includes('payment')) return { icon: 'pro', color: 'var(--pro)' };
  if (tp.includes('join') || tp.includes('member')) return { icon: 'user', color: 'var(--success)' };
  if (tp.includes('activity') || tp.includes('update') || tp.includes('edit')) return { icon: 'edit', color: 'var(--warm)' };
  return { icon: 'bell', color: 'var(--brand)' };
}

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
          <div className="t-ui grow">{t('notif.title')}</div>
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
  const isInvite = n.type === 'trip_invite' && n.trip_member_id;
  // Invite status rides the row now (getInbox joins trip_members) — no per-row
  // `.from('trip_members')` waterfall (TRIP-408).
  const memberStatus = n.member_status;

  const time = fmtRelative(n.created_at);
  // Форма приходит СТРОКОЙ ИЗ БД (`notifications.i18n_params`), и набор ключей
  // зависит от типа уведомления — статически он не выводим, поэтому объявлен
  // словарём, а не выдуманным союзом форм.
  /** @param {Record<string, any>} params */
  const renderParams = (params = {}) => {
    /** @type {Record<string, any>} */
    const resolved = { ...params };
    if (resolved.role_key) { resolved.role = t(resolved.role_key); delete resolved.role_key; }
    // Booking notifications carry `kind` as a code (hotel/transfer/service) — localize it.
    if (resolved.kind) resolved.kind = t('notif.booking_kind_' + resolved.kind);
    return resolved;
  };
  const titleText = n.i18n_title_key ? t(n.i18n_title_key, renderParams(n.i18n_params)) : n.title;
  const messageText = n.i18n_message_key ? t(n.i18n_message_key, renderParams(n.i18n_params)) : n.message;
  const ip = n.i18n_params || {};
  const titleNode = isInvite ? emphasize(titleText, [{ value: ip.trip, style: { fontWeight: 700 /* design-token-exempt: inline mention emphasis */, color: 'var(--brand)' } }]) : titleText;
  const messageNode = isInvite ? emphasize(messageText, [{ value: ip.inviter, style: { fontWeight: 700 /* design-token-exempt: inline mention emphasis */ } }]) : messageText;

  const meta = notifMeta(n.type);
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
