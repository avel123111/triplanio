import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotificationList, useUnreadNotificationCount, useNotificationActions } from '@/lib/useNotifications';
import { useT, useI18nFormat } from '@/lib/i18n/I18nContext';
import { Btn, Badge, Card, EmptyState, ListRow, NotifRow, PageHead, Seg, Skeleton, Tile } from '../design/index';
import { Icon } from '../design/icons';
import AppShell from '@/components/AppShell';
import { buildNotifView } from '@/components/notifications/notifView';
import { useQueryGate } from '@/lib/useQueryGate';
import { gateStubProps } from '@/lib/loadStateClassify';
import { SystemStub } from '@/lib/PageNotFound';

function dateGroup(iso) {
  if (!iso) return 'earlier';
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startYest = new Date(startToday); startYest.setDate(startYest.getDate() - 1);
  const startWeek = new Date(startToday); startWeek.setDate(startWeek.getDate() - 7);
  if (d >= startToday) return 'today';
  if (d >= startYest) return 'yesterday';
  if (d >= startWeek) return 'week';
  return 'earlier';
}
const GROUP_ORDER = ['today', 'yesterday', 'week', 'earlier'];
const GROUP_LABEL_KEY = { today: 'common.today', yesterday: 'common.yesterday', week: 'notif.this_week', earlier: 'notif.earlier' };

export default function Inbox() {
  const nav = useNavigate();
  const t = useT();
  const { fmtRelative } = useI18nFormat();

  const [filter, setFilter] = useState('all');

  // Shared seam (src/lib/useNotifications.js) — the same single list the bell
  // renders the head of.
  const {
    data: notifications = [], isLoading,
    error: notifError, isPending: notifPending, fetchStatus: notifFetchStatus, refetch: refetchNotifs,
  } = useNotificationList();
  const { markAllRead, markOneRead, respondInvite } = useNotificationActions();

  const unreadCount = useUnreadNotificationCount();

  // ── Action-инбокс (редизайн, задача Pavel): два потока ────────────────────────
  // «Зона решений» = pending-инвайты, закреплены бренд-карточкой над лентой и
  // ИСКЛЮЧЕНЫ из дата-групп (нет дублей); отвеченный инвайт возвращается в ленту
  // с бейджем статуса — механика inbox-zero без единого нового запроса.
  const isPendingInvite = (n) => n.type === 'trip_invite' && n.member_status === 'pending';
  const pendingInvites = notifications.filter(isPendingInvite);
  const stream = notifications.filter(n => !isPendingInvite(n));

  // Счётчики табов — от ленты (история), pending живут в закреплённом блоке.
  const streamUnread = stream.filter(n => !n.read).length;
  const inviteCount = stream.filter(n => n.type === 'trip_invite').length;

  const filtered = stream.filter(n => {
    if (filter === 'unread') return !n.read;
    if (filter === 'invites') return n.type === 'trip_invite';
    return true;
  });

  // Group by date bucket, keeping order.
  const groups = GROUP_ORDER
    .map(label => ({ label, items: filtered.filter(n => dateGroup(n.created_at) === label) }))
    .filter(g => g.items.length > 0);

  const TABS = [
    ['all', t('notif.all'), 0],
    ['unread', t('notif.unread'), streamUnread],
    ['invites', t('notif.invitations'), inviteCount],
  ];

  // ── Load gate (TRIP-208) ──────────────────────────────────────────────────────
  // A failed notifications load must surface an error + retry, not silently render
  // the "inbox empty" screen. Cached list wins (hasData) — a background refetch
  // error never blanks an already-shown inbox.
  // Collection: empty = "nothing yet" via useQueryGate's fail-safe default; a
  // real load failure still gates via the thrown-error path below (TRIP-220).
  const inboxGate = useQueryGate(
    { isPending: notifPending, fetchStatus: notifFetchStatus, error: notifError },
    notifications.length > 0,
  );
  if (inboxGate === 'temporary' || inboxGate === 'access' || inboxGate === 'not_found') {
    const stub = gateStubProps(inboxGate);
    const isTemporary = inboxGate === 'temporary';
    return (
      <div className="app-shell">
        <SystemStub
          icon={stub.icon}
          tone={stub.tone}
          title={t(stub.title)}
          body={t(stub.body)}
          primary={isTemporary
            ? { label: t('sys.retry'), onClick: () => refetchNotifs() }
            : { label: t('sys.to_my_trips'), onClick: () => nav('/trips') }}
          secondary={isTemporary ? { label: t('sys.to_my_trips'), onClick: () => nav('/trips') } : undefined}
        />
      </div>
    );
  }

  return (
    <AppShell active="inbox" onBack={() => nav('/trips')} backTitle={t('telegram.go_to_trips')} title={t('notif.inbox_title')}>
      <main className="ov-anim page-main">
        <PageHead title={t('notif.inbox_title')} />

        {/* Тулбар + зона решений + лента — одна колонка с шагом. */}
        <div className="col col--g8">
          {notifications.length > 0 && (
            // Фильтры слева, «Прочитать всё» видимой кнопкой справа (была
            // ссылкой в шапке — длинная RU-строка давила заголовок на мобиле);
            // row--wrap переносит кнопку на свою строку на узком.
            <div className="row row--j-between row--wrap">
              <Seg
                value={filter}
                onChange={setFilter}
                ariaLabel={t('notif.title')}
                options={TABS.map(([k, l, c]) => ({ value: k, label: c > 0 ? <>{l} <b>{c}</b></> : l }))}
              />
              {unreadCount > 0 && (
                <Btn variant="soft" icon="check" loading={markAllRead.isPending} onClick={() => markAllRead.mutate()}>
                  {t('notif.mark_all_read')}
                </Btn>
              )}
            </div>
          )}

          {/* Зона решений: pending-приглашения закреплены НАД лентой при любом
              фильтре — решение не тонет в датах. Строки без unread-подложки
              (акцент несёт бренд-карточка) и без клика (цели — только кнопки). */}
          {!isLoading && pendingInvites.length > 0 && (
            <Card pad="none" radius="lg" tone="brand">
              <div className="wdg-h">
                <span className="wi"><Icon name="users" size={17} /></span>
                <h4>{t('notif.invitations')}</h4>
                <Badge variant="count">{pendingInvites.length}</Badge>
              </div>
              {pendingInvites.map((n) => (
                <InboxRow
                  key={n.id}
                  n={n}
                  t={t}
                  nav={nav}
                  fmtRelative={fmtRelative}
                  pinned
                  pendingAction={respondInvite.isPending && respondInvite.variables?.memberId === n.trip_member_id ? respondInvite.variables.action : null}
                  onRespond={(action) => {
                    if (!n.read) markOneRead.mutate(n.id);
                    respondInvite.mutate({ memberId: n.trip_member_id, tripId: n.trip_id, action });
                  }}
                />
              ))}
            </Card>
          )}

          {isLoading ? (
            <div className="col">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} w="100%" h={64} r={'var(--r-sm)'} />)}
            </div>
          ) : notifications.length === 0 ? (
            <InboxEmpty onCollection={() => nav('/trips')} />
          ) : filtered.length === 0 ? (
            filter === 'unread' ? (
              // Inbox-zero: пустые «Непрочитанные» — успех, а не пустота.
              <EmptyState kind="success" icon="check" title={t('notif.all_read')} body={t('notif.all_read_desc')} />
            ) : pendingInvites.length > 0 ? (
              // Вся почта = pending-инвайты: блок решений выше и есть контент.
              null
            ) : (
              <EmptyState icon="bell" title={t('notif.filter_empty')} />
            )
          ) : (
            <div className="col col--g8">
              {groups.map((g) => (
              <div key={g.label} className="col col--g4">
                <div className="ngrp__label t-label tp-caption">{t(GROUP_LABEL_KEY[g.label])}</div>
                {/* Дата-группа — ОДНА карточка-поверхность, строки вплотную с
                    хайрлайнами; прочитанная строка на цвете карточки, непрочитанная
                    — мягкая подложка поверх. */}
                <Card pad="none" radius="md">
                  {g.items.map((n) => (
                    <InboxRow
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
                    />
                  ))}
                </Card>
              </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </AppShell>
  );
}

function InboxEmpty({ onCollection }) {
  const t = useT();
  // «Что здесь появится» — канон `<ListRow variant="divider">` (плитка-иконка +
  // заголовок + подпись, хайрлайн между строками, последняя без него — сам
  // вариант). Никакого своего скина: строки, отступы и текст несут примитивы ДС
  // (`ListRow`/`Tile`), все они есть на витрине `/kit`.
  // Каждая строка — тонированная плитка своего смысла (приглашения=бренд,
  // обновления=info, что нового=AI): «живость» цветом и поверхностью, без
  // единой новой строки текста и без нового CSS.
  const rows = [
    { icon: 'users', tone: 'brand', title: t('notif.invitations'), sub: t('notif.invitations_desc') },
    { icon: 'refresh', tone: 'info', title: t('notif.updates'), sub: t('notif.updates_desc') },
    { icon: 'sparkles', tone: 'ai', title: t('notif.whats_new'), sub: t('notif.whats_new_desc') },
  ];
  return (
    <EmptyState
      icon="bell"
      title={t('notif.inbox_empty')}
      body={t('notif.inbox_empty_lead')}
      action={
        <div className="col col--g6 grow--fit">
          <Card pad="none" radius="md">
            {rows.map((r) => (
              <ListRow key={r.icon} variant="divider" lead={<Tile icon={r.icon} tone={r.tone} />} title={r.title} sub={r.sub} />
            ))}
          </Card>
          <Btn variant="primary" icon="plus" block onClick={onCollection}>{t('notif.to_collection')}</Btn>
        </div>
      }
    />
  );
}

// Строка экрана = канон `<NotifRow>` (полноразмерный) + слоты действий. Резолв —
// тот же `buildNotifView`, что у поповера: одна строка, две поверхности.
// `pinned` — строка закреплённого блока решений: без unread-подложки (двойной
// акцент поверх бренд-карточки не нужен) и без клика (цели — только кнопки).
function InboxRow({ n, t, nav, fmtRelative, pendingAction, onRespond, onMarkRead, pinned = false }) {
  // Invite status comes with the row now (getInbox joins trip_members) — no
  // per-row `.from('trip_members')` waterfall (TRIP-408).
  const memberStatus = n.member_status;
  const { glyph, isInvite, titleNode, messageText, messageNode, showLink } = buildNotifView(n, t, { deletedLabel: t('common.deleted_user') });
  const showPending = isInvite && memberStatus === 'pending';
  const status = isInvite && memberStatus === 'active'
    ? <Badge variant="success" icon="check">{t('notif.accepted')}</Badge>
    : isInvite && memberStatus === 'declined'
      ? <Badge variant="quiet">{t('notif.declined')}</Badge>
      : null;
  const hasActions = showPending || status || showLink;

  const actions = hasActions ? (
    <>
      {showPending && (
        <>
          <Btn variant="primary" icon="check" loading={pendingAction === 'accept'} disabled={!!pendingAction} onClick={() => onRespond('accept')}>{t('notif.accept')}</Btn>
          <Btn variant="secondary" loading={pendingAction === 'decline'} disabled={!!pendingAction} onClick={() => onRespond('decline')}>{t('notif.decline')}</Btn>
        </>
      )}
      {status}
      {showLink && (
        <Btn variant="link" icon="pin" onClick={() => nav(`/trip/${n.trip_id}`)}>{t('notif.view_trip')}</Btn>
      )}
    </>
  ) : null;

  return (
    <NotifRow
      glyph={glyph}
      unread={!pinned && !n.read}
      title={titleNode}
      message={messageText ? messageNode : null}
      time={fmtRelative(n.created_at)}
      actions={actions}
      onClick={pinned ? undefined : () => { if (!n.read) onMarkRead?.(); }}
    />
  );
}
